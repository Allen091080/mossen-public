/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import type { SettingSource } from 'src/utils/settings/constants.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import type { ResolvedAgent } from '../../tools/AgentTool/agentDisplay.js';
import {
  AGENT_SOURCE_GROUPS,
  compareAgentsByName,
  getOverrideSourceLabel,
  resolveAgentModelDisplay,
} from '../../tools/AgentTool/agentDisplay.js';
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { Divider } from '../design-system/Divider.js';

type Props = {
  source: SettingSource | 'all' | 'built-in' | 'plugin';
  agents: ResolvedAgent[];
  onBack: () => void;
  onOpenRunning?: () => void;
  onSelect: (agent: AgentDefinition) => void;
  onCreateNew?: () => void;
  changes?: string[];
};

export function AgentsTabs({
  active,
}: {
  active: 'running' | 'library';
}): React.ReactNode {
  return (
    <Box marginBottom={1}>
      <Text bold color="suggestion">
        Agents
      </Text>
      <Text>  </Text>
      <Text inverse={active === 'running'} bold={active === 'running'}>
        {' '}
        Running
        {' '}
      </Text>
      <Text>  </Text>
      <Text inverse={active === 'library'} bold={active === 'library'}>
        {' '}
        Library
        {' '}
      </Text>
    </Box>
  );
}

