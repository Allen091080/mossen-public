/**
 * Mossen 内置默认值表 (G1-2 起步).
 *
 * G3-G5 每迁一个 legacy remote-config key, 同步往这里添加 entry.
 * tmp remote-config audit output 是审计产物 (gitignored, 仅参考),
 * 本文件才是 git tracked 的运行时真值.
 *
 * 命名规范 (见 services/config/types.ts MOSSEN_KEY_PATTERN):
 *   mossen.<domain>.<feature>
 */
export const MOSSEN_BUILTIN_DEFAULTS: Record<string, unknown> = {
  // G3-1: analytics event-batch config → mossen.analytics.eventBatchConfig
  // 默认与 firstPartyEventLogger.ts 历史 remote-config 默认值一致
  // (tmp remote-config audit: high-risk #1)
  'mossen.analytics.eventBatchConfig': {
    scheduledDelayMillis: 60000,
    maxExportBatchSize: 512,
    maxQueueSize: 2048,
    skipAuth: false,
  },
  // G3-2: analytics event-sampling config → mossen.analytics.eventSamplingConfig
  // 真实代码默认是 {} (firstPartyEventLogger.ts:39 caller fallback);
  // 含义: 没有 per-event sampling override, 所有事件 100% 上报.
  // ⚠ 审计 keys.json 的 proposed_default 用了 traceSamplePercentage 等字段,
  // 但代码层的实际 type 是 {[eventName]: {sample_rate: number}}, 两者形状不一致.
  // 这里以代码现实为准, 故 G3-2 不进 R8 STRICT (避免 audit 数据失配引起假 drift).
  'mossen.analytics.eventSamplingConfig': {},
  // G3-3: analytics sink killswitch → mossen.analytics.sinkKillswitch
  // (mangled name 还原为可读名)
  // 默认 {} (sinkKillswitch.ts:18 comment "nothing killed. Fail-open").
  // shape: { datadog?: boolean, firstParty?: boolean }
  'mossen.analytics.sinkKillswitch': {},
  // W163-D1: Datadog event sink gate, default false (personal build keeps
  // Datadog dispatch disabled unless explicitly enabled).
  'mossen.analytics.datadogEventsEnabled': false,
  // Residual runtime dynamic-config defaults migrated in W178-BY.
  'mossen.query.streamingToolExecutionEnabled': false,
  'mossen.api.attributionHeaderEnabled': true,
  'mossen.api.disableKeepaliveOnStaleConnection': false,
  'mossen.api.antiDistillFakeToolInjectionEnabled': false,
  'mossen.api.promptCache1hConfig': {},
  'mossen.api.disableStreamingToNonStreamingFallback': false,
  'mossen.voice.nova3SttEnabled': false,
  // G3-4: remote-config experiment exposure logging gate
  // 默认关闭 — Mossen 个人版不上传 remote-config 实验数据
  // 调用方: dynamic-config compatibility wrapper logExposureForFeature
  'mossen.analytics.gbExperimentExposureLogging': false,
  // ====================================
  // G4-1: Compact 域 (services/compact/**)
  // ====================================
  // legacy time-based message-compaction config
  // src: services/compact/timeBasedMCConfig.ts:35 TIME_BASED_MC_CONFIG_DEFAULTS
  'mossen.compact.timeBasedMCConfig': {
    enabled: false,
    gapThresholdMinutes: 60,
    keepRecent: 5,
  },
  // legacy forked-agent prompt cache reuse killswitch
  // src: services/compact/compact.ts:435/1156 (3P default true)
  'mossen.compact.cachePrefixSharing': true,
  // legacy streaming compact retry gate (默认 false)
  // src: services/compact/compact.ts:1252
  'mossen.compact.streamingRetryEnabled': false,
  // Legacy compact line-prefix killswitch → file read line-prefix format killswitch
  // 默认 false: compact line-prefix format enabled.
  'mossen.compact.linePrefixKillswitch': false,
  // legacy SessionMemory compact threshold config
  // src: services/compact/sessionMemoryCompact.ts:118 DEFAULT_SM_COMPACT_CONFIG
  // ⚠ 形状与 audit keys.json 不一致 (audit 是 enabled/minMessages/compressionRatio,
  //   代码是 minTokens/minTextBlockMessages/maxTokens), 以代码现实为准, 不进 STRICT
  'mossen.compact.sessionMemoryConfig': {
    minTokens: 10000,
    minTextBlockMessages: 5,
    maxTokens: 40000,
  },
  // legacy session memory 总开关 (默认关闭, Mossen 个人版未默认上)
  // src: services/compact/sessionMemoryCompact.ts:413
  'mossen.compact.sessionMemoryEnabled': false,
  // legacy session memory compact 子开关
  // src: services/compact/sessionMemoryCompact.ts:417
  'mossen.compact.sessionMemoryCompactEnabled': false,
  // Session memory extraction config defaults to caller fallback values.
  'mossen.sessionMemory.config': {},
  // legacy REACTIVE_COMPACT 反向 killswitch
  // src: services/compact/autoCompact.ts:196
  'mossen.compact.reactiveAutoCompactKillswitch': false,
  // ====================================
  // G4-2: Memory / session-context 域 (memdir/**)
  // 6 unique gate, 全部默认 false (Mossen 个人版未默认上 auto-memory 实验路径)
  // ====================================
  // legacy memdir gate (memdir/memdir.ts:383)
  'mossen.memory.coralFernEnabled': false,
  // legacy skipIndex for assistant daily log (memdir/memdir.ts:430)
  'mossen.memory.skipDailyLogIndex': false,
  // legacy KAIROS daily-log mode gate (memdir/memdir.ts:440)
  // NOTE: This gate controls ONLY KAIROS daily-log mode, NOT team memory.
  // Team memory has its own independent gate (mossen.memory.teamMemoryEnabled).
  'mossen.memory.kairosActive': false,
  // legacy team memory runtime gate (memdir/teamMemPaths.ts:77)
  // Explicit independent gate for team memory. Default false — team memory is
  // opt-in even when TEAMMEM build flag is present. Must be explicitly enabled
  // via MOSSEN_CONFIG_OVERRIDES or settings to write team memories.
  'mossen.memory.teamMemoryEnabled': false,
  // legacy memory paths gate (memdir/paths.ts:81)
  'mossen.memory.passportQuailEnabled': false,
  // legacy memory paths gate (memdir/paths.ts:90)
  'mossen.memory.slateThimbleEnabled': false,
  // Skip project/local memory-rule injection when memory prefetch handles context.
  'mossen.memory.skipProjectLevelRules': false,
  // Auto-memory extraction turn interval. Default 1 preserves every eligible turn.
  'mossen.memory.extractionTurnInterval': 1,
  // Compact reminder attachment gate.
  'mossen.compact.reminderAttachmentEnabled': false,
  // Transcript leaf-pruning recovery gate.
  'mossen.session.pebbleLeafPruneEnabled': false,
  // ====================================
  // G4-3: Tool 域 (tools/**) 9 unique gate
  // 仅 amber_stoat / slim_subagent_mossenmd / birch_trellis 默认 true
  // ====================================
  'mossen.tool.quartzLanternEnabled': false,
  'mossen.tool.hiveEvidenceEnabled': false,
  'mossen.webSearch.smallFastModelEnabled': false,
  'mossen.tool.autoBackgroundAgentsEnabled': false,
  'mossen.tool.agentListAttachEnabled': false,
  'mossen.tool.amberStoatEnabled': true,
  'mossen.tool.slimSubagentMossenmdEnabled': true,
  'mossen.skill.improvementEnabled': false,
  'mossen.tool.glacier2xrEnabled': false,
  'mossen.tool.surrealDaliEnabled': false,
  'mossen.tool.birchTrellisEnabled': true,
  'mossen.fileRead.defaultLimits': {},
  'mossen.fileRead.dedupKillswitch': false,
  'mossen.toolResult.persistenceThresholds': {},
  'mossen.toolResult.perMessageBudgetLimit': null,
  'mossen.toolResult.replacementEnabled': false,
  'mossen.tool.sandboxDisabledCommands': {
    commands: [],
    substrings: [],
  },
  // ====================================
  // G4-4: Permission setup / plan / default 域
  // ====================================
  // legacy destructive-command warning gate (BashPermissionRequest:275, PowerShell:61)
  'mossen.permission.destructiveCommandWarningEnabled': false,
  // legacy plan-mode interview-phase gate (utils/planModeV2.ts:59)
  // env override existed; gate 仅作 fallback
  'mossen.permission.planModeInterviewPhaseEnabled': false,
  // legacy plan-file variant (utils/planModeV2.ts:90) — 'trim' | 'cut' | 'cap' | null
  // 默认 null (control arm)
  'mossen.permission.pewterLedgerVariant': null,
  // ====================================
  // G4-5: Bypass / yolo classifier 域 (utils/permissions/**)
  // ====================================
  // legacy scratchpad gate (utils/permissions/filesystem.ts isScratchpadEnabled)
  // 默认 false (Mossen 个人版未默认启用 scratchpad)
  'mossen.permission.scratchpadEnabled': false,
  // ====================================
  // G4-6: MCP / channel allowlist / channel permissions 域 (services/mcp/**)
  // ====================================
  // legacy channel gate → mossen.permission.channelsEnabled
  // src: services/mcp/channelAllowlist.ts:52  default false
  // 与 audit keys.json 完全 parity → 加入 R8 STRICT
  'mossen.permission.channelsEnabled': false,
  // legacy channel-permissions gate (channelPermissions.ts:41), 代码默认 false
  // 形状与 audit keys.json 失配 (audit 是 {allowChannelCreation,...} 对象, 代码是
  // boolean), 以代码为准, 不进 STRICT
  'mossen.permission.channelPermissionsAllowedEnabled': false,
  // legacy channel allowlist config (channelAllowlist.ts:39), 实际类型 ChannelAllowlistEntry[]
  // 代码默认 []; audit 形状失配 (audit 是 {maxChannels, maxMembers} 对象), 不进 STRICT
  'mossen.permission.channelAllowlist': [],
  // legacy auto-mode config (vscodeSdkMcp.ts:16), 默认 {} (caller fallback)
  // ⚠ audit proposed_default 是 {enabled:'opt-in', interactionLimitPerQuery:10, toolNameList:[]},
  //   audit 字段比代码多 (代码只读 ?.enabled), 形状不算严格失配但不完全一致;
  //   按 audit 默认值丰富以满足审计契约 (代码读 .enabled 仍正常工作);
  //   key 走 audit 命名 mossen.ui.autoModeConfig (跨 MCP/UI 域)
  'mossen.ui.autoModeConfig': {
    enabled: 'opt-in',
    interactionLimitPerQuery: 10,
    toolNameList: [],
  },
  // Native auto-mode classifier fail-closed gate. Default preserves the
  // historical deny-on-classifier-unavailable behavior.
  'mossen.permission.autoModeClassifierFailClosed': true,
  // legacy VS Code review upsell gate (vscodeSdkMcp:84), 默认 false
  'mossen.mcp.vscodeReviewUpsellEnabled': false,
  // legacy VS Code onboarding gate (vscodeSdkMcp:87), 默认 false
  'mossen.mcp.vscodeOnboardingEnabled': false,
  // legacy browser-support gate (vscodeSdkMcp:91), 默认 false
  'mossen.mcp.quietFernEnabled': false,
  // legacy VS Code auth gate (vscodeSdkMcp:96), 默认 false
  'mossen.mcp.vscodeCcAuthEnabled': false,
  // ====================================
  // G4-7: Model / thinking / effort / fallback 域
  // ====================================
  // legacy ultrathink gate (utils/thinking.ts:25 isUltrathinkEnabled), 默认 true
  // ULTRATHINK feature 开启后, 该 gate 控制 ultrathink 是否启用
  'mossen.model.ultrathinkEnabled': true,
  // Legacy fast-mode unavailable-reason config (utils/fastMode.ts)
  // null 表示 fast mode 未被远端禁用。
  'mossen.model.fastModeUnavailableReason': null,
  // legacy fast-mode native-binary gate (utils/fastMode.ts:95), 默认 false
  // 控制是否要求 fast mode 用 native binary (legacy 兼容)
  'mossen.model.fastModeRequiresNative': false,
  // Legacy default-effort config (utils/effort.ts)
  // 默认与 OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT 保持一致。
  'mossen.model.defaultEffortConfig': {
    enabled: true,
    dialogTitle: 'We recommend medium effort for this model',
    dialogDescription:
      'Effort determines how long Mossen thinks for when completing your task. We recommend medium effort for most tasks to balance speed and intelligence and maximize rate limits. Use ultrathink to trigger high effort when needed.',
  },
  // Legacy max-output-token cap gate (services/api/mossen.ts)
  // 默认 false (3P 未验证 max-tokens cap on Bedrock/Vertex)
  'mossen.model.maxTokensCapEnabled': false,
  // ====================================
  // G5-1: Plugin / marketplace / official startup check 域
  // ====================================
  // legacy plugin hint-recommendation gate (utils/plugins/hintRecommendation.ts:66)
  // 默认 false - 个人版默认隐藏 plugin hint 弹窗 (避免 marketplace upsell)
  'mossen.plugin.hintRecommendationEnabled': false,
  // Official marketplace GCS fallback guard. Default true preserves the
  // previous retry path while the mirrored artifact rollout remains mixed.
  'mossen.plugin.officialMarketplaceGitFallbackEnabled': true,
  // ====================================
  // G5-2: Browser / Chrome / computer-use 域 (utils/mossenInChrome/**)
  // ====================================
  // legacy Chrome auto-enable gate (utils/mossenInChrome/setup.ts:92)
  // 默认 false - 个人版默认不自动启用 mossen-in-chrome 集成
  'mossen.browser.chromeAutoEnable': false,
  // legacy Chrome bridge gate (utils/mossenInChrome/mcpServer.ts:55)
  // 默认 false - 个人版默认不开 chrome-bridge MCP server
  'mossen.browser.copperBridgeEnabled': false,
  // Native clipboard image reader kill switch. Default true preserves the
  // previous fast macOS path when the native module is compiled in.
  'mossen.clipboard.nativeImageReaderEnabled': true,
  // Remote hosted setup/token-sync gate. Default false for personal builds.
  'mossen.remote.setupEnabled': false,
  // Remote background bundle seeding gate. Default false unless env forces it.
  'mossen.remote.bundleSeedEnabled': false,
  'mossen.remote.bundleMaxBytes': null,
  // Deep-link auto-registration gate. Default false; users can opt in locally.
  'mossen.deepLink.autoRegisterEnabled': false,
  // Native computer-use MCP config. Defaults mirror the local fallback.
  'mossen.computerUse.nativeMcpConfig': {
    enabled: false,
    pixelValidation: false,
    clipboardPasteMultiline: true,
    mouseAnimation: true,
    hideBeforeAction: true,
    autoTargetDisplay: true,
    clipboardGuard: true,
    coordinateMode: 'pixels',
  },
  // ====================================
  // G5-3: Native installer / update / remote session 域
  // ====================================
  // legacy remote backend gate (main.tsx:3415 isRemoteTuiEnabled), 默认 false
  // 个人版无 remote backend
  'mossen.session.remoteBackendEnabled': false,
  // legacy desktop upsell config (DesktopUpsellStartup.tsx:23)
  'mossen.installer.desktopUpsellConfig': {
    enable_shortcut_tip: false,
    enable_startup_dialog: false,
  },
  // legacy terminal panel gate (PromptInputHelpMenu.tsx:133, useGlobalKeybindings:212), 默认 false
  'mossen.ui.terminalPanelEnabled': false,
  // Terminal sidebar status gate (REPL.tsx:1165, Settings/Config.tsx:457) - 默认 false
  'mossen.ui.terminalSidebarEnabled': false,
  // Idle-return treatment: "dialog" | "hint" | "hint_v2" | "off".
  'mossen.session.idleReturnMode': 'off',
  // Startup background cache warm throttle (ms). Default 0 means always warm.
  'mossen.startup.prefetchThrottleMs': 0,
  // Startup fast-mode prefetch kill switch. Default false preserves prefetch.
  'mossen.startup.skipFastModePrefetch': false,
  'mossen.ui.keybindingCustomizationEnabled': false,
  'mossen.rateLimit.buyFirstEnabled': false,
  'mossen.voice.disabled': false,
  'mossen.cron.enabled': true,
  'mossen.cron.durableEnabled': true,
  'mossen.cron.jitterConfig': {
    recurringFrac: 0.1,
    recurringCapMs: 15 * 60 * 1000,
    oneShotMaxMs: 90 * 1000,
    oneShotFloorMs: 0,
    oneShotMinuteMod: 30,
    recurringMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
  'mossen.agentSwarms.enabled': true,
  'mossen.mcp.instructionsDeltaEnabled': false,
  'mossen.toolSearch.unsupportedModels': null,
  'mossen.tool.strictSchemaEnabled': false,
  'mossen.tool.fineGrainedStreamingEnabled': false,
  'mossen.memory.correctionHintEnabled': false,
  'mossen.advisor.config': {},
  'mossen.message.toolReferenceDeferEnabled': false,
  'mossen.message.systemReminderWrapEnabled': false,
  // legacy brief gate (Spinner:112, UserPromptMessage:61, BriefTool:95), 默认 false
  'mossen.ui.kairosBriefEnabled': false,
  'mossen.ui.kairosBriefConfig': {},
  'mossen.settingsSync.uploadEnabled': false,
  'mossen.settingsSync.downloadEnabled': false,
  'mossen.suggestion.promptEnabled': true,
  'mossen.autoDream.config': {},
  'mossen.tips.effortHighNudgeVariant': 'off',
  'mossen.tips.subagentFanoutNudgeVariant': 'off',
  'mossen.tips.loopCommandNudgeVariant': 'off',
  'mossen.survey.memoryEnabled': false,
  'mossen.survey.postCompactEnabled': false,
  'mossen.survey.feedbackConfig': {
    minTimeBeforeFeedbackMs: 600000,
    minTimeBetweenFeedbackMs: 3600000,
    minTimeBetweenGlobalFeedbackMs: 100000000,
    minUserTurnsBeforeFeedback: 5,
    minUserTurnsBetweenFeedback: 10,
    hideThanksAfterMs: 3000,
    onForModels: ['*'],
    probability: 0.005,
  },
  'mossen.survey.badTranscriptAskConfig': { probability: 0 },
  'mossen.survey.goodTranscriptAskConfig': { probability: 0 },
  'mossen.awaySummary.enabled': false,
  'mossen.sdk.agentProgressSummariesEnabled': true,
  // legacy thinkback gate (commands/thinkback/index.ts:10, thinkback-play:11), 默认 false
  'mossen.session.thinkbackEnabled': false,
  'mossen.model.immediateConfigCommandEnabled': false,
  'mossen.shell.prefixSystemPromptPolicySpecEnabled': false,
  // Installer version-policy config. Keep personal builds permissive unless
  // explicitly overridden by local config.
  'mossen.installer.versionConfig': {
    minVersion: '0.0.0',
  },
  // Optional max-version policy for staged rollbacks. Empty means no cap.
  'mossen.installer.maxVersionConfig': {},
  // PID-based installer locks stay opt-in; mtime fallback remains the default.
  'mossen.installer.pidBasedVersionLocking': false,
}
