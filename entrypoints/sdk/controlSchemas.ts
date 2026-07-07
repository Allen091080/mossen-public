/**
 * SDK Control Schemas - Zod schemas for the control protocol.
 *
 * These schemas define the control protocol between SDK implementations and the CLI.
 * Used by SDK builders (e.g., Python SDK) to communicate with the CLI process.
 *
 * SDK consumers should use coreSchemas.ts instead.
 */

import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  AccountInfoSchema,
  AgentDefinitionSchema,
  AgentInfoSchema,
  FastModeStateSchema,
  HookEventSchema,
  HookInputSchema,
  McpServerConfigForProcessTransportSchema,
  McpServerStatusSchema,
  ModelInfoSchema,
  PermissionModeSchema,
  PermissionUpdateSchema,
  SDKMessageSchema,
  SDKPostTurnSummaryMessageSchema,
  SDKStreamlinedTextMessageSchema,
  SDKStreamlinedToolUseSummaryMessageSchema,
  SDKUserMessageSchema,
  SlashCommandSchema,
} from './coreSchemas.js'

// ============================================================================
// External Type Placeholders
// ============================================================================

// JSONRPCMessage from @modelcontextprotocol/sdk - treat as unknown
export const JSONRPCMessagePlaceholder = lazySchema(() => z.unknown())

// ============================================================================
// Hook Callback Types
// ============================================================================

export const SDKHookCallbackMatcherSchema = lazySchema(() =>
  z
    .object({
      matcher: z.string().optional(),
      hookCallbackIds: z.array(z.string()),
      timeout: z.number().optional(),
    })
    .describe('Configuration for matching and routing hook callbacks.'),
)

// ============================================================================
// Control Request Types
// ============================================================================

export const SDKControlInitializeRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('initialize'),
      hooks: z
        .record(HookEventSchema(), z.array(SDKHookCallbackMatcherSchema()))
        .optional(),
      sdkMcpServers: z.array(z.string()).optional(),
      jsonSchema: z.record(z.string(), z.unknown()).optional(),
      systemPrompt: z.string().optional(),
      appendSystemPrompt: z.string().optional(),
      agents: z.record(z.string(), AgentDefinitionSchema()).optional(),
      promptSuggestions: z.boolean().optional(),
      agentProgressSummaries: z.boolean().optional(),
      desktopCapabilities: z
        .object({
          supportsImagePreview: z.boolean().optional(),
          supportsOpenFile: z.boolean().optional(),
          supportsTerminalSequences: z.boolean().optional(),
        })
        .optional(),
    })
    .describe(
      'Initializes the SDK session with hooks, MCP servers, and agent configuration.',
    ),
)

export const SDKControlInitializeResponseSchema = lazySchema(() =>
  z
    .object({
      commands: z.array(SlashCommandSchema()),
      agents: z.array(AgentInfoSchema()),
      output_style: z.string(),
      available_output_styles: z.array(z.string()),
      models: z.array(ModelInfoSchema()),
      account: AccountInfoSchema(),
      pid: z
        .number()
        .optional()
        .describe('@internal CLI process PID for tmux socket isolation'),
      fast_mode_state: FastModeStateSchema().optional(),
      desktopSdk: z
        .object({
          version: z.literal(1),
          cwd: z.string(),
          model: z.string().nullable(),
          providerProtocol: z.string().nullable(),
          permissionPromptTool: z.string().nullable(),
          searchBackend: z.enum([
            'vendor-rg',
            'system-rg',
            'embedded-rg',
            'js-fallback',
          ]),
          memorySidecar: z.object({
            enabled: z.boolean(),
          }),
          mcp: z.object({
            summary: z.object({
              enterprise: z.number(),
              user: z.number(),
              project: z.number(),
              local: z.number(),
              errors: z.number(),
              pluginOnly: z.boolean(),
              managedOnly: z.boolean(),
            }),
          }),
          plugin: z.object({
            summary: z.object({
              enabled: z.number(),
              disabled: z.number(),
              errors: z.number(),
            }),
          }),
          i18n: z.object({
            locale: z.enum(['en', 'zh']),
          }),
          desktop: z.object({
            acceptedCapabilities: z.object({
              supportsImagePreview: z.boolean().optional(),
              supportsOpenFile: z.boolean().optional(),
              supportsTerminalSequences: z.boolean().optional(),
            }),
          }),
        })
        .optional(),
    })
    .describe(
      'Response from session initialization with available commands, models, and account info.',
    ),
)

