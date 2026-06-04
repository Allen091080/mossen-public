import { getProductAssistantName, getProductDisplayName } from '../constants/product.js'
import type { Command } from '../types/command.js'
import { getCommandName } from '../types/command.js'
import { hasI18nKey, t } from './i18n/index.js'
import { getLocalizedText } from './uiLanguage.js'
import { getMainLoopModel, renderModelName } from './model/model.js'

function localizeSandboxDescription(description: string): string {
  const icon = description.match(/^\S+/)?.[0] ?? ''
  let status = '沙箱已关闭'

  if (description.includes('sandbox enabled (auto-allow)')) {
    status = '沙箱已开启（自动允许）'
  } else if (description.includes('sandbox enabled')) {
    status = '沙箱已开启'
  }

  if (description.includes('fallback allowed')) {
    status += '，允许降级执行'
  }
  if (description.includes('(managed)')) {
    status += '（受策略管理）'
  }

  return `${icon} ${status}（⏎ 配置）`.trim()
}

function localizeTerminalSetupDescription(description: string): string {
  return description.includes('Option+Enter')
    ? '启用 Option+Enter 换行快捷键和视觉铃'
    : '安装 Shift+Enter 换行快捷键'
}

function getChineseBuiltInCommandDescription(
  cmd: Command,
): string | undefined {
  const product = getProductDisplayName()
  const assistant = getProductAssistantName()
  const name = getCommandName(cmd)

  switch (name) {
    case 'add-dir':
      return '添加新的工作目录'
    case 'advisor':
      return '配置 advisor 模型'
    case 'agents':
      return '管理智能体配置'
    case 'assistant':
      return '连接到正在运行的助手会话'
    case 'batch':
      return '把大型变更拆成多个隔离 worktree，并行派发给子任务'
    case 'branch':
      return '在当前节点创建当前对话的分支'
    case 'bridge':
      return '连接此终端以用于远程控制会话'
    case 'btw':
      return '快速问一个支线问题，不打断主对话'
    case 'chrome':
      return `${product} in Chrome（Beta）设置`
    case 'clear':
      return '清空对话历史并释放上下文'
    case 'color':
      return '设置本会话提示栏颜色'
    case 'compact':
      return '清空对话历史，但保留上下文摘要。可选：/compact [摘要说明]'
    case 'config':
      return '打开配置面板'
    case 'context':
      return '显示当前上下文使用情况'
    case 'copy':
      return `复制 ${assistant} 的最新回复到剪贴板（或用 /copy N 复制倒数第 N 条）`
    case 'cost':
      return '显示当前会话的总成本和耗时'
    case 'debug':
      return '为当前会话启用调试日志，并协助诊断问题'
    case 'doc-coauthoring':
      return '撰写 Mossen 技术方案、升级计划、施工包和完成报告'
    case 'desktop':
      return '在桌面配套应用中继续当前会话'
    case 'diff':
      return '查看未提交变更和每轮 diff'
    case 'doctor':
      return `诊断并验证 ${product} 的安装与设置`
    case 'dream':
      return '把近期会话经验沉淀到持久记忆文件，并刷新记忆索引'
    case 'effort':
      return '设置模型使用的推理强度'
    case 'env':
      return '显示当前环境配置'
    case 'exit':
      return '退出交互界面'
    case 'extensions':
      return '查看 Skill、MCP 和 Plugin 的安装命令'
    case 'export':
      return '将当前对话导出到文件或剪贴板'
    case 'fast':
      return '切换快速模式'
    case 'feedback':
      return `提交关于 ${assistant} 的反馈`
    case 'files':
      return '列出当前上下文中的全部文件'
    case 'help':
      return '显示帮助和可用命令'
    case 'heapdump':
      return '将 JS 堆快照导出到 ~/Desktop'
    case 'hooks':
      return '查看工具事件的 hook 配置'
    case 'ide':
      return '管理 IDE 集成并显示状态'
    case 'init':
      return '初始化新的 MOSSEN.md 代码库文档'
    case 'insights':
      return `生成 ${product} 会话分析报告`
    case 'install-github-app':
      return '为仓库设置平台 GitHub 工作流'
    case 'install-slack-app':
      return `安装 ${product} Slack 应用`
    case 'keybindings':
      return '打开或创建按键绑定配置文件'
    case 'lang':
      return '快速切换运行语言'
    case 'login':
      return '显示 Mossen 后端凭据配置指引'
    case 'logout':
      return '清理当前后端的本地认证缓存'
    case 'lsp':
      return '查看和配置 LSP 代码智能能力'
    case 'loop':
      return '按固定间隔重复运行一个提示或斜杠命令（例如 /loop 5m /foo，默认 10m）'
    case 'mcp':
      return '管理 MCP 服务器'
    case 'mcp-builder':
      return '设计和构建符合 Mossen 权限与本地优先约束的 MCP server 和工具 schema'
    case 'memory':
      return `编辑 ${product} 记忆文件`
    case 'memory-sidecar':
      return `旁路记忆系统：自动采集、检索、LLM 整理和 worker 管理`
    case 'mobile':
      return `显示下载 ${product} 手机应用的二维码`
    case 'model':
      return `设置 ${assistant} 使用的 AI 模型（当前 ${renderModelName(getMainLoopModel())}）`
    case 'mossen-memory-development':
      return '安全开发 Mossen 自动记忆、团队记忆、会话记忆、compact 和记忆诊断'
    case 'mossen-permission-safety':
      return '处理 Mossen 权限、bypass 免疫、Auto Mode 和安全敏感行为，且不削弱保护'
    case 'mossen-plugin-development':
      return '设计 Mossen 插件、内置 skills、命令、hooks、MCP 集成、设置和安全边界'
    case 'mossen-protocol-development':
      return '安全开发 Mossen stream-json、control_request、能力清单、schema、文档和 smoke'
    case 'mossen-release-maintenance':
      return '准备 Mossen commit、验证报告、push 指令和发布安全维护摘要'
    case 'mossen-upgrade-planning':
      return '规划 Mossen 升级 wave，明确范围、红线、验证和收尾要求'
    case 'output-style':
      return '已弃用：使用 /config 更改输出样式'
    case 'permissions':
      return '管理工具权限的允许和拒绝规则'
    case 'plan':
      return '开启计划模式或查看当前会话计划'
    case 'plugin':
      return `管理 ${product} 插件`
    case 'plugin-structure':
      return '设计 Mossen 插件目录、manifest、组件文件夹和 review checklist'
    case 'skill-creator':
      return '创建、优化和评估 Mossen skill，确保触发条件明确且 frontmatter 安全'
    case 'skill-development':
      return '创建或优化 Mossen skill，保持触发文本明确且 allowed-tools 策略安全'
    case 'command-development':
      return '新增或 review Mossen slash command，同时保持 parser、router、smoke 和文档约定'
    case 'hook-development':
      return '设计 Mossen hooks，限定安全事件范围，默认禁用高风险行为，并保证失败可观察'
    case 'mcp-integration':
      return '为 Mossen 插件设计 MCP server 集成，不默认自动连接，也不隐藏凭据'
    case 'plugin-settings':
      return '安全规划插件设置、默认值、迁移和用户可见开关'
    case 'agent-development':
      return '设计插件提供的 agents，范围受控、prompt 清晰，并保持工具权限安全'
    case 'project':
      return '管理项目存储（清理会话、保留 memory）'
    case 'pr-comments':
      return '获取 GitHub 拉取请求的评论'
    case 'proactive':
      return '切换主动自治模式'
    case 'profile':
      return '设置个人工作流的执行和推理配置'
    case 'privacy-settings':
      return '查看当前后端的隐私和数据控制'
    case 'extra-usage':
      return '配置额外用量，以便达到限制后继续工作'
    case 'passes':
      return `与朋友分享一周免费 ${product} 并获得额外用量`
    case 'rate-limit-options':
      return '达到速率限制时显示可选处理方式'
    case 'release-notes':
      return '查看发布说明'
    case 'reload-plugins':
      return '激活当前会话中待生效的插件变更'
    case 'remote-env':
      return '配置 teleport 会话使用的默认远程环境'
    case 'remote-control':
      return '连接此终端以用于远程控制会话'
    case 'remote-control-server':
      return '内部远程控制桥接工作进程入口'
    case 'rename':
      return '重命名当前对话'
    case 'resume':
      return '恢复之前的对话'
    case 'review':
      return '审查一个拉取请求'
    case 'rewind':
      return '将代码和/或对话恢复到之前的时间点'
    case 'sandbox':
      return localizeSandboxDescription(cmd.description)
    case 'security-review':
      return '对当前分支的待提交变更进行安全审查'
    case 'session':
      return '显示远程会话链接和二维码'
    case 'simplify':
      return '检查已修改代码的复用、质量和效率，并修复发现的问题'
    case 'skills':
      return '列出可用技能'
    case 'stats':
      return `显示 ${product} 使用统计和活动`
    case 'status':
      return `显示 ${assistant} 状态，包括版本、模型、后端、API 连接和工具状态`
    case 'statusline':
      return `设置 ${product} 状态栏 UI`
    case 'stickers':
      return `订购 ${product} 贴纸`
    case 'tag':
      return '为当前会话切换可搜索标签'
    case 'tasks':
      return '列出并管理后台任务'
    case 'terminal-setup':
      return localizeTerminalSetupDescription(cmd.description)
    case 'theme':
      return '更换主题'
    case 'thinkback':
    case 'think-back':
      return `${product} 2025 年度回顾`
    case 'thinkback-play':
      return '播放年度回顾动画'
    case 'ultraplan':
      return '让托管工作区起草一份可编辑和审批的高级计划'
    case 'ultrareview':
      return '在托管工作区中查找并验证当前分支的 bug'
    case 'update-config':
      return '协助更新 Mossen 设置文件'
    case 'upgrade':
      return '打开当前后端的套餐和计费选项'
    case 'usage':
      return '显示套餐使用限制'
    case 'vim':
      return '在 Vim 和普通编辑模式之间切换'
    case 'voice':
      return '切换语音模式'
    case 'web-setup':
      return '设置托管远程工作区和 GitHub 访问'
    default:
      return undefined
  }
}

export function getLocalizedCommandDescription(cmd: Command): string {
  const shouldUseBuiltInTranslation =
    cmd.type !== 'prompt' || cmd.source === 'builtin' || cmd.source === 'bundled'

  // UX-Wave1 S2A: builtin cmd description 命中 i18n 字典则走 t()；
  // 未命中 fallback 到下方旧 switch + getLocalizedText 兼容路径。
  if (shouldUseBuiltInTranslation) {
    const i18nKey = `cmd.${getCommandName(cmd)}.description`
    if (hasI18nKey(i18nKey)) {
      return t(i18nKey, {
        product: getProductDisplayName(),
        assistant: getProductAssistantName(),
      })
    }
  }

  return getLocalizedText({
    en: cmd.description,
    zh: shouldUseBuiltInTranslation
      ? getChineseBuiltInCommandDescription(cmd) ?? cmd.description
      : cmd.description,
  })
}
