import chalk from 'chalk'
import { logForDebugging } from 'src/utils/debug.js'
import { fileHistoryEnabled } from 'src/utils/fileHistory.js'
import {
  getInitialSettings,
  getSettings_DEPRECATED,
  getSettingsForSource,
} from 'src/utils/settings/settings.js'
import { shouldOfferTerminalSetup } from '../../commands/terminalSetup/terminalSetup.js'
import { getDesktopUpsellConfig } from '../../components/DesktopUpsell/DesktopUpsellStartup.js'
import { color } from '../../components/design-system/color.js'
import { shouldShowOverageCreditUpsell } from '../../components/LogoV2/OverageCreditUpsell.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import { isKairosCronEnabled } from '../../tools/ScheduleCronTool/prompt.js'
import { is1PApiCustomer, isHostedSubscriber } from '../../utils/auth.js'
import { getGitHubWorkflowReadiness } from '../../constants/github-app.js'
import { countConcurrentSessions } from '../../utils/concurrentSessions.js'
import { getGlobalConfig } from '../../utils/config.js'
import {
  getEffortEnvOverride,
  modelSupportsEffort,
} from '../../utils/effort.js'
import { env } from '../../utils/env.js'
import { cacheKeys } from '../../utils/fileStateCache.js'
import { getWorktreeCount } from '../../utils/git.js'
import { isInternalOperatorMode } from '../../utils/internalUserMode.js'
import {
  detectRunningIDEsCached,
  getSortedIdeLockfiles,
  isCursorInstalled,
  isSupportedTerminal,
  isSupportedVSCodeTerminal,
  isVSCodeInstalled,
  isWindsurfInstalled,
} from '../../utils/ide.js'
import {
  getMainLoopModel,
  getUserSpecifiedModelSetting,
} from '../../utils/model/model.js'
import {
  getProductAssistantName,
  getProductCliName,
  getProductDisplayName,
} from '../../constants/product.js'
import { getPlatform } from '../../utils/platform.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isPluginInstalled } from '../../utils/plugins/installedPluginsManager.js'
import { loadKnownMarketplacesConfigSafe } from '../../utils/plugins/marketplaceManager.js'
import { OFFICIAL_MARKETPLACE_NAME } from '../../utils/plugins/officialMarketplace.js'
import {
  getDesktopCompanionName,
  getHostedPlatformUrls,
  hasConfiguredFeedbackUrls,
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import { canUseHostedWorkspaceFeatures } from '../../utils/hostedFeatureGates.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import {
  getCurrentSessionAgentColor,
  isCustomTitleEnabled,
} from '../../utils/sessionStorage.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../config/featureFlags.js'
import {
  formatGrantAmount,
  getCachedOverageCreditGrant,
} from '../api/overageCreditGrant.js'
import {
  checkCachedPassesEligibility,
  formatCreditAmount,
  getCachedReferrerReward,
} from '../api/referral.js'
import { getSessionsSinceLastShown } from './tipHistory.js'
import type { Tip, TipContext } from './types.js'

let _isOfficialMarketplaceInstalledCache: boolean | undefined

function hasHostedPlatformForTips(): boolean {
  if (!isCustomBackendEnabled()) {
    return true
  }
  return (
    isEnvTruthy(process.env.MOSSEN_CODE_ENABLE_HOSTED_TIPS) &&
    hasConfiguredHostedPlatformUrls()
  )
}

function hasGitHubWorkflowForTips(): boolean {
  return !isCustomBackendEnabled() || getGitHubWorkflowReadiness().ready
}

async function isOfficialMarketplaceInstalled(): Promise<boolean> {
  if (_isOfficialMarketplaceInstalledCache !== undefined) {
    return _isOfficialMarketplaceInstalledCache
  }
  const config = await loadKnownMarketplacesConfigSafe()
  _isOfficialMarketplaceInstalledCache = OFFICIAL_MARKETPLACE_NAME in config
  return _isOfficialMarketplaceInstalledCache
}