export const SDKControlInterruptRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('interrupt'),
    })
    .describe('Interrupts the currently running conversation turn.'),
)

export const SDKControlToolCancelRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('tool_cancel'),
      tool_use_id: z
        .string()
        .describe(
          'Tool block id (`tool_use.id`) the SDK consumer wants to abort. Resolved against the in-flight tool registry; sibling tools in the same turn keep running.',
        ),
      reason: z
        .string()
        .optional()
        .describe(
          'Free-form reason surfaced as the abort signal reason; used for analytics / debugging. Does not affect cancellation semantics.',
        ),
    })
    .describe(
      'Cancels a single in-flight tool execution by its tool_use_id without ending the turn. Returns {cancelled} indicating whether the registry found a live controller for that id.',
    ),
)


export const SDKControlPermissionRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('can_use_tool'),
      tool_name: z.string(),
      input: z.record(z.string(), z.unknown()),
      permission_suggestions: z.array(PermissionUpdateSchema()).optional(),
      blocked_path: z.string().optional(),
      decision_reason: z.string().optional(),
      title: z.string().optional(),
      display_name: z.string().optional(),
      tool_use_id: z.string(),
      agent_id: z.string().optional(),
      description: z.string().optional(),
    })
    .describe('Requests permission to use a tool with the given input.'),
)

export const SDKControlSetPermissionModeRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_permission_mode'),
      mode: PermissionModeSchema(),
      ultraplan: z
        .boolean()
        .optional()
        .describe('@internal CCR ultraplan session marker.'),
    })
    .describe('Sets the permission mode for tool execution handling.'),
)

export const SDKControlSetModelRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_model'),
      model: z.string().optional(),
    })
    .describe('Sets the model to use for subsequent conversation turns.'),
)

export const SDKControlSetMaxThinkingTokensRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('set_max_thinking_tokens'),
      max_thinking_tokens: z.number().nullable(),
    })
    .describe(
      'Sets the maximum number of thinking tokens for extended thinking.',
    ),
)

export const SDKControlMcpStatusRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_status'),
    })
    .describe('Requests the current status of all MCP server connections.'),
)

export const SDKControlMcpStatusResponseSchema = lazySchema(() =>
  z
    .object({
      mcpServers: z.array(McpServerStatusSchema()),
    })
    .describe(
      'Response containing the current status of all MCP server connections.',
    ),
)

export const SDKControlGetContextUsageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_context_usage'),
    })
    .describe(
      'Requests a breakdown of current context window usage by category.',
    ),
)

const ContextCategorySchema = lazySchema(() =>
  z.object({
    name: z.string(),
    tokens: z.number(),
    color: z.string(),
    isDeferred: z.boolean().optional(),
  }),
)

const ContextGridSquareSchema = lazySchema(() =>
  z.object({
    color: z.string(),
    isFilled: z.boolean(),
    categoryName: z.string(),
    tokens: z.number(),
    percentage: z.number(),
    squareFullness: z.number(),
  }),
)

