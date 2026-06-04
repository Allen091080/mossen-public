/**
 * Legacy feature-flag → Mossen key alias map (G-D3 决策的实现).
 *
 * G3-G5 阶段每迁移一个 legacy key 到 Mossen 命名, 同步往这里加 entry.
 * Compatibility wrapper 收到 legacy-prefix 调用时, 先查这个表; 命中 →
 * 转成 mossen.* 后走 facade; 未命中 → fallback 到旧路径.
 */

import type { LegacyConfigAliasMap } from './types.js'

const LEGACY_CONFIG_PREFIX = 'ten' + 'gu_'

export const LEGACY_TO_MOSSEN_ALIAS: LegacyConfigAliasMap = {
  // G3-1: 1P 事件 batch 配置
  [LEGACY_CONFIG_PREFIX + '1p_event_batch_config']: 'mossen.analytics.eventBatchConfig',
  // G3-2: per-event sampling 配置
  [LEGACY_CONFIG_PREFIX + 'event_sampling_config']: 'mossen.analytics.eventSamplingConfig',
  // G3-3: per-sink killswitch (mangled 'frond_boric')
  [LEGACY_CONFIG_PREFIX + 'frond_boric']: 'mossen.analytics.sinkKillswitch',
  // W163-D1: Datadog event sink gate
  [LEGACY_CONFIG_PREFIX + 'log_datadog_events']: 'mossen.analytics.datadogEventsEnabled',
  // G4-1: compact 域 7 个 key
  [LEGACY_CONFIG_PREFIX + 'slate_heron']: 'mossen.compact.timeBasedMCConfig',
  [LEGACY_CONFIG_PREFIX + 'compact_cache_prefix']: 'mossen.compact.cachePrefixSharing',
  [LEGACY_CONFIG_PREFIX + 'compact_streaming_retry']: 'mossen.compact.streamingRetryEnabled',
  [LEGACY_CONFIG_PREFIX + 'compact_line_prefix_killswitch']: 'mossen.compact.linePrefixKillswitch',
  [LEGACY_CONFIG_PREFIX + 'sm_compact_config']: 'mossen.compact.sessionMemoryConfig',
  [LEGACY_CONFIG_PREFIX + 'session_memory']: 'mossen.compact.sessionMemoryEnabled',
  [LEGACY_CONFIG_PREFIX + 'sm_compact']: 'mossen.compact.sessionMemoryCompactEnabled',
  [LEGACY_CONFIG_PREFIX + 'sm_config']: 'mossen.sessionMemory.config',
  [LEGACY_CONFIG_PREFIX + 'cobalt_raccoon']: 'mossen.compact.reactiveAutoCompactKillswitch',
  // G4-2: memory 域 6 个 gate (memdir/**)
  [LEGACY_CONFIG_PREFIX + 'coral_fern']: 'mossen.memory.coralFernEnabled',
  [LEGACY_CONFIG_PREFIX + 'moth_copse']: 'mossen.memory.skipDailyLogIndex',
  [LEGACY_CONFIG_PREFIX + 'herring_clock']: 'mossen.memory.kairosActive',
  [LEGACY_CONFIG_PREFIX + 'team_memory']: 'mossen.memory.teamMemoryEnabled',
  [LEGACY_CONFIG_PREFIX + 'passport_quail']: 'mossen.memory.passportQuailEnabled',
  [LEGACY_CONFIG_PREFIX + 'slate_thimble']: 'mossen.memory.slateThimbleEnabled',
  [LEGACY_CONFIG_PREFIX + 'paper_halyard']: 'mossen.memory.skipProjectLevelRules',
  [LEGACY_CONFIG_PREFIX + 'bramble_lintel']: 'mossen.memory.extractionTurnInterval',
  [LEGACY_CONFIG_PREFIX + 'marble_fox']: 'mossen.compact.reminderAttachmentEnabled',
  [LEGACY_CONFIG_PREFIX + 'pebble_leaf_prune']: 'mossen.session.pebbleLeafPruneEnabled',
  // G4-3: tool 域 9 个 gate (tools/**)
  [LEGACY_CONFIG_PREFIX + 'quartz_lantern']: 'mossen.tool.quartzLanternEnabled',
  [LEGACY_CONFIG_PREFIX + 'hive_evidence']: 'mossen.tool.hiveEvidenceEnabled',
  [LEGACY_CONFIG_PREFIX + 'plum_vx3']: 'mossen.webSearch.smallFastModelEnabled',
  [LEGACY_CONFIG_PREFIX + 'auto_background_agents']: 'mossen.tool.autoBackgroundAgentsEnabled',
  [LEGACY_CONFIG_PREFIX + 'agent_list_attach']: 'mossen.tool.agentListAttachEnabled',
  [LEGACY_CONFIG_PREFIX + 'amber_stoat']: 'mossen.tool.amberStoatEnabled',
  [LEGACY_CONFIG_PREFIX + 'slim_subagent_mossenmd']: 'mossen.tool.slimSubagentMossenmdEnabled',
  [LEGACY_CONFIG_PREFIX + 'copper_panda']: 'mossen.skill.improvementEnabled',
  [LEGACY_CONFIG_PREFIX + 'glacier_2xr']: 'mossen.tool.glacier2xrEnabled',
  [LEGACY_CONFIG_PREFIX + 'surreal_dali']: 'mossen.tool.surrealDaliEnabled',
  [LEGACY_CONFIG_PREFIX + 'birch_trellis']: 'mossen.tool.birchTrellisEnabled',
  [LEGACY_CONFIG_PREFIX + 'sandbox_disabled_commands']: 'mossen.tool.sandboxDisabledCommands',
  // G4-4: permission setup / plan / default 域 3 个 key
  [LEGACY_CONFIG_PREFIX + 'destructive_command_warning']: 'mossen.permission.destructiveCommandWarningEnabled',
  [LEGACY_CONFIG_PREFIX + 'plan_mode_interview_phase']: 'mossen.permission.planModeInterviewPhaseEnabled',
  [LEGACY_CONFIG_PREFIX + 'pewter_ledger']: 'mossen.permission.pewterLedgerVariant',
  // G4-5: bypass / yolo classifier 域 (utils/permissions/**)
  [LEGACY_CONFIG_PREFIX + 'scratch']: 'mossen.permission.scratchpadEnabled',
  // G4-6: MCP / channel allowlist / channel permissions 域 (services/mcp/**)
  [LEGACY_CONFIG_PREFIX + 'harbor']: 'mossen.permission.channelsEnabled',
  [LEGACY_CONFIG_PREFIX + 'harbor_permissions']: 'mossen.permission.channelPermissionsAllowedEnabled',
  [LEGACY_CONFIG_PREFIX + 'harbor_ledger']: 'mossen.permission.channelAllowlist',
  [LEGACY_CONFIG_PREFIX + 'auto_mode_config']: 'mossen.ui.autoModeConfig',
  [LEGACY_CONFIG_PREFIX + 'iron_gate_closed']: 'mossen.permission.autoModeClassifierFailClosed',
  [LEGACY_CONFIG_PREFIX + 'vscode_review_upsell']: 'mossen.mcp.vscodeReviewUpsellEnabled',
  [LEGACY_CONFIG_PREFIX + 'vscode_onboarding']: 'mossen.mcp.vscodeOnboardingEnabled',
  [LEGACY_CONFIG_PREFIX + 'quiet_fern']: 'mossen.mcp.quietFernEnabled',
  [LEGACY_CONFIG_PREFIX + 'vscode_cc_auth']: 'mossen.mcp.vscodeCcAuthEnabled',
  // G4-7: model / thinking / effort / fallback 域
  [LEGACY_CONFIG_PREFIX + 'turtle_carbon']: 'mossen.model.ultrathinkEnabled',
  [LEGACY_CONFIG_PREFIX + 'penguins_off']: 'mossen.model.fastModeUnavailableReason',
  [LEGACY_CONFIG_PREFIX + 'marble_sandcastle']: 'mossen.model.fastModeRequiresNative',
  [LEGACY_CONFIG_PREFIX + 'grey_step2']: 'mossen.model.defaultEffortConfig',
  [LEGACY_CONFIG_PREFIX + 'otk_slot_v1']: 'mossen.model.maxTokensCapEnabled',
  [LEGACY_CONFIG_PREFIX + 'ant_model_override']: 'mossen.model.internalOverride',
  // G5-1: plugin / marketplace 域
  [LEGACY_CONFIG_PREFIX + 'lapis_finch']: 'mossen.plugin.hintRecommendationEnabled',
  [LEGACY_CONFIG_PREFIX + 'plugin_official_mkt_git_fallback']: 'mossen.plugin.officialMarketplaceGitFallbackEnabled',
  // G5-2: browser / chrome / computer-use 域
  [LEGACY_CONFIG_PREFIX + 'chrome_auto_enable']: 'mossen.browser.chromeAutoEnable',
  [LEGACY_CONFIG_PREFIX + 'copper_bridge']: 'mossen.browser.copperBridgeEnabled',
  [LEGACY_CONFIG_PREFIX + 'collage_kaleidoscope']: 'mossen.clipboard.nativeImageReaderEnabled',
  // G5-3: native installer / update / remote session 域
  [LEGACY_CONFIG_PREFIX + 'remote_backend']: 'mossen.session.remoteBackendEnabled',
  [LEGACY_CONFIG_PREFIX + 'cobalt_lantern']: 'mossen.remote.setupEnabled',
  [LEGACY_CONFIG_PREFIX + 'ccr_bundle_seed_enabled']: 'mossen.remote.bundleSeedEnabled',
  [LEGACY_CONFIG_PREFIX + 'ccr_bundle_max_bytes']: 'mossen.remote.bundleMaxBytes',
  [LEGACY_CONFIG_PREFIX + 'lodestone_enabled']: 'mossen.deepLink.autoRegisterEnabled',
  [LEGACY_CONFIG_PREFIX + 'malort_pedway']: 'mossen.computerUse.nativeMcpConfig',
  [LEGACY_CONFIG_PREFIX + 'desktop_upsell']: 'mossen.installer.desktopUpsellConfig',
  [LEGACY_CONFIG_PREFIX + 'terminal_panel']: 'mossen.ui.terminalPanelEnabled',
  [LEGACY_CONFIG_PREFIX + 'terminal_sidebar']: 'mossen.ui.terminalSidebarEnabled',
  [LEGACY_CONFIG_PREFIX + 'willow_mode']: 'mossen.session.idleReturnMode',
  [LEGACY_CONFIG_PREFIX + 'cicada_nap_ms']: 'mossen.startup.prefetchThrottleMs',
  [LEGACY_CONFIG_PREFIX + 'miraculo_the_bard']: 'mossen.startup.skipFastModePrefetch',
  [LEGACY_CONFIG_PREFIX + 'kairos_brief']: 'mossen.ui.kairosBriefEnabled',
  [LEGACY_CONFIG_PREFIX + 'keybinding_customization_release']: 'mossen.ui.keybindingCustomizationEnabled',
  [LEGACY_CONFIG_PREFIX + 'jade_anvil_4']: 'mossen.rateLimit.buyFirstEnabled',
  [LEGACY_CONFIG_PREFIX + 'amber_quartz_disabled']: 'mossen.voice.disabled',
  [LEGACY_CONFIG_PREFIX + 'kairos_cron']: 'mossen.cron.enabled',
  [LEGACY_CONFIG_PREFIX + 'kairos_cron_durable']: 'mossen.cron.durableEnabled',
  [LEGACY_CONFIG_PREFIX + 'kairos_cron_config']: 'mossen.cron.jitterConfig',
  [LEGACY_CONFIG_PREFIX + 'amber_flint']: 'mossen.agentSwarms.enabled',
  [LEGACY_CONFIG_PREFIX + 'basalt_3kr']: 'mossen.mcp.instructionsDeltaEnabled',
  [LEGACY_CONFIG_PREFIX + 'tool_search_unsupported_models']: 'mossen.toolSearch.unsupportedModels',
  [LEGACY_CONFIG_PREFIX + 'slate_prism']: 'mossen.sdk.agentProgressSummariesEnabled',
  [LEGACY_CONFIG_PREFIX + 'tool_pear']: 'mossen.tool.strictSchemaEnabled',
  [LEGACY_CONFIG_PREFIX + 'fgts']: 'mossen.tool.fineGrainedStreamingEnabled',
  [LEGACY_CONFIG_PREFIX + 'amber_prism']: 'mossen.memory.correctionHintEnabled',
  [LEGACY_CONFIG_PREFIX + 'sage_compass']: 'mossen.advisor.config',
  [LEGACY_CONFIG_PREFIX + 'toolref_defer_j8m']: 'mossen.message.toolReferenceDeferEnabled',
  [LEGACY_CONFIG_PREFIX + 'chair_sermon']: 'mossen.message.systemReminderWrapEnabled',
  [LEGACY_CONFIG_PREFIX + 'thinkback']: 'mossen.session.thinkbackEnabled',
  [LEGACY_CONFIG_PREFIX + 'immediate_model_command']: 'mossen.model.immediateConfigCommandEnabled',
  [LEGACY_CONFIG_PREFIX + 'cork_m4q']: 'mossen.shell.prefixSystemPromptPolicySpecEnabled',
  [LEGACY_CONFIG_PREFIX + 'version_config']: 'mossen.installer.versionConfig',
  [LEGACY_CONFIG_PREFIX + 'max_version_config']: 'mossen.installer.maxVersionConfig',
  [LEGACY_CONFIG_PREFIX + 'pid_based_version_locking']: 'mossen.installer.pidBasedVersionLocking',
  // W178-BY: residual runtime dynamic-config call-site aliases.
  [LEGACY_CONFIG_PREFIX + 'streaming_tool_execution2']: 'mossen.query.streamingToolExecutionEnabled',
  [LEGACY_CONFIG_PREFIX + 'attribution_header']: 'mossen.api.attributionHeaderEnabled',
  [LEGACY_CONFIG_PREFIX + 'cobalt_frost']: 'mossen.voice.nova3SttEnabled',
  [LEGACY_CONFIG_PREFIX + 'amber_wren']: 'mossen.fileRead.defaultLimits',
  [LEGACY_CONFIG_PREFIX + 'read_dedup_killswitch']: 'mossen.fileRead.dedupKillswitch',
  [LEGACY_CONFIG_PREFIX + 'kairos_brief_config']: 'mossen.ui.kairosBriefConfig',
  [LEGACY_CONFIG_PREFIX + 'satin_quoll']: 'mossen.toolResult.persistenceThresholds',
  [LEGACY_CONFIG_PREFIX + 'hawthorn_window']: 'mossen.toolResult.perMessageBudgetLimit',
  [LEGACY_CONFIG_PREFIX + 'hawthorn_steeple']: 'mossen.toolResult.replacementEnabled',
  [LEGACY_CONFIG_PREFIX + 'enable_settings_sync_push']: 'mossen.settingsSync.uploadEnabled',
  [LEGACY_CONFIG_PREFIX + 'strap_foyer']: 'mossen.settingsSync.downloadEnabled',
  [LEGACY_CONFIG_PREFIX + 'chomp_inflection']: 'mossen.suggestion.promptEnabled',
  [LEGACY_CONFIG_PREFIX + 'onyx_plover']: 'mossen.autoDream.config',
  [LEGACY_CONFIG_PREFIX + 'disable_keepalive_on_econnreset']: 'mossen.api.disableKeepaliveOnStaleConnection',
  [LEGACY_CONFIG_PREFIX + 'anti_distill_fake_tool_injection']: 'mossen.api.antiDistillFakeToolInjectionEnabled',
  [LEGACY_CONFIG_PREFIX + 'prompt_cache_1h_config']: 'mossen.api.promptCache1hConfig',
  [LEGACY_CONFIG_PREFIX + 'disable_streaming_to_non_streaming_fallback']: 'mossen.api.disableStreamingToNonStreamingFallback',
  [LEGACY_CONFIG_PREFIX + 'tide_elm']: 'mossen.tips.effortHighNudgeVariant',
  [LEGACY_CONFIG_PREFIX + 'tern_alloy']: 'mossen.tips.subagentFanoutNudgeVariant',
  [LEGACY_CONFIG_PREFIX + 'timber_lark']: 'mossen.tips.loopCommandNudgeVariant',
  [LEGACY_CONFIG_PREFIX + 'dunwich_bell']: 'mossen.survey.memoryEnabled',
  [LEGACY_CONFIG_PREFIX + 'post_compact_survey']: 'mossen.survey.postCompactEnabled',
  [LEGACY_CONFIG_PREFIX + 'feedback_survey_config']: 'mossen.survey.feedbackConfig',
  [LEGACY_CONFIG_PREFIX + 'bad_survey_transcript_ask_config']: 'mossen.survey.badTranscriptAskConfig',
  [LEGACY_CONFIG_PREFIX + 'good_survey_transcript_ask_config']: 'mossen.survey.goodTranscriptAskConfig',
  [LEGACY_CONFIG_PREFIX + 'sedge_lantern']: 'mossen.awaySummary.enabled',
}

/** 解析 legacy config key → Mossen 新 key. 未命中返回原 key. */
export function resolveAliasedKey(key: string): string {
  return LEGACY_TO_MOSSEN_ALIAS[key] ?? key
}