async function isMarketplacePluginRelevant(
  pluginName: string,
  context: TipContext | undefined,
  signals: { filePath?: RegExp; cli?: string[] },
): Promise<boolean> {
  if (!(await isOfficialMarketplaceInstalled())) {
    return false
  }
  if (isPluginInstalled(`${pluginName}@${OFFICIAL_MARKETPLACE_NAME}`)) {
    return false
  }
  const { bashTools } = context ?? {}
  if (signals.cli && bashTools?.size) {
    if (signals.cli.some(cmd => bashTools.has(cmd))) {
      return true
    }
  }
  if (signals.filePath && context?.readFileState) {
    const readFiles = cacheKeys(context.readFileState)
    if (readFiles.some(fp => signals.filePath!.test(fp))) {
      return true
    }
  }
  return false
}

const externalTips: Tip[] = [
  {
    id: 'new-user-warmup',
    content: async () =>
      getLocalizedText({
        en: `Start with small features or bug fixes, tell ${getProductAssistantName()} to propose a plan, and verify its suggested edits`,
        zh: '先从小功能或 bug 修复开始，让编码助手先给出计划，再核对建议修改',
      }),
    cooldownSessions: 3,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups < 10
    },
  },
  {
    id: 'plan-mode-for-complex-tasks',
    content: async () =>
      getLocalizedText({
        en: `Use Plan Mode to prepare for a complex request before making changes. Press ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} twice to enable.`,
        zh: `遇到复杂请求时，先用计划模式做好准备再开始修改。按 ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} 两次即可启用。`,
      }),
    cooldownSessions: 5,
    isRelevant: async () => {
      if (isInternalOperatorMode()) return false
      const config = getGlobalConfig()
      // Show to users who haven't used plan mode recently (7+ days)
      const daysSinceLastUse = config.lastPlanModeUse
        ? (Date.now() - config.lastPlanModeUse) / (1000 * 60 * 60 * 24)
        : Infinity
      return daysSinceLastUse > 7
    },
  },
  {
    id: 'default-permission-mode-config',
    content: async () =>
      getLocalizedText({
        en: 'Use /config to change your default permission mode (including Plan Mode)',
        zh: '使用 /config 修改默认权限模式（包括计划模式）',
      }),
    cooldownSessions: 10,
    isRelevant: async () => {
      try {
        const config = getGlobalConfig()
        const settings = getSettings_DEPRECATED()
        // Show if they've used plan mode but haven't set a default
        const hasUsedPlanMode = Boolean(config.lastPlanModeUse)
        const hasDefaultMode = Boolean(settings?.permissions?.defaultMode)
        return hasUsedPlanMode && !hasDefaultMode
      } catch (error) {
        logForDebugging(
          `Failed to check default-permission-mode-config tip relevance: ${error}`,
          { level: 'warn' },
        )
        return false
      }
    },
  },
  {
    id: 'git-worktrees',
    content: async () =>
      getLocalizedText({
        en: `Use git worktrees to run multiple ${getProductDisplayName()} sessions in parallel.`,
        zh: '使用 git worktree 并行运行多个编码助手会话。',
      }),
    cooldownSessions: 10,
    isRelevant: async () => {
      try {
        const config = getGlobalConfig()
        const worktreeCount = await getWorktreeCount()
        return worktreeCount <= 1 && config.numStartups > 50
      } catch (_) {
        return false
      }
    },
  },
  {
    id: 'color-when-concurrent-sessions',
    content: async () =>
      getLocalizedText({
        en: `Running multiple ${getProductDisplayName()} sessions? Use /color and /rename to tell them apart at a glance.`,
        zh: '同时运行多个编码助手会话？用 /color 和 /rename 一眼区分它们。',
      }),
    cooldownSessions: 10,
    isRelevant: async () => {
      if (getCurrentSessionAgentColor()) return false
      const count = await countConcurrentSessions()
      return count >= 2
    },
  },
  {
    id: 'terminal-setup',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? getLocalizedText({
            en: 'Run /terminal-setup to enable convenient terminal integration like Option + Enter for new line and more',
            zh: '运行 /terminal-setup，启用 Option + Enter 换行等便捷终端集成能力',
          })
        : getLocalizedText({
            en: 'Run /terminal-setup to enable convenient terminal integration like Shift + Enter for new line and more',
            zh: '运行 /terminal-setup，启用 Shift + Enter 换行等便捷终端集成能力',
          }),
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      if (env.terminal === 'Apple_Terminal') {
        return !config.optionAsMetaKeyInstalled
      }
      return !config.shiftEnterKeyBindingInstalled
    },
  },
  {
    id: 'shift-enter',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? getLocalizedText({
            en: 'Press Option+Enter to send a multi-line message',
            zh: '按 Option+Enter 发送多行消息',
          })
        : getLocalizedText({
            en: 'Press Shift+Enter to send a multi-line message',
            zh: '按 Shift+Enter 发送多行消息',
          }),
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      return Boolean(
        (env.terminal === 'Apple_Terminal'
          ? config.optionAsMetaKeyInstalled
          : config.shiftEnterKeyBindingInstalled) && config.numStartups > 3,
      )
    },
  },
  {
    id: 'shift-enter-setup',
    content: async () =>
      env.terminal === 'Apple_Terminal'
        ? getLocalizedText({
            en: 'Run /terminal-setup to enable Option+Enter for new lines',
            zh: '运行 /terminal-setup 启用 Option+Enter 换行',
          })
        : getLocalizedText({
            en: 'Run /terminal-setup to enable Shift+Enter for new lines',
            zh: '运行 /terminal-setup 启用 Shift+Enter 换行',
          }),
    cooldownSessions: 10,
    async isRelevant() {
      if (!shouldOfferTerminalSetup()) {
        return false
      }
      const config = getGlobalConfig()
      return !(env.terminal === 'Apple_Terminal'
        ? config.optionAsMetaKeyInstalled
        : config.shiftEnterKeyBindingInstalled)
    },
  },
  {
    id: 'memory-command',
    content: async () =>
      getLocalizedText({
        en: `Use /memory to view and manage ${getProductAssistantName()} memory`,
        zh: '使用 /memory 查看和管理编码助手记忆',
      }),
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.memoryUsageCount <= 0
    },
  },
  {
    id: 'theme-command',
    content: async () =>
      getLocalizedText({
        en: 'Use /theme to change the color theme',
        zh: '使用 /theme 切换颜色主题',
      }),
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'colorterm-truecolor',
    content: async () =>
      getLocalizedText({
        en: 'Try setting environment variable COLORTERM=truecolor for richer colors',
        zh: '可尝试设置环境变量 COLORTERM=truecolor，以获得更丰富的颜色显示',
      }),
    cooldownSessions: 30,
    isRelevant: async () => !process.env.COLORTERM && chalk.level < 3,
  },
  {
    id: 'powershell-tool-env',
    content: async () =>
      getLocalizedText({
        en: 'Set MOSSEN_CODE_USE_POWERSHELL_TOOL=1 to enable the PowerShell tool (preview)',
        zh: '设置 MOSSEN_CODE_USE_POWERSHELL_TOOL=1 以启用 PowerShell 工具（预览）',
      }),
    cooldownSessions: 10,
    isRelevant: async () =>
      getPlatform() === 'windows' &&
      process.env.MOSSEN_CODE_USE_POWERSHELL_TOOL === undefined,
  },
  {
    id: 'status-line',
    content: async () =>
      getLocalizedText({
        en: 'Use /statusline to set up a custom status line that will display beneath the input box',
        zh: '使用 /statusline 设置输入框下方显示的自定义状态栏',
      }),
    cooldownSessions: 25,
    isRelevant: async () => getSettings_DEPRECATED().statusLine === undefined,
  },
  {
    id: 'prompt-queue',
    content: async () =>
      getLocalizedText({
        en: `Hit Enter to queue up additional messages while ${getProductAssistantName()} is working.`,
        zh: '在编码助手工作时按 Enter，可继续排队发送更多消息。',
      }),
    cooldownSessions: 5,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.promptQueueUseCount <= 3
    },
  },
  {
    id: 'enter-to-steer-in-relatime',
    content: async () =>
      getLocalizedText({
        en: `Send messages to ${getProductAssistantName()} while it works to steer it in real time`,
        zh: '在编码助手工作时继续发送消息，可实时调整执行方向',
      }),
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'todo-list',
    content: async () =>
      getLocalizedText({
        en: `Ask ${getProductAssistantName()} to create a todo list for complex tasks to track progress and stay on course`,
        zh: '处理复杂任务时，让编码助手先创建待办清单，以便跟踪进度并保持方向一致',
      }),
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'vscode-command-install',
    content: async () =>
      getLocalizedText({
        en: `Open the Command Palette (Cmd+Shift+P), then run “Shell Command: Install '${env.terminal === 'vscode' ? 'code' : env.terminal}' command in PATH” to enable IDE integration`,
        zh: `打开命令面板（Cmd+Shift+P），运行“Shell Command: Install '${env.terminal === 'vscode' ? 'code' : env.terminal}' command in PATH”以启用 IDE 集成`,
      }),
    cooldownSessions: 0,
    async isRelevant() {
      // Only show this tip if we're in a VS Code-style terminal
      if (!isSupportedVSCodeTerminal()) {
        return false
      }
      if (getPlatform() !== 'macos') {
        return false
      }

      // Check if the relevant command is available
      switch (env.terminal) {
        case 'vscode':
          return !(await isVSCodeInstalled())
        case 'cursor':
          return !(await isCursorInstalled())
        case 'windsurf':
          return !(await isWindsurfInstalled())
        default:
          return false
      }
    },
  },
  {
    id: 'ide-upsell-external-terminal',
    content: async () =>
      getLocalizedText({
        en: `Connect ${getProductAssistantName()} to your IDE · /ide`,
        zh: '将编码助手连接到你的 IDE · /ide',
      }),
    cooldownSessions: 4,
    async isRelevant() {
      if (isSupportedTerminal()) {
        return false
      }

      // Use lockfiles as a (quicker) signal for running IDEs
      const lockfiles = await getSortedIdeLockfiles()
      if (lockfiles.length !== 0) {
        return false
      }

      const runningIDEs = await detectRunningIDEsCached()
      return runningIDEs.length > 0
    },
  },
  {
    id: 'install-github-app',
    content: async () =>
      isCustomBackendEnabled()
        ? getLocalizedText({
            en: 'Run /install-github-app to tag @assistant right from your GitHub issues and PRs',
            zh: '运行 /install-github-app，即可在 GitHub issue 和 PR 中直接 @assistant',
          })
        : getLocalizedText({
            en: 'Run /install-github-app to tag @assistant right from your GitHub issues and PRs',
            zh: '运行 /install-github-app，即可在 GitHub issue 和 PR 中直接 @assistant',
          }),
    cooldownSessions: 10,
    isRelevant: async () =>
      hasHostedPlatformForTips() &&
      hasGitHubWorkflowForTips() &&
      !getGlobalConfig().githubActionSetupCount,
  },
  {
    id: 'install-slack-app',
    content: async () =>
      getLocalizedText({
        en: `Run /install-slack-app to use ${getProductAssistantName()} in Slack`,
        zh: '运行 /install-slack-app，在 Slack 中使用编码助手',
      }),
    cooldownSessions: 10,
    isRelevant: async () =>
      isHostedSubscriber() && !getGlobalConfig().slackAppInstallCount,
  },
  {
    id: 'permissions',
    content: async () =>
      getLocalizedText({
        en: 'Use /permissions to pre-approve and pre-deny bash, edit, and MCP tools',
        zh: '使用 /permissions 预先批准或拒绝 bash、edit 和 MCP 工具',
      }),
    cooldownSessions: 10,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 10
    },
  },
  {
    id: 'drag-and-drop-images',
    content: async () =>
      getLocalizedText({
        en: 'Did you know you can drag and drop image files into your terminal?',
        zh: '你知道吗？可以把图片文件直接拖放到终端里。',
      }),
    cooldownSessions: 10,
    isRelevant: async () => !env.isSSH(),
  },
  {
    id: 'paste-images-mac',
    content: async () =>
      getLocalizedText({
        en: `Paste images into ${getProductAssistantName()} using control+v (not cmd+v!)`,
        zh: '使用 control+v 将图片粘贴到编码助手中（不是 cmd+v！）',
      }),
    cooldownSessions: 10,
    isRelevant: async () => getPlatform() === 'macos',
  },
  {
    id: 'double-esc',
    content: async () =>
      getLocalizedText({
        en: 'Double-tap esc to rewind the conversation to a previous point in time',
        zh: '连按两次 esc，可将对话回退到之前的时间点',
      }),
    cooldownSessions: 10,
    isRelevant: async () => !fileHistoryEnabled(),
  },
  {
    id: 'double-esc-code-restore',
    content: async () =>
      getLocalizedText({
        en: 'Double-tap esc to rewind the code and/or conversation to a previous point in time',
        zh: '连按两次 esc，可将代码和/或对话回退到之前的时间点',
      }),
    cooldownSessions: 10,
    isRelevant: async () => fileHistoryEnabled(),
  },
  {
    id: 'continue',
    content: async () =>
      getLocalizedText({
        en: `Run ${getProductCliName()} --continue or ${getProductCliName()} --resume to resume a conversation`,
        zh: `运行 ${getProductCliName()} --continue 或 ${getProductCliName()} --resume 以恢复之前的对话`,
      }),
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'rename-conversation',
    content: async () =>
      getLocalizedText({
        en: 'Name your conversations with /rename to find them easily in /resume later',
        zh: '使用 /rename 为对话命名，之后在 /resume 中更容易找到',
      }),
    cooldownSessions: 15,
    isRelevant: async () =>
      isCustomTitleEnabled() && getGlobalConfig().numStartups > 10,
  },
  {
    id: 'custom-commands',
    content: async () =>
      getLocalizedText({
        en: 'Create skills by adding .md files to .mossen/skills/ in your project or ~/.mossen/skills/ for skills that work in any project',
        zh: '把 .md 文件放到项目的 .mossen/skills/ 或 ~/.mossen/skills/ 中，即可创建技能并在任意项目复用',
      }),
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 10
    },
  },
  {
    id: 'shift-tab',
    content: async () =>
      isInternalOperatorMode()
        ? getLocalizedText({
            en: `Hit ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} to cycle between default mode and auto mode`,
            zh: `按 ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} 可在默认模式和自动模式之间切换`,
          })
        : getLocalizedText({
            en: `Hit ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} to cycle between default mode, auto-accept edit mode, and plan mode`,
            zh: `按 ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} 可在默认模式、自动接受编辑模式和计划模式之间切换`,
          }),
    cooldownSessions: 10,
    isRelevant: async () => true,
  },
  {
    id: 'image-paste',
    content: async () =>
      getLocalizedText({
        en: `Use ${getShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v')} to paste images from your clipboard`,
        zh: `使用 ${getShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v')} 从剪贴板粘贴图片`,
      }),
    cooldownSessions: 20,
    isRelevant: async () => true,
  },
  {
    id: 'custom-agents',
    content: async () =>
      getLocalizedText({
        en: 'Use /agents to optimize specific tasks. Eg. Software Architect, Code Writer, Code Reviewer',
        zh: '使用 /agents 为特定任务启用更合适的代理，例如：软件架构师、代码编写者、代码审查者',
      }),
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
  {
    id: 'agent-flag',
    content: async () =>
      getLocalizedText({
        en: 'Use --agent <agent_name> to directly start a conversation with a subagent',
        zh: '使用 --agent <agent_name> 可直接与某个子代理开始对话',
      }),
    cooldownSessions: 15,
    async isRelevant() {
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
  {
    id: 'desktop-app',
    content: async () =>
      getLocalizedText({
        en: `Run ${getProductAssistantName()} locally or remotely using the ${getDesktopCompanionName()}: ${getHostedPlatformUrls().desktopDocsUrl}`,
        zh: `通过 ${getDesktopCompanionName()} 在本地或远程运行编码助手：${getHostedPlatformUrls().desktopDocsUrl}`,
    }),
    cooldownSessions: 15,
    isRelevant: async () =>
      hasHostedPlatformForTips() && getPlatform() !== 'linux',
  },
  {
    id: 'desktop-shortcut',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      return getLocalizedText({
        en: `Continue your session in the ${getDesktopCompanionName()} with ${blue('/desktop')}`,
        zh: `使用 ${blue('/desktop')} 在 ${getDesktopCompanionName()} 中继续当前会话`,
      })
    },
    cooldownSessions: 15,
    isRelevant: async () => {
      if (!canUseHostedWorkspaceFeatures()) return false
      if (!getDesktopUpsellConfig().enable_shortcut_tip) return false
      return (
        process.platform === 'darwin' ||
        (process.platform === 'win32' && process.arch === 'x64')
      )
    },
  },
  {
    id: 'web-app',
    content: async () =>
      getLocalizedText({
        en: `Run tasks in the hosted workspace while you keep coding locally · ${getHostedPlatformUrls().remoteWebUrl}`,
        zh: `在本地继续编码的同时，可在托管工作区中运行任务 · ${getHostedPlatformUrls().remoteWebUrl}`,
    }),
    cooldownSessions: 15,
    isRelevant: async () => canUseHostedWorkspaceFeatures(),
  },
  {
    id: 'mobile-app',
    content: async () =>
      getLocalizedText({
        en: `/mobile to use ${getProductAssistantName()} from the companion app on your phone`,
        zh: '使用 /mobile，可在手机上的配套应用中使用编码助手',
      }),
    cooldownSessions: 15,
    isRelevant: async () => hasHostedPlatformForTips(),
  },
  {
    id: 'opusplan-mode-reminder',
    content: async () =>
      getLocalizedText({
        en: `Your default model setting is Plan Mode. Press ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} twice to activate Plan Mode and plan with the strongest available planning model.`,
        zh: `你当前的默认模型设置是计划模式。按 ${getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')} 两次即可启用计划模式，并使用当前可用的最强规划模型。`,
      }),
    cooldownSessions: 2,
    async isRelevant() {
      if (isInternalOperatorMode()) return false
      const config = getGlobalConfig()
      const modelSetting = getUserSpecifiedModelSetting()
      const hasOpusPlanMode = modelSetting === 'opusplan'
      // Show reminder if they have Opus Plan Mode and haven't used plan mode recently (3+ days)
      const daysSinceLastUse = config.lastPlanModeUse
        ? (Date.now() - config.lastPlanModeUse) / (1000 * 60 * 60 * 24)
        : Infinity
      return hasOpusPlanMode && daysSinceLastUse > 3
    },
  },
  {
    id: 'frontend-design-plugin',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      return getLocalizedText({
        en: `Working with HTML/CSS? Install the frontend-design plugin:\n${blue(`/plugin install frontend-design@${OFFICIAL_MARKETPLACE_NAME}`)}`,
        zh: `正在处理 HTML/CSS？可安装 frontend-design 插件：\n${blue(`/plugin install frontend-design@${OFFICIAL_MARKETPLACE_NAME}`)}`,
      })
    },
    cooldownSessions: 3,
    isRelevant: async context =>
      isMarketplacePluginRelevant('frontend-design', context, {
        filePath: /\.(html|css|htm)$/i,
      }),
  },
  {
    id: 'vercel-plugin',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      return getLocalizedText({
        en: `Working with Vercel? Install the vercel plugin:\n${blue(`/plugin install vercel@${OFFICIAL_MARKETPLACE_NAME}`)}`,
        zh: `正在使用 Vercel？可安装 vercel 插件：\n${blue(`/plugin install vercel@${OFFICIAL_MARKETPLACE_NAME}`)}`,
      })
    },
    cooldownSessions: 3,
    isRelevant: async context =>
      isMarketplacePluginRelevant('vercel', context, {
        filePath: /(?:^|[/\\])vercel\.json$/i,
        cli: ['vercel'],
      }),
  },
  {
    id: 'effort-high-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const cmd = blue('/effort high')
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('mossen.tips.effortHighNudgeVariant', 'off')
      return variant === 'copy_b'
        ? getLocalizedText({
            en: `Use ${cmd} for better one-shot answers. ${getProductAssistantName()} thinks it through first.`,
            zh: `使用 ${cmd} 获得更好的单次回答，编码助手会先更深入地思考。`,
          })
        : getLocalizedText({
            en: `Working on something tricky? ${cmd} gives better first answers`,
            zh: `如果任务比较棘手，${cmd} 往往能带来更好的首轮回答`,
          })
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      if (!modelSupportsEffort(getMainLoopModel())) return false
      if (getSettingsForSource('policySettings')?.effortLevel !== undefined) {
        return false
      }
      if (getEffortEnvOverride() !== undefined) return false
      const persisted = getInitialSettings().effortLevel
      if (persisted === 'high' || persisted === 'max') return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'mossen.tips.effortHighNudgeVariant',
          'off',
        ) !== 'off'
      )
    },
  },
  {
    id: 'subagent-fanout-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('mossen.tips.subagentFanoutNudgeVariant', 'off')
      return variant === 'copy_b'
        ? getLocalizedText({
            en: `For big tasks, tell ${getProductAssistantName()} to ${blue('use subagents')}. They work in parallel and keep your main thread clean.`,
            zh: `遇到大任务时，可以让编码助手 ${blue('use subagents')}。它们会并行工作，并让主线程保持清爽。`,
          })
        : getLocalizedText({
            en: `Say ${blue('"fan out subagents"')} and ${getProductAssistantName()} sends a team. Each one digs deep so nothing gets missed.`,
            zh: `直接说 ${blue('"fan out subagents"')}，编码助手就会派出一支小队，各自深入处理，减少遗漏。`,
          })
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'mossen.tips.subagentFanoutNudgeVariant',
          'off',
        ) !== 'off'
      )
    },
  },
  {
    id: 'loop-command-nudge',
    content: async ctx => {
      const blue = color('suggestion', ctx.theme)
      const variant = getFeatureValue_CACHED_MAY_BE_STALE<
        'off' | 'copy_a' | 'copy_b'
      >('mossen.tips.loopCommandNudgeVariant', 'off')
      return variant === 'copy_b'
        ? getLocalizedText({
            en: `Use ${blue('/loop 5m check the deploy')} to run any prompt on a schedule. Set it and forget it.`,
            zh: `使用 ${blue('/loop 5m check the deploy')} 可按计划重复运行任意提示词，设好后就能自动执行。`,
          })
        : getLocalizedText({
            en: `${blue('/loop')} runs any prompt on a recurring schedule. Great for monitoring deploys, babysitting PRs, or polling status.`,
            zh: `${blue('/loop')} 可以按周期重复运行任意提示词，很适合监控部署、盯 PR 或轮询状态。`,
          })
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!is1PApiCustomer()) return false
      if (!isKairosCronEnabled()) return false
      return (
        getFeatureValue_CACHED_MAY_BE_STALE<'off' | 'copy_a' | 'copy_b'>(
          'mossen.tips.loopCommandNudgeVariant',
          'off',
        ) !== 'off'
      )
    },
  },
  {
    id: 'guest-passes',
    content: async ctx => {
      const mossen = color('mossen', ctx.theme)
      const reward = getCachedReferrerReward()
      return reward
        ? getLocalizedText({
            en: `Share ${getProductAssistantName()} and earn ${mossen(formatCreditAmount(reward))} of extra usage · ${mossen('/passes')}`,
            zh: `分享编码助手并获得 ${mossen(formatCreditAmount(reward))} 额外额度 · ${mossen('/passes')}`,
          })
        : getLocalizedText({
            en: `You have free guest passes to share · ${mossen('/passes')}`,
            zh: `你有可分享的免费线下体验名额 · ${mossen('/passes')}`,
          })
    },
    cooldownSessions: 3,
    isRelevant: async () => {
      if (!hasHostedPlatformForTips()) return false
      const config = getGlobalConfig()
      if (config.hasVisitedPasses) {
        return false
      }
      const { eligible } = checkCachedPassesEligibility()
      return eligible
    },
  },
  {
    id: 'overage-credit',
    content: async ctx => {
      const mossen = color('mossen', ctx.theme)
      const info = getCachedOverageCreditGrant()
      const amount = info ? formatGrantAmount(info) : null
      if (!amount) return ''
      // Copy from "OC & Bulk Overages copy" doc (#5 — CLI Rotating tip)
      return getLocalizedText({
        en: `${mossen(`${amount} in extra usage, on us`)} · third-party apps · ${mossen('/extra-usage')}`,
        zh: `${mossen(`我们赠送你 ${amount} 额外额度`)} · 第三方应用 · ${mossen('/extra-usage')}`,
      })
    },
    cooldownSessions: 3,
    isRelevant: async () =>
      hasHostedPlatformForTips() && shouldShowOverageCreditUpsell(),
  },
  {
    id: 'feedback-command',
    content: async () =>
      getLocalizedText({
        en: 'Use /feedback to help us improve!',
        zh: '使用 /feedback 帮助我们继续改进！',
      }),
    cooldownSessions: 15,
    async isRelevant() {
      if (isInternalOperatorMode()) {
        return false
      }
      if (!hasConfiguredFeedbackUrls()) {
        return false
      }
      const config = getGlobalConfig()
      return config.numStartups > 5
    },
  },
]
const internalOnlyTips: Tip[] =
  isInternalOperatorMode()
    ? [
        {
          id: 'important-mossenmd',
          content: async () =>
            getLocalizedText({
              en: '[MOSSEN-INTERNAL] Use "IMPORTANT:" prefix for must-follow MOSSEN.md rules',
              zh: '[MOSSEN-INTERNAL] 对必须遵守的 MOSSEN.md 规则使用 "IMPORTANT:" 前缀',
            }),
          cooldownSessions: 30,
          isRelevant: async () => true,
        },
        {
          id: 'skillify',
          content: async () =>
            getLocalizedText({
              en: '[MOSSEN-INTERNAL] Use /skillify at the end of a workflow to turn it into a reusable skill',
              zh: '[MOSSEN-INTERNAL] 在工作流结束时使用 /skillify，将其转成可复用技能',
            }),
          cooldownSessions: 15,
          isRelevant: async () => true,
        },
      ]
    : []