export const SDKControlGetContextUsageResponseSchema = lazySchema(() =>
  z
    .object({
      categories: z.array(ContextCategorySchema()),
      totalTokens: z.number(),
      maxTokens: z.number(),
      rawMaxTokens: z.number(),
      percentage: z.number(),
      gridRows: z.array(z.array(ContextGridSquareSchema())),
      model: z.string(),
      memoryFiles: z.array(
        z.object({
          path: z.string(),
          type: z.string(),
          tokens: z.number(),
        }),
      ),
      mcpTools: z.array(
        z.object({
          name: z.string(),
          serverName: z.string(),
          tokens: z.number(),
          isLoaded: z.boolean().optional(),
        }),
      ),
      deferredBuiltinTools: z
        .array(
          z.object({
            name: z.string(),
            tokens: z.number(),
            isLoaded: z.boolean(),
          }),
        )
        .optional(),
      systemTools: z
        .array(z.object({ name: z.string(), tokens: z.number() }))
        .optional(),
      systemPromptSections: z
        .array(z.object({ name: z.string(), tokens: z.number() }))
        .optional(),
      agents: z.array(
        z.object({
          agentType: z.string(),
          source: z.string(),
          tokens: z.number(),
        }),
      ),
      slashCommands: z
        .object({
          totalCommands: z.number(),
          includedCommands: z.number(),
          tokens: z.number(),
        })
        .optional(),
      skills: z
        .object({
          totalSkills: z.number(),
          includedSkills: z.number(),
          tokens: z.number(),
          skillFrontmatter: z.array(
            z.object({
              name: z.string(),
              source: z.string(),
              tokens: z.number(),
            }),
          ),
        })
        .optional(),
      autoCompactThreshold: z.number().optional(),
      isAutoCompactEnabled: z.boolean(),
      messageBreakdown: z
        .object({
          toolCallTokens: z.number(),
          toolResultTokens: z.number(),
          attachmentTokens: z.number(),
          assistantMessageTokens: z.number(),
          userMessageTokens: z.number(),
          toolCallsByType: z.array(
            z.object({
              name: z.string(),
              callTokens: z.number(),
              resultTokens: z.number(),
            }),
          ),
          attachmentsByType: z.array(
            z.object({ name: z.string(), tokens: z.number() }),
          ),
        })
        .optional(),
      apiUsage: z
        .object({
          input_tokens: z.number(),
          output_tokens: z.number(),
          cache_creation_input_tokens: z.number(),
          cache_read_input_tokens: z.number(),
        })
        .nullable(),
    })
    .describe(
      'Breakdown of current context window usage by category (system prompt, tools, messages, etc.).',
    ),
)

export const SDKControlRewindFilesRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('rewind_files'),
      user_message_id: z.string(),
      dry_run: z.boolean().optional(),
    })
    .describe('Rewinds file changes made since a specific user message.'),
)

export const SDKControlRewindFilesResponseSchema = lazySchema(() =>
  z
    .object({
      canRewind: z.boolean(),
      error: z.string().optional(),
      filesChanged: z.array(z.string()).optional(),
      insertions: z.number().optional(),
      deletions: z.number().optional(),
    })
    .describe('Result of a rewindFiles operation.'),
)

export const SDKControlCancelAsyncMessageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('cancel_async_message'),
      message_uuid: z.string(),
    })
    .describe(
      'Drops a pending async user message from the command queue by uuid. No-op if already dequeued for execution.',
    ),
)

export const SDKControlCancelAsyncMessageResponseSchema = lazySchema(() =>
  z
    .object({
      cancelled: z.boolean(),
    })
    .describe(
      'Result of a cancel_async_message operation. cancelled=false means the message was not in the queue (already dequeued or never enqueued).',
    ),
)

export const SDKControlSeedReadStateRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('seed_read_state'),
      path: z.string(),
      mtime: z.number(),
    })
    .describe(
      'Seeds the readFileState cache with a path+mtime entry. Use when a prior Read was removed from context (e.g. by snip) so Edit validation would fail despite the client having observed the Read. The mtime lets the CLI detect if the file changed since the seeded Read — same staleness check as the normal path.',
    ),
)

export const SDKHookCallbackRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('hook_callback'),
      callback_id: z.string(),
      input: HookInputSchema(),
      tool_use_id: z.string().optional(),
    })
    .describe('Delivers a hook callback with its input data.'),
)

export const SDKControlMcpMessageRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_message'),
      server_name: z.string(),
      message: JSONRPCMessagePlaceholder(),
    })
    .describe('Sends a JSON-RPC message to a specific MCP server.'),
)

export const SDKControlMcpSetServersRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_set_servers'),
      servers: z.record(z.string(), McpServerConfigForProcessTransportSchema()),
    })
    .describe('Replaces the set of dynamically managed MCP servers.'),
)

export const SDKControlMcpSetServersResponseSchema = lazySchema(() =>
  z
    .object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      errors: z.record(z.string(), z.string()),
    })
    .describe(
      'Result of replacing the set of dynamically managed MCP servers.',
    ),
)

export const SDKControlReloadPluginsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('reload_plugins'),
    })
    .describe(
      'Reloads plugins from disk and returns the refreshed session components.',
    ),
)

export const SDKControlReloadPluginsResponseSchema = lazySchema(() =>
  z
    .object({
      commands: z.array(SlashCommandSchema()),
      agents: z.array(AgentInfoSchema()),
      plugins: z.array(
        z.object({
          name: z.string(),
          path: z.string(),
          source: z.string().optional(),
        }),
      ),
      mcpServers: z.array(McpServerStatusSchema()),
      error_count: z.number(),
    })
    .describe(
      'Refreshed commands, agents, plugins, and MCP server status after reload.',
    ),
)

export const SDKControlReloadSkillsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('reload_skills'),
      changed_paths: z
        .array(z.string())
        .optional()
        .describe(
          'Optional paths changed by the SDK client. Used for ConfigChange hook attribution; the reload still refreshes all skill/command caches.',
        ),
    })
    .describe(
      'Reloads skills and slash-command caches for the already-running process without reloading plugins or restarting Mossen.',
    ),
)

export const SDKControlReloadSkillsResponseSchema = lazySchema(() =>
  z
    .object({
      status: z.enum(['reloaded', 'blocked']),
      changedPaths: z.array(z.string()),
      commands: z.array(SlashCommandSchema()),
      skills: z.array(SlashCommandSchema()),
      reason: z.string().optional(),
    })
    .describe(
      'Refreshed commands and skill-like slash commands after an explicit skill reload.',
    ),
)

export const SDKControlMcpReconnectRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_reconnect'),
      serverName: z.string(),
    })
    .describe('Reconnects a disconnected or failed MCP server.'),
)

export const SDKControlMcpToggleRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('mcp_toggle'),
      serverName: z.string(),
      enabled: z.boolean(),
    })
    .describe('Enables or disables an MCP server.'),
)


export const SDKControlStopTaskRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('stop_task'),
      task_id: z.string(),
    })
    .describe('Stops a running task.'),
)

export const SDKControlApplyFlagSettingsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('apply_flag_settings'),
      settings: z.record(z.string(), z.unknown()),
    })
    .describe(
      'Merges the provided settings into the flag settings layer, updating the active configuration.',
    ),
)

export const SDKControlGetSettingsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_settings'),
    })
    .describe(
      'Returns the effective merged settings and the raw per-source settings.',
    ),
)

export const SDKControlGetSettingsResponseSchema = lazySchema(() =>
  z
    .object({
      effective: z.record(z.string(), z.unknown()),
      sources: z
        .array(
          z.object({
            source: z.enum([
              'userSettings',
              'projectSettings',
              'localSettings',
              'flagSettings',
              'policySettings',
            ]),
            settings: z.record(z.string(), z.unknown()),
          }),
        )
        .describe(
          'Ordered low-to-high priority — later entries override earlier ones.',
        ),
      applied: z
        .object({
          model: z.string(),
          // String levels only — numeric effort is internal-only and the
          // Zod→proto generator can't emit enum∪number unions.
          effort: z.enum(['low', 'medium', 'high', 'max']).nullable(),
        })
        .optional()
        .describe(
          'Runtime-resolved values after env overrides, session state, and model-specific defaults are applied. Unlike `effective` (disk merge), these reflect what will actually be sent to the API.',
        ),
    })
    .describe(
      'Effective merged settings plus raw per-source settings in merge order.',
    ),
)

