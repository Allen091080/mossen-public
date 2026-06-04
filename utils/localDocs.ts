import { getProductDisplayName } from '../constants/product.js'
import { getLocalizedText } from './uiLanguage.js'

export type LocalDocTopic = {
  id: string
  aliases: string[]
  title: string
  summary: string
  bullets: string[]
  commands: string[]
}

function normalizeTopicQuery(value: string): string {
  return value.trim().toLowerCase().replace(/^\/+/, '')
}

export function getLocalDocTopics(): LocalDocTopic[] {
  const product = getProductDisplayName()
  return [
    {
      id: 'quickstart',
      aliases: ['start', 'intro', '入门', '开始'],
      title: getLocalizedText({ en: 'Quickstart', zh: '快速开始' }),
      summary: getLocalizedText({
        en: `Start ${product}, choose a model profile, and ask for one concrete task at a time.`,
        zh: `启动 ${product}，选择模型配置，然后一次交给它一个明确任务。`,
      }),
      bullets: [
        getLocalizedText({
          en: 'Run /init in a project to create MOSSEN.md with project guidance.',
          zh: '在项目里运行 /init，创建 MOSSEN.md 项目说明。',
        }),
        getLocalizedText({
          en: 'Use /model doctor and /model test after changing provider settings.',
          zh: '修改模型供应商配置后，运行 /model doctor 和 /model test。',
        }),
        getLocalizedText({
          en: 'Use /help for command browsing and /docs <topic> for task-oriented guides.',
          zh: '用 /help 浏览命令，用 /docs <topic> 查看面向任务的指南。',
        }),
      ],
      commands: ['/init', '/model doctor', '/model test', '/help', '/docs'],
    },
    {
      id: 'model',
      aliases: ['models', 'provider', 'profile', 'baseurl', '模型', '配置'],
      title: getLocalizedText({ en: 'Models and providers', zh: '模型与供应商' }),
      summary: getLocalizedText({
        en: 'Profiles decide which provider adapter, base URL, model, auth header, and token limits are used.',
        zh: '模型配置决定供应商适配器、baseURL、模型名、鉴权头和 token 上限。',
      }),
      bullets: [
        getLocalizedText({
          en: 'openai-compatible profiles use the OpenAI adapter and Bearer auth.',
          zh: 'openai-compatible 配置走 OpenAI 适配器和 Bearer 鉴权。',
        }),
        getLocalizedText({
          en: 'messages-compatible profiles use the message API path and x-api-key auth.',
          zh: 'messages-compatible 配置走消息 API 路径和 x-api-key 鉴权。',
        }),
        getLocalizedText({
          en: 'Enable 1M context per supported model; the default remains conservative.',
          zh: '对支持的模型按模型开启 1M 上下文；默认仍保持保守。',
        }),
      ],
      commands: ['/model add', '/model use', '/model doctor', '/model test'],
    },
    {
      id: 'agent-view',
      aliases: ['agents', 'agent', 'bg', 'background', '后台', '智能体'],
      title: getLocalizedText({ en: 'Agent View', zh: 'Agent View 后台任务' }),
      summary: getLocalizedText({
        en: 'Agent View manages background jobs, local tasks, shells, replies, summaries, wait, purge, and gc.',
        zh: 'Agent View 管理后台任务、本地任务、shell、回复、摘要、wait、purge 和 gc。',
      }),
      bullets: [
        getLocalizedText({
          en: 'Run mossen agents to open the dashboard; /agents opens agent definitions, and /agents view is the compatibility dashboard entry.',
          zh: '运行 mossen agents 打开面板；/agents 打开智能体配置，/agents view 是兼容的面板入口。',
        }),
        getLocalizedText({
          en: 'Type a task to dispatch, / to choose task skills/templates, Space peeks/replies, Enter/→ attaches, and ? shows shortcuts.',
          zh: '输入任务即可派发，/ 选择任务技能/模板，Space 查看/回复，Enter/→ 进入任务，? 查看快捷键。',
        }),
        getLocalizedText({
          en: 'Use mossen wait <id> for automation and mossen rm <id> --dry-run before cleanup.',
          zh: '自动化脚本用 mossen wait <id>，清理前先用 mossen rm <id> --dry-run。',
        }),
      ],
      commands: ['mossen agents', '/agents view', '/bg <task>', 'mossen --bg', 'mossen wait <id>', 'mossen rm <id> --dry-run'],
    },
    {
      id: 'goal',
      aliases: ['goals', 'objective', '目标'],
      title: getLocalizedText({ en: 'Goal mode', zh: '目标模式' }),
      summary: getLocalizedText({
        en: 'Goal mode tracks a cross-turn completion condition without changing normal chat unless enabled.',
        zh: '目标模式追踪跨轮完成条件；不启用时不改变普通对话。',
      }),
      bullets: [
        getLocalizedText({
          en: 'Use /goal set <goal> to start the evaluator.',
          zh: '用 /goal set <目标> 启动评估器。',
        }),
        getLocalizedText({
          en: 'Ctrl+G hides or shows the floating goal overlay.',
          zh: 'Ctrl+G 隐藏或显示右上角目标浮层。',
        }),
        getLocalizedText({
          en: 'Token estimates are predictive only; personal edition does not bill budget.',
          zh: 'token 只是预测消耗；个人版不做费用预算扣费。',
        }),
      ],
      commands: ['/goal', '/goal set <goal>', '/goal clear'],
    },
    {
      id: 'memory',
      aliases: ['remember', 'sidecar', '记忆'],
      title: getLocalizedText({ en: 'Memory', zh: '记忆系统' }),
      summary: getLocalizedText({
        en: 'Memory keeps stable user, project, and handoff facts outside the active prompt.',
        zh: '记忆系统把稳定的用户、项目和交接事实放在当前 prompt 之外。',
      }),
      bullets: [
        getLocalizedText({
          en: 'Saved memories appear when the assistant extracts stable facts.',
          zh: '当助手提取到稳定事实时，会显示 Saved memories。',
        }),
        getLocalizedText({
          en: 'Agent memory handoff lets background jobs leave useful findings for later work.',
          zh: 'Agent memory handoff 让后台任务把有用发现留给后续任务。',
        }),
        getLocalizedText({
          en: 'Use memory-sidecar governance commands for health, archive, and retention checks.',
          zh: '用 memory-sidecar governance 命令检查健康、归档和保留策略。',
        }),
      ],
      commands: ['/memory', '/memory-sidecar governance status', '/memory-sidecar governance plan'],
    },
    {
      id: 'mcp',
      aliases: ['server', 'servers', 'tools', '工具'],
      title: getLocalizedText({ en: 'MCP and tools', zh: 'MCP 与工具' }),
      summary: getLocalizedText({
        en: 'MCP servers add tools; diagnostics explain broken servers, retries, and protocol noise.',
        zh: 'MCP server 提供工具；诊断会解释异常 server、重试和协议噪声。',
      }),
      bullets: [
        getLocalizedText({
          en: 'Use /mcp to inspect configured servers and reconnect where supported.',
          zh: '用 /mcp 检查已配置 server，并在支持时重连。',
        }),
        getLocalizedText({
          en: 'Use /doctor when tools vanish, list fails, or stderr is noisy.',
          zh: '工具消失、list 失败或 stderr 很吵时，用 /doctor。',
        }),
        getLocalizedText({
          en: 'Permission prompts should explain why a tool is asking before it runs.',
          zh: '权限弹窗应在工具运行前说明为什么需要授权。',
        }),
      ],
      commands: ['/mcp', '/doctor', '/permissions'],
    },
    {
      id: 'plugin',
      aliases: ['plugins', 'extension', 'extensions', '插件', '扩展'],
      title: getLocalizedText({ en: 'Plugins and extensions', zh: '插件与扩展' }),
      summary: getLocalizedText({
        en: 'Plugins and extensions add packaged commands, skills, hooks, and integrations.',
        zh: '插件与扩展提供打包命令、技能、hook 和集成。',
      }),
      bullets: [
        getLocalizedText({
          en: 'Use /plugin for plugin status and /extensions for extension diagnostics.',
          zh: '用 /plugin 查看插件状态，用 /extensions 做扩展诊断。',
        }),
        getLocalizedText({
          en: 'Prefer HTTPS plugin clone mode when network policy blocks SSH.',
          zh: '网络策略禁止 SSH 时，优先使用 HTTPS 插件 clone 模式。',
        }),
        getLocalizedText({
          en: 'Run doctor checks after installing or disabling plugin packages.',
          zh: '安装或禁用插件包后运行 doctor 检查。',
        }),
      ],
      commands: ['/plugin', '/extensions', '/doctor'],
    },
    {
      id: 'troubleshooting',
      aliases: ['debug', 'doctor', 'fix', '排障', '问题'],
      title: getLocalizedText({ en: 'Troubleshooting', zh: '排障' }),
      summary: getLocalizedText({
        en: 'Start with doctor, model doctor, Agent View doctor, and focused smoke output before changing code.',
        zh: '先看 doctor、model doctor、Agent View doctor 和 focused smoke 输出，再改代码。',
      }),
      bullets: [
        getLocalizedText({
          en: 'If a provider call fails, verify provider, baseURL, model, auth header, and model test.',
          zh: '供应商调用失败时，核对 provider、baseURL、模型、鉴权头和 model test。',
        }),
        getLocalizedText({
          en: 'If a background job looks stuck, inspect /agents, logs, events, and wait status.',
          zh: '后台任务疑似卡住时，检查 /agents、logs、events 和 wait 状态。',
        }),
        getLocalizedText({
          en: 'If terminal input looks odd, check paste/focus handling and scroll-speed settings.',
          zh: '终端输入异常时，检查粘贴/focus 处理和 scroll-speed 设置。',
        }),
      ],
      commands: ['/doctor', '/model doctor', '/agents --doctor', '/scroll-speed'],
    },
  ]
}

export function findLocalDocTopic(query: string | undefined): LocalDocTopic | null {
  const normalized = normalizeTopicQuery(query ?? '')
  if (!normalized) return null
  return (
    getLocalDocTopics().find(
      topic =>
        topic.id === normalized ||
        topic.aliases.some(alias => normalizeTopicQuery(alias) === normalized),
    ) ?? null
  )
}

export function getLocalDocTopicIds(): string[] {
  return getLocalDocTopics().map(topic => topic.id)
}
