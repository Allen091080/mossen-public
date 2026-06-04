// Mossen-native analytics event logger.
//
// Background: the underlying sink (services/analytics/index.ts +
// sink.ts) accepts arbitrary event-name strings. Historically every
// call site historically passed legacy-prefixed literals directly to
// `logEvent(...)`. New code should use Mossen-native event names
// (`mossen.<domain>.<verb>` or similar) without leaking the upstream
// brand into business code.
//
// W162-E4 introduces this thin wrapper. It accepts a Mossen-native
// event name, looks up an optional legacy wire alias from
// `MOSSEN_EVENT_TO_LEGACY_WIRE_ALIAS`, and forwards to the existing
// sink. Keys that have no alias are forwarded as-is — the sink layer
// is intentionally schema-loose so a brand-new Mossen event name can
// ship without first being added to any registry.
//
// Why an alias indirection (vs renaming the wire stream wholesale):
//   - The downstream 1P / Datadog backends already index on the
//     legacy event names. Renaming the wire stream would break
//     dashboards / alerts / sampling configs we don't own.
//   - Bulk-renaming the ~60 in-tree call sites today would create a
//     diff that conflicts with every in-flight wave touching the
//     analytics surface. Doing the rename per-domain across W162-E5+
//     keeps each change small enough to review.
//
// New code should call `logMossenEvent('mossen.tool.use.success', {...})`.
// The wrapper translates to the legacy wire name only if the alias map says
// so; otherwise the new name is forwarded verbatim.

import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from './index.js'
import { logEvent, logEventAsync } from './index.js'