export const SDKControlElicitationRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('elicitation'),
      mcp_server_name: z.string(),
      message: z.string(),
      mode: z.enum(['form', 'url']).optional(),
      url: z.string().optional(),
      elicitation_id: z.string().optional(),
      requested_schema: z.record(z.string(), z.unknown()).optional(),
    })
    .describe(
      'Requests the SDK consumer to handle an MCP elicitation (user input request).',
    ),
)

export const SDKControlElicitationResponseSchema = lazySchema(() =>
  z
    .object({
      action: z.enum(['accept', 'decline', 'cancel']),
      content: z.record(z.string(), z.unknown()).optional(),
    })
    .describe('Response from the SDK consumer for an elicitation request.'),
)

export const SDKControlSlashCommandRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('slash_command'),
      command: z.string(),
      args: z.array(z.string()).optional(),
    })
    .describe(
      'Triggers a structured slash command from a stream-json client. Wires curated commands (`help`, `capabilities`, `status`, `model`, `clear`, `cost`, `skills`, `mcp`, `plugin`, `agents`); unsupported commands return an unsupported_slash_command error string.',
    ),
)

export const SDKControlWorkflowControlActionIdSchema = lazySchema(() =>
  z.enum([
    'workflow.run.pause',
    'workflow.run.stop',
    'workflow.run.stopAgent',
    'workflow.run.retryAgent',
  ]),
)

export const SDKControlWorkflowControlRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('workflow_control'),
      action_id: SDKControlWorkflowControlActionIdSchema(),
      run_id: z.string(),
      agent_number: z.number().int().positive().optional(),
      expected_session_id: z.string().optional(),
      source: z.enum(['workbench', 'cli', 'system']).optional(),
    })
    .describe(
      'Executes a typed Workbench workflow control against the live stream-json process. This is narrower than slash_command and only supports run/agent controls owned by the current process.',
    ),
)

// ============================================================================
// W46 — High-Value Dedicated Control Protocols
// ============================================================================

export const SDKControlCompactConversationRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('compact_conversation'),
      mode: z.enum(['manual']).optional(),
      dry_run: z.boolean().optional(),
      custom_instructions: z
        .string()
        .optional()
        .describe(
          'Optional user-supplied instructions for the compact summary. Passed through to compactConversation as customInstructions when the request executes at the query loop safe point.',
        ),
    })
    .describe(
      'Dedicated channel for triggering conversation compaction. W48: the control_request handler validates the request and enqueues it into a pending buffer, returning status "queued" or "blocked". Real compaction executes at the next query loop safe point (holding the real ToolUseContext + CacheSafeParams). The handler never calls compactConversation directly.',
    ),
)

export const SDKControlCompactConversationResponseSchema = lazySchema(() =>
  z
    .object({
      status: z.enum(['queued', 'blocked', 'completed', 'failed']),
      reason: z.string().optional(),
      summary: z.string().optional(),
      truncatedMessageCount: z.number().optional(),
    })
    .describe(
      'Result of a compact_conversation request. status="queued" means the request is enqueued and will execute at the next query loop safe point. status="blocked" means the request was rejected (duplicate pending, unsupported mode, etc). Completion or failure is emitted later as a compact_completed SDK event.',
    ),
)

export const SDKControlGetConfigSummaryRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_config_summary'),
    })
    .describe(
      'Returns a redacted summary of effective settings: per-source key counts, source enablement, and global flags. Never echoes raw values to avoid leaking API keys, URLs, or other secrets. Clients that need full settings must use get_settings and apply their own redaction.',
    ),
)

export const SDKControlGetConfigSummaryResponseSchema = lazySchema(() =>
  z
    .object({
      summary: z.string(),
      sources: z.array(
        z.object({
          source: z.string(),
          present: z.boolean(),
          keyCount: z.number(),
          topLevelKeys: z.array(z.string()),
        }),
      ),
      effectiveKeyCount: z.number(),
      effectiveTopLevelKeys: z.array(z.string()),
    })
    .describe(
      'Redacted config summary. Lists which settings sources contributed and which top-level keys exist, but never the values.',
    ),
)

export const SDKControlRuntimeDoctorSummaryRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('runtime_doctor_summary'),
      includeNetworkProbes: z
        .boolean()
        .optional()
        .describe(
          'W177-A: opt-in to timeout-bounded backend reachability and local version checks (off by default). Probes never send credentials or custom auth headers and summaries are redacted.',
        ),
    })
    .describe(
      'Returns a structured set of doctor checks. Without includeNetworkProbes it stays fully in-process; with includeNetworkProbes=true it adds opt-in, timeout-bounded backend reachability checks without credentials. Each check is structured as {id, title, status, severity, summary} and never contains raw error dumps.',
    ),
)

export const SDKControlRuntimeDoctorSummaryResponseSchema = lazySchema(() =>
  z
    .object({
      summary: z.string(),
      checks: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.enum(['ok', 'warn', 'fail', 'unavailable']),
          severity: z.enum(['info', 'warning', 'error']),
          summary: z.string(),
        }),
      ),
    })
    .describe(
      'Structured doctor checks. Each check has a stable id and short summary; clients render their own UI from this list.',
    ),
)

export const SDKControlGitDiffSummaryRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('git_diff_summary'),
      includeUntracked: z.boolean().optional(),
      includePatch: z
        .boolean()
        .optional()
        .describe(
          'W47: when true, include a bounded patch preview (100KB cap, 20 file cap, binary files skipped via numstat). Subprocess timeout is identical to the no-patch path.',
        ),
    })
    .describe(
      'Spawns a bounded `git status --porcelain` and `git diff --shortstat` in the current working directory. Read-only — never writes git state. Returns a file list and aggregate stats. Patch contents are off by default; set includePatch=true for a bounded patch preview. Non-git working directories return status="not_git_repo" without a hard error.',
    ),
)

export const SDKControlGitDiffSummaryResponseSchema = lazySchema(() =>
  z
    .object({
      status: z.enum(['ok', 'not_git_repo', 'unavailable']),
      summary: z.string(),
      cwd: z.string(),
      reason: z.string().optional(),
      files: z
        .array(
          z.object({
            path: z.string(),
            status: z.string(),
            staged: z.boolean(),
          }),
        )
        .optional(),
      stats: z
        .object({
          changedFiles: z.number(),
          insertions: z.number(),
          deletions: z.number(),
        })
        .optional(),
      truncated: z.boolean().optional(),
      patch: z
        .object({
          included: z.boolean(),
          truncated: z.boolean(),
          totalBytes: z.number(),
          fileCount: z.number(),
          binaryFiles: z.array(z.string()),
          skippedFiles: z.array(z.string()),
          text: z.string(),
        })
        .optional()
        .describe(
          'W47: present only when request.includePatch=true. text is bounded to 100KB; binaryFiles list is filled from `git diff --numstat` "-" markers; skippedFiles enumerates files dropped after hitting the 20-file cap.',
        ),
    })
    .describe(
      'Bounded git status/diff summary. files[] is truncated to 200 entries; truncated=true signals the caller to pull patches another way. patch object is only present when request.includePatch=true.',
    ),
)

// ============================================================================
// W47 — Real Capability Operations (mutation-shaped placeholders + discovery)
// ============================================================================

export const SDKControlApplyConfigChangeRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('apply_config_change'),
      source: z
        .enum(['userSettings', 'projectSettings', 'localSettings'])
        .optional(),
      changes: z.record(z.string(), z.unknown()).optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
      confirmToken: z.string().optional(),
    })
    .describe(
      'Dedicated channel for applying a small allowlisted non-secret settings change from a stream-json client. Defaults to preview/dry-run and returns an 8-hex confirmToken. confirm=true with that token applies only if the settings file hash still matches the preview; credential-like keys are rejected.',
    ),
)