type CustomTipContent = string | { en: string; zh?: string }

function resolveCustomTipContent(content: CustomTipContent): string {
  return typeof content === 'string'
    ? content
    : getLocalizedText({ en: content.en, zh: content.zh ?? content.en })
}

function getCustomTips(): Tip[] {
  const settings = getInitialSettings()
  const override = settings.spinnerTipsOverride
  if (!override?.tips?.length) return []

  return override.tips.map((content, i) => ({
    id: `custom-tip-${i}`,
    content: async () => resolveCustomTipContent(content),
    cooldownSessions: 0,
    isRelevant: async () => true,
  }))
}

export async function getRelevantTips(context?: TipContext): Promise<Tip[]> {
  const settings = getInitialSettings()
  const override = settings.spinnerTipsOverride
  const customTips = getCustomTips()

  // If excludeDefault is true and there are custom tips, skip built-in tips entirely
  if (override?.excludeDefault && customTips.length > 0) {
    return customTips
  }

  // Otherwise, filter built-in tips as before and combine with custom
  const tips = [...externalTips, ...internalOnlyTips]
  const isRelevant = await Promise.all(tips.map(_ => _.isRelevant(context)))
  const filtered = tips
    .filter((_, index) => isRelevant[index])
    .filter(_ => getSessionsSinceLastShown(_.id) >= _.cooldownSessions)

  return [...filtered, ...customTips]
}
