// Mossen 最小 ESLint 配置。
// 目的：架起闸门（bun run lint），挡未来新增明显错误；历史遗留先不强制清零。
//
// 配套 P0-05 typecheck:diff baseline gate，两层网：tsc 抓类型/import，eslint 抓
// react hooks 规则、未用变量、@ts-ignore 滥用等。
//
// 设计原则：
// - strict false（刚落地，不要一上来挡住所有提交）
// - no-unused-vars / no-undef 交给 ts（避免双报）
// - react-hooks/rules-of-hooks 必错（这是真 bug 类别）
// - no-console warn
// - 忽略生成文件、.mossen/、.mossensrc/、node_modules/、types/generated/
//
// Slice A/4 of P0-06.

import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

// 上游仓库带有 custom-rules/* eslint-disable 注释（约 ~16 条规则）
// 但 plugin 实现没随源码迁移过来。提供一个空实现 stub，让 ESLint 不再报
// "Definition for rule ... was not found"。这些 disable 反正本来也没起作用。
// 后续 P0-06-D 可考虑批量删 disable 注释。
function makeStubPlugin(ruleNames) {
  const rules = {}
  for (const name of ruleNames) {
    rules[name] = {
      meta: { type: 'problem', schema: [] },
      create() { return {} },
    }
  }
  return { rules }
}

// 上游仓库带有 custom-rules/* eslint-disable 注释（约 ~16 条规则）
// 但 plugin 实现没随源码迁移过来。提供空实现 stub 让 ESLint 不再报
// "Definition for rule ... was not found"。这些 disable 反正本来也没起作用。
// 后续 P0-06-D 可考虑批量删 disable 注释。
const CUSTOM_RULES_STUB = makeStubPlugin([
  'bootstrap-isolation',
  'no-cross-platform-process-issues',
  'no-direct-json-operations',
  'no-direct-ps-commands',
  'no-lookbehind-regex',
  'no-process-cwd',
  'no-process-env-top-level',
  'no-process-exit',
  'no-sync-fs',
  'no-top-level-dynamic-import',
  'no-top-level-side-effects',
  'prefer-use-keybindings',
  'prefer-use-terminal-size',
  'prompt-spacing',
  'require-bun-typeof-guard',
  'require-tool-match-name',
])

// eslint-plugin-n 也是上游遗产；同样 stub
const N_PLUGIN_STUB = makeStubPlugin([
  'no-unsupported-features/node-builtins',
  'no-sync',
])

const REACT_COMPILER_HOOK_LINT_OUTPUT_FILES = [
  'buddy/CompanionSprite.tsx',
  'buddy/useBuddyNotification.tsx',
  'commands/btw/btw.tsx',
  'commands/ide/ide.tsx',
  'commands/mcp/mcp.tsx',
  'commands/mobile/mobile.tsx',
  'commands/plugin/ManageMarketplaces.tsx',
  'commands/plugin/PluginSettings.tsx',
  'commands/plugin/ValidatePlugin.tsx',
  'commands/resume/resume.tsx',
  'commands/session/session.tsx',
  'commands/tag/tag.tsx',
  'components/AutoUpdaterWrapper.tsx',
  'components/AwsAuthStatusBox.tsx',
  'components/ConsoleOAuthFlow.tsx',
  'components/CustomSelect/select-input-option.tsx',
  'components/CustomSelect/select.tsx',
  'components/EffortCallout.tsx',
  'components/FeedbackSurvey/usePostCompactSurvey.tsx',
  'components/GlobalSearchDialog.tsx',
  'components/HighlightedCode.tsx',
  'components/LogSelector.tsx',
  'components/LogoV2/CondensedLogo.tsx',
  'components/LogoV2/LogoV2.tsx',
  'components/LogoV2/Opus1mMergeNotice.tsx',
  'components/LogoV2/VoiceModeNotice.tsx',
  'components/MCPServerDesktopImportDialog.tsx',
  'components/MessageSelector.tsx',
  'components/OutputStylePicker.tsx',
  'components/PromptInput/Notifications.tsx',
  'components/PromptInput/PromptInputFooterLeftSide.tsx',
  'components/QuickOpenDialog.tsx',
  'components/RemoteEnvironmentDialog.tsx',
  'components/SandboxViolationExpandedView.tsx',
  'components/SessionPreview.tsx',
  'components/Settings/Config.tsx',
  'components/SkillImprovementSurvey.tsx',
  'components/Spinner.tsx',
  'components/TeleportResumeWrapper.tsx',
  'components/TrustDialog/TrustDialog.tsx',
  'components/VimTextInput.tsx',
  'components/VirtualMessageList.tsx',
  'components/agents/AgentsList.tsx',
  'components/design-system/Tabs.tsx',
  'components/diff/DiffDialog.tsx',
  'components/grove/Grove.tsx',
  'components/mcp/ElicitationDialog.tsx',
  'components/mcp/MCPSettings.tsx',
  'components/mcp/MCPToolDetailView.tsx',
  'components/messages/RateLimitMessage.tsx',
  'components/permissions/BashPermissionRequest/BashPermissionRequest.tsx',
  'components/permissions/rules/PermissionRuleList.tsx',
  'components/permissions/rules/RecentDenialsTab.tsx',
  'components/permissions/rules/WorkspaceTab.tsx',
  'components/tasks/ShellDetailDialog.tsx',
  'components/teams/TeamsDialog.tsx',
  'components/wizard/WizardProvider.tsx',
  'context/overlayContext.tsx',
  'context/promptOverlayContext.tsx',
  'context/stats.tsx',
  'hooks/notifs/useDeprecationWarningNotification.tsx',
  'hooks/notifs/useFastModeNotification.tsx',
  'hooks/notifs/useIDEStatusIndicator.tsx',
  'hooks/notifs/usePluginAutoupdateNotification.tsx',
  'hooks/notifs/usePluginInstallationStatus.tsx',
  'hooks/notifs/useRateLimitWarningNotification.tsx',
  'hooks/notifs/useSettingsErrors.tsx',
  'hooks/useIDEIntegration.tsx',
  'hooks/useLspPluginRecommendation.tsx',
  'hooks/useMossenHintRecommendation.tsx',
  'hooks/usePromptsFromMossenInChrome.tsx',
  'ink/components/Button.tsx',
  'ink/components/ClockContext.tsx',
  'keybindings/KeybindingContext.tsx',
  'keybindings/KeybindingProviderSetup.tsx',
  'screens/Doctor.tsx',
  'screens/REPL.tsx',
  'state/AppState.tsx',
  'utils/autoRunIssue.tsx',
  'utils/preflightChecks.tsx',
  'utils/staticRender.tsx',
  'utils/swarm/It2SetupPrompt.tsx',
]

