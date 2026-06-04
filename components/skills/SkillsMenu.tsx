import capitalize from 'lodash-es/capitalize.js';
import * as React from 'react';
import { useMemo, useState } from 'react';
import { useInput } from 'ink';
import { type Command, type CommandBase, type CommandResultDisplay, getCommandName, type PromptCommand } from '../../commands.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { Box, Text } from '../../ink.js';
import { estimateSkillFrontmatterTokens, getSkillsPath } from '../../skills/loadSkillsDir.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatTokens } from '../../utils/format.js';
import { getSettingSourceName, type SettingSource } from '../../utils/settings/constants.js';
import { plural } from '../../utils/stringUtils.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Dialog } from '../design-system/Dialog.js';
import TextInput from '../TextInput.js';

// Skills are always PromptCommands with CommandBase properties
type SkillCommand = CommandBase & PromptCommand;
type SkillSource = SettingSource | 'bundled' | 'plugin' | 'mcp';
type Props = {
  onExit: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  commands: Command[];
};

// Render order across source groups (matches the pre-search layout).
const SOURCE_RENDER_ORDER: readonly SkillSource[] = [
  'projectSettings',
  'userSettings',
  'policySettings',
  'bundled',
  'plugin',
  'mcp',
];

// W56: source filter chip set. 'all' === no filter; the order matches the
// render order above so the chip strip reads top-to-bottom on screen.
type SourceFilter = SkillSource | 'all';
const SOURCE_FILTER_ORDER: readonly SourceFilter[] = [
  'all',
  'projectSettings',
  'userSettings',
  'policySettings',
  'bundled',
  'plugin',
  'mcp',
];

function getFilterChipLabel(f: SourceFilter): string {
  if (f === 'all') return 'all';
  if (f === 'bundled') return getLocalizedText({ en: 'bundled', zh: '内置' });
  if (f === 'plugin') return 'plugin';
  if (f === 'mcp') return 'mcp';
  // Settings sources: use the existing localized label.
  return capitalize(getSettingSourceName(f));
}

function getSourceTitle(source: SkillSource): string {
  if (source === 'bundled') {
    return getLocalizedText({ en: 'Bundled skills', zh: '内置 skills' });
  }
  if (source === 'plugin') {
    return 'Plugin skills';
  }
  if (source === 'mcp') {
    return 'MCP skills';
  }
  return `${capitalize(getSettingSourceName(source))} skills`;
}

function getSourceSubtitle(source: SkillSource, skills: SkillCommand[]): string | undefined {
  // MCP skills show server names; file-based skills show filesystem paths.
  // Skill names are `<server>:<skill>`, not `mcp__<server>__…`.
  if (source === 'mcp') {
    const servers = [...new Set(skills.map(s => {
      const idx = s.name.indexOf(':');
      return idx > 0 ? s.name.slice(0, idx) : null;
    }).filter((n): n is string => n != null))];
    return servers.length > 0 ? servers.join(', ') : undefined;
  }
  if (source === 'bundled') {
    return getLocalizedText({ en: 'Built into Mossen', zh: 'Mossen 内置' });
  }
  const skillsPath = getDisplayPath(getSkillsPath(source, 'skills'));
  const hasCommandsSkills = skills.some(s => s.loadedFrom === 'commands_DEPRECATED');
  return hasCommandsSkills ? `${skillsPath}, ${getDisplayPath(getSkillsPath(source, 'commands'))}` : skillsPath;
}

function isSkillCommand(cmd: Command): boolean {
  return cmd.type === 'prompt' && (
    cmd.loadedFrom === 'skills' ||
    cmd.loadedFrom === 'commands_DEPRECATED' ||
    cmd.loadedFrom === 'bundled' ||
    cmd.loadedFrom === 'plugin' ||
    cmd.loadedFrom === 'mcp'
  );
}

function getSkillSearchableText(skill: SkillCommand): string {
  // Search corpus: name + description + source label. Lowercased so the
  // matcher is case-insensitive without per-call work.
  const sourceLabel = getSourceTitle(skill.source as SkillSource);
  const description = typeof skill.description === 'string' ? skill.description : '';
  const pluginName =
    skill.source === 'plugin' && skill.pluginInfo?.pluginManifest.name
      ? skill.pluginInfo.pluginManifest.name
      : '';
  return `${getCommandName(skill)} ${description} ${sourceLabel} ${pluginName}`.toLowerCase();
}

function matchesSearch(skill: SkillCommand, normalizedQuery: string): boolean {
  if (normalizedQuery === '') return true;
  return getSkillSearchableText(skill).includes(normalizedQuery);
}

function compareByName(a: SkillCommand, b: SkillCommand): number {
  return getCommandName(a).localeCompare(getCommandName(b));
}

function renderSkill(skill: SkillCommand): React.ReactNode {
  const estimatedTokens = estimateSkillFrontmatterTokens(skill);
  const tokenDisplay = `~${formatTokens(estimatedTokens)}`;
  const pluginName = skill.source === 'plugin' ? skill.pluginInfo?.pluginManifest.name : undefined;
  return (
    <Box key={`${skill.name}-${skill.source}`}>
      <Text>{getCommandName(skill)}</Text>
      <Text dimColor>{pluginName ? ` · ${pluginName}` : ''} · {tokenDisplay} description tokens</Text>
    </Box>
  );
}

