import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import {
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
  memoryContext,
  projectIdFromCwd,
  type LightweightMemoryResult,
} from '../../memory-sidecar/src/index.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { errorMessage } from '../../utils/errors.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { t } from '../../utils/i18n/index.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { DESCRIPTION, MEMORY_CONTEXT_TOOL_NAME } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
} from './UI.js'

// W110: internal cap applied inside formatToolResult so the rendered tool
// result rarely reaches the framework-level maxResultSizeChars (80_000).
// Truncation appends a hint pointing at /memory-sidecar recall.
export const MEMORY_CONTEXT_TOOL_INTERNAL_MAX_CHARS = 12_000

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z
      .string()
      .describe(
        'Search query for relevant sidecar memory. Use natural language keywords from the current task.',
      ),
    scope: z
      .enum(['project', 'session'])
      .optional()
      .describe(
        "Memory scope. Use 'project' by default; use 'session' only when the user asks about this exact session.",
      ),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum number of memory items to return. Default: configured sidecar maxResults.'),
    max_tokens: z
      .number()
      .int()
      .min(100)
      .max(4000)
      .optional()
      .describe('Approximate token budget for returned memory context. Default: configured sidecar maxTokens.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const memoryResultSchema = z.object({
  id: z.string(),
  source: z.enum(['archive', 'observation', 'profile', 'proposal']),
  scope: z.string(),
  score: z.number(),
  tokenEstimate: z.number(),
  title: z.string().optional(),
  summary: z.string().optional(),
  textPreview: z.string().optional(),
  type: z.string().optional(),
  kind: z.string().optional(),
  domain: z.string().optional(),
  lifecycle: z.string().optional(),
  retrievalPolicy: z.string().optional(),
  createdAt: z.string().optional(),
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  evidenceEventIds: z.array(z.string()).optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    enabled: z.boolean(),
    reason: z.string().optional(),
    query: z.string(),
    scope: z.enum(['project', 'session']),
    projectId: z.string(),
    resolvedProjectId: z.string().optional(),
    sessionId: z.string().optional(),
    resultCount: z.number(),
    maxTokens: z.number(),
    totalTokenEstimate: z.number(),
    results: z.array(memoryResultSchema),
    sections: z.object({
      profile: z.array(memoryResultSchema),
      observations: z.array(memoryResultSchema),
      proposals: z.array(memoryResultSchema),
      archive: z.array(memoryResultSchema),
    }),
    guidance: z.string(),
    disabledGuidance: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const MemoryContextTool = buildTool({
  name: MEMORY_CONTEXT_TOOL_NAME,
  searchHint: 'recall sidecar memory preferences decisions history',
  shouldDefer: true,
  maxResultSizeChars: 80_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Memory'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: true }
  },
  toAutoClassifierInput(input: Input) {
    return input.query
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input): Promise<{ data: Output }> {
    const cwd = getCwd()
    const projectId = projectIdFromCwd(cwd)
    const scope = input.scope ?? 'project'
    const sessionId = scope === 'session' ? getSessionId() : undefined
    const query = input.query.trim()

    let config
    try {
      config = loadMemorySidecarConfig(getDefaultMemorySidecarConfigPath())
    } catch (error) {
      return {
        data: disabledOutput({
          query,
          scope,
          projectId,
          sessionId,
          reason: `failed to load sidecar config: ${errorMessage(error)}`,
        }),
      }
    }

    if (!config.enabled) {
      return {
        data: disabledOutput({
          query,
          scope,
          projectId,
          sessionId,
          reason: 'memory sidecar is disabled',
          disabledGuidance: 'Run /memory-sidecar enable to turn on sidecar memory, then retry.',
        }),
      }
    }

    try {
      const bundle = await memoryContext({
        rootDir: config.homeDir,
        projectId,
        query,
        scopeFilter: {
          scope,
          projectId,
          ...(sessionId ? { sessionId } : {}),
        },
        limit: input.max_results ?? config.retrieval.maxResults,
        maxTokens: input.max_tokens ?? config.retrieval.maxTokens,
      })

      return {
        data: {
          enabled: true,
          query,
          scope,
          projectId,
          resolvedProjectId: bundle.resolvedProjectId,
          sessionId,
          resultCount: bundle.results.length,
          maxTokens: bundle.maxTokens,
          totalTokenEstimate: bundle.totalTokenEstimate,
          results: normalizeResults(bundle.results),
          sections: {
            profile: normalizeResults(bundle.sections.profile),
            observations: normalizeResults(bundle.sections.observations),
            proposals: normalizeResults(bundle.sections.proposals),
            archive: normalizeResults(bundle.sections.archive),
          },
          guidance:
            'Use these memories as evidence, not as absolute truth. Prefer recent/high-confidence observations and cite uncertainty when memory conflicts with the current conversation.',
        },
      }
    } catch (error) {
      return {
        data: disabledOutput({
          query,
          scope,
          projectId,
          sessionId,
          reason: `memory lookup failed: ${errorMessage(error)}`,
        }),
      }
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: formatToolResult(output),
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function disabledOutput({
  query,
  scope,
  projectId,
  sessionId,
  reason,
  disabledGuidance,
}: {
  query: string
  scope: Output['scope']
  projectId: string
  sessionId?: string
  reason: string
  disabledGuidance?: string
}): Output {
  return {
    enabled: false,
    reason,
    query,
    scope,
    projectId,
    sessionId,
    resultCount: 0,
    maxTokens: 0,
    totalTokenEstimate: 0,
    results: [],
    sections: {
      profile: [],
      observations: [],
      proposals: [],
      archive: [],
    },
    guidance: disabledGuidance ?? 'Sidecar memory is unavailable. Continue using the current conversation and project files.',
  }
}

function normalizeResults(results: LightweightMemoryResult[]): Output['results'] {
  return results.map(result => ({
    id: result.id,
    source: result.source,
    scope: result.scope,
    score: result.score,
    tokenEstimate: result.tokenEstimate,
    title: result.title,
    summary: result.summary,
    textPreview: result.textPreview,
    type: result.type,
    kind: result.kind,
    domain: result.domain,
    lifecycle: result.lifecycle,
    retrievalPolicy: result.retrievalPolicy,
    createdAt: result.createdAt,
    projectId: result.projectId,
    sessionId: result.sessionId,
    evidenceIds: result.evidenceIds,
    evidenceEventIds: result.evidenceEventIds,
  }))
}

function formatToolResult(output: Output): string {
  let text: string
  if (!output.enabled) {
    text = [
      'Sidecar memory unavailable.',
      `Reason: ${output.reason ?? 'unknown'}`,
      `Project: ${output.projectId}`,
      output.guidance,
    ].join('\n')
  } else if (output.results.length === 0) {
    text = [
      `No sidecar memory matched query: ${output.query}`,
      `Project: ${output.projectId}`,
      output.guidance,
    ].join('\n')
  } else {
    const sections = [
      formatSection('Profile', output.sections.profile),
      formatSection('Observations', output.sections.observations),
      formatSection('Proposals', output.sections.proposals),
      formatSection('Archive evidence', output.sections.archive),
    ].filter(Boolean)

    const projectLine = output.resolvedProjectId && output.resolvedProjectId !== output.projectId
      ? `Scope: ${output.scope} · Project: ${output.projectId} → resolved: ${output.resolvedProjectId} · ~${output.totalTokenEstimate}/${output.maxTokens} tokens`
      : `Scope: ${output.scope} · Project: ${output.projectId} · ~${output.totalTokenEstimate}/${output.maxTokens} tokens`

    text = [
      `Sidecar memory context for: ${output.query}`,
      projectLine,
      ...sections,
      `Guidance: ${output.guidance}`,
      formatRecallCitations(output.results),
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  if (text.length > MEMORY_CONTEXT_TOOL_INTERNAL_MAX_CHARS) {
    const head = text.slice(0, MEMORY_CONTEXT_TOOL_INTERNAL_MAX_CHARS)
    text = `${head}\n...[truncated at ${MEMORY_CONTEXT_TOOL_INTERNAL_MAX_CHARS} chars; run /memory-sidecar recall for the full bundle]`
  }
  return text
}

// W418 S4 — Recall citation footnote. Shows the user (and reinforces to the
// model) which entries were just recalled. Honors MOSSEN_MEMORY_HIDE_CITATIONS
// env opt-out for users who find the footnote noisy.
const RECALL_CITATION_MAX_ITEMS = 5
const RECALL_CITATION_PREVIEW_CHARS = 80

function formatRecallCitations(results: Output['results']): string {
  if (results.length === 0) return ''
  if (isEnvTruthy(process.env.MOSSEN_MEMORY_HIDE_CITATIONS)) return ''
  const visible = results.slice(0, RECALL_CITATION_MAX_ITEMS)
  const extra = results.length - visible.length
  const header = `💭 ${t('ui.memory.recallCitation.header', {
    count: String(results.length),
  })}`
  const items = visible.map((result, idx) => {
    const raw =
      result.title?.trim() ||
      result.summary?.trim() ||
      result.textPreview?.trim() ||
      result.id
    const preview =
      raw.length > RECALL_CITATION_PREVIEW_CHARS
        ? `${raw.slice(0, RECALL_CITATION_PREVIEW_CHARS - 1).trimEnd()}…`
        : raw
    return `  [${idx + 1}] ${preview} (${result.scope})`
  })
  const lines = [header, ...items]
  if (extra > 0) {
    lines.push(`  ${t('ui.memory.recallCitation.more', { extra: String(extra) })}`)
  }
  return lines.join('\n')
}

function formatSection(label: string, results: Output['results']): string {
  if (results.length === 0) return ''
  const lines = results.map(result => {
    const title = result.title ?? result.source
    const body = result.summary ?? result.textPreview ?? ''
    const meta = [
      result.type,
      result.kind,
      result.domain,
      result.lifecycle,
      result.retrievalPolicy,
    ]
      .filter(Boolean)
      .join('/')
    return [
      `- ${title}`,
      meta ? `  meta: ${meta}` : '',
      body ? `  ${body}` : '',
      result.evidenceEventIds?.length
        ? `  evidenceEventIds: ${result.evidenceEventIds.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  })
  return `${label}:\n${lines.join('\n')}`
}

export function stringifyMemoryContextOutput(output: Output): string {
  return jsonStringify(output, null, 2)
}