export const SDKControlApplyConfigChangeResponseSchema = lazySchema(() =>
  z
    .object({
      status: z.enum(['blocked', 'preview', 'applied', 'failed']),
      reason: z.string().optional(),
      summary: z.string().optional(),
      changedKeys: z.array(z.string()).optional(),
      rejectedKeys: z.array(z.string()).optional(),
      token: z.string().optional(),
      expiresAt: z.string().optional(),
      source: z
        .enum(['userSettings', 'projectSettings', 'localSettings'])
        .optional(),
      backupCreated: z.boolean().optional(),
    })
    .describe(
      'Result of an apply_config_change request. preview returns changedKeys plus token/expiresAt; applied confirms a one-shot token and reports whether a backup was created; failed returns reason/rejectedKeys.',
    ),
)

export const SDKControlGetCapabilityOperationsRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('get_capability_operations'),
    })
    .describe(
      'Returns a routing map of mutation-style operations Workbench may want to execute against plugin/skill/MCP/recommendation systems. Discovery only — never executes anything. Each entry advertises which existing safe control_request subtype carries the operation, whether it is supported in this build, and whether confirmation is required.',
    ),
)

export const SDKControlGetCapabilityOperationsResponseSchema = lazySchema(() =>
  z
    .object({
      summary: z.string(),
      operations: z.array(
        z.object({
          capabilityId: z.string(),
          operation: z.string(),
          status: z.enum(['available', 'blocked', 'unavailable']),
          executor: z.string(),
          requiresConfirmation: z.boolean(),
          dryRunSupported: z.boolean(),
          summary: z.string(),
          reason: z.string().optional(),
        }),
      ),
    })
    .describe(
      'Discovery map of capability operations. The executor field names the existing control_request subtype (or "none" for blocked entries) the client must use to actually execute the operation.',
    ),
)

export const SDKControlProjectMemoryOperationRequestSchema = lazySchema(() =>
  z
    .object({
      subtype: z.literal('project_memory_operation'),
      operation: z
        .enum([
          'preview_init',
          'apply_init',
          'preview_memory_update',
          'apply_memory_update',
        ])
        .optional(),
      path: z.string().optional(),
      content: z.string().optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
      confirmToken: z.string().optional(),
      previousHash: z.string().optional(),
    })
    .describe(
      'Dedicated channel for project-root MOSSEN.md initialization and updates. W177-C supports root MOSSEN.md only: preview_init / preview_memory_update return diff + previousHash + confirmToken; apply_init / apply_memory_update require the one-shot token and unchanged previousHash before writing with backup. .mossen/rules/* remains out of scope.',
    ),
)

export const SDKControlProjectMemoryOperationResponseSchema = lazySchema(() =>
  z
    .object({
      status: z.enum(['blocked', 'preview', 'applied', 'failed']),
      reason: z.string().optional(),
      summary: z.string().optional(),
      wouldCreate: z.array(z.string()).optional(),
      wouldModify: z.array(z.string()).optional(),
      path: z.string().optional(),
      previousHash: z.string().optional(),
      token: z.string().optional(),
      expiresAt: z.string().optional(),
      diff: z.string().optional(),
      diffTruncated: z.boolean().optional(),
      backupCreated: z.boolean().optional(),
    })
    .describe(
      'Result of a project_memory_operation request. preview returns root-relative path, previousHash, diff and confirm token; applied reports backupCreated; failed returns reason.',
    ),
)


// ============================================================================
// Control Request/Response Wrappers
// ============================================================================