const I18N_DEFERRED_REACT_COMPILER_UNUSED_OUTPUT_FILES = [
  'commands/chrome/chrome.tsx',
  'commands/copy/copy.tsx',
  'commands/thinkback/thinkback.tsx',
  'components/BypassPermissionsModeDialog.tsx',
  'components/ChannelDowngradeDialog.tsx',
  'components/IdleReturnDialog.tsx',
  'components/InvalidConfigDialog.tsx',
  'components/MossenMdExternalIncludesDialog.tsx',
  'components/Settings/Status.tsx',
  'components/Stats.tsx',
  'components/TeleportProgress.tsx',
  'components/agents/new-agent-creation/wizard-steps/LocationStep.tsx',
  'components/mcp/MCPListPanel.tsx',
  'components/memory/MemoryFileSelector.tsx',
  'components/permissions/ComputerUseApproval/ComputerUseApproval.tsx',
]

const I18N_DEFERRED_REACT_COMPILER_HOOK_OUTPUT_FILES = [
  'commands/thinkback/thinkback.tsx',
  'components/Stats.tsx',
  'components/memory/MemoryFileSelector.tsx',
]

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      // `.mossen/worktrees/<slug>` is where mossen stores per-job
      // worktree copies; it is already swept up by `.mossen/**` so we
      // don't need a separate ignore for the worktree path. (W434c
      // removed a stale upstream-fork path that mossen never used.)
      '.mossen/**',
      '.mossensrc/**',
      '.git/**',
      'tmp/**',
      'coverage/**',
      'outputs/**',
      'types/generated/**',
      '**/*.bak-*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'custom-rules': CUSTOM_RULES_STUB,
      'eslint-plugin-n': N_PLUGIN_STUB,
    },
    rules: {
      // ts 自己管更准，eslint 版容易和 bundler 不一致
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // ts-eslint 版 no-unused-vars：以 _ 前缀作为"故意未用"的约定
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // React hooks 规则是真 bug 类别（顺序错会 runtime 崩）
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // 非错误路径 console.log 应清到 logForDebugging / logError
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // 历史债：仓库有真 as any；新代码尽量避免
      '@typescript-eslint/no-explicit-any': 'warn',

      // 强制 @ts-expect-error 有说明
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 4,
        },
      ],
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: REACT_COMPILER_HOOK_LINT_OUTPUT_FILES,
    rules: {
      // React Compiler output rewrites hook/cell dependencies in ways
      // eslint-plugin-react-hooks cannot model, while the original sources
      // remain covered before compilation.
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  {
    files: I18N_DEFERRED_REACT_COMPILER_UNUSED_OUTPUT_FILES,
    rules: {
      // These UI files are React Compiler output too, but changing their
      // source text requires a separate i18n migration. Keep generated unused
      // symbols out of the global lint baseline without touching user copy.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: I18N_DEFERRED_REACT_COMPILER_HOOK_OUTPUT_FILES,
    rules: {
      // Same generated-output boundary as above, but limited to the remaining
      // i18n-deferred files that still trip dependency-array analysis.
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]