export function SkillsMenu({ onExit, commands }: Props): React.ReactNode {
  // All hooks must run unconditionally on every render — no early-returns
  // before this block. The empty-corpus branch reuses the same hook order.
  const allSkills = useMemo<SkillCommand[]>(
    () => commands.filter(isSkillCommand) as SkillCommand[],
    [commands],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const { columns } = useTerminalSize();

  // Tab cycles forward through SOURCE_FILTER_ORDER; Shift+Tab cycles back.
  // Read-only — never mutates the skill registry, loader, or invocation path.
  useInput((_input, key) => {
    if (allSkills.length === 0) return;
    if (!key.tab) return;
    const idx = SOURCE_FILTER_ORDER.indexOf(sourceFilter);
    const nextIdx = key.shift
      ? (idx - 1 + SOURCE_FILTER_ORDER.length) % SOURCE_FILTER_ORDER.length
      : (idx + 1) % SOURCE_FILTER_ORDER.length;
    setSourceFilter(SOURCE_FILTER_ORDER[nextIdx]!);
  });

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredSkills = useMemo(
    () => {
      let working = allSkills;
      if (sourceFilter !== 'all') {
        working = working.filter(s => (s.source as SkillSource) === sourceFilter);
      }
      if (normalizedQuery !== '') {
        working = working.filter(skill =>
          matchesSearch(skill, normalizedQuery),
        );
      }
      return working;
    },
    [allSkills, normalizedQuery, sourceFilter],
  );

  // Group filtered skills by source, sorted by name within each group.
  const skillsBySource = useMemo(() => {
    const groups: Record<SkillSource, SkillCommand[]> = {
      policySettings: [],
      userSettings: [],
      projectSettings: [],
      localSettings: [],
      flagSettings: [],
      bundled: [],
      plugin: [],
      mcp: [],
    };
    for (const skill of filteredSkills) {
      const source = skill.source as SkillSource;
      if (source in groups) {
        groups[source].push(skill);
      }
    }
    for (const group of Object.values(groups)) {
      group.sort(compareByName);
    }
    return groups;
  }, [filteredSkills]);

  const handleCancel = (): void => {
    onExit('Skills dialog dismissed', { display: 'system' });
  };

  // Empty-corpus path (no skills loaded) — keep the original message and
  // bypass the search row entirely. Placed AFTER hooks to preserve order.
  if (allSkills.length === 0) {
    return (
      <Dialog
        title="Skills"
        subtitle="No skills found"
        onCancel={handleCancel}
        hideInputGuide
      >
        <Text dimColor>Create skills in .mossen/skills/ or ~/.mossen/skills/</Text>
        <Text dimColor italic>
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="close"
          />
        </Text>
      </Dialog>
    );
  }

  const matchCountLabel = normalizedQuery === ''
    ? `${allSkills.length} ${plural(allSkills.length, 'skill')}`
    : getLocalizedText({
        en: `${filteredSkills.length} of ${allSkills.length} ${plural(allSkills.length, 'skill')}`,
        zh: `${filteredSkills.length} / ${allSkills.length} 个技能`,
      });

  const searchPlaceholder = getLocalizedText({
    en: 'Search by name, description, or source',
    zh: '按名称、描述或来源搜索',
  });

  const emptyResultMessage = getLocalizedText({
    en: `No skills match "${searchQuery}"`,
    zh: `没有匹配 "${searchQuery}" 的技能`,
  });

  return (
    <Dialog
      title="Skills"
      subtitle={matchCountLabel}
      onCancel={handleCancel}
      hideInputGuide
    >
      <Box flexDirection="column" gap={1}>
        <Box>
          <Text dimColor>🔍 </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={searchPlaceholder}
            columns={Math.max(columns - 6, 20)}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            showCursor
          />
        </Box>
        <Box>
          <Text dimColor>{getLocalizedText({ en: 'Filter: ', zh: '筛选: ' })}</Text>
          {SOURCE_FILTER_ORDER.map((f, idx) => {
            const active = f === sourceFilter;
            const label = getFilterChipLabel(f);
            return (
              <React.Fragment key={f}>
                {idx > 0 && <Text dimColor> · </Text>}
                <Text bold={active} inverse={active} dimColor={!active}>
                  {' '}{label}{' '}
                </Text>
              </React.Fragment>
            );
          })}
          <Text dimColor>
            {getLocalizedText({
              en: '   (Tab / Shift+Tab to cycle)',
              zh: '   （Tab / Shift+Tab 切换）',
            })}
          </Text>
        </Box>
        {filteredSkills.length === 0 ? (
          <Box>
            <Text dimColor italic>{emptyResultMessage}</Text>
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            {SOURCE_RENDER_ORDER.map(source => {
              const groupSkills = skillsBySource[source];
              if (groupSkills.length === 0) return null;
              const title = getSourceTitle(source);
              const subtitle = getSourceSubtitle(source, groupSkills);
              return (
                <Box flexDirection="column" key={source}>
                  <Box>
                    <Text bold dimColor>{title}</Text>
                    {subtitle && <Text dimColor> ({subtitle})</Text>}
                  </Box>
                  {groupSkills.map(renderSkill)}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
      <Text dimColor italic>
        <ConfigurableShortcutHint
          action="confirm:no"
          context="Confirmation"
          fallback="Esc"
          description="close"
        />
      </Text>
    </Dialog>
  );
}
