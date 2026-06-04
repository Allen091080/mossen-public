import { z } from 'zod/v4'

export const AGENT_SUPERVISOR_SCHEMA_VERSION = 1

export const AGENT_SUPERVISOR_STATUSES = [
  'queued',
  'working',
  'idle',
  'needs_input',
  'completed',
  'failed',
  'stopped',
] as const

export const AgentSupervisorStatusSchema = z.enum(AGENT_SUPERVISOR_STATUSES)
export type AgentSupervisorStatus = z.infer<typeof AgentSupervisorStatusSchema>

export const AgentSupervisorJobIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{2,63}$/)
export type AgentSupervisorJobId = z.infer<typeof AgentSupervisorJobIdSchema>

const NullableIsoStringSchema = z.string().nullable()

export const AgentSupervisorProcessStateSchema = z.object({
  pid: z.number().int().positive().nullable(),
  alive: z.boolean(),
  lastStartedAt: NullableIsoStringSchema,
  lastExitedAt: NullableIsoStringSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  expectedCmdlineSubstring: z.string().nullable(),
})
export type AgentSupervisorProcessState = z.infer<
  typeof AgentSupervisorProcessStateSchema
>

export const AgentSupervisorQuestionOptionSchema = z.object({
  key: z.string().min(1).max(32),
  label: z.string().min(1).max(200),
})
export type AgentSupervisorQuestionOption = z.infer<
  typeof AgentSupervisorQuestionOptionSchema
>

export const AgentSupervisorLastQuestionSchema = z
  .object({
    ts: z.string(),
    fromEventSeq: z.number().int().nonnegative(),
    text: z.string(),
    options: z.array(AgentSupervisorQuestionOptionSchema),
    suggestedReply: z.string().nullable(),
  })
  .nullable()
export type AgentSupervisorLastQuestion = z.infer<
  typeof AgentSupervisorLastQuestionSchema
>

export const AgentSupervisorUiStateSchema = z.object({
  pinned: z.boolean(),
  order: z.number().int(),
  collapsed: z.boolean(),
  renamedTitle: z.string().nullable(),
})
export type AgentSupervisorUiState = z.infer<typeof AgentSupervisorUiStateSchema>

export const AgentSupervisorCountersSchema = z.object({
  inputSeqHigh: z.number().int().nonnegative(),
  controlSeqHigh: z.number().int().nonnegative(),
  eventSeqHigh: z.number().int().nonnegative(),
  outputSeqHigh: z.number().int().nonnegative(),
})
export type AgentSupervisorCounters = z.infer<
  typeof AgentSupervisorCountersSchema
>

export const AgentSupervisorResultArtifactSchema = z.object({
  label: z.string().min(1).max(200),
  path: z.string().min(1).max(1000).optional(),
  url: z.string().min(1).max(2000).optional(),
})
export type AgentSupervisorResultArtifact = z.infer<
  typeof AgentSupervisorResultArtifactSchema
>

export const AgentSupervisorResultPayloadSchema = z.object({
  summary: z.string().min(1).max(2000),
  artifacts: z.array(AgentSupervisorResultArtifactSchema),
  risks: z.array(z.string().min(1).max(500)),
  nextActions: z.array(z.string().min(1).max(500)),
  createdAt: z.string(),
})
export type AgentSupervisorResultPayload = z.infer<
  typeof AgentSupervisorResultPayloadSchema
>

export const AgentSupervisorErrorSchema = z.object({
  ts: z.string(),
  message: z.string(),
  source: z.string().optional(),
})
export type AgentSupervisorError = z.infer<typeof AgentSupervisorErrorSchema>

export const AgentSupervisorJobStateSchema = z.object({
  schemaVersion: z.literal(AGENT_SUPERVISOR_SCHEMA_VERSION),
  id: AgentSupervisorJobIdSchema,
  title: z.string().min(1),
  cwd: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: AgentSupervisorStatusSchema,
  process: AgentSupervisorProcessStateSchema,
  model: z.string().nullable(),
  permissionMode: z.string().nullable(),
  effort: z.string().nullable().optional().default(null),
  agent: z.string().nullable(),
  settings: z.string().nullable().optional().default(null),
  addDirs: z.array(z.string()).optional().default([]),
  mcpConfig: z.array(z.string()).optional().default([]),
  pluginDirs: z.array(z.string()).optional().default([]),
  strictMcpConfig: z.boolean().optional().default(false),
  fallbackModel: z.string().nullable().optional().default(null),
  allowDangerouslySkipPermissions: z.boolean().optional().default(false),
  dangerouslySkipPermissions: z.boolean().optional().default(false),
  sessionId: z.string().nullable(),
  promptPreview: z.string(),
  summary: z.string().nullable(),
  resultPayload: AgentSupervisorResultPayloadSchema.nullable().optional(),
  lastQuestion: AgentSupervisorLastQuestionSchema,
  ui: AgentSupervisorUiStateSchema,
  counters: AgentSupervisorCountersSchema,
  errors: z.array(AgentSupervisorErrorSchema),
})
export type AgentSupervisorJobState = z.infer<
  typeof AgentSupervisorJobStateSchema