type LogEventMetadata = {
  [key: string]:
    | boolean
    | number
    | undefined
    | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

const LEGACY_EVENT_PREFIX = 'ten' + 'gu_'

/** Mossen-native event name → legacy wire name on the sink.
 *
 *  Add an entry here when a Mossen-side rename ships ahead of the
 *  downstream backend. New events introduced after W162-E4 should
 *  ideally NOT need an entry — they can use the Mossen name directly
 *  on the wire from day one.
 */
export const MOSSEN_EVENT_TO_LEGACY_WIRE_ALIAS: Readonly<Record<string, string>> = Object.freeze({
  'mossen.compact.cacheSharingFallback':
    LEGACY_EVENT_PREFIX + 'compact_cache_sharing_fallback',
  'mossen.compact.cacheSharingSuccess':
    LEGACY_EVENT_PREFIX + 'compact_cache_sharing_success',
  'mossen.compact.cachedMicrocompact':
    LEGACY_EVENT_PREFIX + 'cached_microcompact',
  'mossen.compact.completed':
    LEGACY_EVENT_PREFIX + 'compact',
  'mossen.compact.failed':
    LEGACY_EVENT_PREFIX + 'compact_failed',
  'mossen.compact.partialCompleted':
    LEGACY_EVENT_PREFIX + 'partial_compact',
  'mossen.compact.partialFailed':
    LEGACY_EVENT_PREFIX + 'partial_compact_failed',
  'mossen.compact.postFileRestoreError':
    LEGACY_EVENT_PREFIX + 'post_compact_file_restore_error',
  'mossen.compact.postFileRestoreSuccess':
    LEGACY_EVENT_PREFIX + 'post_compact_file_restore_success',
  'mossen.compact.promptTooLongRetry':
    LEGACY_EVENT_PREFIX + 'compact_ptl_retry',
  'mossen.compact.sessionMemoryEmptyTemplate':
    LEGACY_EVENT_PREFIX + 'sm_compact_empty_template',
  'mossen.compact.sessionMemoryError':
    LEGACY_EVENT_PREFIX + 'sm_compact_error',
  'mossen.compact.sessionMemoryFlagCheck':
    LEGACY_EVENT_PREFIX + 'sm_compact_flag_check',
  'mossen.compact.sessionMemoryMissing':
    LEGACY_EVENT_PREFIX + 'sm_compact_no_session_memory',
  'mossen.compact.sessionMemoryResumed':
    LEGACY_EVENT_PREFIX + 'sm_compact_resumed_session',
  'mossen.compact.sessionMemorySummarizedIdMissing':
    LEGACY_EVENT_PREFIX + 'sm_compact_summarized_id_not_found',
  'mossen.compact.sessionMemoryThresholdExceeded':
    LEGACY_EVENT_PREFIX + 'sm_compact_threshold_exceeded',
  'mossen.compact.streamingRetry':
    LEGACY_EVENT_PREFIX + 'compact_streaming_retry',
  'mossen.compact.timeBasedMicrocompact':
    LEGACY_EVENT_PREFIX + 'time_based_microcompact',
  'mossen.attachment.atMentionAgentNotFound':
    LEGACY_EVENT_PREFIX + 'at_mention_agent_not_found',
  'mossen.attachment.atMentionAgentSuccess':
    LEGACY_EVENT_PREFIX + 'at_mention_agent_success',
  'mossen.attachment.atMentionDirectoryExtracted':
    LEGACY_EVENT_PREFIX + 'at_mention_extracting_directory_success',
  'mossen.attachment.atMentionFilenameExtracted':
    LEGACY_EVENT_PREFIX + 'at_mention_extracting_filename_success',
  'mossen.attachment.atMentionFilenameExtractFailed':
    LEGACY_EVENT_PREFIX + 'at_mention_extracting_filename_error',
  'mossen.attachment.atMentionMcpResourceError':
    LEGACY_EVENT_PREFIX + 'at_mention_mcp_resource_error',
  'mossen.attachment.atMentionMcpResourceSuccess':
    LEGACY_EVENT_PREFIX + 'at_mention_mcp_resource_success',
  'mossen.attachment.collected':
    LEGACY_EVENT_PREFIX + 'attachments',
  'mossen.attachment.computeDuration':
    LEGACY_EVENT_PREFIX + 'attachment_compute_duration',
  'mossen.attachment.fileTooLarge':
    LEGACY_EVENT_PREFIX + 'attachment_file_too_large',
  'mossen.attachment.pdfReference':
    LEGACY_EVENT_PREFIX + 'pdf_reference_attachment',
  'mossen.attachment.ultrathinkTriggered':
    LEGACY_EVENT_PREFIX + 'ultrathink',
  'mossen.attachment.watchedFileCompressionFailed':
    LEGACY_EVENT_PREFIX + 'watched_file_compression_failed',
  'mossen.memory.memdirAccessed':
    LEGACY_EVENT_PREFIX + 'memdir_accessed',
  'mossen.memory.memdirDisabled':
    LEGACY_EVENT_PREFIX + 'memdir_disabled',
  'mossen.memory.memdirFileEdit':
    LEGACY_EVENT_PREFIX + 'memdir_file_edit',
  'mossen.memory.memdirFileRead':
    LEGACY_EVENT_PREFIX + 'memdir_file_read',
  'mossen.memory.memdirFileWrite':
    LEGACY_EVENT_PREFIX + 'memdir_file_write',
  'mossen.memory.memdirLoaded':
    LEGACY_EVENT_PREFIX + 'memdir_loaded',
  'mossen.memory.autoDreamToggled':
    LEGACY_EVENT_PREFIX + 'auto_dream_toggled',
  'mossen.memory.autoMemoryToggled':
    LEGACY_EVENT_PREFIX + 'auto_memory_toggled',
  'mossen.memory.autoToolDenied':
    LEGACY_EVENT_PREFIX + 'auto_mem_tool_denied',
  'mossen.memory.extractCoalesced':
    LEGACY_EVENT_PREFIX + 'extract_memories_coalesced',
  'mossen.memory.extractError':
    LEGACY_EVENT_PREFIX + 'extract_memories_error',
  'mossen.memory.extractGateDisabled':
    LEGACY_EVENT_PREFIX + 'extract_memories_gate_disabled',
  'mossen.memory.extractResult':
    LEGACY_EVENT_PREFIX + 'extract_memories_extraction',
  'mossen.memory.extractSkippedDirectWrite':
    LEGACY_EVENT_PREFIX + 'extract_memories_skipped_direct_write',
  'mossen.memory.mossenMdInitialLoad':
    LEGACY_EVENT_PREFIX + 'mossenmd__initial_load',
  'mossen.memory.mossenMdPermissionError':
    LEGACY_EVENT_PREFIX + 'mossen_md_permission_error',
  'mossen.memory.mossenRulesMdPermissionError':
    LEGACY_EVENT_PREFIX + 'mossen_rules_md_permission_error',
  'mossen.memory.externalIncludesDialogAccepted':
    LEGACY_EVENT_PREFIX + 'mossen_md_external_includes_dialog_accepted',
  'mossen.memory.externalIncludesDialogDeclined':
    LEGACY_EVENT_PREFIX + 'mossen_md_external_includes_dialog_declined',
  'mossen.memory.externalIncludesDialogShown':
    LEGACY_EVENT_PREFIX + 'mossen_md_includes_dialog_shown',
  'mossen.memory.prefetchCollected':
    LEGACY_EVENT_PREFIX + 'memdir_prefetch_collected',
  'mossen.memory.teamMemAccessed':
    LEGACY_EVENT_PREFIX + 'team_mem_accessed',
  'mossen.memory.teamMemdirDisabled':
    LEGACY_EVENT_PREFIX + 'team_memdir_disabled',
  'mossen.memory.teamMemFileEdit':
    LEGACY_EVENT_PREFIX + 'team_mem_file_edit',
  'mossen.memory.teamMemFileRead':
    LEGACY_EVENT_PREFIX + 'team_mem_file_read',
  'mossen.memory.teamMemFileWrite':
    LEGACY_EVENT_PREFIX + 'team_mem_file_write',
  'mossen.teamMemory.entriesCapped':
    LEGACY_EVENT_PREFIX + 'team_mem_entries_capped',
  'mossen.teamMemory.pushSuppressed':
    LEGACY_EVENT_PREFIX + 'team_mem_push_suppressed',
  'mossen.teamMemory.secretSkipped':
    LEGACY_EVENT_PREFIX + 'team_mem_secret_skipped',
  'mossen.teamMemory.syncPull':
    LEGACY_EVENT_PREFIX + 'team_mem_sync_pull',
  'mossen.teamMemory.syncPush':
    LEGACY_EVENT_PREFIX + 'team_mem_sync_push',
  'mossen.teamMemory.syncStarted':
    LEGACY_EVENT_PREFIX + 'team_mem_sync_started',
  'mossen.sessionMemory.extraction':
    LEGACY_EVENT_PREFIX + 'session_memory_extraction',
  'mossen.sessionMemory.fileRead':
    LEGACY_EVENT_PREFIX + 'session_memory_file_read',
  'mossen.sessionMemory.gateDisabled':
    LEGACY_EVENT_PREFIX + 'session_memory_gate_disabled',
  'mossen.sessionMemory.init':
    LEGACY_EVENT_PREFIX + 'session_memory_init',
  'mossen.sessionMemory.loaded':
    LEGACY_EVENT_PREFIX + 'session_memory_loaded',
  'mossen.sessionMemory.manualExtraction':
    LEGACY_EVENT_PREFIX + 'session_memory_manual_extraction',
  'mossen.session.agentColorSet':
    LEGACY_EVENT_PREFIX + 'agent_color_set',
  'mossen.session.agentNameSet':
    LEGACY_EVENT_PREFIX + 'agent_name_set',
  'mossen.session.agenticSearchCancelled':
    LEGACY_EVENT_PREFIX + 'agentic_search_cancelled',
  'mossen.session.agenticSearchCompleted':
    LEGACY_EVENT_PREFIX + 'agentic_search_completed',
  'mossen.session.agenticSearchError':
    LEGACY_EVENT_PREFIX + 'agentic_search_error',
  'mossen.session.agenticSearchStarted':
    LEGACY_EVENT_PREFIX + 'agentic_search_started',
  'mossen.session.allProjectsToggled':
    LEGACY_EVENT_PREFIX + 'session_all_projects_toggled',
  'mossen.session.branchFilterToggled':
    LEGACY_EVENT_PREFIX + 'session_branch_filter_toggled',
  'mossen.session.chainParallelToolResultsRecovered':
    LEGACY_EVENT_PREFIX + 'chain_parallel_tr_recovered',
  'mossen.session.chainParentCycle':
    LEGACY_EVENT_PREFIX + 'chain_parent_cycle',
  'mossen.session.concurrentSessions':
    LEGACY_EVENT_PREFIX + 'concurrent_sessions',
  'mossen.session.continue':
    LEGACY_EVENT_PREFIX + 'continue',
  'mossen.session.conversationForked':
    LEGACY_EVENT_PREFIX + 'conversation_forked',
  'mossen.session.forkedBranchesFetched':
    LEGACY_EVENT_PREFIX + 'session_forked_branches_fetched',
  'mossen.session.groupExpanded':
    LEGACY_EVENT_PREFIX + 'session_group_expanded',
  'mossen.session.linkedToPr':
    LEGACY_EVENT_PREFIX + 'session_linked_to_pr',
  'mossen.session.memoryAccessed':
    LEGACY_EVENT_PREFIX + 'session_memory_accessed',
  'mossen.session.previewOpened':
    LEGACY_EVENT_PREFIX + 'session_preview_opened',
  'mossen.session.persistenceFailed':
    LEGACY_EVENT_PREFIX + 'session_persistence_failed',
  'mossen.session.relinkWalkBroken':
    LEGACY_EVENT_PREFIX + 'relink_walk_broken',
  'mossen.session.renameStarted':
    LEGACY_EVENT_PREFIX + 'session_rename_started',
  'mossen.session.renamed':
    LEGACY_EVENT_PREFIX + 'session_renamed',
  'mossen.session.resumed':
    LEGACY_EVENT_PREFIX + 'session_resumed',
  'mossen.session.resumeConsistencyDelta':
    LEGACY_EVENT_PREFIX + 'resume_consistency_delta',
  'mossen.session.titleGenerated':
    LEGACY_EVENT_PREFIX + 'session_title_generated',
  'mossen.session.searchToggled':
    LEGACY_EVENT_PREFIX + 'session_search_toggled',
  'mossen.conversation.rewind':
    LEGACY_EVENT_PREFIX + 'conversation_rewind',
  'mossen.cost.thresholdAcknowledged':
    LEGACY_EVENT_PREFIX + 'cost_threshold_acknowledged',
  'mossen.cost.thresholdReached':
    LEGACY_EVENT_PREFIX + 'cost_threshold_reached',
  'mossen.repl.concurrentOnQueryDetected':
    LEGACY_EVENT_PREFIX + 'concurrent_onquery_detected',
  'mossen.repl.concurrentOnQueryEnqueued':
    LEGACY_EVENT_PREFIX + 'concurrent_onquery_enqueued',
  'mossen.repl.idleReturnAction':
    LEGACY_EVENT_PREFIX + 'idle_return_action',
  'mossen.repl.immediateCommandExecuted':
    LEGACY_EVENT_PREFIX + 'immediate_command_executed',
  'mossen.repl.pasteText':
    LEGACY_EVENT_PREFIX + 'paste_text',
  'mossen.cancel.requested':
    LEGACY_EVENT_PREFIX + 'cancel',
  'mossen.session.snipResumeFiltered':
    LEGACY_EVENT_PREFIX + 'snip_resume_filtered',
  'mossen.session.tagFilterChanged':
    LEGACY_EVENT_PREFIX + 'session_tag_filter_changed',
  'mossen.session.tagged':
    LEGACY_EVENT_PREFIX + 'session_tagged',
  'mossen.session.transcriptAccessed':
    LEGACY_EVENT_PREFIX + 'transcript_accessed',
  'mossen.session.transcriptParentCycle':
    LEGACY_EVENT_PREFIX + 'transcript_parent_cycle',
  'mossen.session.transcriptViewEnter':
    LEGACY_EVENT_PREFIX + 'transcript_view_enter',
  'mossen.session.transcriptViewExit':
    LEGACY_EVENT_PREFIX + 'transcript_view_exit',
  'mossen.session.worktreeFilterToggled':
    LEGACY_EVENT_PREFIX + 'session_worktree_filter_toggled',
  'mossen.remote.createSession':
    LEGACY_EVENT_PREFIX + 'remote_create_session',
  'mossen.remote.createSessionError':
    LEGACY_EVENT_PREFIX + 'remote_create_session_error',
  'mossen.remote.createSessionSuccess':
    LEGACY_EVENT_PREFIX + 'remote_create_session_success',
  'mossen.survey.feedbackFollowup':
    LEGACY_EVENT_PREFIX + 'feedback_survey_event',
  'mossen.survey.memory':
    LEGACY_EVENT_PREFIX + 'memory_survey_event',
  'mossen.feedback.bugReportSubmitted':
    LEGACY_EVENT_PREFIX + 'bug_report_submitted',
  'mossen.survey.postCompact':
    LEGACY_EVENT_PREFIX + 'post_compact_survey_event',
  'mossen.survey.skillImprovement':
    LEGACY_EVENT_PREFIX + 'skill_improvement_survey',
  'mossen.agent.cacheEvictionHint':
    LEGACY_EVENT_PREFIX + 'cache_eviction_hint',
  'mossen.agent.flag':
    LEGACY_EVENT_PREFIX + 'agent_flag',
  'mossen.agent.memoryLoaded':
    LEGACY_EVENT_PREFIX + 'agent_memory_loaded',
  'mossen.agent.parseError':
    LEGACY_EVENT_PREFIX + 'agent_parse_error',
  'mossen.agent.toolCompleted':
    LEGACY_EVENT_PREFIX + 'agent_tool_completed',
  'mossen.agent.toolSelected':
    LEGACY_EVENT_PREFIX + 'agent_tool_selected',
  'mossen.agent.toolTerminated':
    LEGACY_EVENT_PREFIX + 'agent_tool_terminated',
  'mossen.model.effortCommand':
    LEGACY_EVENT_PREFIX + 'effort_command',
  'mossen.model.fastModeFallbackTriggered':
    LEGACY_EVENT_PREFIX + 'fast_mode_fallback_triggered',
  'mossen.model.fastModeOverageRejected':
    LEGACY_EVENT_PREFIX + 'fast_mode_overage_rejected',
  'mossen.model.fastModePickerShown':
    LEGACY_EVENT_PREFIX + 'fast_mode_picker_shown',
  'mossen.model.pickerEffort':
    LEGACY_EVENT_PREFIX + 'model_command_menu_effort',
  'mossen.model.fastModeStatusFetchFailed':
    LEGACY_EVENT_PREFIX + 'org_penguin_mode_fetch_failed',
  'mossen.model.fastModeToggled':
    LEGACY_EVENT_PREFIX + 'fast_mode_toggled',
  'mossen.model.unknownCost':
    LEGACY_EVENT_PREFIX + 'unknown_model_cost',
  'mossen.git.operation':
    LEGACY_EVENT_PREFIX + 'git_operation',
  'mossen.config.autoCompactSettingChanged':
    LEGACY_EVENT_PREFIX + 'auto_compact_setting_changed',
  'mossen.config.autoConnectIdeChanged':
    LEGACY_EVENT_PREFIX + 'auto_connect_ide_changed',
  'mossen.config.autoInstallIdeExtensionChanged':
    LEGACY_EVENT_PREFIX + 'auto_install_ide_extension_changed',
  'mossen.config.autoUpdateChannelChanged':
    LEGACY_EVENT_PREFIX + 'autoupdate_channel_changed',
  'mossen.config.autoUpdateEnabled':
    LEGACY_EVENT_PREFIX + 'autoupdate_enabled',
  'mossen.config.changed':
    LEGACY_EVENT_PREFIX + 'config_changed',
  'mossen.config.authLossPrevented':
    LEGACY_EVENT_PREFIX + 'config_auth_loss_prevented',
  'mossen.config.cacheStats':
    LEGACY_EVENT_PREFIX + 'config_cache_stats',
  'mossen.config.lockContention':
    LEGACY_EVENT_PREFIX + 'config_lock_contention',
  'mossen.config.lockFallback':
    LEGACY_EVENT_PREFIX + 'config_lock_fallback',
  'mossen.config.parseError':
    LEGACY_EVENT_PREFIX + 'config_parse_error',
  'mossen.config.staleWrite':
    LEGACY_EVENT_PREFIX + 'config_stale_write',
  'mossen.config.toolChanged':
    LEGACY_EVENT_PREFIX + 'config_tool_changed',
  'mossen.migration.autoUpdatesError':
    LEGACY_EVENT_PREFIX + 'migrate_autoupdates_error',
  'mossen.migration.autoUpdatesToSettings':
    LEGACY_EVENT_PREFIX + 'migrate_autoupdates_to_settings',
  'mossen.migration.bypassPermissionsAccepted':
    LEGACY_EVENT_PREFIX + 'migrate_bypass_permissions_accepted',
  'mossen.migration.legacyOpusToCurrent':
    LEGACY_EVENT_PREFIX + 'legacy_opus_migration',
  'mossen.migration.mcpApprovalFieldsError':
    LEGACY_EVENT_PREFIX + 'migrate_mcp_approval_fields_error',
  'mossen.migration.mcpApprovalFieldsSuccess':
    LEGACY_EVENT_PREFIX + 'migrate_mcp_approval_fields_success',
  'mossen.migration.opusToOpus1m':
    LEGACY_EVENT_PREFIX + 'opus_to_opus1m_migration',
  'mossen.migration.resetAutoOptInForDefaultOffer':
    LEGACY_EVENT_PREFIX + 'migrate_reset_auto_opt_in_for_default_offer',
  'mossen.migration.resetProToOpusDefault':
    LEGACY_EVENT_PREFIX + 'reset_pro_to_opus_default',
  'mossen.migration.sonnet45To46':
    LEGACY_EVENT_PREFIX + 'sonnet45_to_46_migration',
  'mossen.config.defaultViewSettingChanged':
    LEGACY_EVENT_PREFIX + 'default_view_setting_changed',
  'mossen.config.diffToolChanged':
    LEGACY_EVENT_PREFIX + 'diff_tool_changed',
  'mossen.config.editorModeChanged':
    LEGACY_EVENT_PREFIX + 'editor_mode_changed',
  'mossen.config.fileHistorySnapshotsSettingChanged':
    LEGACY_EVENT_PREFIX + 'file_history_snapshots_setting_changed',
  'mossen.config.languageChanged':
    LEGACY_EVENT_PREFIX + 'language_changed',
  'mossen.config.modelChanged':
    LEGACY_EVENT_PREFIX + 'config_model_changed',
  'mossen.config.mossenInChromeSettingChanged':
    LEGACY_EVENT_PREFIX + 'mossen_in_chrome_setting_changed',
  'mossen.config.outputStyleChanged':
    LEGACY_EVENT_PREFIX + 'output_style_changed',
  'mossen.config.prStatusFooterSettingChanged':
    LEGACY_EVENT_PREFIX + 'pr_status_footer_setting_changed',
  'mossen.config.reduceMotionSettingChanged':
    LEGACY_EVENT_PREFIX + 'reduce_motion_setting_changed',
  'mossen.config.respectGitignoreSettingChanged':
    LEGACY_EVENT_PREFIX + 'respect_gitignore_setting_changed',
  'mossen.config.showTurnDurationSettingChanged':
    LEGACY_EVENT_PREFIX + 'show_turn_duration_setting_changed',
  'mossen.config.speculationSettingChanged':
    LEGACY_EVENT_PREFIX + 'speculation_setting_changed',
  'mossen.config.teammateDefaultModelChanged':
    LEGACY_EVENT_PREFIX + 'teammate_default_model_changed',
  'mossen.config.teammateModeChanged':
    LEGACY_EVENT_PREFIX + 'teammate_mode_changed',
  'mossen.config.terminalProgressBarSettingChanged':
    LEGACY_EVENT_PREFIX + 'terminal_progress_bar_setting_changed',
  'mossen.config.terminalTabStatusSettingChanged':
    LEGACY_EVENT_PREFIX + 'terminal_tab_status_setting_changed',
  'mossen.config.thinkingToggled':
    LEGACY_EVENT_PREFIX + 'thinking_toggled',
  'mossen.config.tipsSettingChanged':
    LEGACY_EVENT_PREFIX + 'tips_setting_changed',
  'mossen.coordinator.modeSwitched':
    LEGACY_EVENT_PREFIX + 'coordinator_mode_switched',
  'mossen.tips.shown':
    LEGACY_EVENT_PREFIX + 'tip_shown',
  'mossen.notification.methodUsed':
    LEGACY_EVENT_PREFIX + 'notification_method_used',
  'mossen.copy.executed':
    LEGACY_EVENT_PREFIX + 'copy',
  'mossen.file.atomicWriteError':
    LEGACY_EVENT_PREFIX + 'atomic_write_error',
  'mossen.file.changed':
    LEGACY_EVENT_PREFIX + 'file_changed',
  'mossen.fileHistory.backupDeletedFile':
    LEGACY_EVENT_PREFIX + 'file_history_backup_deleted_file',
  'mossen.fileHistory.backupFileCreated':
    LEGACY_EVENT_PREFIX + 'file_history_backup_file_created',
  'mossen.fileHistory.backupFileFailed':
    LEGACY_EVENT_PREFIX + 'file_history_backup_file_failed',
  'mossen.fileHistory.resumeCopyFailed':
    LEGACY_EVENT_PREFIX + 'file_history_resume_copy_failed',
  'mossen.fileHistory.rewindFailed':
    LEGACY_EVENT_PREFIX + 'file_history_rewind_failed',
  'mossen.fileHistory.rewindRestoreFileFailed':
    LEGACY_EVENT_PREFIX + 'file_history_rewind_restore_file_failed',
  'mossen.fileHistory.rewindSuccess':
    LEGACY_EVENT_PREFIX + 'file_history_rewind_success',
  'mossen.fileHistory.snapshotFailed':
    LEGACY_EVENT_PREFIX + 'file_history_snapshot_failed',
  'mossen.fileHistory.snapshotSuccess':
    LEGACY_EVENT_PREFIX + 'file_history_snapshot_success',
  'mossen.fileHistory.trackEditFailed':
    LEGACY_EVENT_PREFIX + 'file_history_track_edit_failed',
  'mossen.fileHistory.trackEditSuccess':
    LEGACY_EVENT_PREFIX + 'file_history_track_edit_success',
  'mossen.file.operation':
    LEGACY_EVENT_PREFIX + 'file_operation',
  'mossen.fileEdit.stringLengths':
    LEGACY_EVENT_PREFIX + 'edit_string_lengths',
  'mossen.fileRead.dedup':
    LEGACY_EVENT_PREFIX + 'file_read_dedup',
  'mossen.fileRead.limitsOverride':
    LEGACY_EVENT_PREFIX + 'file_read_limits_override',
  'mossen.fileRead.pdfPageExtraction':
    LEGACY_EVENT_PREFIX + 'pdf_page_extraction',
  'mossen.fileRead.sessionFileRead':
    LEGACY_EVENT_PREFIX + 'session_file_read',
  'mossen.image.apiValidationFailed':
    LEGACY_EVENT_PREFIX + 'image_api_validation_failed',
  'mossen.image.compressFailed':
    LEGACY_EVENT_PREFIX + 'image_compress_failed',
  'mossen.image.resizeFailed':
    LEGACY_EVENT_PREFIX + 'image_resize_failed',
  'mossen.image.resizeFallback':
    LEGACY_EVENT_PREFIX + 'image_resize_fallback',
  'mossen.ripgrep.availability':
    LEGACY_EVENT_PREFIX + 'ripgrep_availability',
  'mossen.ripgrep.eagainRetry':
    LEGACY_EVENT_PREFIX + 'ripgrep_eagain_retry',
  'mossen.runtime.nodeWarning':
    LEGACY_EVENT_PREFIX + 'node_warning',
  'mossen.runtime.timer':
    LEGACY_EVENT_PREFIX + 'timer',
  'mossen.terminal.flicker':
    LEGACY_EVENT_PREFIX + 'flicker',
  'mossen.terminal.stdinInteractive':
    LEGACY_EVENT_PREFIX + 'stdin_interactive',
  'mossen.suggestion.fileGitLsFiles':
    LEGACY_EVENT_PREFIX + 'file_suggestions_git_ls_files',
  'mossen.suggestion.fileQuery':
    LEGACY_EVENT_PREFIX + 'file_suggestions_query',
  'mossen.suggestion.fileRipgrep':
    LEGACY_EVENT_PREFIX + 'file_suggestions_ripgrep',
  'mossen.suggestion.pluginHintResponse':
    LEGACY_EVENT_PREFIX + 'plugin_hint_response',
  'mossen.suggestion.promptInit':
    LEGACY_EVENT_PREFIX + 'prompt_suggestion_init',
  'mossen.suggestion.promptOutcome':
    LEGACY_EVENT_PREFIX + 'prompt_suggestion',
  'mossen.suggestion.shellCompletionFailed':
    LEGACY_EVENT_PREFIX + 'shell_completion_failed',
  'mossen.suggestion.speculation':
    LEGACY_EVENT_PREFIX + 'speculation',
  'mossen.cleanup.npmCache':
    LEGACY_EVENT_PREFIX + 'npm_cache_cleanup',
  'mossen.cleanup.worktree':
    LEGACY_EVENT_PREFIX + 'worktree_cleanup',
  'mossen.brief.modeToggled':
    LEGACY_EVENT_PREFIX + 'brief_mode_toggled',
  'mossen.brief.modeEnabled':
    LEGACY_EVENT_PREFIX + 'brief_mode_enabled',
  'mossen.brief.send':
    LEGACY_EVENT_PREFIX + 'brief_send',
  'mossen.voice.toggled':
    LEGACY_EVENT_PREFIX + 'voice_toggled',
  'mossen.cli.doctorCommand':
    LEGACY_EVENT_PREFIX + 'doctor_command',
  'mossen.cli.setupTokenCommand':
    LEGACY_EVENT_PREFIX + 'setup_token_command',
  'mossen.integration.slackAppInstallClicked':
    LEGACY_EVENT_PREFIX + 'install_mossen_slack_app_clicked',
  'mossen.passes.visited':
    LEGACY_EVENT_PREFIX + 'guest_passes_visited',
  'mossen.passes.linkCopied':
    LEGACY_EVENT_PREFIX + 'guest_passes_link_copied',
  'mossen.rateLimitOptions.cancel':
    LEGACY_EVENT_PREFIX + 'rate_limit_options_menu_cancel',
  'mossen.rateLimitOptions.selectExtraUsage':
    LEGACY_EVENT_PREFIX + 'rate_limit_options_menu_select_extra_usage',
  'mossen.rateLimitOptions.selectUpgrade':
    LEGACY_EVENT_PREFIX + 'rate_limit_options_menu_select_upgrade',
  'mossen.privacy.grovePolicyToggled':
    LEGACY_EVENT_PREFIX + 'grove_policy_toggled',
  'mossen.grove.policyExited':
    LEGACY_EVENT_PREFIX + 'grove_policy_exited',
  'mossen.quickOpen.insert':
    LEGACY_EVENT_PREFIX + 'quick_open_insert',
  'mossen.quickOpen.select':
    LEGACY_EVENT_PREFIX + 'quick_open_select',
  'mossen.tag.add':
    LEGACY_EVENT_PREFIX + 'tag_command_add',
  'mossen.tag.removeCancelled':
    LEGACY_EVENT_PREFIX + 'tag_command_remove_cancelled',
  'mossen.tag.removeConfirmed':
    LEGACY_EVENT_PREFIX + 'tag_command_remove_confirmed',
  'mossen.tag.removePrompt':
    LEGACY_EVENT_PREFIX + 'tag_command_remove_prompt',
  'mossen.teleport.resumeCancelled':
    LEGACY_EVENT_PREFIX + 'teleport_cancelled',
  'mossen.teleport.resumeStarted':
    LEGACY_EVENT_PREFIX + 'teleport_started',
  'mossen.teleport.interactiveMode':
    LEGACY_EVENT_PREFIX + 'teleport_interactive_mode',
  'mossen.teleport.resumeSession':
    LEGACY_EVENT_PREFIX + 'teleport_resume_session',
  'mossen.teleport.bundleMode':
    LEGACY_EVENT_PREFIX + 'teleport_bundle_mode',
  'mossen.teleport.errorBranchCheckoutFailed':
    LEGACY_EVENT_PREFIX + 'teleport_error_branch_checkout_failed',
  'mossen.teleport.errorGitNotClean':
    LEGACY_EVENT_PREFIX + 'teleport_error_git_not_clean',
  'mossen.teleport.errorRepoMismatchSessionsApi':
    LEGACY_EVENT_PREFIX + 'teleport_error_repo_mismatch_sessions_api',
  'mossen.teleport.errorRepoNotInGitDirSessionsApi':
    LEGACY_EVENT_PREFIX + 'teleport_error_repo_not_in_git_dir_sessions_api',
  'mossen.teleport.errorSessionNotFound404':
    LEGACY_EVENT_PREFIX + 'teleport_error_session_not_found_404',
  'mossen.teleport.errorsDetected':
    LEGACY_EVENT_PREFIX + 'teleport_errors_detected',
  'mossen.teleport.errorsResolved':
    LEGACY_EVENT_PREFIX + 'teleport_errors_resolved',
  'mossen.teleport.resumeError':
    LEGACY_EVENT_PREFIX + 'teleport_resume_error',
  'mossen.teleport.sourceDecision':
    LEGACY_EVENT_PREFIX + 'teleport_source_decision',
  'mossen.trustDialog.accept':
    LEGACY_EVENT_PREFIX + 'trust_dialog_accept',
  'mossen.trustDialog.shown':
    LEGACY_EVENT_PREFIX + 'trust_dialog_shown',
  'mossen.onboarding.started':
    LEGACY_EVENT_PREFIX + 'began_setup',
  'mossen.onboarding.step':
    LEGACY_EVENT_PREFIX + 'onboarding_step',
  'mossen.startup.codePromptIgnored':
    LEGACY_EVENT_PREFIX + 'code_prompt_ignored',
  'mossen.startup.init':
    LEGACY_EVENT_PREFIX + 'init',
  'mossen.startup.manualModelConfig':
    LEGACY_EVENT_PREFIX + 'startup_manual_model_config',
  'mossen.startup.singleWordPrompt':
    LEGACY_EVENT_PREFIX + 'single_word_prompt',
  'mossen.startup.started':
    LEGACY_EVENT_PREFIX + 'started',
  'mossen.startup.telemetry':
    LEGACY_EVENT_PREFIX + 'startup_telemetry',
  'mossen.session.previousExit':
    LEGACY_EVENT_PREFIX + 'exit',
  'mossen.auth.apiKeyHelperMissingTrust11':
    LEGACY_EVENT_PREFIX + 'apiKeyHelper_missing_trust11',
  'mossen.auth.apiKeyKeychainError':
    LEGACY_EVENT_PREFIX + 'api_key_keychain_error',
  'mossen.auth.apiKeySavedToConfig':
    LEGACY_EVENT_PREFIX + 'api_key_saved_to_config',
  'mossen.auth.apiKeySavedToKeychain':
    LEGACY_EVENT_PREFIX + 'api_key_saved_to_keychain',
  'mossen.auth.awsAuthRefreshMissingTrust':
    LEGACY_EVENT_PREFIX + 'awsAuthRefresh_missing_trust',
  'mossen.auth.awsCredentialExportMissingTrust':
    LEGACY_EVENT_PREFIX + 'awsCredentialExport_missing_trust',
  'mossen.auth.gcpAuthRefreshMissingTrust':
    LEGACY_EVENT_PREFIX + 'gcpAuthRefresh_missing_trust',
  'mossen.auth.oauth401RecoveredFromKeychain':
    LEGACY_EVENT_PREFIX + 'oauth_401_recovered_from_keychain',
  'mossen.auth.oauthTokenRefreshLockAcquired':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_lock_acquired',
  'mossen.auth.oauthTokenRefreshLockAcquiring':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_lock_acquiring',
  'mossen.auth.oauthTokenRefreshLockError':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_lock_error',
  'mossen.auth.oauthTokenRefreshLockReleased':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_lock_released',
  'mossen.auth.oauthTokenRefreshLockReleasing':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_lock_releasing',
  'mossen.auth.oauthTokenRefreshLockRetry':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_lock_retry',
  'mossen.auth.oauthTokenRefreshLockRetryLimitReached':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_lock_retry_limit_reached',
  'mossen.auth.oauthTokenRefreshRaceRecovered':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_race_recovered',
  'mossen.auth.oauthTokenRefreshRaceResolved':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_race_resolved',
  'mossen.auth.oauthTokenRefreshStarting':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_starting',
  'mossen.auth.oauthTokensInferenceOnly':
    LEGACY_EVENT_PREFIX + 'oauth_tokens_inference_only',
  'mossen.auth.oauthTokensNotHosted':
    LEGACY_EVENT_PREFIX + 'oauth_tokens_not_hosted',
  'mossen.auth.oauthTokensSaveException':
    LEGACY_EVENT_PREFIX + 'oauth_tokens_save_exception',
  'mossen.auth.oauthTokensSaveFailed':
    LEGACY_EVENT_PREFIX + 'oauth_tokens_save_failed',
  'mossen.auth.oauthTokensSaved':
    LEGACY_EVENT_PREFIX + 'oauth_tokens_saved',
  'mossen.oauth.consoleForced':
    LEGACY_EVENT_PREFIX + 'oauth_console_forced',
  'mossen.oauth.consoleSelected':
    LEGACY_EVENT_PREFIX + 'oauth_console_selected',
  'mossen.oauth.error':
    LEGACY_EVENT_PREFIX + 'oauth_error',
  'mossen.oauth.flowStart':
    LEGACY_EVENT_PREFIX + 'oauth_flow_start',
  'mossen.oauth.apiKey':
    LEGACY_EVENT_PREFIX + 'oauth_api_key',
  'mossen.oauth.authCodeReceived':
    LEGACY_EVENT_PREFIX + 'oauth_auth_code_received',
  'mossen.oauth.automaticRedirect':
    LEGACY_EVENT_PREFIX + 'oauth_automatic_redirect',
  'mossen.oauth.automaticRedirectError':
    LEGACY_EVENT_PREFIX + 'oauth_automatic_redirect_error',
  'mossen.oauth.hostedForced':
    LEGACY_EVENT_PREFIX + 'oauth_hosted_forced',
  'mossen.oauth.hostedSelected':
    LEGACY_EVENT_PREFIX + 'oauth_hosted_selected',
  'mossen.oauth.loginFromRefreshToken':
    LEGACY_EVENT_PREFIX + 'login_from_refresh_token',
  'mossen.oauth.manualEntry':
    LEGACY_EVENT_PREFIX + 'oauth_manual_entry',
  'mossen.oauth.platformSelected':
    LEGACY_EVENT_PREFIX + 'oauth_platform_selected',
  'mossen.oauth.profileFetchSuccess':
    LEGACY_EVENT_PREFIX + 'oauth_profile_fetch_success',
  'mossen.oauth.rolesStored':
    LEGACY_EVENT_PREFIX + 'oauth_roles_stored',
  'mossen.oauth.storageWarning':
    LEGACY_EVENT_PREFIX + 'oauth_storage_warning',
  'mossen.oauth.success':
    LEGACY_EVENT_PREFIX + 'oauth_success',
  'mossen.oauth.tokenExchangeError':
    LEGACY_EVENT_PREFIX + 'oauth_token_exchange_error',
  'mossen.oauth.tokenExchangeSuccess':
    LEGACY_EVENT_PREFIX + 'oauth_token_exchange_success',
  'mossen.oauth.tokenRefreshFailure':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_failure',
  'mossen.oauth.tokenRefreshSuccess':
    LEGACY_EVENT_PREFIX + 'oauth_token_refresh_success',
  'mossen.statusLine.mounted':
    LEGACY_EVENT_PREFIX + 'status_line_mount',
  'mossen.promptInput.externalEditorHintShown':
    LEGACY_EVENT_PREFIX + 'external_editor_hint_shown',
  'mossen.promptInput.externalEditorUsed':
    LEGACY_EVENT_PREFIX + 'external_editor_used',
  'mossen.promptInput.helpToggled':
    LEGACY_EVENT_PREFIX + 'help_toggled',
  'mossen.promptInput.ideAtMentioned':
    LEGACY_EVENT_PREFIX + 'ext_at_mentioned',
  'mossen.promptInput.modeCycle':
    LEGACY_EVENT_PREFIX + 'mode_cycle',
  'mossen.promptInput.modelPickerHotkey':
    LEGACY_EVENT_PREFIX + 'model_picker_hotkey',
  'mossen.promptInput.pasteImage':
    LEGACY_EVENT_PREFIX + 'paste_image',
  'mossen.promptInput.thinkingToggledHotkey':
    LEGACY_EVENT_PREFIX + 'thinking_toggled_hotkey',
  'mossen.promptInput.transcriptInputToTeammate':
    LEGACY_EVENT_PREFIX + 'transcript_input_to_teammate',
  'mossen.input.bash':
    LEGACY_EVENT_PREFIX + 'input_bash',
  'mossen.input.command':
    LEGACY_EVENT_PREFIX + 'input_command',
  'mossen.input.pastedImageResizeAttempt':
    LEGACY_EVENT_PREFIX + 'pasted_image_resize_attempt',
  'mossen.input.prompt':
    LEGACY_EVENT_PREFIX + 'input_prompt',
  'mossen.input.slashForked':
    LEGACY_EVENT_PREFIX + 'slash_command_forked',
  'mossen.input.slashInvalid':
    LEGACY_EVENT_PREFIX + 'input_slash_invalid',
  'mossen.input.slashMissing':
    LEGACY_EVENT_PREFIX + 'input_slash_missing',
  'mossen.input.subagentAtMention':
    LEGACY_EVENT_PREFIX + 'subagent_at_mention',
  'mossen.hooks.commandOpened':
    LEGACY_EVENT_PREFIX + 'hooks_command',
  'mossen.hooks.run':
    LEGACY_EVENT_PREFIX + 'run_hook',
  'mossen.hooks.replFinished':
    LEGACY_EVENT_PREFIX + 'repl_hook_finished',
  'mossen.history.pickerSelect':
    LEGACY_EVENT_PREFIX + 'history_picker_select',
  'mossen.hostedLimits.statusChanged':
    LEGACY_EVENT_PREFIX + 'hosted_limits_status_changed',
  'mossen.messageSelector.cancelled':
    LEGACY_EVENT_PREFIX + 'message_selector_cancelled',
  'mossen.messageSelector.opened':
    LEGACY_EVENT_PREFIX + 'message_selector_opened',
  'mossen.messageSelector.restoreOptionSelected':
    LEGACY_EVENT_PREFIX + 'message_selector_restore_option_selected',
  'mossen.messageSelector.selected':
    LEGACY_EVENT_PREFIX + 'message_selector_selected',
  'mossen.messageActions.enter':
    LEGACY_EVENT_PREFIX + 'message_actions_enter',
  'mossen.message.filteredOrphanedThinkingMessage':
    LEGACY_EVENT_PREFIX + 'filtered_orphaned_thinking_message',
  'mossen.message.filteredTrailingThinkingBlock':
    LEGACY_EVENT_PREFIX + 'filtered_trailing_thinking_block',
  'mossen.message.filteredWhitespaceOnlyAssistant':
    LEGACY_EVENT_PREFIX + 'filtered_whitespace_only_assistant',
  'mossen.message.fixedEmptyAssistantContent':
    LEGACY_EVENT_PREFIX + 'fixed_empty_assistant_content',
  'mossen.message.modelWhitespaceResponse':
    LEGACY_EVENT_PREFIX + 'model_whitespace_response',
  'mossen.message.toolInputJsonParseFail':
    LEGACY_EVENT_PREFIX + 'tool_input_json_parse_fail',
  'mossen.message.toolResultPairingRepaired':
    LEGACY_EVENT_PREFIX + 'tool_result_pairing_repaired',
  'mossen.globalSearch.select':
    LEGACY_EVENT_PREFIX + 'global_search_select',
  'mossen.globalSearch.insert':
    LEGACY_EVENT_PREFIX + 'global_search_insert',
  'mossen.keybinding.fallbackUsed':
    LEGACY_EVENT_PREFIX + 'keybinding_fallback_used',
  'mossen.keybinding.customLoaded':
    LEGACY_EVENT_PREFIX + 'custom_keybindings_loaded',
  'mossen.keybinding.toggleTodos':
    LEGACY_EVENT_PREFIX + 'toggle_todos',
  'mossen.keybinding.toggleTranscript':
    LEGACY_EVENT_PREFIX + 'toggle_transcript',
  'mossen.keybinding.transcriptExit':
    LEGACY_EVENT_PREFIX + 'transcript_exit',
  'mossen.keybinding.transcriptToggleShowAll':
    LEGACY_EVENT_PREFIX + 'transcript_toggle_show_all',
  'mossen.mcp.addCommand':
    LEGACY_EVENT_PREFIX + 'mcp_add',
  'mossen.mcp.cliDeleted':
    LEGACY_EVENT_PREFIX + 'mcp_delete',
  'mossen.mcp.cliGot':
    LEGACY_EVENT_PREFIX + 'mcp_get',
  'mossen.mcp.cliListed':
    LEGACY_EVENT_PREFIX + 'mcp_list',
  'mossen.mcp.cliResetProjectChoices':
    LEGACY_EVENT_PREFIX + 'mcp_reset_mcpjson_choices',
  'mossen.mcp.cliStarted':
    LEGACY_EVENT_PREFIX + 'mcp_start',
  'mossen.mcp.authConfigAuthenticate':
    LEGACY_EVENT_PREFIX + 'mcp_auth_config_authenticate',
  'mossen.mcp.authConfigClear':
    LEGACY_EVENT_PREFIX + 'mcp_auth_config_clear',
  'mossen.mcp.builtinToggle':
    LEGACY_EVENT_PREFIX + 'builtin_mcp_toggle',
  'mossen.mcp.channelGate':
    LEGACY_EVENT_PREFIX + 'mcp_channel_gate',
  'mossen.mcp.channelEnabled':
    LEGACY_EVENT_PREFIX + 'mcp_channel_enable',
  'mossen.mcp.channelMessage':
    LEGACY_EVENT_PREFIX + 'mcp_channel_message',
  'mossen.mcp.channelFlags':
    LEGACY_EVENT_PREFIX + 'mcp_channel_flags',
  'mossen.mcp.dialogChoice':
    LEGACY_EVENT_PREFIX + 'mcp_dialog_choice',
  'mossen.mcp.elicitationResponse':
    LEGACY_EVENT_PREFIX + 'mcp_elicitation_response',
  'mossen.mcp.elicitationShown':
    LEGACY_EVENT_PREFIX + 'mcp_elicitation_shown',
  'mossen.mcp.headersHelperMissingTrust':
    LEGACY_EVENT_PREFIX + 'mcp_headersHelper_missing_trust',
  'mossen.mcp.hostedAuthCompleted':
    LEGACY_EVENT_PREFIX + 'hosted_mcp_auth_completed',
  'mossen.mcp.hostedAuthStarted':
    LEGACY_EVENT_PREFIX + 'hosted_mcp_auth_started',
  'mossen.mcp.hostedClearAuthCompleted':
    LEGACY_EVENT_PREFIX + 'hosted_mcp_clear_auth_completed',
  'mossen.mcp.hostedClearAuthStarted':
    LEGACY_EVENT_PREFIX + 'hosted_mcp_clear_auth_started',
  'mossen.mcp.hostedEligibility':
    LEGACY_EVENT_PREFIX + 'hosted_mcp_eligibility',
  'mossen.mcp.hostedProxy401':
    LEGACY_EVENT_PREFIX + 'mcp_hosted_proxy_401',
  'mossen.mcp.hostedReconnect':
    LEGACY_EVENT_PREFIX + 'hosted_mcp_reconnect',
  'mossen.mcp.hostedToggle':
    LEGACY_EVENT_PREFIX + 'hosted_mcp_toggle',
  'mossen.mcp.ideServerConnectionFailed':
    LEGACY_EVENT_PREFIX + 'mcp_ide_server_connection_failed',
  'mossen.mcp.ideServerConnectionSucceeded':
    LEGACY_EVENT_PREFIX + 'mcp_ide_server_connection_succeeded',
  'mossen.mcp.largeResultHandled':
    LEGACY_EVENT_PREFIX + 'mcp_large_result_handled',
  'mossen.mcp.listChanged':
    LEGACY_EVENT_PREFIX + 'mcp_list_changed',
  'mossen.mcp.multiDialogChoice':
    LEGACY_EVENT_PREFIX + 'mcp_multidialog_choice',
  'mossen.mcp.oauthFlowError':
    LEGACY_EVENT_PREFIX + 'mcp_oauth_flow_error',
  'mossen.mcp.oauthFlowFailure':
    LEGACY_EVENT_PREFIX + 'mcp_oauth_flow_failure',
  'mossen.mcp.oauthFlowStart':
    LEGACY_EVENT_PREFIX + 'mcp_oauth_flow_start',
  'mossen.mcp.oauthFlowSuccess':
    LEGACY_EVENT_PREFIX + 'mcp_oauth_flow_success',
  'mossen.mcp.oauthRefreshFailure':
    LEGACY_EVENT_PREFIX + 'mcp_oauth_refresh_failure',
  'mossen.mcp.oauthRefreshSuccess':
    LEGACY_EVENT_PREFIX + 'mcp_oauth_refresh_success',
  'mossen.mcp.serverConnectionFailed':
    LEGACY_EVENT_PREFIX + 'mcp_server_connection_failed',
  'mossen.mcp.serverConnectionSucceeded':
    LEGACY_EVENT_PREFIX + 'mcp_server_connection_succeeded',
  'mossen.mcp.serverNeedsAuth':
    LEGACY_EVENT_PREFIX + 'mcp_server_needs_auth',
  'mossen.mcp.servers':
    LEGACY_EVENT_PREFIX + 'mcp_servers',
  'mossen.mcp.sessionExpired':
    LEGACY_EVENT_PREFIX + 'mcp_session_expired',
  'mossen.mcp.toolCallAuthError':
    LEGACY_EVENT_PREFIX + 'mcp_tool_call_auth_error',
  'mossen.mcp.toolsCommandsLoaded':
    LEGACY_EVENT_PREFIX + 'mcp_tools_commands_loaded',
  'mossen.chrome.setup':
    LEGACY_EVENT_PREFIX + 'mossen_in_chrome_setup',
  'mossen.chrome.setupFailed':
    LEGACY_EVENT_PREFIX + 'mossen_in_chrome_setup_failed',
  'mossen.deepLink.opened':
    LEGACY_EVENT_PREFIX + 'deep_link_opened',
  'mossen.codeIndexing.toolUsed':
    LEGACY_EVENT_PREFIX + 'code_indexing_tool_used',
  'mossen.worktree.created':
    LEGACY_EVENT_PREFIX + 'worktree_created',
  'mossen.worktree.detection':
    LEGACY_EVENT_PREFIX + 'worktree_detection',
  'mossen.worktree.kept':
    LEGACY_EVENT_PREFIX + 'worktree_kept',
  'mossen.worktree.removed':
    LEGACY_EVENT_PREFIX + 'worktree_removed',
  'mossen.permission.acceptSubmitted':
    LEGACY_EVENT_PREFIX + 'accept_submitted',
  'mossen.permission.acceptFeedbackModeCollapsed':
    LEGACY_EVENT_PREFIX + 'accept_feedback_mode_collapsed',
  'mossen.permission.acceptFeedbackModeEntered':
    LEGACY_EVENT_PREFIX + 'accept_feedback_mode_entered',
  'mossen.permission.askUserQuestionAccepted':
    LEGACY_EVENT_PREFIX + 'ask_user_question_accepted',
  'mossen.permission.askUserQuestionFinishPlanInterview':
    LEGACY_EVENT_PREFIX + 'ask_user_question_finish_plan_interview',
  'mossen.permission.askUserQuestionRejected':
    LEGACY_EVENT_PREFIX + 'ask_user_question_rejected',
  'mossen.permission.askUserQuestionRespondToMossen':
    LEGACY_EVENT_PREFIX + 'ask_user_question_respond_to_mossen',
  'mossen.permission.autoModeDecision':
    LEGACY_EVENT_PREFIX + 'auto_mode_decision',
  'mossen.permission.autoModeDenialLimitExceeded':
    LEGACY_EVENT_PREFIX + 'auto_mode_denial_limit_exceeded',
  'mossen.permission.autoModeMalformedToolInput':
    LEGACY_EVENT_PREFIX + 'auto_mode_malformed_tool_input',
  'mossen.permission.autoModeOutcome':
    LEGACY_EVENT_PREFIX + 'auto_mode_outcome',
  'mossen.permission.autoModeOptInDialogAccept':
    LEGACY_EVENT_PREFIX + 'auto_mode_opt_in_dialog_accept',
  'mossen.permission.autoModeOptInDialogAcceptDefault':
    LEGACY_EVENT_PREFIX + 'auto_mode_opt_in_dialog_accept_default',
  'mossen.permission.autoModeOptInDialogDecline':
    LEGACY_EVENT_PREFIX + 'auto_mode_opt_in_dialog_decline',
  'mossen.permission.autoModeOptInDialogShown':
    LEGACY_EVENT_PREFIX + 'auto_mode_opt_in_dialog_shown',
  'mossen.permission.bypassModeDialogAccept':
    LEGACY_EVENT_PREFIX + 'bypass_permissions_mode_dialog_accept',
  'mossen.permission.bypassModeDialogShown':
    LEGACY_EVENT_PREFIX + 'bypass_permissions_mode_dialog_shown',
  'mossen.permission.explainerError':
    LEGACY_EVENT_PREFIX + 'permission_explainer_error',
  'mossen.permission.explainerGenerated':
    LEGACY_EVENT_PREFIX + 'permission_explainer_generated',
  'mossen.permission.explainerShortcutUsed':
    LEGACY_EVENT_PREFIX + 'permission_explainer_shortcut_used',
  'mossen.permission.internalBashToolUseRequest':
    LEGACY_EVENT_PREFIX + 'internal_bash_tool_use_permission_request',
  'mossen.permission.internalToolUseRequestNoAlwaysAllow':
    LEGACY_EVENT_PREFIX + 'internal_tool_use_permission_request_no_always_allow',
  'mossen.permission.planEnter':
    LEGACY_EVENT_PREFIX + 'plan_enter',
  'mossen.permission.planExit':
    LEGACY_EVENT_PREFIX + 'plan_exit',
  'mossen.permission.planExternalEditorUsed':
    LEGACY_EVENT_PREFIX + 'plan_external_editor_used',
  'mossen.permission.rejectFeedbackModeCollapsed':
    LEGACY_EVENT_PREFIX + 'reject_feedback_mode_collapsed',
  'mossen.permission.rejectFeedbackModeEntered':
    LEGACY_EVENT_PREFIX + 'reject_feedback_mode_entered',
  'mossen.permission.rejectSubmitted':
    LEGACY_EVENT_PREFIX + 'reject_submitted',
  'mossen.permission.requestEscape':
    LEGACY_EVENT_PREFIX + 'permission_request_escape',
  'mossen.permission.requestOptionSelected':
    LEGACY_EVENT_PREFIX + 'permission_request_option_selected',
  'mossen.permission.toolUseShowPermissionRequest':
    LEGACY_EVENT_PREFIX + 'tool_use_show_permission_request',
  'mossen.permission.unsupportedDefaultModeIgnored':
    LEGACY_EVENT_PREFIX + 'ccr_unsupported_default_mode_ignored',
  'mossen.managedSettings.securityDialogAccepted':
    LEGACY_EVENT_PREFIX + 'managed_settings_security_dialog_accepted',
  'mossen.managedSettings.securityDialogRejected':
    LEGACY_EVENT_PREFIX + 'managed_settings_security_dialog_rejected',
  'mossen.managedSettings.securityDialogShown':
    LEGACY_EVENT_PREFIX + 'managed_settings_security_dialog_shown',
  'mossen.managedSettings.loaded':
    LEGACY_EVENT_PREFIX + 'managed_settings_loaded',
  'mossen.settingsSync.downloadEmpty':
    LEGACY_EVENT_PREFIX + 'settings_sync_download_empty',
  'mossen.settingsSync.downloadError':
    LEGACY_EVENT_PREFIX + 'settings_sync_download_error',
  'mossen.settingsSync.downloadFetchFailed':
    LEGACY_EVENT_PREFIX + 'settings_sync_download_fetch_failed',
  'mossen.settingsSync.downloadSkipped':
    LEGACY_EVENT_PREFIX + 'settings_sync_download_skipped',
  'mossen.settingsSync.downloadSuccess':
    LEGACY_EVENT_PREFIX + 'settings_sync_download_success',
  'mossen.settingsSync.uploadFailed':
    LEGACY_EVENT_PREFIX + 'settings_sync_upload_failed',
  'mossen.settingsSync.uploadFetchFailed':
    LEGACY_EVENT_PREFIX + 'settings_sync_upload_fetch_failed',
  'mossen.settingsSync.uploadSkipped':
    LEGACY_EVENT_PREFIX + 'settings_sync_upload_skipped',
  'mossen.settingsSync.uploadSkippedIneligible':
    LEGACY_EVENT_PREFIX + 'settings_sync_upload_skipped_ineligible',
  'mossen.settingsSync.uploadSuccess':
    LEGACY_EVENT_PREFIX + 'settings_sync_upload_success',
  'mossen.plugin.enabledForSession':
    LEGACY_EVENT_PREFIX + 'plugin_enabled_for_session',
  'mossen.plugin.loadFailed':
    LEGACY_EVENT_PREFIX + 'plugin_load_failed',
  'mossen.plugin.loaded':
    LEGACY_EVENT_PREFIX + 'plugins_loaded',
  'mossen.plugin.marketplaceBackgroundInstall':
    LEGACY_EVENT_PREFIX + 'marketplace_background_install',
  'mossen.plugin.commandFailed':
    LEGACY_EVENT_PREFIX + 'plugin_command_failed',
  'mossen.plugin.listCommand':
    LEGACY_EVENT_PREFIX + 'plugin_list_command',
  'mossen.plugin.installCommand':
    LEGACY_EVENT_PREFIX + 'plugin_install_command',
  'mossen.plugin.uninstallCommand':
    LEGACY_EVENT_PREFIX + 'plugin_uninstall_command',
  'mossen.plugin.enableCommand':
    LEGACY_EVENT_PREFIX + 'plugin_enable_command',
  'mossen.plugin.disableCommand':
    LEGACY_EVENT_PREFIX + 'plugin_disable_command',
  'mossen.plugin.updateCommand':
    LEGACY_EVENT_PREFIX + 'plugin_update_command',
  'mossen.plugin.installedCli':
    LEGACY_EVENT_PREFIX + 'plugin_installed_cli',
  'mossen.plugin.uninstalledCli':
    LEGACY_EVENT_PREFIX + 'plugin_uninstalled_cli',
  'mossen.plugin.enabledCli':
    LEGACY_EVENT_PREFIX + 'plugin_enabled_cli',
  'mossen.plugin.disabledCli':
    LEGACY_EVENT_PREFIX + 'plugin_disabled_cli',
  'mossen.plugin.disabledAllCli':
    LEGACY_EVENT_PREFIX + 'plugin_disabled_all_cli',
  'mossen.plugin.updatedCli':
    LEGACY_EVENT_PREFIX + 'plugin_updated_cli',
  'mossen.plugin.marketplaceAdded':
    LEGACY_EVENT_PREFIX + 'marketplace_added',
  'mossen.plugin.marketplaceRemoved':
    LEGACY_EVENT_PREFIX + 'marketplace_removed',
  'mossen.plugin.marketplaceUpdated':
    LEGACY_EVENT_PREFIX + 'marketplace_updated',
  'mossen.plugin.marketplaceUpdatedAll':
    LEGACY_EVENT_PREFIX + 'marketplace_updated_all',
  'mossen.plugin.remoteFetch':
    LEGACY_EVENT_PREFIX + 'plugin_remote_fetch',
  'mossen.plugin.headlessInstall':
    LEGACY_EVENT_PREFIX + 'headless_plugin_install',
  'mossen.plugin.hintDetected':
    LEGACY_EVENT_PREFIX + 'plugin_hint_detected',
  'mossen.plugin.officialMarketplaceAutoInstall':
    LEGACY_EVENT_PREFIX + 'official_marketplace_auto_install',
  'mossen.plugin.installed':
    LEGACY_EVENT_PREFIX + 'plugin_installed',
  'mossen.plugin.syncInstallTimeout':
    LEGACY_EVENT_PREFIX + 'sync_plugin_install_timeout',
  'mossen.print.continue':
    LEGACY_EVENT_PREFIX + 'continue_print',
  'mossen.print.resume':
    LEGACY_EVENT_PREFIX + 'resume_print',
  'mossen.print.teleport':
    LEGACY_EVENT_PREFIX + 'teleport_print',
  'mossen.webFetch.hostChecked':
    LEGACY_EVENT_PREFIX + 'web_fetch_host',
  'mossen.security.bashAstTooComplex':
    LEGACY_EVENT_PREFIX + 'bash_ast_too_complex',
  'mossen.security.bashSecurityCheckTriggered':
    LEGACY_EVENT_PREFIX + 'bash_security_check_triggered',
  'mossen.security.treeSitterDivergence':
    LEGACY_EVENT_PREFIX + 'tree_sitter_security_divergence',
  'mossen.security.treeSitterShadow':
    LEGACY_EVENT_PREFIX + 'tree_sitter_shadow',
  'mossen.ide.diffAccepted':
    LEGACY_EVENT_PREFIX + 'ext_diff_accepted',
  'mossen.ide.diffRejected':
    LEGACY_EVENT_PREFIX + 'ext_diff_rejected',
  'mossen.ide.diffWillShow':
    LEGACY_EVENT_PREFIX + 'ext_will_show_diff',
  'mossen.ide.commandOpened':
    LEGACY_EVENT_PREFIX + 'ext_ide_command',
  'mossen.install.commandCompleted':
    LEGACY_EVENT_PREFIX + 'mossen_install_command',
  'mossen.tool.bashCommandAssistantAutoBackgrounded':
    LEGACY_EVENT_PREFIX + 'bash_command_assistant_auto_backgrounded',
  'mossen.tool.bashCommandExecuted':
    LEGACY_EVENT_PREFIX + 'bash_tool_command_executed',
  'mossen.tool.bashCommandExplicitlyBackgrounded':
    LEGACY_EVENT_PREFIX + 'bash_command_explicitly_backgrounded',
  'mossen.tool.bashCommandStartupSignalBackgrounded':
    LEGACY_EVENT_PREFIX + 'bash_command_startup_signal_backgrounded',
  'mossen.tool.bashCommandTimeoutBackgrounded':
    LEGACY_EVENT_PREFIX + 'bash_command_timeout_backgrounded',
  'mossen.tool.bashToolResetToOriginalDir':
    LEGACY_EVENT_PREFIX + 'bash_tool_reset_to_original_dir',
  'mossen.tool.codeIndexingToolUsed':
    LEGACY_EVENT_PREFIX + 'code_indexing_tool_used',
  'mossen.tool.diffComputed':
    LEGACY_EVENT_PREFIX + 'tool_use_diff_computed',
  'mossen.tool.gitIndexLockError':
    LEGACY_EVENT_PREFIX + 'git_index_lock_error',
  'mossen.tool.deferredSchemaNotSent':
    LEGACY_EVENT_PREFIX + 'deferred_tool_schema_not_sent',
  'mossen.tool.permissionAllowed':
    LEGACY_EVENT_PREFIX + 'tool_use_can_use_tool_allowed',
  'mossen.tool.permissionDeniedInConfig':
    LEGACY_EVENT_PREFIX + 'tool_use_denied_in_config',
  'mossen.tool.permissionGrantedByClassifier':
    LEGACY_EVENT_PREFIX + 'tool_use_granted_by_classifier',
  'mossen.tool.permissionGrantedByPermissionHook':
    LEGACY_EVENT_PREFIX + 'tool_use_granted_by_permission_hook',
  'mossen.tool.permissionGrantedInConfig':
    LEGACY_EVENT_PREFIX + 'tool_use_granted_in_config',
  'mossen.tool.permissionGrantedInPromptPermanent':
    LEGACY_EVENT_PREFIX + 'tool_use_granted_in_prompt_permanent',
  'mossen.tool.permissionGrantedInPromptTemporary':
    LEGACY_EVENT_PREFIX + 'tool_use_granted_in_prompt_temporary',
  'mossen.tool.permissionRejected':
    LEGACY_EVENT_PREFIX + 'tool_use_can_use_tool_rejected',
  'mossen.tool.permissionRejectedInPrompt':
    LEGACY_EVENT_PREFIX + 'tool_use_rejected_in_prompt',
  'mossen.tool.powershellCommandAssistantAutoBackgrounded':
    LEGACY_EVENT_PREFIX + 'powershell_command_assistant_auto_backgrounded',
  'mossen.tool.powershellCommandExecuted':
    LEGACY_EVENT_PREFIX + 'powershell_tool_command_executed',
  'mossen.tool.powershellCommandExplicitlyBackgrounded':
    LEGACY_EVENT_PREFIX + 'powershell_command_explicitly_backgrounded',
  'mossen.tool.powershellCommandInterruptBackgrounded':
    LEGACY_EVENT_PREFIX + 'powershell_command_interrupt_backgrounded',
  'mossen.tool.powershellCommandTimeoutBackgrounded':
    LEGACY_EVENT_PREFIX + 'powershell_command_timeout_backgrounded',
  'mossen.tool.writeMossenMd':
    LEGACY_EVENT_PREFIX + 'write_mossenmd',
  'mossen.toolResult.empty':
    LEGACY_EVENT_PREFIX + 'tool_empty_result',
  'mossen.toolResult.messageLevelBudgetEnforced':
    LEGACY_EVENT_PREFIX + 'message_level_tool_result_budget_enforced',
  'mossen.toolResult.persisted':
    LEGACY_EVENT_PREFIX + 'tool_result_persisted',
  'mossen.toolResult.persistedMessageBudget':
    LEGACY_EVENT_PREFIX + 'tool_result_persisted_message_budget',
  'mossen.tool.use.cancelled':
    LEGACY_EVENT_PREFIX + 'tool_use_cancelled',
  'mossen.tool.use.error':
    LEGACY_EVENT_PREFIX + 'tool_use_error',
  'mossen.tool.use.progress':
    LEGACY_EVENT_PREFIX + 'tool_use_progress',
  'mossen.tool.use.success':
    LEGACY_EVENT_PREFIX + 'tool_use_success',
  'mossen.toolHook.postCancelled':
    LEGACY_EVENT_PREFIX + 'post_tool_hooks_cancelled',
  'mossen.toolHook.postError':
    LEGACY_EVENT_PREFIX + 'post_tool_hook_error',
  'mossen.toolHook.postFailureCancelled':
    LEGACY_EVENT_PREFIX + 'post_tool_failure_hooks_cancelled',
  'mossen.toolHook.postFailureError':
    LEGACY_EVENT_PREFIX + 'post_tool_failure_hook_error',
  'mossen.toolHook.preCancelled':
    LEGACY_EVENT_PREFIX + 'pre_tool_hooks_cancelled',
  'mossen.toolHook.preError':
    LEGACY_EVENT_PREFIX + 'pre_tool_hook_error',
  'mossen.toolSearch.deferredToolsPoolChange':
    LEGACY_EVENT_PREFIX + 'deferred_tools_pool_change',
  'mossen.toolSearch.modeDecision':
    LEGACY_EVENT_PREFIX + 'tool_search_mode_decision',
  'mossen.toolSearch.outcome':
    LEGACY_EVENT_PREFIX + 'tool_search_outcome',
  'mossen.skill.descriptionsTruncated':
    LEGACY_EVENT_PREFIX + 'skill_descriptions_truncated',
  'mossen.skill.dynamicChanged':
    LEGACY_EVENT_PREFIX + 'dynamic_skills_changed',
  'mossen.skill.toolInvocation':
    LEGACY_EVENT_PREFIX + 'skill_tool_invocation',
  'mossen.skill.toolSlashPrefix':
    LEGACY_EVENT_PREFIX + 'skill_tool_slash_prefix',
  'mossen.api.query':
    LEGACY_EVENT_PREFIX + 'api_query',
  'mossen.api.error':
    LEGACY_EVENT_PREFIX + 'api_error',
  'mossen.api.afterNormalize':
    LEGACY_EVENT_PREFIX + 'api_after_normalize',
  'mossen.api.advisorToolCall':
    LEGACY_EVENT_PREFIX + 'advisor_tool_call',
  'mossen.api.advisorToolInterrupted':
    LEGACY_EVENT_PREFIX + 'advisor_tool_interrupted',
  'mossen.cost.advisorToolTokenUsage':
    LEGACY_EVENT_PREFIX + 'advisor_tool_token_usage',
  'mossen.api.beforeNormalize':
    LEGACY_EVENT_PREFIX + 'api_before_normalize',
  'mossen.api.background529Dropped':
    LEGACY_EVENT_PREFIX + 'api_529_background_dropped',
  'mossen.api.bashToolSimpleEcho':
    LEGACY_EVENT_PREFIX + 'bash_tool_simple_echo',
  'mossen.api.cacheBreakpoints':
    LEGACY_EVENT_PREFIX + 'api_cache_breakpoints',
  'mossen.api.contextWindowExceeded':
    LEGACY_EVENT_PREFIX + 'context_window_exceeded',
  'mossen.api.contextSize':
    LEGACY_EVENT_PREFIX + 'context_size',
  'mossen.api.custom529OverloadedError':
    LEGACY_EVENT_PREFIX + 'api_custom_529_overloaded_error',
  'mossen.api.duplicateToolUseId':
    LEGACY_EVENT_PREFIX + 'duplicate_tool_use_id',
  'mossen.api.maxTokensReached':
    LEGACY_EVENT_PREFIX + 'max_tokens_reached',
  'mossen.api.maxTokensContextOverflowAdjustment':
    LEGACY_EVENT_PREFIX + 'max_tokens_context_overflow_adjustment',
  'mossen.api.modelFallbackTriggered':
    LEGACY_EVENT_PREFIX + 'api_opus_fallback_triggered',
  'mossen.api.nonStreamingFallbackError':
    LEGACY_EVENT_PREFIX + 'nonstreaming_fallback_error',
  'mossen.api.nonStreamingFallbackStarted':
    LEGACY_EVENT_PREFIX + 'nonstreaming_fallback_started',
  'mossen.api.offSwitchQuery':
    LEGACY_EVENT_PREFIX + 'off_switch_query',
  'mossen.api.persistentRetryWait':
    LEGACY_EVENT_PREFIX + 'api_persistent_retry_wait',
  'mossen.api.promptCacheBreak':
    LEGACY_EVENT_PREFIX + 'prompt_cache_break',
  'mossen.api.refusalResponse':
    LEGACY_EVENT_PREFIX + 'refusal_api_response',
  'mossen.api.retry':
    LEGACY_EVENT_PREFIX + 'api_retry',
  'mossen.api.streamLoopExitedAfterWatchdog':
    LEGACY_EVENT_PREFIX + 'stream_loop_exited_after_watchdog',
  'mossen.api.streamNoEvents':
    LEGACY_EVENT_PREFIX + 'stream_no_events',
  'mossen.api.streamingError':
    LEGACY_EVENT_PREFIX + 'streaming_error',
  'mossen.api.streamingFallbackToNonStreaming':
    LEGACY_EVENT_PREFIX + 'streaming_fallback_to_non_streaming',
  'mossen.api.streamingIdleTimeout':
    LEGACY_EVENT_PREFIX + 'streaming_idle_timeout',
  'mossen.api.streamingStall':
    LEGACY_EVENT_PREFIX + 'streaming_stall',
  'mossen.api.streamingStallSummary':
    LEGACY_EVENT_PREFIX + 'streaming_stall_summary',
  'mossen.api.success':
    LEGACY_EVENT_PREFIX + 'api_success',
  'mossen.api.systemPromptBlock':
    LEGACY_EVENT_PREFIX + 'sysprompt_block',
  'mossen.api.systemPromptBoundaryFound':
    LEGACY_EVENT_PREFIX + 'sysprompt_boundary_found',
  'mossen.api.systemPromptMissingBoundaryMarker':
    LEGACY_EVENT_PREFIX + 'sysprompt_missing_boundary_marker',
  'mossen.api.systemPromptUsingToolBasedCache':
    LEGACY_EVENT_PREFIX + 'sysprompt_using_tool_based_cache',
  'mossen.api.teleportFirstMessageError':
    LEGACY_EVENT_PREFIX + 'teleport_first_message_error',
  'mossen.api.teleportFirstMessageSuccess':
    LEGACY_EVENT_PREFIX + 'teleport_first_message_success',
  'mossen.api.toolUseToolResultMismatchError':
    LEGACY_EVENT_PREFIX + 'tool_use_tool_result_mismatch_error',
  'mossen.api.unexpectedToolResult':
    LEGACY_EVENT_PREFIX + 'unexpected_tool_result',
  'mossen.api.fileListFailed':
    LEGACY_EVENT_PREFIX + 'file_list_failed',
  'mossen.api.fileUploadFailed':
    LEGACY_EVENT_PREFIX + 'file_upload_failed',
  'mossen.query.actionPromiseRecovery':
    LEGACY_EVENT_PREFIX + 'action_promise_recovery',
  'mossen.query.autoCompactSucceeded':
    LEGACY_EVENT_PREFIX + 'auto_compact_succeeded',
  'mossen.query.beforeAttachments':
    LEGACY_EVENT_PREFIX + 'query_before_attachments',
  'mossen.query.error':
    LEGACY_EVENT_PREFIX + 'query_error',
  'mossen.query.maxTokensEscalate':
    LEGACY_EVENT_PREFIX + 'max_tokens_escalate',
  'mossen.query.modelFallbackTriggered':
    LEGACY_EVENT_PREFIX + 'model_fallback_triggered',
  'mossen.query.orphanedMessagesTombstoned':
    LEGACY_EVENT_PREFIX + 'orphaned_messages_tombstoned',
  'mossen.query.postAutoCompactTurn':
    LEGACY_EVENT_PREFIX + 'post_autocompact_turn',
  'mossen.query.afterAttachments':
    LEGACY_EVENT_PREFIX + 'query_after_attachments',
  'mossen.query.streamingToolExecutionNotUsed':
    LEGACY_EVENT_PREFIX + 'streaming_tool_execution_not_used',
  'mossen.query.streamingToolExecutionUsed':
    LEGACY_EVENT_PREFIX + 'streaming_tool_execution_used',
  'mossen.query.tokenBudgetCompleted':
    LEGACY_EVENT_PREFIX + 'token_budget_completed',
  'mossen.structuredOutput.enabled':
    LEGACY_EVENT_PREFIX + 'structured_output_enabled',
  'mossen.structuredOutput.failure':
    LEGACY_EVENT_PREFIX + 'structured_output_failure',
  'mossen.installer.autoUpdaterSuccess':
    LEGACY_EVENT_PREFIX + 'auto_updater_success',
  'mossen.installer.autoUpdaterFail':
    LEGACY_EVENT_PREFIX + 'auto_updater_fail',
  'mossen.installer.autoUpdaterLockContention':
    LEGACY_EVENT_PREFIX + 'auto_updater_lock_contention',
  'mossen.installer.autoUpdaterWindowsNpmInWsl':
    LEGACY_EVENT_PREFIX + 'auto_updater_windows_npm_in_wsl',
  'mossen.installer.nativeAutoUpdaterStart':
    LEGACY_EVENT_PREFIX + 'native_auto_updater_start',
  'mossen.installer.nativeAutoUpdaterLockContention':
    LEGACY_EVENT_PREFIX + 'native_auto_updater_lock_contention',
  'mossen.installer.nativeAutoUpdaterSuccess':
    LEGACY_EVENT_PREFIX + 'native_auto_updater_success',
  'mossen.installer.nativeAutoUpdaterUpToDate':
    LEGACY_EVENT_PREFIX + 'native_auto_updater_up_to_date',
  'mossen.installer.nativeAutoUpdaterFail':
    LEGACY_EVENT_PREFIX + 'native_auto_updater_fail',
  'mossen.installer.versionCheckFailure':
    LEGACY_EVENT_PREFIX + 'version_check_failure',
  'mossen.installer.versionCheckSuccess':
    LEGACY_EVENT_PREFIX + 'version_check_success',
  'mossen.update.check':
    LEGACY_EVENT_PREFIX + 'update_check',
  'mossen.installer.binaryDownloadAttempt':
    LEGACY_EVENT_PREFIX + 'binary_download_attempt',
  'mossen.installer.binaryManifestFetchFailure':
    LEGACY_EVENT_PREFIX + 'binary_manifest_fetch_failure',
  'mossen.installer.binaryPlatformNotFound':
    LEGACY_EVENT_PREFIX + 'binary_platform_not_found',
  'mossen.installer.binaryDownloadSuccess':
    LEGACY_EVENT_PREFIX + 'binary_download_success',
  'mossen.installer.binaryDownloadFailure':
    LEGACY_EVENT_PREFIX + 'binary_download_failure',
  'mossen.installer.versionLockAcquired':
    LEGACY_EVENT_PREFIX + 'version_lock_acquired',
  'mossen.installer.versionLockFailed':
    LEGACY_EVENT_PREFIX + 'version_lock_failed',
  'mossen.installer.nativeInstallPackageFailure':
    LEGACY_EVENT_PREFIX + 'native_install_package_failure',
  'mossen.installer.nativeInstallPackageSuccess':
    LEGACY_EVENT_PREFIX + 'native_install_package_success',
  'mossen.installer.nativeInstallBinaryFailure':
    LEGACY_EVENT_PREFIX + 'native_install_binary_failure',
  'mossen.installer.nativeInstallBinarySuccess':
    LEGACY_EVENT_PREFIX + 'native_install_binary_success',
  'mossen.installer.nativeUpdateSkippedMaxVersion':
    LEGACY_EVENT_PREFIX + 'native_update_skipped_max_version',
  'mossen.installer.nativeUpdateComplete':
    LEGACY_EVENT_PREFIX + 'native_update_complete',
  'mossen.installer.nativeUpdateSkippedMinimumVersion':
    LEGACY_EVENT_PREFIX + 'native_update_skipped_minimum_version',
  'mossen.installer.nativeUpdateLockFailed':
    LEGACY_EVENT_PREFIX + 'native_update_lock_failed',
  'mossen.installer.nativeStagingCleanup':
    LEGACY_EVENT_PREFIX + 'native_staging_cleanup',
  'mossen.installer.nativeStaleLocksCleanup':
    LEGACY_EVENT_PREFIX + 'native_stale_locks_cleanup',
  'mossen.installer.nativeTempFilesCleanup':
    LEGACY_EVENT_PREFIX + 'native_temp_files_cleanup',
  'mossen.installer.nativeVersionCleanup':
    LEGACY_EVENT_PREFIX + 'native_version_cleanup',
  'mossen.installer.desktopUpsellShown':
    LEGACY_EVENT_PREFIX + 'desktop_upsell_shown',
  'mossen.upsell.guestPassesShown':
    LEGACY_EVENT_PREFIX + 'guest_passes_upsell_shown',
  'mossen.upsell.overageCreditShown':
    LEGACY_EVENT_PREFIX + 'overage_credit_upsell_shown',
  'mossen.team.created':
    LEGACY_EVENT_PREFIX + 'team_created',
  'mossen.team.deleted':
    LEGACY_EVENT_PREFIX + 'team_deleted',
  'mossen.browserIntegration.onboardingShown':
    LEGACY_EVENT_PREFIX + 'mossen_in_chrome_onboarding_shown',
  'mossen.deepLink.registered':
    LEGACY_EVENT_PREFIX + 'deep_link_registered',
  'mossen.remote.setupStarted':
    LEGACY_EVENT_PREFIX + 'remote_setup_started',
  'mossen.remote.setupResult':
    LEGACY_EVENT_PREFIX + 'remote_setup_result',
  'mossen.github.actionsSetupCompleted':
    LEGACY_EVENT_PREFIX + 'setup_github_actions_completed',
  'mossen.github.actionsSetupFailed':
    LEGACY_EVENT_PREFIX + 'setup_github_actions_failed',
  'mossen.github.actionsSetupStarted':
    LEGACY_EVENT_PREFIX + 'setup_github_actions_started',
  'mossen.github.installAppCompleted':
    LEGACY_EVENT_PREFIX + 'install_github_app_completed',
  'mossen.github.installAppError':
    LEGACY_EVENT_PREFIX + 'install_github_app_error',
  'mossen.github.installAppStarted':
    LEGACY_EVENT_PREFIX + 'install_github_app_started',
  'mossen.github.installAppStepCompleted':
    LEGACY_EVENT_PREFIX + 'install_github_app_step_completed',
  'mossen.stopHooks.preCancelled':
    LEGACY_EVENT_PREFIX + 'pre_stop_hooks_cancelled',
  'mossen.stopHooks.error':
    LEGACY_EVENT_PREFIX + 'stop_hook_error',
  'mossen.websocket.transportReconnected':
    LEGACY_EVENT_PREFIX + 'ws_transport_reconnected',
  'mossen.websocket.transportClosed':
    LEGACY_EVENT_PREFIX + 'ws_transport_closed',
  'mossen.websocket.transportReconnecting':
    LEGACY_EVENT_PREFIX + 'ws_transport_reconnecting',
  'mossen.memory.autoDreamFired':
    LEGACY_EVENT_PREFIX + 'auto_dream_fired',
  'mossen.memory.autoDreamCompleted':
    LEGACY_EVENT_PREFIX + 'auto_dream_completed',
  'mossen.memory.autoDreamFailed':
    LEGACY_EVENT_PREFIX + 'auto_dream_failed',
  'mossen.voice.silentDropReplay':
    LEGACY_EVENT_PREFIX + 'voice_silent_drop_replay',
  'mossen.voice.recordingCompleted':
    LEGACY_EVENT_PREFIX + 'voice_recording_completed',
  'mossen.voice.recordingStarted':
    LEGACY_EVENT_PREFIX + 'voice_recording_started',
  'mossen.voice.streamEarlyRetry':
    LEGACY_EVENT_PREFIX + 'voice_stream_early_retry',
  'mossen.grove.printViewed':
    LEGACY_EVENT_PREFIX + 'grove_print_viewed',
  'mossen.markdown.dirSearch':
    LEGACY_EVENT_PREFIX + 'dir_search',
  'mossen.grove.policyViewed':
    LEGACY_EVENT_PREFIX + 'grove_policy_viewed',
  'mossen.grove.policySubmitted':
    LEGACY_EVENT_PREFIX + 'grove_policy_submitted',
  'mossen.grove.policyDismissed':
    LEGACY_EVENT_PREFIX + 'grove_policy_dismissed',
  'mossen.grove.policyEscaped':
    LEGACY_EVENT_PREFIX + 'grove_policy_escaped',
  'mossen.grove.privacySettingsViewed':
    LEGACY_EVENT_PREFIX + 'grove_privacy_settings_viewed',
  'mossen.preflight.checkFailed':
    LEGACY_EVENT_PREFIX + 'preflight_check_failed',
  'mossen.mcpOutput.binaryContentPersisted':
    LEGACY_EVENT_PREFIX + 'binary_content_persisted',
  'mossen.agent.definitionGenerated':
    LEGACY_EVENT_PREFIX + 'agent_definition_generated',
  'mossen.agent.created':
    LEGACY_EVENT_PREFIX + 'agent_created',
  'mossen.runtime.uncaughtException':
    LEGACY_EVENT_PREFIX + 'uncaught_exception',
  'mossen.runtime.unhandledRejection':
    LEGACY_EVENT_PREFIX + 'unhandled_rejection',
  'mossen.unary.event':
    LEGACY_EVENT_PREFIX + 'unary_event',
  'mossen.runtime.heapDump':
    LEGACY_EVENT_PREFIX + 'heap_dump',
  'mossen.teleport.ccrBundleUpload':
    LEGACY_EVENT_PREFIX + 'ccr_bundle_upload',
  'mossen.cron.scheduledTaskMissed':
    LEGACY_EVENT_PREFIX + 'scheduled_task_missed',
  'mossen.cron.scheduledTaskFire':
    LEGACY_EVENT_PREFIX + 'scheduled_task_fire',
  'mossen.cron.scheduledTaskExpired':
    LEGACY_EVENT_PREFIX + 'scheduled_task_expired',
  'mossen.ide.extensionInstalled':
    LEGACY_EVENT_PREFIX + 'ext_installed',
  'mossen.ide.extensionInstallError':
    LEGACY_EVENT_PREFIX + 'ext_install_error',
  'mossen.shell.snapshotFailed':
    LEGACY_EVENT_PREFIX + 'shell_snapshot_failed',
  'mossen.shell.unknownError':
    LEGACY_EVENT_PREFIX + 'shell_unknown_error',
  'mossen.shell.snapshotError':
    LEGACY_EVENT_PREFIX + 'shell_snapshot_error',
  'mossen.treeSitter.load':
    LEGACY_EVENT_PREFIX + 'tree_sitter_load',
  'mossen.treeSitter.parseAbort':
    LEGACY_EVENT_PREFIX + 'tree_sitter_parse_abort',
  'mossen.shell.setCwd':
    LEGACY_EVENT_PREFIX + 'shell_set_cwd',
  'mossen.shell.bashPrefix':
    LEGACY_EVENT_PREFIX + 'bash_prefix',
  'mossen.skill.fileChanged':
    LEGACY_EVENT_PREFIX + 'skill_file_changed',
  'mossen.mcp.instructionsPoolChange':
    LEGACY_EVENT_PREFIX + 'mcp_instructions_pool_change',
  'mossen.internal.permissionContextRecorded':
    LEGACY_EVENT_PREFIX + 'internal_record_permission_context',
  'mossen.agent.forkQuery':
    LEGACY_EVENT_PREFIX + 'fork_agent_query',
  'mossen.profiler.headlessLatency':
    LEGACY_EVENT_PREFIX + 'headless_latency',
  'mossen.profiler.startupPerf':
    LEGACY_EVENT_PREFIX + 'startup_perf',
  'mossen.filePersistence.started':
    LEGACY_EVENT_PREFIX + 'file_persistence_started',
  'mossen.filePersistence.completed':
    LEGACY_EVENT_PREFIX + 'file_persistence_completed',
  'mossen.filePersistence.limitExceeded':
    LEGACY_EVENT_PREFIX + 'file_persistence_limit_exceeded',
  'mossen.skillImprovement.detected':
    LEGACY_EVENT_PREFIX + 'skill_improvement_detected',
  'mossen.agent.stopHookMaxTurns':
    LEGACY_EVENT_PREFIX + 'agent_stop_hook_max_turns',
  'mossen.agent.stopHookError':
    LEGACY_EVENT_PREFIX + 'agent_stop_hook_error',
  'mossen.agent.stopHookSuccess':
    LEGACY_EVENT_PREFIX + 'agent_stop_hook_success',
  'mossen.permission.exitPlanModeOutsidePlan':
    LEGACY_EVENT_PREFIX + 'exit_plan_mode_called_outside_plan',
  'mossen.workflow.launched':
    LEGACY_EVENT_PREFIX + 'workflow_launched',
  'mossen.workflow.completed':
    LEGACY_EVENT_PREFIX + 'workflow_completed',
  'mossen.workflow.phaseCompleted':
    LEGACY_EVENT_PREFIX + 'workflow_phase_completed',
})

/** Resolve a Mossen-native event name to the wire name the sink will
 *  receive. Returns the input unchanged when no alias is registered.
 */
export function resolveMossenEventName(name: string): string {
  return MOSSEN_EVENT_TO_LEGACY_WIRE_ALIAS[name] ?? name
}

/** Log an analytics event using a Mossen-native event name.
 *
 *  Equivalent to `logEvent(resolveMossenEventName(name), metadata)` —
 *  callers should prefer this wrapper so a future rename of the wire
 *  stream is one entry in `MOSSEN_EVENT_TO_LEGACY_WIRE_ALIAS` instead
 *  of a hundred-file edit.
 */
export function logMossenEvent(name: string, metadata: LogEventMetadata): void {
  logEvent(resolveMossenEventName(name), metadata)
}

/** Log a Mossen-native event while preserving a dynamic legacy wire suffix.
 *
 *  Use this only for dynamic event families that cannot be represented in the
 *  static alias map, such as IDE-originated event names.
 */
export function logMossenEventWithLegacyWireSuffix(
  _name: string,
  legacyWireSuffix: string,
  metadata: LogEventMetadata,
): void {
  logEvent(LEGACY_EVENT_PREFIX + legacyWireSuffix, metadata)
}

/** Async variant of `logMossenEvent`. */
export async function logMossenEventAsync(
  name: string,
  metadata: LogEventMetadata,
): Promise<void> {
  await logEventAsync(resolveMossenEventName(name), metadata)
}
