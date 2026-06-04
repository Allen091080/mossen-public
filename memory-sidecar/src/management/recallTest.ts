// W122-A: read-only recall regression / sanity helper. Runs four fixed
// memoryContext probes in parallel that exercise the retrieval gate
// (stopword + single-CJK + nonexistent token + real token) without
// invoking the LLM, the worker, or any mutation. Used by
// /memory-sidecar recall-test.
//
// HARD CONSTRAINT: read-only. No fs writes. No worker. No LLM. The four
// probe ids ('stopword' | 'single-cjk' | 'nonexistent' | 'real-token') are
// stable contract — smoke tests pin them.

import type { MemoryRootOptions } from '../index.js'
import {
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
  type MemorySidecarConfig,
} from '../config/config.js'
import { resolveProjectId } from '../projectId.js'
import { memoryContext } from '../retrieval/context.js'
import { getArchiveStoreManifest } from '../storage/manifest.js'

export type RecallTestOptions = MemoryRootOptions & {
  query?: string
  limit?: number
  maxTokens?: number
}

export type RecallProbeId =
  | 'stopword'
  | 'single-cjk'
  | 'nonexistent'
  | 'real-token'

export type RecallProbe = {
  id: RecallProbeId
  query: string
  expected: 'zero' | 'maybe-positive'
  results: number
  filteredControlPlaneCount: number
  estimatedTokens: number
  status: 'pass' | 'warn' | 'fail'
  detail?: string
}

export type RecallTestReport = {
  generatedAt: string
  projectId: string
  resolvedProjectId: string
  searchedProjectIds: string[]
  probes: RecallProbe[]
  overallStatus: 'pass' | 'warn' | 'fail'
  warnings: string[]
  recommendedActions: string[]
}

const STOPWORD_QUERY = '是'
const SINGLE_CJK_QUERY = '中'
const NONEXISTENT_QUERY = '__W122A_NONEXISTENT_xyz__'
const DEFAULT_REAL_TOKEN_QUERY = '旁路记忆'

type ProbeSpec = {
  id: RecallProbeId
  query: string
  expected: 'zero' | 'maybe-positive'
}

export async function generateRecallTestReport(
  options: RecallTestOptions,
): Promise<RecallTestReport> {
  const generatedAt = new Date().toISOString()
  const configPath = getDefaultMemorySidecarConfigPath()

  let config: MemorySidecarConfig | null = null
  try {
    config = loadMemorySidecarConfig(configPath)
  } catch {
    config = null
  }

  const limit = options.limit ?? config?.retrieval.maxResults ?? 10
  const maxTokens = options.maxTokens ?? config?.retrieval.maxTokens ?? 1200

  const realQuery = options.query ?? DEFAULT_REAL_TOKEN_QUERY
  const specs: ProbeSpec[] = [
    { id: 'stopword', query: STOPWORD_QUERY, expected: 'zero' },
    { id: 'single-cjk', query: SINGLE_CJK_QUERY, expected: 'zero' },
    { id: 'nonexistent', query: NONEXISTENT_QUERY, expected: 'zero' },
    { id: 'real-token', query: realQuery, expected: 'maybe-positive' },
  ]

  // Archive size is needed to differentiate "real-token returns 0 because
  // there's nothing to find" from "real-token returns 0 despite a populated
  // archive". Both are warn, but the detail string differs.
  const manifest = await getArchiveStoreManifest(options).catch(() => null)
  const archiveCount = manifest?.stats.archiveEventCount ?? 0

  const resolved = await resolveProjectId({
    rootDir: options.rootDir,
    projectId: options.projectId,
  }).catch(() => ({
    projectId: options.projectId,
    requestedProjectId: options.projectId,
    aliases: [options.projectId],
    aliasReason: undefined as string | undefined,
  }))

  // Run the four probes in parallel. Each probe individually catches and
  // surfaces its error as a fail status; one probe failure must not abort
  // the others.
  const probes = await Promise.all(
    specs.map(spec => runProbe(spec, options, limit, maxTokens, archiveCount)),
  )

  const warnings: string[] = []
  if (archiveCount === 0) {
    warnings.push('no archive events; recall results may be empty')
  }
  for (const probe of probes) {
    if (probe.status === 'warn' || probe.status === 'fail') {
      warnings.push(`[${probe.id}] ${probe.detail ?? probe.status}`)
    }
  }

  const overallStatus: RecallTestReport['overallStatus'] = probes.some(
    p => p.status === 'fail',
  )
    ? 'fail'
    : probes.some(p => p.status === 'warn')
      ? 'warn'
      : 'pass'

  const recommendedActions: string[] = [
    '/memory-sidecar status',
    '/memory-sidecar doctor',
    '/memory-sidecar explain-capture',
  ]
  const sidecarEnabled = config?.enabled ?? false
  if (!sidecarEnabled) {
    recommendedActions.push('/memory-sidecar enable')
  }

  return {
    generatedAt,
    projectId: options.projectId,
    resolvedProjectId: resolved.projectId,
    searchedProjectIds: resolved.aliases,
    probes,
    overallStatus,
    warnings,
    recommendedActions,
  }
}

async function runProbe(
  spec: ProbeSpec,
  options: RecallTestOptions,
  limit: number,
  maxTokens: number,
  archiveCount: number,
): Promise<RecallProbe> {
  try {
    const bundle = await memoryContext({
      rootDir: options.rootDir,
      memoryDir: options.memoryDir,
      projectId: options.projectId,
      llmProviderConfig: options.llmProviderConfig,
      query: spec.query,
      scopeFilter: { scope: 'project', projectId: options.projectId },
      limit,
      maxTokens,
    })

    const results = bundle.results.length
    const filteredControlPlaneCount = bundle.filteredControlPlaneCount
    const estimatedTokens = bundle.totalTokenEstimate

    let status: RecallProbe['status']
    let detail: string | undefined

    if (spec.expected === 'zero') {
      if (results === 0) {
        status = 'pass'
      } else {
        status = 'fail'
        detail = `expected zero results, got ${results}`
      }
    } else {
      // 'maybe-positive': pass when results > 0; warn when 0 (regardless
      // of archive size — both empty-archive and populated-archive 0-hit
      // cases are warn, with detail differentiating).
      if (results > 0) {
        status = 'pass'
      } else {
        status = 'warn'
        detail =
          archiveCount === 0
            ? 'no results (archive empty)'
            : 'no results (archive non-empty; index may need rebuild)'
      }
    }

    return {
      id: spec.id,
      query: spec.query,
      expected: spec.expected,
      results,
      filteredControlPlaneCount,
      estimatedTokens,
      status,
      detail,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      id: spec.id,
      query: spec.query,
      expected: spec.expected,
      results: 0,
      filteredControlPlaneCount: 0,
      estimatedTokens: 0,
      status: 'fail',
      detail: `probe error: ${message}`,
    }
  }
}