>

export const AgentSupervisorRosterJobSchema = z.object({
  id: AgentSupervisorJobIdSchema,
  title: z.string(),
  cwd: z.string(),
  status: AgentSupervisorStatusSchema,
  lastUpdatedAt: z.string(),
  lastSummaryLine: z.string().nullable(),
  pinned: z.boolean(),
  order: z.number().int(),
  collapsed: z.boolean(),
  agent: z.string().nullable(),
  processAlive: z.boolean().optional(),
})
export type AgentSupervisorRosterJob = z.infer<
  typeof AgentSupervisorRosterJobSchema
>

export const AgentSupervisorRosterSchema = z.object({
  schemaVersion: z.literal(AGENT_SUPERVISOR_SCHEMA_VERSION),
  updatedAt: z.string(),
  jobs: z.array(AgentSupervisorRosterJobSchema),
})
export type AgentSupervisorRoster = z.infer<typeof AgentSupervisorRosterSchema>

export const AgentSupervisorTranscriptLinkSchema = z.object({
  schemaVersion: z.literal(AGENT_SUPERVISOR_SCHEMA_VERSION),
  jobId: AgentSupervisorJobIdSchema,
  sessionId: z.string().nullable(),
  transcriptPath: z.string().nullable(),
  sidechainTranscriptPath: z.string().nullable(),
  updatedAt: z.string(),
})
export type AgentSupervisorTranscriptLink = z.infer<
  typeof AgentSupervisorTranscriptLinkSchema
>

export const AgentSupervisorWorktreeCleanupStateSchema = z.enum([
  'none',
  'eligible',
  'blocked_dirty',
  'cleaned',
])
export type AgentSupervisorWorktreeCleanupState = z.infer<
  typeof AgentSupervisorWorktreeCleanupStateSchema
>

export const AgentSupervisorWorktreeSchema = z.object({
  schemaVersion: z.literal(AGENT_SUPERVISOR_SCHEMA_VERSION),
  jobId: AgentSupervisorJobIdSchema,
  ownedByMossen: z.boolean(),
  path: z.string().nullable(),
  owner: z.literal('mossen-agent-supervisor').nullable(),
  baseRepo: z.string().nullable(),
  baseRepoCommit: z.string().nullable(),
  baseBranch: z.string().nullable(),
  baseRef: z.string().nullable().optional(),
  baseRefMode: z.enum(['head', 'remote-default']).nullable().optional(),
  baseRefFallbackReason: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
  creatorPid: z.number().int().positive().nullable(),
  creatorVersion: z.string().nullable(),
  creatorHostname: z.string().nullable(),
  ownershipMarkerPath: z.string().nullable(),
  ownershipMarkerHash: z.string().nullable(),
  cleanupState: AgentSupervisorWorktreeCleanupStateSchema,
  cleanupEligible: z.boolean(),
  dirty: z.boolean().nullable(),
  isolationReason: z.string().nullable(),
})
export type AgentSupervisorWorktree = z.infer<
  typeof AgentSupervisorWorktreeSchema
>

export const AgentSupervisorJsonlSourceSchema = z.enum([
  'agent_view',
  'cli_attach',
  'cli_input',
  'supervisor',
  'job',
])
export type AgentSupervisorJsonlSource = z.infer<
  typeof AgentSupervisorJsonlSourceSchema
>

export const AgentSupervisorJsonlEnvelopeSchema = z.object({
  ts: z.string(),
  seq: z.number().int().positive(),
  kind: z.string(),
  source: AgentSupervisorJsonlSourceSchema,
  v: z.literal(AGENT_SUPERVISOR_SCHEMA_VERSION),
})
export type AgentSupervisorJsonlEnvelope = z.infer<
  typeof AgentSupervisorJsonlEnvelopeSchema