export function AgentsList({
  source,
  agents,
  onBack,
  onOpenRunning,
  onSelect,
  onCreateNew,
  changes,
}: Props): React.ReactNode {
  const [selectedAgent, setSelectedAgent] = React.useState<ResolvedAgent | null>(null);
  const [isCreateNewSelected, setIsCreateNewSelected] = React.useState(true);

  const sortedAgents = React.useMemo(() => [...agents].sort(compareAgentsByName), [agents]);

  const selectableAgentsInOrder = React.useMemo(() => {
    const nonBuiltIn = sortedAgents.filter(agent => agent.source !== 'built-in');
    if (source === 'all') {
      return AGENT_SOURCE_GROUPS
        .filter(group => group.source !== 'built-in')
        .flatMap(group => nonBuiltIn.filter(agent => agent.source === group.source));
    }
    return nonBuiltIn;
  }, [sortedAgents, source]);

  React.useEffect(() => {
    if (!selectedAgent && !isCreateNewSelected && selectableAgentsInOrder.length > 0) {
      if (onCreateNew) {
        setIsCreateNewSelected(true);
      } else {
        setSelectedAgent(selectableAgentsInOrder[0] ?? null);
      }
    }
  }, [selectableAgentsInOrder, selectedAgent, isCreateNewSelected, onCreateNew]);

  const getOverrideInfo = React.useCallback(
    (agent: ResolvedAgent) => {
      if (agent.overriddenBy) {
        return { isOverridden: true, overriddenBy: agent.overriddenBy };
      }
      return { isOverridden: false, overriddenBy: undefined };
    },
    [],
  );

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'left' || event.key === 'right') {
      event.preventDefault();
      onOpenRunning?.();
      return;
    }
    if (event.key === 'escape') {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key === 'return') {
      event.preventDefault();
      if (isCreateNewSelected && onCreateNew) {
        onCreateNew();
      } else if (selectedAgent) {
        onSelect(selectedAgent);
      }
      return;
    }
    if (event.key !== 'up' && event.key !== 'down') return;

    event.preventDefault();
    const hasCreateOption = !!onCreateNew;
    const totalItems = selectableAgentsInOrder.length + (hasCreateOption ? 1 : 0);
    if (totalItems === 0) return;

    let currentPosition = 0;
    if (!isCreateNewSelected && selectedAgent) {
      const agentIndex = selectableAgentsInOrder.findIndex(
        agent => agent.agentType === selectedAgent.agentType && agent.source === selectedAgent.source,
      );
      if (agentIndex >= 0) {
        currentPosition = hasCreateOption ? agentIndex + 1 : agentIndex;
      }
    }

    const newPosition =
      event.key === 'up'
        ? currentPosition === 0
          ? totalItems - 1
          : currentPosition - 1
        : currentPosition === totalItems - 1
          ? 0
          : currentPosition + 1;

    if (hasCreateOption && newPosition === 0) {
      setIsCreateNewSelected(true);
      setSelectedAgent(null);
      return;
    }

    const agentIndex = hasCreateOption ? newPosition - 1 : newPosition;
    const newAgent = selectableAgentsInOrder[agentIndex];
    if (newAgent) {
      setIsCreateNewSelected(false);
      setSelectedAgent(newAgent);
    }
  };

  const renderCreateNewOption = () => (
    <Box>
      <Text color={isCreateNewSelected ? 'suggestion' : undefined}>
        {isCreateNewSelected ? `${figures.pointer} ` : '  '}
      </Text>
      <Text color={isCreateNewSelected ? 'suggestion' : undefined}>
        {getLocalizedText({ en: 'Create new agent', zh: '创建新 agent' })}
      </Text>
    </Box>
  );

  const renderAgent = (agent_0: ResolvedAgent) => {
    const agent = agent_0;
    const isBuiltIn = agent.source === 'built-in';
    const isSelected =
      !isBuiltIn &&
      !isCreateNewSelected &&
      selectedAgent?.agentType === agent.agentType &&
      selectedAgent?.source === agent.source;
    const { isOverridden, overriddenBy } = getOverrideInfo(agent);
    const dimmed = isBuiltIn || isOverridden;
    const textColor = !isBuiltIn && isSelected ? 'suggestion' : undefined;
    const resolvedModel = resolveAgentModelDisplay(agent_0);

    return (
      <Box key={`${agent.agentType}-${agent.source}`}>
        <Text dimColor={dimmed && !isSelected} color={textColor}>
          {isBuiltIn ? '' : isSelected ? `${figures.pointer} ` : '  '}
        </Text>
        <Text dimColor={dimmed && !isSelected} color={textColor}>
          {agent.agentType}
        </Text>
        {resolvedModel ? (
          <Text dimColor color={textColor}>
            {' '}
            · {resolvedModel}
          </Text>
        ) : null}
        {agent.memory ? (
          <Text dimColor color={textColor}>
            {' '}
            · {agent.memory} {getLocalizedText({ en: 'memory', zh: '记忆' })}
          </Text>
        ) : null}
        {overriddenBy ? (
          <Text dimColor={!isSelected} color={isSelected ? 'warning' : undefined}>
            {' '}
            {figures.warning} {getLocalizedText({ en: 'shadowed by', zh: '被覆盖于' })}{' '}
            {getOverrideSourceLabel(overriddenBy)}
          </Text>
        ) : null}
      </Box>
    );
  };

  const renderBuiltInAgentsSection = (title?: string) => {
    const builtInAgents = sortedAgents.filter(agent => agent.source === 'built-in');
    if (builtInAgents.length === 0) return null;
    return (
      <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
        <Text bold dimColor>
          {title ?? getLocalizedText({ en: 'Built-in agents (always available):', zh: '内置代理（始终可用）：' })}
        </Text>
        {builtInAgents.map(renderAgent)}
      </Box>
    );
  };

  const renderAgentGroup = (title: string, groupAgents: ResolvedAgent[]) => {
    if (groupAgents.length === 0) return null;
    const folderPath = groupAgents[0]?.baseDir;
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box paddingLeft={2}>
          <Text bold dimColor>
            {title}
          </Text>
          {folderPath ? <Text dimColor> ({folderPath})</Text> : null}
        </Box>
        {groupAgents.map(renderAgent)}
      </Box>
    );
  };

  const hasNoAgents =
    !sortedAgents.length || (source !== 'built-in' && !sortedAgents.some(agent => agent.source !== 'built-in'));
  const nonBuiltInCount = sortedAgents.filter(agent => !agent.overriddenBy).length;

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <AgentsTabs active="library" />
      <Text dimColor>
        {getLocalizedText({ en: `${nonBuiltInCount} agents`, zh: `${nonBuiltInCount} 个 agent` })}
      </Text>
      {changes && changes.length > 0 ? (
        <Box marginTop={1}>
          <Text dimColor>{changes[changes.length - 1]}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1} gap={1}>
        {hasNoAgents ? (
          <>
            {onCreateNew ? <Box>{renderCreateNewOption()}</Box> : null}
            <Text dimColor>
              {getLocalizedText({
                en: 'No agents found. Create specialized subagents that Mossen can delegate to.',
                zh: '未找到任何 agent。你可以创建一些专用子代理，让 Mossen 在需要时进行委派。',
              })}
            </Text>
            <Text dimColor>
              {getLocalizedText({
                en: 'Each subagent has its own context window, custom system prompt, and specific tools.',
                zh: '每个子代理都有自己的上下文窗口、自定义系统提示词和可用工具。',
              })}
            </Text>
            <Text dimColor>
              {getLocalizedText({
                en: 'Try creating: Code Reviewer, Code Simplifier, Security Reviewer, Tech Lead, or UX Reviewer.',
                zh: '可以尝试创建：代码审查员、代码简化员、安全审查员、技术负责人或体验审查员。',
              })}
            </Text>
            {source !== 'built-in' && sortedAgents.some(agent => agent.source === 'built-in') ? (
              <>
                <Divider />
                {renderBuiltInAgentsSection()}
              </>
            ) : null}
          </>
        ) : (
          <>
            {onCreateNew ? <Box marginBottom={1}>{renderCreateNewOption()}</Box> : null}
            {source === 'all' ? (
              <>
                {AGENT_SOURCE_GROUPS.filter(group => group.source !== 'built-in').map(group => (
                  <React.Fragment key={group.source}>
                    {renderAgentGroup(group.label, sortedAgents.filter(agent => agent.source === group.source))}
                  </React.Fragment>
                ))}
                {renderBuiltInAgentsSection(
                  getLocalizedText({ en: 'Built-in agents (always available)', zh: '内置 agents（始终可用）' }),
                )}
              </>
            ) : source === 'built-in' ? (
              <>
                <Text dimColor italic>
                  {getLocalizedText({
                    en: 'Built-in agents are provided by default and cannot be modified.',
                    zh: '内置 agents 默认提供，无法修改。',
                  })}
                </Text>
                <Box marginTop={1} flexDirection="column">
                  {sortedAgents.map(renderAgent)}
                </Box>
              </>
            ) : (
              <>
                {sortedAgents.filter(agent => agent.source !== 'built-in').map(renderAgent)}
                {sortedAgents.some(agent => agent.source === 'built-in') ? (
                  <>
                    <Divider />
                    {renderBuiltInAgentsSection()}
                  </>
                ) : null}
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
