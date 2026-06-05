/**
 * STRINGS_EN — English source-of-truth dictionary for Mossen UI.
 *
 * This module has NO imports. It is the root of the i18n type chain:
 *   strings.en.ts (no import)
 *     └── keys.ts          (import { STRINGS_EN }; export I18nKey = keyof typeof STRINGS_EN)
 *           └── strings.zh.ts (import type { I18nKey }; satisfies Record<I18nKey, string>)
 *                 └── index.ts (combines all + getInteractiveLanguageTag)
 *
 * Naming convention (W1-D5 = A): <scope>.<feature>.<element>
 *   scope     ∈ { cmd, ui, ctx, compact, onboarding, hosted, lang, statusline, spinner }
 *   feature   ∈ command name / component name / region (lowercase, hyphen or camelCase)
 *   element   ∈ { title, description, hint, label, note, count, line, placeholder, ... }
 *
 * Placeholder syntax: '{name}'. Example: 'Welcome to {product}' + { product: 'Mossen' }.
 *
 * Migration policy (UX-Wave1):
 *   - New user-visible text MUST go through `t(key)` with a key registered here.
 *   - Existing inline `getLocalizedText({en, zh})` calls remain compat; do NOT bulk-migrate.
 *   - Slices that touch a file MUST migrate text in that file to `t()`.
 */