export const SDKControlRequestInnerSchema = lazySchema(() =>
  z.union([
    SDKControlInterruptRequestSchema(),
    SDKControlToolCancelRequestSchema(),
    SDKControlPermissionRequestSchema(),
    SDKControlInitializeRequestSchema(),
    SDKControlSetPermissionModeRequestSchema(),
    SDKControlSetModelRequestSchema(),
    SDKControlSetMaxThinkingTokensRequestSchema(),
    SDKControlMcpStatusRequestSchema(),
    SDKControlGetContextUsageRequestSchema(),
    SDKHookCallbackRequestSchema(),
    SDKControlMcpMessageRequestSchema(),
    SDKControlRewindFilesRequestSchema(),
    SDKControlCancelAsyncMessageRequestSchema(),
    SDKControlSeedReadStateRequestSchema(),
    SDKControlMcpSetServersRequestSchema(),
    SDKControlReloadPluginsRequestSchema(),
    SDKControlReloadSkillsRequestSchema(),
    SDKControlMcpReconnectRequestSchema(),
    SDKControlMcpToggleRequestSchema(),
    SDKControlStopTaskRequestSchema(),
    SDKControlApplyFlagSettingsRequestSchema(),
    SDKControlGetSettingsRequestSchema(),
    SDKControlElicitationRequestSchema(),
    SDKControlSlashCommandRequestSchema(),
    SDKControlWorkflowControlRequestSchema(),
    SDKControlCompactConversationRequestSchema(),
    SDKControlGetConfigSummaryRequestSchema(),
    SDKControlRuntimeDoctorSummaryRequestSchema(),
    SDKControlGitDiffSummaryRequestSchema(),
    SDKControlApplyConfigChangeRequestSchema(),
    SDKControlGetCapabilityOperationsRequestSchema(),
    SDKControlProjectMemoryOperationRequestSchema(),
  ]),
)

export const SDKControlRequestSchema = lazySchema(() =>
  z.object({
    type: z.literal('control_request'),
    request_id: z.string(),
    request: SDKControlRequestInnerSchema(),
  }),
)

export const ControlResponseSchema = lazySchema(() =>
  z.object({
    subtype: z.literal('success'),
    request_id: z.string(),
    response: z.record(z.string(), z.unknown()).optional(),
  }),
)

export const ControlErrorResponseSchema = lazySchema(() =>
  z.object({
    subtype: z.literal('error'),
    request_id: z.string(),
    error: z.string(),
    pending_permission_requests: z
      .array(z.lazy(() => SDKControlRequestSchema()))
      .optional(),
  }),
)

export const SDKControlResponseSchema = lazySchema(() =>
  z.object({
    type: z.literal('control_response'),
    response: z.union([ControlResponseSchema(), ControlErrorResponseSchema()]),
  }),
)

export const SDKControlCancelRequestSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('control_cancel_request'),
      request_id: z.string(),
    })
    .describe('Cancels a currently open control request.'),
)

export const SDKKeepAliveMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('keep_alive'),
    })
    .describe('Keep-alive message to maintain WebSocket connection.'),
)

export const SDKUpdateEnvironmentVariablesMessageSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('update_environment_variables'),
      variables: z.record(z.string(), z.string()),
    })
    .describe('Updates environment variables at runtime.'),
)

export const SDKCapabilityRecommendationResponseSchema = lazySchema(() =>
  z
    .object({
      type: z.literal('capability_recommendation_response'),
      recommendation_id: z
        .string()
        .describe('Must match the recommendation_id from the event'),
      choice_id: z
        .string()
        .describe(
          'One of the choice.id values from the recommendation event',
        ),
    })
    .describe(
      'User response to a capability_recommendation event. The CLI/Core handles explicit install, not_now, never_for_capability, and disable_all_recommendations choices.',
    ),
)

// ============================================================================
// Aggregate Message Types
// ============================================================================

export const StdoutMessageSchema = lazySchema(() =>
  z.union([
    SDKMessageSchema(),
    SDKStreamlinedTextMessageSchema(),
    SDKStreamlinedToolUseSummaryMessageSchema(),
    SDKPostTurnSummaryMessageSchema(),
    SDKControlResponseSchema(),
    SDKControlRequestSchema(),
    SDKControlCancelRequestSchema(),
    SDKKeepAliveMessageSchema(),
  ]),
)

export const StdinMessageSchema = lazySchema(() =>
  z.union([
    SDKUserMessageSchema(),
    SDKControlRequestSchema(),
    SDKControlResponseSchema(),
    SDKKeepAliveMessageSchema(),
    SDKUpdateEnvironmentVariablesMessageSchema(),
    SDKCapabilityRecommendationResponseSchema(),
  ]),
)