>

export const AgentSupervisorInputMessageSchema = z.discriminatedUnion('kind', [
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('user_message'),
    content: z.string(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('choice'),
    choiceKey: z.string(),
    fromQuestionEventSeq: z.number().int().positive(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('soft_interrupt'),
  }),
])
export type AgentSupervisorInputMessage = z.infer<
  typeof AgentSupervisorInputMessageSchema
>

export const AgentSupervisorControlMessageSchema = z.discriminatedUnion('kind', [
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('stop'),
    reason: z.string(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('interrupt'),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('shutdown'),
    grace_sec: z.number().int().nonnegative(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('ping'),
    nonce: z.string(),
  }),
])
export type AgentSupervisorControlMessage = z.infer<
  typeof AgentSupervisorControlMessageSchema
>

export const AgentSupervisorEventMessageSchema = z.discriminatedUnion('kind', [
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('started'),
    pid: z.number().int().positive(),
    sessionId: z.string().nullable(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('activity'),
    detail: z.string(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('needs_input'),
    question: z.string(),
    options: z.array(AgentSupervisorQuestionOptionSchema),
    suggestedReply: z.string().nullable(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('input_received'),
    fromInputSeq: z.number().int().positive(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('assistant_done'),
    summary: z.string(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('result_payload'),
    payload: AgentSupervisorResultPayloadSchema,
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('pong'),
    nonce: z.string(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('exited'),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('stop_requested'),
  }),
])
export type AgentSupervisorEventMessage = z.infer<
  typeof AgentSupervisorEventMessageSchema
>

export const AgentSupervisorOutputMessageSchema = z.discriminatedUnion('kind', [
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('assistant_text'),
    text: z.string(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('tool_call'),
    tool: z.string(),
    input: z.string(),
  }),
  AgentSupervisorJsonlEnvelopeSchema.extend({
    kind: z.literal('tool_result'),
    tool: z.string(),
    exitCode: z.number().int().nullable(),
    stdoutTail: z.string().optional(),
    stderrTail: z.string().optional(),
  }),
])
export type AgentSupervisorOutputMessage = z.infer<
  typeof AgentSupervisorOutputMessageSchema
>

export function createInitialAgentSupervisorJobState(
  options: {
    id: AgentSupervisorJobId
    title: string
    cwd: string
    promptPreview: string
    model?: string | null
    permissionMode?: string | null
    effort?: string | null
    agent?: string | null
    settings?: string | null
    addDirs?: string[]
    mcpConfig?: string[]
    pluginDirs?: string[]
    strictMcpConfig?: boolean
    fallbackModel?: string | null
    allowDangerouslySkipPermissions?: boolean
    dangerouslySkipPermissions?: boolean
    sessionId?: string | null
    now?: string
  },
): AgentSupervisorJobState {
  const now = options.now ?? new Date().toISOString()
  return {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    id: options.id,
    title: options.title,
    cwd: options.cwd,
    createdAt: now,
    updatedAt: now,
    status: 'queued',
    process: {
      pid: null,
      alive: false,
      lastStartedAt: null,
      lastExitedAt: null,
      exitCode: null,
      signal: null,
      expectedCmdlineSubstring: null,
    },
    model: options.model ?? null,
    permissionMode: options.permissionMode ?? null,
    effort: options.effort ?? null,
    agent: options.agent ?? null,
    settings: options.settings ?? null,
    addDirs: options.addDirs ?? [],
    mcpConfig: options.mcpConfig ?? [],
    pluginDirs: options.pluginDirs ?? [],
    strictMcpConfig: options.strictMcpConfig ?? false,
    fallbackModel: options.fallbackModel ?? null,
    allowDangerouslySkipPermissions:
      options.allowDangerouslySkipPermissions ?? false,
    dangerouslySkipPermissions: options.dangerouslySkipPermissions ?? false,
    sessionId: options.sessionId ?? null,
    promptPreview: options.promptPreview,
    summary: null,
    resultPayload: null,
    lastQuestion: null,
    ui: {
      pinned: false,
      order: 0,
      collapsed: false,
      renamedTitle: null,
    },
    counters: {
      inputSeqHigh: 0,
      controlSeqHigh: 0,
      eventSeqHigh: 0,
      outputSeqHigh: 0,
    },
    errors: [],
  }
}