export const STRINGS_EN = {
  // --- cmd.* — command registry metadata (description / hint) ---
  // S2A 已迁 9 个 builtin cmd description；后续 slice 会把
  // utils/commandDescription.ts switch 中的剩余 case 逐步迁过来。
  'cmd.help.description': 'Show help and available commands',
  'cmd.exit.description': 'Exit the REPL',
  'cmd.files.description': 'List all files currently in context',
  'cmd.memory.description':
    'Edit hand-written {product} memory files (mossen.md)',
  'cmd.memory.crossref':
    'For the auto-captured memory database, use /memory-sidecar.',
  'cmd.mcp.description': 'Manage MCP servers',
  'cmd.skills.description': 'List available skills',
  'cmd.hooks.description': 'View hook configurations for tool events',
  'cmd.resume.description': 'Resume a previous conversation',
  'cmd.resume.argumentHint': '[id, title, or search term]',
  'cmd.lang.description': 'Quickly switch interface language',
  // W2-S1 高频会话基础 10 命令（9 A + 1 B）
  'cmd.clear.description': 'Clear conversation history and free up context',
  'cmd.compact.description':
    'Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]',
  'cmd.diff.description': 'View uncommitted changes and per-turn diffs',
  'cmd.copy.description':
    "Copy {product}'s last response to clipboard (or /copy N for the Nth-latest)",
  'cmd.export.description':
    'Export the current conversation to a file or clipboard',
  'cmd.branch.description':
    'Create a branch of the current conversation at this point',
  'cmd.fork.description':
    'Run a forked subagent with the current conversation context',
  'cmd.rename.description': 'Rename the current conversation',
  'cmd.tasks.description': 'List current-session tasks and bashes',
  'cmd.docs.description': 'Open local Mossen docs and topic guides',
  'cmd.usage.description': 'Show plan usage limits',
  'cmd.rewind.description':
    'Restore the code and/or conversation to a previous point',
  // W2-S2 编辑 / 配置 8 命令（全 A）
  'cmd.config.description': 'Open config panel',
  'cmd.theme.description': 'Change the theme',
  'cmd.color.description': 'Set the prompt bar color for this session',
  'cmd.keybindings.description':
    'Open or create your keybindings configuration file',
  'cmd.vim.description': 'Toggle between Vim and Normal editing modes',
  'cmd.voice.description': 'Toggle voice mode',
  'cmd.effort.description': 'Set effort level for model usage',
  'cmd.profile.description':
    'Set execution and reasoning profiles for personal workflows',
  'cmd.plan.description':
    'Enable plan mode or view the current session plan',
  'cmd.goal.description':
    'Set or view a session-scoped completion target',
  'cmd.workflows.description': 'Monitor workflow runs and save them as reusable commands',
  'cmd.workflows.empty': 'No workflow runs in this session yet.',
  'cmd.workflows.emptyHint': 'Type "workflow" in your message to orchestrate subagents; runs appear here.',
  'cmd.workflows.dialogTitle': 'Workflows',
  'cmd.workflows.dismissed': 'Workflow view dismissed',
  'cmd.workflows.listTitle': 'Workflow runs this session:',
  'cmd.workflows.detailHint': 'Use /workflows <runId> to see progress, pause/stop to manage the run, stop-agent/restart-agent for a specific agent, resume/resume-task to replay from journal, or save to keep it.',
  'cmd.workflows.notFound': 'No workflow run found with id {runId}.',
  'cmd.workflows.status': 'Status',
  'cmd.workflows.agents': 'Agents',
  'cmd.workflows.tools': 'Tools',
  'cmd.workflows.tokens': 'Tokens',
  'cmd.workflows.duration': 'Duration',
  'cmd.workflows.failures': 'Failures',
  'cmd.workflows.phase': 'Phase',
  'cmd.workflows.phases': 'Phases:',
  'cmd.workflows.agentsDetail': 'Agents:',
  'cmd.workflows.agentDetail': 'Agent detail',
  'cmd.workflows.prompt': 'Prompt',
  'cmd.workflows.lastTool': 'Last tool',
  'cmd.workflows.result': 'Result',
  'cmd.workflows.progress': 'Progress:',
  'cmd.workflows.noProgress': 'No progress recorded for this run.',
  'cmd.workflows.controlsHint': 'Controls: /workflows pause {runId}, stop {runId}, stop-agent {runId} <agent>, restart-agent {runId} <agent>, agent {runId} <agent>, save {runId}.',
  'cmd.workflows.saveUsage': 'Usage: /workflows save <runId> [name] [--user]',
  'cmd.workflows.saveBadName': 'Could not derive a valid workflow name. Provide one explicitly.',
  'cmd.workflows.saved': 'Saved workflow "{name}" ({scope} scope) → {path}. It is now available as /{name}.',
  'cmd.workflows.saveFailed': 'Could not save workflow: {error}',
  'cmd.workflows.saveDialogTitle': 'Save workflow',
  'cmd.workflows.saveDialogRun': 'Run',
  'cmd.workflows.saveDialogName': 'Command',
  'cmd.workflows.saveScopeProject': 'Project workflow',
  'cmd.workflows.saveScopeUser': 'User workflow',
  'cmd.workflows.saveDialogHint': 'Press Tab to switch location, Enter to save.',
  'cmd.workflows.resumeUsage': 'Usage: /workflows resume <runId>',
  'cmd.workflows.resumeQueued': 'Resuming workflow run {runId}.',
  'cmd.workflows.pauseUsage': 'Usage: /workflows pause <runId>',
  'cmd.workflows.stopUsage': 'Usage: /workflows stop <runId>',
  'cmd.workflows.stopAgentUsage': 'Usage: /workflows stop-agent <runId> <agentNumber>',
  'cmd.workflows.retryAgentUsage': 'Usage: /workflows restart-agent <runId> <agentNumber>',
  'cmd.workflows.agentDetailUsage': 'Usage: /workflows agent <runId> <agentNumber>',
  'cmd.workflows.resumeTaskUsage': 'Usage: /workflows resume-task <runId>',
  'cmd.workflows.paused': 'Paused workflow task {runId}. Resume with /workflows resume {runId}.',
  'cmd.workflows.stopped': 'Stopped workflow task {runId}.',
  'cmd.workflows.agentStopped': 'Stop requested for workflow {runId} agent #{agentNumber}.',
  'cmd.workflows.agentRetryQueued': 'Restart requested for workflow {runId} agent #{agentNumber}.',
  'cmd.workflows.agentNotFound': 'No visible agent #{agentNumber} found for workflow {runId}.',
  'cmd.workflows.agentNotRunning': 'Workflow {runId} agent #{agentNumber} is not running.',
  'cmd.workflows.agentControlsHint': 'Controls: /workflows stop-agent {runId} {agentNumber}, /workflows restart-agent {runId} {agentNumber}, /workflows <runId>.',
  'cmd.workflows.resumed': 'Queued workflow resume for {runId}.',
  'cmd.workflows.alreadyPaused': 'Workflow task {runId} is already paused.',
  'cmd.workflows.notPaused': 'Workflow task {runId} is not paused or stopped.',
  'cmd.workflows.taskNotRunning': 'Workflow task {runId} is not running.',
  'cmd.workflows.ultracodeOn': 'Ultracode standing orchestration mode is now ON for this session.',
  'cmd.workflows.ultracodeOff': 'Ultracode standing orchestration mode is now OFF.',
  'cmd.workflows.ultracodeStatusOn': 'Ultracode standing orchestration mode is ON. Use /workflows ultracode off to disable.',
  'cmd.workflows.ultracodeStatusOff': 'Ultracode standing orchestration mode is OFF. Type "ultracode" in a message (or /workflows ultracode on) to enable.',
  'cmd.goal.set.ok': 'Goal set for this session.',
  'cmd.goal.unavailable.hooksDisabled':
    '/goal is unavailable because hooks are disabled by settings or managed policy.',
  'cmd.goal.set.empty':
    'Usage: /goal set <goal>, /goal status, /goal why, /goal clear (or stop/off/reset/none/cancel), /goal pause, /goal resume, or /goal done',
  'cmd.goal.set.truncated': 'Goal was truncated to {max} graphemes.',
  'cmd.goal.status.none':
    'No active session goal. Use /goal set <goal> to add one.',
  'cmd.goal.status.scope':
    'Scope: current process; survives /compact. Mossen can continue turns automatically until the model marks the goal complete/blocked or the evaluator caps it.',
  'cmd.goal.status.previous': 'Previous goal status',
  'cmd.goal.status.historyTitle': 'Previously this session:',
  'cmd.goal.status.title': 'Current session goal',
  'cmd.goal.status.status': 'Status',
  'cmd.goal.status.goal': 'Goal',
  'cmd.goal.status.turns': 'Turns since set',
  'cmd.goal.status.budget': 'Turn budget',
  'cmd.goal.status.elapsed': 'Elapsed',
  'cmd.goal.status.tokens': 'Estimated tokens',
  'cmd.goal.status.lastTurnTokens': 'Last turn token estimate',
  'cmd.goal.status.evaluatorTokens': 'Evaluator token estimate',
  'cmd.goal.status.reason': 'Latest evaluator reason',
  'cmd.goal.status.startHint': 'Start: /goal set <target>. The goal is session-scoped and survives /resume as paused.',
  'cmd.goal.status.next': 'Next',
  'cmd.goal.status.nextActive': 'Mossen may continue automatically; the model should call update_goal when complete or truly blocked.',
  'cmd.goal.status.nextPaused': 'Paused goals do not continue automatically. Use /goal resume when ready.',
  'cmd.goal.status.overlayHint': 'Overlay: Ctrl-G hides or shows the floating card on wide terminals.',
  'cmd.goal.status.value.active': 'active',
  'cmd.goal.status.value.paused': 'paused',
  'cmd.goal.status.value.blocked': 'blocked',
  'cmd.goal.status.value.cleared': 'cleared',
  'cmd.goal.status.value.completed': 'completed',
  'cmd.goal.status.value.failed': 'failed',
  'cmd.goal.clear.ok': 'Cleared the session goal.',
  'cmd.goal.clear.none': 'No session goal to clear.',
  'cmd.goal.pause.ok': 'Paused the session goal. Use /goal resume to continue.',
  'cmd.goal.pause.none': 'No active session goal to pause.',
  'cmd.goal.resume.ok': 'Resumed the session goal.',
  'cmd.goal.resume.none': 'No paused session goal to resume.',
  'cmd.goal.done.ok': 'Marked the session goal completed.',
  'cmd.goal.done.none': 'No active session goal to complete.',
  'cmd.goal.auto.completed': 'Session goal completed: {reason}',
  'cmd.goal.auto.continue': 'Session goal not met yet; continuing: {reason}',
  'cmd.goal.auto.error': 'Session goal evaluator stopped: {reason}',
  'cmd.goal.auto.maxTurns': 'Session goal auto-continuation capped: {reason}',
  'cmd.goal.auto.paused': 'Session goal paused for user input: {reason}',
  'cmd.goal.reason.pending': 'Waiting for the first evaluation.',
  'cmd.goal.reason.deferred': 'Goal evaluation is waiting for active work: {reason}',
  'cmd.goal.reason.continue': 'Goal is not met yet; continuing: {reason}',
  'cmd.goal.reason.completed': 'Goal is met: {reason}',
  'cmd.goal.reason.paused': 'Goal is paused until you respond or resume: {reason}',
  'cmd.goal.reason.blocked': 'Goal is blocked; use /goal resume after resolving it: {reason}',
  'cmd.goal.reason.maxTurns': 'Turn cap reached; auto-continuation stopped: {reason}',
  'cmd.goal.reason.error': 'Evaluator error; auto-continuation stopped: {reason}',
  'cmd.goal.reason.cleared': 'Goal was cleared: {reason}',
  'cmd.goal.explain.title': 'Session goal explanation',
  'cmd.goal.explain.none': 'No session goal is available to explain.',
  'cmd.goal.explain.outcome': 'Outcome',
  'cmd.goal.explain.outcome.pending': 'waiting for first evaluation',
  'cmd.goal.explain.outcome.deferred': 'waiting for active work',
  'cmd.goal.explain.outcome.continue': 'not met; will continue automatically',
  'cmd.goal.explain.outcome.completed': 'completed',
  'cmd.goal.explain.outcome.paused': 'paused; waiting for you',
  'cmd.goal.explain.outcome.blocked': 'blocked; waiting for resume',
  'cmd.goal.explain.outcome.maxTurns': 'turn cap reached',
  'cmd.goal.explain.outcome.error': 'evaluator error',
  'cmd.goal.explain.outcome.cleared': 'cleared',
  'cmd.goal.explain.hint':
    'Tip: /goal status shows current state; /goal pause pauses; /goal resume resumes.',
  'cmd.goal.defer.runningTool': 'a tool call is still running',
  'cmd.goal.defer.backgroundShell': 'a background shell is still running',
  'cmd.goal.defer.backgroundAgent': 'a background agent is still running',
  'cmd.goal.defer.teammate': 'a delegated agent is still running',
  'cmd.scrollSpeed.description': 'Set terminal scroll speed',
  'cmd.scrollSpeed.current': 'Current scroll speed: {speed}x.',
  'cmd.scrollSpeed.updated':
    'Scroll speed set to {speed}x. New scroll events use this speed immediately.',
  'cmd.scrollSpeed.invalid': 'Invalid scroll speed: {value}.',
  'cmd.scrollSpeed.usage':
    'Usage: /scroll-speed <slow|normal|fast|0.1-20>.',
  'ui.workflowKeyword.notification':
    'Workflow mode — multi-agent orchestration enabled for this message.',
  'ui.workflowKeyword.reminder':
    'The user explicitly opted into multi-agent orchestration by typing the workflow keyword or asking for it in natural language. When the task genuinely warrants it, you may use the Workflow tool to coordinate sub-agents.',
  'ui.workflowKeyword.ultraworkReminder':
    'The user requested the strongest single-turn orchestration (ultrawork) for this message. Decompose aggressively and use the Workflow tool to fan out sub-agents in parallel, verifying findings before reporting.',
  'ui.workflowKeyword.ultracodeReminder':
    'The user turned on standing orchestration mode (ultracode) for this session. From now on, default to the Workflow tool for substantial work — decompose and cover in parallel — until the user clears the mode.',
  'ui.workflowKeyword.ultracodeStandingReminder':
    'Standing orchestration mode (ultracode) is active. For any substantial task, reach for the Workflow tool to orchestrate sub-agents rather than working solo.',
  'ui.workflowKeyword.ultraworkNotification':
    'Ultrawork — strongest single-turn multi-agent orchestration for this message.',
  'ui.workflowKeyword.ultracodeNotification':
    'Ultracode — standing multi-agent orchestration mode ON for this session.',
  'ui.goalOverlay.title': 'GOAL',
  'ui.goalOverlay.hideHint': 'ctrl-g hide',
  'ui.goalOverlay.hiddenToast': 'Goal overlay hidden; press Ctrl-G to show it again.',
  'ui.goalOverlay.shownToast': 'Goal overlay shown; press Ctrl-G to hide it.',
  'ui.goalOverlay.subtitle': 'current session',
  'ui.goalOverlay.goalCollapsedHint': 'goal collapsed; use /goal status for full text',
  'ui.goalOverlay.scope': 'Scope',
  'ui.goalOverlay.scopeValue': 'this session',
  'ui.goalOverlay.statusActive': 'active: auto-checking',
  'ui.goalOverlay.statusPaused': 'paused: waiting',
  'ui.goalOverlay.statusBlocked': 'blocked: resume needed',
  'ui.goalOverlay.statusCompleted': 'completed: result kept',
  'ui.goalOverlay.statusFailed': 'error: needs attention',
  'ui.goalOverlay.next': 'Next',
  'ui.goalOverlay.nextActive': 'evaluate, then continue',
  'ui.goalOverlay.nextPaused': 'use /goal resume',
  'ui.goalOverlay.nextBlocked': 'use /goal resume',
  'ui.goalOverlay.nextCompleted': 'use /goal clear',
  'ui.goalOverlay.nextFailed': 'check /goal why',
  'ui.goalOverlay.reasonPending': 'not evaluated yet',
  'ui.goalOverlay.elapsedUnknown': 'unknown',
  'ui.goalOverlay.tokenPending': 'waiting for first estimate',
  'ui.promptInput.exampleCommand.placeholder': 'Try "{command}"',
  'ui.promptInput.context.teammate': 'Message @{name}…',
  'ui.promptInput.context.goalActive': 'Continue goal: {goal}',
  'ui.promptInput.context.goalPaused': 'Goal paused: {goal}',
  'ui.promptInput.context.goalBlocked': 'Goal blocked: {goal}',
  'ui.promptInput.context.busy': 'Add a follow-up for after this turn',
  'ui.promptInput.context.next': 'Type the next step, or / for commands',
  'ui.promptInput.context.start': 'Type a task, or / for commands',
  'ui.promptQueue.upHint': 'Press up to edit queued messages',
  'ui.promptQueue.previewLabel': 'Queued input',
  'ui.promptQueue.taskPreviewLabel': 'Background notifications',
  'ui.promptQueue.moreTasksCompleted': '+{count} more tasks completed',
  // W2-S3 PR / Review / 安全 / 登录 / 顾问 4 命令（3 A + 1 B）
  // /review 暂缓 — smoke_check.py L10802 单一 en 字面量硬比较，待 R-20 解禁
  'cmd.advisor.description': 'Configure the advisor model',
  'cmd.security-review.description':
    'Complete a security review of the pending changes on the current branch',
  'cmd.permissions.description': 'Manage allow & deny tool permission rules',
  'cmd.login.description': 'Show {product} backend credential setup guidance',
  // W2-S4 Plugin / Skill / IDE 5 命令（全 A；/plugin 暂缓）
  // /plugin 暂缓 — smoke_check.py L10854-10855 pluginDescription 单一 en 字面量硬比较，与 /review 同模式，待 R-20 解禁
  'cmd.reload-plugins.description':
    'Activate pending plugin changes in the current session',
  'cmd.agents.description': 'Open Agent View or manage agent configurations',
  'cmd.agents.view.shellOnly':
    'Agent View is a full-screen shell dashboard. Run `mossen agents` from your terminal. `/agents` keeps managing agent definitions.',
  'cmd.bg.description': 'Start a task in Agent View background mode',
  'ui.agentView.title': 'Agent sessions',
  'ui.agentView.empty':
    'No agent sessions yet\n  Type a task and press Enter, or Shift+Enter to open the new job\n  From a shell: `mossen --bg "<prompt>"`\n  Agent definitions: `/agents library`\n  Press `?` for shortcuts',
  'ui.agentView.select': 'select',
  'ui.agentView.peek': 'peek/reply',
  'ui.agentView.attach': 'attach',
  'ui.agentView.reply': 'reply panel',
  'ui.agentView.stop': 'stop',
  'ui.agentView.dismiss': 'dismiss',
  'ui.agentView.confirmDismiss': 'press Ctrl+X again to dismiss',
  'ui.agentView.close': 'close',
  'ui.agentView.dismissed': 'Agent View dismissed',
  'ui.agentView.viewingMain': 'Viewing main session',
  'ui.agentView.viewingAgent': 'Viewing agent session',
  'ui.agentView.activeSession': 'active session',
  'ui.agentView.activeSessions': 'active sessions',
  'ui.agentView.totalSession': 'session',
  'ui.agentView.totalSessions': 'sessions',
  'ui.agentView.groupAgents': 'Agents',
  'ui.agentView.groupRemoteAgents': 'Remote agents',
  'ui.agentView.groupLocalAgents': 'Local agents',
  'ui.agentView.groupSupervisorJobs': 'Supervisor jobs',
  'ui.agentView.groupLiveLocalTasks': 'Live local tasks',
  'ui.agentView.typeShortcut': 'type',
  'ui.agentView.taskShortcut': 'task',
  'ui.agentView.filter': 'filter',
  'ui.agentView.command': 'command',
  'ui.agentView.dispatch': 'dispatch',
  'ui.agentView.dispatchAttach': 'dispatch + open',
  'ui.agentView.attachNth': 'open row',
  'ui.agentView.externalEditor': 'editor',
  'ui.agentView.dispatchHint':
    'Type a task and press Enter to dispatch. Use agent:/status:/cwd:/# to filter. Slash opens task skills/templates only. Shift+Enter opens the new job; Ctrl+G edits the dispatch prompt when VISUAL or EDITOR is set.',
  'ui.agentView.inputPlaceholder': 'start a task in the background',
  'ui.agentView.rootBackHint': 'Already at the Agent View dashboard. Space peeks/replies; Enter/→ attaches to the selected job. Type /exit to close.',
  'ui.agentView.dispatchDefaults': 'dispatch defaults',
  'ui.agentView.dispatchDefaultsSkipPermissions': 'skip permissions',
  'ui.agentView.lastRefresh': 'last refresh',
  'ui.agentView.nextStep': 'next',
  'ui.agentView.nextEmpty': 'Type a task to start a background job; use /agents library for agent definitions.',
  'ui.agentView.nextFilter': 'Filtering list; Esc clears the filter.',
  'ui.agentView.nextCommand': 'Choose a skill/template with Enter or Tab, then press Enter to dispatch it as a background job.',
  'ui.agentView.nextDispatch':
    'Press Enter to dispatch, or Shift+Enter to dispatch and open the new job.',
  'ui.agentView.nextNeedsInput': 'Press Space to reply, or Enter/→ to attach to the live session.',
  'ui.agentView.nextRunning': 'Press Space to peek, Enter/→ to attach, or Ctrl+X to stop.',
  'ui.agentView.nextReadyResult': 'Press Space to review the result, or Enter/→ to attach for follow-up.',
  'ui.agentView.nextFailed': 'Press Space for details, or use `mossen respawn <id>` from a shell.',
  'ui.agentView.nextTerminal':
    'Press Space to review, Ctrl+X twice to remove from the roster, or use `mossen rm <id> --dry-run`.',
  'ui.agentView.nextLeader': 'Press Enter/→ to return to the main session.',
  'ui.agentView.nextShell': 'Press Enter to inspect shell output; Ctrl+X stops a running shell.',
  'ui.agentView.nextLocalAgent': 'Press Enter/→ to view this local agent in the main chat.',
  'ui.agentView.nextGenericTask': 'Press Enter to inspect, or ←/Esc to close Agent View.',
  'ui.agentView.density': '{groups} groups · {rows} visible jobs',
  'ui.agentView.highDensityMode':
    'High-density view: low-value path detail is hidden; status, title, and summary remain.',
  'ui.agentView.groupCountActive': '{count} active',
  'ui.agentView.groupCountNeedsInput': '{count} needs input',
  'ui.agentView.groupCountFailed': '{count} failed',
  'ui.agentView.groupCountCompleted': '{count} done',
  'ui.agentView.actionAttach': 'attach',
  'ui.agentView.actionInspect': 'inspect',
  'ui.agentView.actionPeek': 'peek',
  'ui.agentView.actionReply': 'reply',
  'ui.agentView.actionReview': 'review result',
  'ui.agentView.groupStagePinned': 'Pinned',
  'ui.agentView.groupStageNeedsInput': 'Needs input',
  'ui.agentView.groupStageReadyForReview': 'Ready for review',
  'ui.agentView.groupStageWorking': 'Working',
  'ui.agentView.groupStageCompleted': 'Completed',
  'ui.agentView.groupStageStoppedFailed': 'Stopped/failed',
  'ui.agentView.moreCompleted': '{count} more completed · Ctrl+O to expand',
  'ui.agentView.notification.title': 'Mossen Agent View',
  'ui.agentView.notification.needsInput':
    'Background job {id} needs input.',
  'ui.agentView.resultPayload': 'Result',
  'ui.agentView.resultArtifacts': 'Artifacts',
  'ui.agentView.resultRisks': 'Risks',
  'ui.agentView.resultNextActions': 'Next actions',
  'ui.agentView.dateToday': 'today',
  'ui.agentView.dateYesterday': 'yesterday',
  'ui.agentView.dateThisWeek': 'this week',
  'ui.agentView.dateOlder': 'older',
  'ui.agentView.dateUnknown': 'unknown date',
  'ui.agentView.refreshNever': 'never',
  'ui.agentView.refreshJustNow': 'just now',
  'ui.agentView.refreshSecondsAgo': '{seconds}s ago',
  'ui.agentView.dispatching': 'Dispatching background job...',
  'ui.agentView.dispatchTooShort': 'Background job prompt is too short.',
  'ui.agentView.editorUnavailable':
    'No external editor is configured for Agent View. Set VISUAL or EDITOR, then try Ctrl+G again.',
  'ui.agentView.noGroupShortcutTarget':
    'No row {index} in the current Agent View group.',
  'ui.agentView.stopRequestedSupervisorJob':
    'Stop requested. Press Ctrl+X again within 2s to remove this job from Agent View.',
  'ui.agentView.removeSupervisorConfirm':
    'Press Ctrl+X again within 2s to remove this job from Agent View. Job files and transcripts are preserved.',
  'ui.agentView.removedSupervisorJob':
    'Removed job from Agent View. Job files and transcripts were preserved.',
  'ui.agentView.supervisorLoadError': 'Supervisor roster load failed',
  'ui.agentView.noMatches': 'No matching agent sessions',
  'ui.agentView.commandPending': 'Use the skill/template palette above, or press Esc to return to task dispatch.',
  'ui.agentView.paletteTitle': 'Agent View task skills/templates',
  'ui.agentView.paletteEmpty': 'No matching task skills/templates',
  'ui.agentView.paletteHint': '↑/↓ select · Enter/Tab insert · add arguments, then Enter dispatches',
  'ui.agentView.paletteKindSkill': 'skill',
  'ui.agentView.paletteKindTemplate': 'template',
  'ui.agentView.paletteBlockedCommand':
    '{command} is not available in Agent View. Type a task, choose a skill/template from /, or run normal slash commands inside an attached session.',
  'ui.agentView.peekPending':
    'Supervisor peek opens in W283-G. Use logs <id> for now.',
  'ui.agentView.attachPending':
    'Supervisor attach opens in W283-H. Use logs <id> for now.',
  'ui.agentView.attachCommand':
    'Run `mossen attach {id}` in another terminal to attach; leaving that session detaches without stopping the job.',
  'ui.agentView.detached': 'Detached from job {id}. Agent View is active again.',
  'ui.agentView.attachFailed': 'Attach to job {id} exited with code {code}.',
  'ui.agentView.attachConnecting':
    'Connecting to agent terminal… press Esc twice to detach.',
  'ui.agentView.attachEvicted':
    'Another dashboard took over this job. Press any key to return to the list.',
  'ui.agentView.attachUnsupported':
    'Raw terminal mode is unavailable here. Open Agent View from a real interactive terminal.',
  'ui.agentView.attachFailedGeneric':
    'Failed to attach to the agent session. Returning to the dashboard.',
  'ui.agentView.attachConnectFailed':
    'Could not open the agent terminal: {message}. Returning to the dashboard.',
  'ui.agentView.attachAborted':
    'Agent terminal attach was interrupted: {message}. Returning to the dashboard.',
  'ui.agentView.attachExitedSplash':
    'Agent View session ended (exit {code}). Press any key to return to the dashboard.',
  'ui.agentView.pin': 'pin',
  'ui.agentView.unpin': 'unpin',
  'ui.agentView.rename': 'rename',
  'ui.agentView.renamePrompt': 'Rename:',
  'ui.agentView.reorder': 'reorder',
  'ui.agentView.collapseGroup': 'collapse group',
  'ui.agentView.definitions': 'definitions',
  'ui.agentView.definitionsUnavailable':
    'Agent definitions are available from the REPL with /agents library.',
  'ui.agentView.help': 'help',
  'ui.agentView.helpText':
    'Main input creates new jobs. Use / for commands and skills, /exit to close, agent:/status:/cwd:/# to filter, Space peeks/replies, Enter/→ attaches, and ← returns to the list. ✻ means live process, ∙ means stopped/resumable. Ctrl+T pins, Ctrl+R renames, Shift+↑/↓ reorders, Ctrl+O collapses/expands groups, Ctrl+X stops/removes.',
  'ui.agentView.helpCreateTitle': 'Create:',
  'ui.agentView.helpCreate':
    'Type a task to dispatch; / opens commands and skills; Shift+Enter dispatches and opens; Ctrl+G edits the dispatch prompt when VISUAL or EDITOR is set.',
  'ui.agentView.helpBrowseTitle': 'Browse:',
  'ui.agentView.helpBrowse':
    'Use a:<agent>, s:<state>, s:blocked, #<number>, or a PR URL to filter; Ctrl+O toggles the current group collapse/expansion.',
  'ui.agentView.helpInteractTitle': 'Open/reply:',
  'ui.agentView.helpInteract':
    'Space opens the lightweight peek/reply panel. Enter/→ attaches to the live job session. The dashboard input only creates new background jobs.',
  'ui.agentView.helpOrganizeTitle': 'Organize:',
  'ui.agentView.helpOrganize':
    'Ctrl+T pins, Ctrl+R renames, Shift+↑/↓ reorders, Ctrl+X stops; press Ctrl+X again to remove a terminal job.',
  'ui.agentView.helpShellTitle': 'Shell:',
  'ui.agentView.helpShell':
    '`mossen --bg`, `mossen agents`, `mossen wait <id>`, `mossen logs <id>`, and `mossen rm <id> --dry-run` mirror the TUI.',
  'ui.agentView.statusQueued': 'queued',
  'ui.agentView.statusWorking': 'working',
  'ui.agentView.statusIdle': 'idle',
  'ui.agentView.statusNeedsInput': 'needs input',
  'ui.agentView.statusCompleted': 'completed',
  'ui.agentView.statusFailed': 'failed',
  'ui.agentView.statusStopped': 'stopped',
  'ui.agentView.loading': 'loading',
  'ui.agentView.back': 'back',
  'ui.agentView.sendReply': 'send reply',
  'ui.agentView.acceptSuggestion': 'accept suggestion',
  'ui.agentView.showActivity': 'show activity',
  'ui.agentView.hideActivity': 'hide activity',
  'ui.transcript.editor.rendering': 'rendering {count} messages...',
  'ui.transcript.editor.opening': 'opening {path} with {editor}',
  'ui.transcript.editor.unavailable':
    'wrote {path} · editor unavailable ({editor}); set VISUAL or EDITOR to choose one.',
  'ui.transcript.editor.renderFailed': 'render failed: {message}',
  'ui.transcript.footer.showing':
    'Showing detailed transcript · {toggleShortcut} to toggle',
  'ui.transcript.footer.searchNav': 'n/N navigate matches',
  'ui.transcript.footer.virtualNav':
    'scroll · home/end top/bottom · {/} prompts · ?/v shortcuts · e editor',
  'ui.transcript.footer.collapse': 'collapse',
  'ui.transcript.footer.showAll': 'show all',
  'ui.transcript.help.title': 'Transcript shortcuts',
  'ui.transcript.help.search': '/ search · n/N next/previous match',
  'ui.transcript.help.promptJump': '{/} previous/next user prompt',
  'ui.transcript.help.scroll':
    '↑/↓ scroll · home/end top/bottom · [ dump to scrollback',
  'ui.transcript.help.shortcuts': '? or v toggles this shortcut panel',
  'ui.transcript.help.editor':
    'e opens the rendered transcript in $VISUAL/$EDITOR',
  'ui.hooks.stop.blockCapReached':
    'Stop hook blocking feedback repeated {attempts}/{limit} times. Mossen stopped auto-continuation to prevent a loop; review the hook output or adjust the hook before retrying.',
  'ui.agentView.peekPanel': 'Peek / reply',
  'ui.agentView.detailStatus': 'Quick read',
  'ui.agentView.detailStatusLine':
    'status {status} · model {model} · agent {agent} · permission {permission}',
  'ui.agentView.detailCwd': 'cwd',
  'ui.agentView.detailSession': 'session',
  'ui.agentView.detailControls':
    '←/Esc back · Enter replies · Tab accepts suggestion · option keys choose · Ctrl+E activity',
  'ui.agentView.detailInputs': 'Recent inputs',
  'ui.agentView.detailOutput': 'Recent output',
  'ui.agentView.detailEvents': 'Recent events',
  'ui.agentView.detailReplyChannel': 'Reply channel',
  'ui.agentView.pendingQuestion': 'Pending question',
  'ui.agentView.questionOptions': 'Choices',
  'ui.agentView.suggestedReply': 'Suggested reply',
  'ui.agentView.recentInputs': 'Recent messages sent to this job',
  'ui.agentView.recentOutput': 'Recent output',
  'ui.agentView.noRecentOutput': 'No recent output yet',
  'ui.agentView.recentEvents': 'Recent events',
  'ui.agentView.noRecentEvents': 'No recent events yet',
  'ui.agentView.activityLogCollapsed': 'Activity log collapsed ({count} events). Ctrl+E shows recent events.',
  'ui.agentView.replySelectedJobOnly': 'Reply target: {jobId}',
  'ui.agentView.replyPrompt': 'Reply:',
  'ui.agentView.replyPlaceholder': 'type a reply or press a choice key',
  'ui.agentView.replySent': 'Sent',
  'ui.agentView.replyAcked': 'ack',
  'ui.agentView.sendingReply': 'Sending reply...',
  'cmd.ide.description': 'Manage IDE integrations and show status',
  'cmd.init-verifiers.description':
    'Create verifier skill(s) for automated verification of code changes',
  'cmd.add-dir.description': 'Add a new working directory',
  // W2-S5 系统/杂项 1 命令（仅 /btw 安全可迁）
  // /context 推迟（multi-variant resolver 阻塞，待 W3）；/brief 归 D（feature KAIROS gate）；
  // /logout 归 D（isCustomBackendEnabled → isUsing3PServices → /logout 个人版不可见）
  'cmd.btw.description':
    'Ask a quick side question without interrupting the main conversation',
  'cmd.brief.description': 'Toggle brief-only mode',
  'cmd.assistant.description': 'Connect to a running assistant session',
  'cmd.commit.description': 'Create a git commit',
  'cmd.commit-push-pr.description': 'Commit, push, and open a PR',
  'cmd.context.description': 'Show current context usage',
  'cmd.context.visualDescription':
    'Visualize current context usage as a colored grid',
  'cmd.cost.description':
    'Show the total cost and duration of the current session',
  'cmd.extensions.description': 'Show extension install commands',
  'cmd.feedback.description': 'Submit feedback about {product}',
  'cmd.heapdump.description': 'Dump the JS heap to ~/Desktop',
  'cmd.install-slack-app.description': 'Install the {product} Slack app',
  'cmd.logout.description':
    'Clear locally cached auth state for the current backend',
  'cmd.lsp.description':
    'Inspect and configure Language Server Protocol support',
  'cmd.memory-sidecar.description':
    'Browse the auto-captured memory sidecar (recall / health / retention / repair)',
  'cmd.memory-sidecar.crossref':
    'For hand-written mossen.md files, use /memory.',
  'cmd.model.description': 'List, switch, and manage model profiles',
  'cmd.model.models.timeoutInvalid':
    '--timeout must be a positive integer in milliseconds, got "{value}".',
  'cmd.model.models.providerDashscopeCodingTitle':
    'Provider note: this looks like an Alibaba Cloud Model Studio coding-plan endpoint.',
  'cmd.model.models.providerDashscopeCodingBody':
    'That endpoint can still work for chat, but it does not expose OpenAI-compatible GET /models.',
  'cmd.model.models.providerDashscopeStandardRoots':
    'If your key is for standard Model Studio, configure a separate profile with one of the official OpenAI-compatible baseURLs:',
  'cmd.model.models.providerDashscopeRootChina':
    '  China (Beijing): https://dashscope.aliyuncs.com/compatible-mode/v1',
  'cmd.model.models.providerDashscopeRootSingapore':
    '  Singapore:       https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'cmd.model.models.providerDashscopeRootUs':
    '  US (Virginia):   https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  'cmd.model.models.providerDashscopeCodingManual':
    'If your key is for the coding-plan endpoint only, keep this baseURL and switch by known model id:',
  'cmd.model.models.providerDashscope404Title':
    'Provider note: this DashScope endpoint returned 404 for GET /models.',
  'cmd.model.models.providerDashscope404Body':
    'Chat requests may still work. If you need discovery, verify that the profile baseURL is a Model Studio OpenAI-compatible API root ending in /compatible-mode/v1, not a chat/completions or coding-plan endpoint.',
  'cmd.model.models.providerMinimaxTitle':
    'Provider note: this looks like a MiniMax OpenAI-compatible endpoint.',
  'cmd.model.models.providerMinimaxBody':
    'Some MiniMax-compatible accounts or proxies do not expose GET /models even when chat requests work.',
  'cmd.model.models.providerGlmTitle':
    'Provider note: this looks like a GLM / Zhipu endpoint.',
  'cmd.model.models.providerGlmBody':
    'GLM-compatible chat endpoints may not expose OpenAI-compatible GET /models for every account or gateway path.',
  'cmd.model.models.providerDeepSeekTitle':
    'Provider note: this looks like a DeepSeek endpoint.',
  'cmd.model.models.providerDeepSeekBody':
    'DeepSeek chat requests can work while this specific baseURL does not expose GET /models.',
  'cmd.model.models.providerDeepSeekOpenAiRoot':
    'For OpenAI-compatible discovery, verify the baseURL is the provider API root such as https://api.deepseek.com/v1. Messages-compatible paths may require manual model ids.',
  'cmd.model.models.providerMessagesCompatibleTitle':
    'Provider note: this profile uses a messages-compatible protocol.',
  'cmd.model.models.providerMessagesCompatibleBody':
    'Messages-compatible providers commonly do not implement OpenAI-style GET /models. Use known model ids for this profile.',
  'cmd.model.models.providerOpenAiCompatibleTitle':
    'Provider note: this OpenAI-compatible endpoint did not expose GET /models.',
  'cmd.model.models.providerOpenAiCompatibleBody':
    'Chat may still work. Check that baseURL points at the provider API root, not a chat/completions-only path, proxy route, or account-specific coding endpoint.',
  'cmd.model.models.providerKnownModelManual':
    'Keep this baseURL and switch by known model id:',
  'cmd.model.models.reasonCurrentProfile': 'current profile',
  'cmd.model.models.reasonOnlyProfile': 'only configured profile',
  'cmd.model.models.reasonSuffix': ' ({reason})',
  'cmd.model.models.usageTitle': 'Usage:',
  'cmd.model.models.usageCommand':
    '  /model models [PROFILE] [--refresh] [--timeout MS]',
  'cmd.model.models.usageDefaultProfile':
    'Without PROFILE, Mossen uses the current session profile when one is active.',
  'cmd.model.models.usageDiscovery':
    'This discovers model ids exposed by the already-configured baseURL/apiKey.',
  'cmd.model.models.usageOptional':
    'It is optional; initial profile setup still uses /model add ... --model MODEL_ID.',
  'cmd.model.models.availableProfiles': 'Available profiles: {profiles}',
  'cmd.model.models.noProfiles': 'No profiles configured.',
  'cmd.model.models.title': 'Model discovery: {name}{reason}',
  'cmd.model.models.resultFailed': 'Result: failed ({reason})',
  'cmd.model.models.url': 'URL: {url}',
  'cmd.model.models.httpStatus': 'HTTP status: {status}',
  'cmd.model.models.reason': 'Reason: {reason}',
  'cmd.model.models.noProfileChange':
    'This does not change the profile and does not affect chat requests.',
  'cmd.model.models.manualFallback':
    'If this provider does not expose GET /models, keep using /model use PROFILE MODEL_ID or /model update NAME --model MODEL_ID manually.',
  'cmd.model.models.source': 'Source: {source}{status}',
  'cmd.model.models.fetchedAt': 'Fetched at: {fetchedAt}',
  'cmd.model.models.cache': 'Cache: {cachePath}',
  'cmd.model.models.currentDefault': 'Current default model: {model}',
  'cmd.model.models.modelsCount': 'Models ({count}):',
  'cmd.model.models.more':
    '  ... {count} more; rerun with provider console if you need the full list.',
  'cmd.model.models.useWithoutChanging': 'Use without changing settings:',
  'cmd.model.models.persistDefault': 'Persist as this profile default:',
  'cmd.model.test.gatewayBlock':
    'Gateway/WAF block: the chat endpoint returned an HTML/block page, not a model response. This is usually proxy or gateway policy, not a Mossen credential rewrite.',
  'cmd.model.test.gatewayBlockCheck':
    'Check the proxy/WAF allow rules for POST /chat/completions, streaming responses, and the configured upstream key.',
  'cmd.model.test.modelUnsupported':
    'Model unsupported: the chat endpoint rejected model {model}.',
  'cmd.model.test.modelUnsupportedModels':
    'Try /model models {name} --refresh if this provider exposes a model list.',
  'cmd.model.test.modelUnsupportedManual':
    'Or switch manually: /model use {name} MODEL_ID --persist',
  'cmd.model.test.payloadRejected':
    'Payload rejected: the endpoint is reachable, but the provider/proxy rejected the chat request body.',
  'cmd.model.test.payloadRejectedCheck':
    'Check model id, tool/stream support, max token limits, and proxy payload rewrite rules.',
  'cmd.model.test.providerServerError':
    'Provider/gateway server error: retry later or inspect proxy upstream logs if this persists.',
  'api.provider.error.gatewayBlock':
    'API Error: {name} gateway/WAF blocked the request (HTTP {status}) · baseURL={baseUrl} · This is not necessarily a credential failure; check proxy/WAF allow rules for POST /chat/completions and streaming responses. · Provider message: {detail}',
  'api.provider.error.unsupportedModel':
    'API Error: {name} rejected model {model} (HTTP {status}) · The endpoint is reachable, but this model may not exist or may not be enabled for the key. Run /model test <profile> and /model models <profile> --refresh if supported. · Provider message: {detail}',
  'api.provider.error.server':
    'API Error: {name} provider/gateway returned HTTP {status} · Retry later or inspect proxy upstream logs if this persists. · Provider message: {detail}',
  'api.provider.error.payloadRejected':
    'API Error: {name} rejected the request payload (HTTP {status}) · Check model id, tool/stream support, max token limits, and proxy payload rewrite rules. · Provider message: {detail}',
  'api.provider.error.client':
    'API Error: {name} provider returned HTTP {status} · Check baseURL, model id, provider protocol, and proxy routing. · Provider message: {detail}',
  'cmd.output-style.description':
    'Deprecated: use /config to change output style',
  'cmd.privacy-settings.description':
    'View privacy and data controls for the current backend',
  'cmd.proactive.description': 'Toggle proactive autonomous mode',
  'cmd.project.description':
    'Manage project storage (purge sessions, preserve memory)',
  'cmd.rate-limit-options.description':
    'Show options when rate limit is reached',
  'cmd.release-notes.description': 'View release notes',
  'cmd.remote-env.description':
    'Configure the default remote environment for teleport sessions',
  'cmd.review.description': 'Review a pull request',
  'cmd.session.description': 'Show remote session URL and QR code',
  'cmd.tag.description': 'Toggle a searchable tag on the current session',
  'cmd.thinkback-play.description': 'Play the thinkback animation',
  'cmd.mobile.description': 'Show QR code to download the mobile app',
  'cmd.pr-comments.description': 'Get comments from a GitHub pull request',
  'cmd.pr-comments.progress': 'fetching PR comments',
  'cmd.chrome.installExtension.label': 'Install Chrome extension',
  'cmd.copy.fullResponse.label': 'Full response',
  'cmd.copy.alwaysFull.label': 'Always copy full response',
  'cmd.copy.alwaysFull.description':
    'Skip this picker in the future (revert via /config)',
  'cmd.thinkback.menu.play.label': 'Play animation',
  'cmd.thinkback.menu.play.description': 'Watch your year in review',
  'cmd.thinkback.menu.edit.label': 'Edit content',
  'cmd.thinkback.menu.edit.description': 'Modify the animation',
  'cmd.thinkback.menu.fix.label': 'Fix errors',
  'cmd.thinkback.menu.fix.description':
    'Fix validation or rendering issues',
  'cmd.thinkback.menu.regenerate.label': 'Regenerate',
  'cmd.thinkback.menu.regenerate.description':
    'Create a new animation from scratch',
  'cmd.thinkback.menu.start.label': "Let's go!",
  'cmd.thinkback.menu.start.description':
    'Generate your personalized animation',

  // --- ui.* — generic UI surfaces ---
  // Subsequent slices (S4A) will append goodbye / interrupted / welcome.fallback keys.
  'ui.welcome.title': 'Welcome to {product}',
  'ui.status.version': 'Version',
  'ui.status.sessionName': 'Session name',
  'ui.status.sessionId': 'Session ID',
  'ui.stats.shots.one': '1-shot',
  'ui.stats.shots.twoToFive': '2–5 shot',
  'ui.stats.shots.sixToTen': '6–10 shot',
  'ui.stats.shots.elevenPlus': '11+ shot',
  'ui.bypassPermissions.noExit': 'No, exit',
  'ui.bypassPermissions.yesAccept': 'Yes, I accept',
  'ui.idleReturn.continue': 'Continue this conversation',
  'ui.idleReturn.newConversation': 'Send message as a new conversation',
  'ui.idleReturn.dontAskAgain': "Don't ask me again",
  'ui.channelDowngrade.allowDowngrade':
    'Allow possible downgrade to stable version',
  'ui.invalidConfig.chooseOption': 'Choose an option:',
  'ui.invalidConfig.exitFixManually': 'Exit and fix manually',
  'ui.invalidConfig.resetDefault': 'Reset with default configuration',
  'ui.externalIncludes.allow': 'Yes, allow external imports',
  'ui.externalIncludes.disable': 'No, disable external imports',
  'ui.teleport.validating': 'Validating session',
  'ui.teleport.fetchingLogs': 'Fetching session logs',
  'ui.teleport.fetchingBranch': 'Getting branch info',
  'ui.teleport.checkingOut': 'Checking out branch',
  'ui.mcp.scope.project': 'Project MCPs',
  'ui.mcp.scope.user': 'User MCPs',
  'ui.mcp.scope.local': 'Local MCPs',
  'ui.mcp.scope.enterprise': 'Enterprise MCPs',
  'ui.mcp.scope.dynamic': 'Built-in MCPs',
  'ui.mcp.scope.alwaysAvailable': 'always available',
  'ui.memory.openAutoMemoryFolder': 'Open auto-memory folder',
  'ui.memory.openTeamMemoryFolder': 'Open team memory folder',
  'ui.worktreeExit.removeDirtyDescription':
    'All changes and commits will be lost.',
  'ui.worktreeExit.removeCleanDescription':
    'Clean up the worktree directory.',
  'ui.worktreeExit.keepWorktreeAndTmux':
    'Keep worktree and tmux session',
  'ui.worktreeExit.keepWorktreeAndTmuxDescription':
    'Stays at {path}. Reattach with: tmux attach -t {tmux}',
  'ui.worktreeExit.keepWorktreeKillTmux':
    'Keep worktree, kill tmux session',
  'ui.worktreeExit.keepWorktreeKillTmuxDescription':
    'Keeps worktree at {path}, terminates tmux session.',
  'ui.worktreeExit.removeWorktreeAndTmux':
    'Remove worktree and tmux session',
  'ui.worktreeExit.keepWorktree': 'Keep worktree',
  'ui.worktreeExit.keepWorktreeDescription': 'Stays at {path}',
  'ui.worktreeExit.removeWorktree': 'Remove worktree',
  'ui.agent.location.project': 'Project (.mossen/agents/)',
  'ui.agent.location.personal': 'Personal (~/.mossen/agents/)',
  'ui.githubWorkflow.updateLatest':
    'Update workflow file with latest version',
  'ui.githubWorkflow.skipUpdate':
    'Skip workflow update (configure secrets only)',
  'ui.githubWorkflow.exitNoChanges': 'Exit without making changes',
  'ui.permission.yes': 'Yes',
  'ui.permission.no': 'No',
  'ui.permission.acceptFeedbackPlaceholder':
    'and tell the assistant what to do next',
  'ui.permission.rejectFeedbackPlaceholder':
    'and tell the assistant what to do differently',
  'ui.permission.yesDontAskAgainFor':
    'Yes, and don’t ask again for',
  'ui.permission.bashCommandPrefixPlaceholder':
    'command prefix (e.g., npm run:*)',
  'ui.permission.powerShellCommandPrefixPlaceholder':
    'command prefix (e.g., Get-Process:*)',
  'ui.permission.describeAllowPlaceholder': 'describe what to allow...',
  'ui.computerUse.openAccessibility':
    'Open System Settings → Accessibility',
  'ui.computerUse.openScreenRecording':
    'Open System Settings → Screen Recording',
  'ui.computerUse.tryAgain': 'Try again',
  'ctx.observability.worktree': 'Worktree',
  'ctx.observability.originalCwd': 'Original cwd',
  'ctx.observability.originalBranch': 'Original branch',
  'ctx.observability.autoCompact': 'Auto-compact',
  'ctx.observability.autoCompact.enabled':
    'Enabled @ {percent}% context used ({tokens})',
  'ctx.observability.autoCompact.disabled': 'Disabled',
  'ctx.observability.recentCompact': 'Recent compact',
  'ctx.observability.recentCompact.messagesSince':
    '{count} messages since last compact',
  'ctx.observability.recentCompact.none':
    'No compact boundary in this session',
  'ctx.observability.memorySources': 'Memory sources',

  // --- ui.taskSummary.* / ui.task.blockedByLabel — TaskListV2 文案 (S3) ---
  // 仅展示层；不影响 task.status 字段值或状态机。
  'ui.taskSummary.tasks': 'tasks',
  'ui.taskSummary.done': 'done',
  'ui.taskSummary.inProgress': 'in progress',
  'ui.taskSummary.open': 'open',
  'ui.taskSummary.pending': 'pending',
  'ui.taskSummary.completed': 'completed',
  'ui.task.blockedByLabel': 'blocked by',

  // --- ui.taskActivity.* — describeTeammateActivity 返回值 (S3 续) ---
  // 仅 UI 展示用途；callers 不做 enum 等值比较 (已 grep 确认)。
  'ui.taskActivity.stopping': 'stopping',
  'ui.taskActivity.awaitingApproval': 'awaiting approval',
  'ui.taskActivity.idle': 'idle',
  'ui.taskActivity.working': 'working',

  // --- lang.* — /lang command + 语言偏好 (S4A) ---
  // lang.switched.message 在 lang.tsx 中通过 t(key, _, langOverride) 强制按
  // 用户选择的目标语言渲染，不依赖 set→get 同步性。
  'lang.cleared.message':
    'Interface language preference cleared. Runtime UI now follows your recent conversation or system language.',
  'lang.current.label': 'Current interface language: {language}',
  'lang.preference.label': 'Preference: {preference}',
  'lang.preference.auto': 'Auto',
  'lang.usage.line': 'Usage: /lang [zh|中文|en|english|auto]',
  'lang.usage.shortcut':
    'Shortcut: /lang toggle switches between Chinese and English UI.',
  'lang.usage.note':
    'Note: /lang changes UI text only. Assistant replies follow the conversation unless you set a response language in /config.',
  'lang.switched.message':
    'Interface language switched to English. Assistant replies still follow the conversation language.',

  // --- ui.exit.* / ui.interrupted.* — Exit + Interrupted 提示 (S4B) ---
  'ui.exit.goodbye1': 'Goodbye!',
  'ui.exit.goodbye2': 'See ya!',
  'ui.exit.goodbye3': 'Bye!',
  'ui.exit.goodbye4': 'Catch you later!',
  'ui.interrupted.label': 'Interrupted ',
  'ui.interrupted.hint': 'What should {product} do instead?',

  // --- ui.compact.* — CompactSummary (S4C) ---
  'ui.compact.summarizedTitle': 'Summarized conversation',
  'ui.compact.summarizedDetailUpTo':
    'Summarized {count} messages up to this point',
  'ui.compact.summarizedDetailFrom':
    'Summarized {count} messages from this point',
  'ui.compact.contextLabel': 'Context: ',
  'ui.compact.summaryTitle': 'Compact summary',
  'ui.compact.expandHistoryHint': 'expand history',
  'ui.compact.expandHint': 'expand',

  // --- ui.plugin.dependencies.* — plugin enable/disable dependency enforcement ---
  'ui.plugin.dependencies.disableBlocked':
    'Cannot disable "{plugin}" because enabled plugin(s) depend on it: {dependents}. Disable those plugins first.',
  'ui.plugin.dependencies.enableMissing':
    'Cannot enable "{plugin}" because dependency "{dependency}" required by "{requiredBy}" is not installed or loaded.',
  'ui.plugin.dependencies.enableCycle':
    'Cannot enable "{plugin}" because a plugin dependency cycle was detected: {chain}.',
  'ui.plugin.dependencies.enableBlockedByPolicy':
    'Cannot enable "{plugin}" because dependency "{dependency}" is blocked by policy.',
  'ui.plugin.dependencies.enabledSuffix':
    '; also enabled dependencies: {dependencies}',

  // W418 S2 — memory-sidecar capture toast
  'ui.memory.toast.captured.prefix': 'Remembered',
  'ui.memory.toast.captured.batch': '+{extra} more',
  'ui.memory.toast.captured.hint': '/memory-sidecar to manage',
  'ui.memory.toast.captured.manualPrefix': 'Saved',
  // W418 S4 — memory-sidecar recall citation footnote
  'ui.memory.recallCitation.header': 'Recalled {count} from memory',
  'ui.memory.recallCitation.more': '... and {extra} more',
  // W418 S3 — /remember slash command
  'cmd.remember.description':
    'Write a memory entry directly (bypass automatic capture filters)',
  'cmd.remember.usage': 'Usage: /remember <text to memorize>',
  'cmd.remember.empty': 'Nothing to remember — pass the text after /remember.',
  'cmd.remember.disabled': 'Memory sidecar is disabled; enable it first.',
  'cmd.remember.failed': 'Failed to save: {reason}',
  'cmd.remember.success': 'Saved to project memory.',
  // W419 — /undo command
  'cmd.undo.description': 'Undo the most-recent memory capture',
  'cmd.undo.nothing': 'Nothing recent to undo.',
  'cmd.undo.success': 'Removed: {id}',
  'cmd.undo.notFound':
    'Entry already gone — it may have been deleted from /memory-sidecar.',
  'cmd.undo.disabled': 'Memory sidecar is disabled.',
  'cmd.undo.failed': 'Undo failed: {reason}',
  'ui.memory.undoToast.removed': 'Undone',
  'ui.memory.toast.captured.undoHint': '/undo to remove',
  // W433 — /memory-export
  'cmd.memory-export.description':
    'Export memory entries to a markdown/JSON file in cwd',
  'cmd.memory-export.usageInvalid':
    'Unknown format. Use: /memory-export [markdown|json]',
  'cmd.memory-export.writing': 'Writing memory export…',
  'cmd.memory-export.success': 'Exported {count} entries to {path}',
  'cmd.memory-export.empty':
    'No memory entries to export (sidecar may be empty or recently created).',
  'cmd.memory-export.disabled': 'Memory sidecar is disabled.',
  'cmd.memory-export.failed': 'Export failed: {reason}',
  // W432 — /memory-review
  'cmd.memory-review.description':
    'List the oldest archive memory entries to consider cleaning up',
  'cmd.memory-review.pending': 'Scanning archive…',
  'cmd.memory-review.empty':
    'No archive entries found (sidecar may be empty or recently created).',
  'cmd.memory-review.disabled': 'Memory sidecar is disabled.',
  'cmd.memory-review.failed': 'Review failed: {reason}',
  'cmd.memory-review.heading': 'Top {count} oldest archive entries (createdAt asc)',
  'cmd.memory-review.footer':
    'To remove one: /memory-sidecar memory delete archive <id> --dry-run',
  // W431 — scope meaning labels for capture toast and any future
  // scope-aware UI
  'ui.memory.scope.session': 'session · only this conversation',
  'ui.memory.scope.project': 'project · only this project',
  'ui.memory.scope.workspace': 'workspace · this workspace',
  'ui.memory.scope.user': 'user · across all projects (private)',
  'ui.memory.scope.team': 'team · shared with team',
  // W419b — /forget <id-prefix>
  'cmd.forget.description':
    'Delete an archive memory entry by id-prefix (use /memory-review to find ids)',
  'cmd.forget.usage': 'Usage: /forget <archive-event-id-prefix>',
  'cmd.forget.tooShort':
    'Prefix too short (need at least 4 characters, e.g. evt_a3f0).',
  'cmd.forget.noMatch': 'No archive entry matches prefix: {prefix}',
  'cmd.forget.multipleMatches':
    'Found {count} candidates. Type a longer prefix to disambiguate:',
  'cmd.forget.tooManyMatches':
    '{count} entries start with that prefix — too many; type a longer one.',
  'cmd.forget.success': 'Removed: {id}',
  'cmd.forget.disabled': 'Memory sidecar is disabled.',
  'cmd.forget.failed': 'Forget failed: {reason}',
} as const
