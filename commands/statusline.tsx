import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Command, LocalJSXCommandCall } from '../types/command.js';
import { getProductDisplayName } from '../constants/product.js';
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js';
import { getMossenConfigHomeDir } from '../utils/envUtils.js';
import { getLocalizedText } from '../utils/uiLanguage.js';

async function getExistingStatusLineCommand(): Promise<string | null> {
  try {
    const settingsPath = join(getMossenConfigHomeDir(), 'settings.json');
    const raw = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    const command = settings?.statusLine?.command;
    return 'string' === typeof command && command.length > 0 ? command : null;
  } catch {
    return null;
  }
}

type StatusLineInspection = {
  command: string | null;
  exists: boolean;
  padding: number | null;
  scriptReadable: boolean;
  scriptPath: string | null;
  scriptSummary: string | null;
};

function unquoteShellToken(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function expandHomePath(path: string): string {
  return path === '~' ? homedir() : path.replace(/^~(?=\/)/, homedir());
}

function getStatusLineScriptPath(command: string): string | null {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const executable = unquoteShellToken(tokens[0] ?? '');
  const scriptToken =
    executable === 'bash' || executable === 'sh' || executable === 'zsh'
      ? tokens[1]
      : tokens[0];
  if (!scriptToken) {
    return null;
  }
  return expandHomePath(unquoteShellToken(scriptToken));
}

function getStatusLineScriptSummary(script: string): string | null {
  const features: string[] = [];

  if (script.includes('display_name') || script.includes('model')) {
    features.push(
      getLocalizedText({
        en: 'model',
        zh: '模型',
      }),
    );
  }
  if (script.includes('context_window') || script.includes('used_percentage')) {
    features.push(
      getLocalizedText({
        en: 'context usage',
        zh: '上下文占用',
      }),
    );
  }
  if (script.includes('session_id') || script.includes('uptime')) {
    features.push(
      getLocalizedText({
        en: 'session uptime',
        zh: '会话时长',
      }),
    );
  }
  if (script.includes('rate_limits')) {
    features.push(
      getLocalizedText({
        en: 'rate limits',
        zh: '限额',
      }),
    );
  }
  if (script.includes('current_dir') || script.includes('cwd')) {
    features.push(
      getLocalizedText({
        en: 'workspace path',
        zh: '工作目录',
      }),
    );
  }
  if (script.includes('vim')) {
    features.push(
      getLocalizedText({
        en: 'editor mode',
        zh: '编辑模式',
      }),
    );
  }

  if (!features.length) {
    return null;
  }

  return getLocalizedText({
    en: `Current script appears to show: ${features.join(', ')}`,
    zh: `当前脚本看起来会显示：${features.join('、')}`,
  });
}

async function inspectStatusLine(): Promise<StatusLineInspection> {
  const settingsPath = join(getMossenConfigHomeDir(), 'settings.json');

  try {
    const raw = await readFile(settingsPath, 'utf8');
    const settings = JSON.parse(raw);
    const statusLine = settings?.statusLine;
    const command =
      'string' === typeof statusLine?.command && statusLine.command.length > 0
        ? statusLine.command
        : null;
    const padding =
      'number' === typeof statusLine?.padding ? statusLine.padding : null;

    if (!statusLine || !command) {
      return {
        command: null,
        exists: false,
        padding,
        scriptReadable: false,
        scriptPath: null,
        scriptSummary: null,
      };
    }

    const scriptPath = getStatusLineScriptPath(command);
    try {
      const script = await readFile(scriptPath ?? command, 'utf8');
      return {
        command,
        exists: true,
        padding,
        scriptReadable: true,
        scriptPath,
        scriptSummary: getStatusLineScriptSummary(script),
      };
    } catch {
      return {
        command,
        exists: true,
        padding,
        scriptReadable: false,
        scriptPath,
        scriptSummary: null,
      };
    }
  } catch {
    return {
      command: null,
      exists: false,
      padding: null,
      scriptReadable: false,
      scriptPath: null,
      scriptSummary: null,
    };
  }
}

function buildStatusLineSummary(inspection: StatusLineInspection): string {
  if (!inspection.exists || !inspection.command) {
    return getLocalizedText({
      en: [
        'No statusLine is configured right now.',
        `Checked: ${join(getMossenConfigHomeDir(), 'settings.json')}`,
        'If you want to change it, run `/statusline <what to change>`.',
      ].join('\n'),
      zh: [
        '当前还没有配置 statusLine。',
        `已检查：${join(getMossenConfigHomeDir(), 'settings.json')}`,
        '如果你要修改它，请直接运行 `/statusline <你想改成什么>`。',
      ].join('\n'),
    });
  }

  const scriptLine = inspection.scriptReadable
    ? getLocalizedText({
        en: `Script file found: ${inspection.scriptPath ?? inspection.command}`,
        zh: `脚本文件已找到：${inspection.scriptPath ?? inspection.command}`,
      })
    : getLocalizedText({
        en: `Configured command points to an unreadable file: ${inspection.command}`,
        zh: `当前命令指向了一个无法读取的文件：${inspection.command}`,
      });

  const summaryLine =
    inspection.scriptSummary ??
    getLocalizedText({
      en: `Current script basename: ${basename(inspection.command)}`,
      zh: `当前脚本文件名：${basename(inspection.command)}`,
    });

  return [
    getLocalizedText({
      en: 'Current statusLine setup',
      zh: '当前 statusLine 配置',
    }),
    getLocalizedText({
      en: `Type: command`,
      zh: '类型：command',
    }),
    getLocalizedText({
      en: `Command: ${inspection.command}`,
      zh: `命令：${inspection.command}`,
    }),
    getLocalizedText({
      en: `Padding: ${inspection.padding ?? 0}`,
      zh: `Padding：${inspection.padding ?? 0}`,
    }),
    scriptLine,
    summaryLine,
    getLocalizedText({
      en: 'If you want to update it, run `/statusline <what to change>`.',
      zh: '如果你要修改它，请直接运行 `/statusline <你想改成什么>`。',
    }),
  ].join('\n');
}

function buildAgentPrompt(args: string, existingStatusLineCommand: string | null): string {
  const trimmed = args.trim();
  return (
    trimmed ||
    (existingStatusLineCommand
      ? `Inspect my current statusLine setup first. ~/.mossen/settings.json already contains statusLine.command = "${existingStatusLineCommand}". Explain or update that existing setup. Do not ask whether a statusLine exists. Only import from my shell PS1 if I explicitly ask to replace it from PS1.`
      : 'Inspect my current statusLine setup first. If a statusLine is already configured, explain or update that existing setup. Only import from my shell PS1 if no statusLine is configured or if I explicitly ask to replace it from PS1.')
  );
}

const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmed = args.trim();

  if (!trimmed) {
    const inspection = await inspectStatusLine();
    onDone(buildStatusLineSummary(inspection), {
      display: 'system',
    });
    return null;
  }

  const existingStatusLineCommand = await getExistingStatusLineCommand();
  const prompt = buildAgentPrompt(trimmed, existingStatusLineCommand);

  onDone(
    getLocalizedText({
      en: 'Inspecting and updating the current statusLine setup…',
      zh: '正在检查并更新当前 statusLine 配置…',
    }),
    {
      display: 'system',
      shouldQuery: true,
      metaMessages: [
        `Create exactly one ${AGENT_TOOL_NAME} with subagent_type "statusline-setup" and the prompt "${prompt}". After the agent returns, respond to the user with its result directly and stop. Do not create tasks, plans, additional agents, or TaskCreate calls.`,
      ],
    },
  );
  return null;
};

const statusline = {
  type: 'local-jsx',
  description: `Set up the ${getProductDisplayName()} status line UI`,
  aliases: [],
  name: 'statusline',
  load: () => Promise.resolve({ call }),
} satisfies Command;
export default statusline;
