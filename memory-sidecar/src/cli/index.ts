#!/usr/bin/env bun
/* eslint-disable no-console */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ArchiveEvent } from '../schema/archiveEvent.js'
import type { MemorySidecarConfig } from '../config/config.js'
import {
  createDefaultMemorySidecarConfig,
  mergeMemorySidecarConfig,
} from '../config/config.js'
import {
  createMemorySidecarDoctorReport,
  summarizeLlmTestResult,
} from '../diagnostics/setupDoctor.js'
import { createLlmProvider } from '../llm/provider.js'
import {
  appendArchiveEvent,
  recentArchiveEvents,
} from '../storage/jsonlArchiveStore.js'
import { getArchiveStoreManifest } from '../storage/manifest.js'
import {
  createRepairArchiveStorePlan,
  executeRepairArchiveStorePlan,
  repairArchiveStore,
  verifyArchiveStore,
} from '../storage/verifyRepair.js'
import {
  confirmCleanup,
  createCleanupDryRun,
  createMaintenanceStatusReport,
  exportMemorySidecarData,
  type CleanupScope,
} from '../storage/maintenance.js'
import {
  getArchiveEventsById,
  initializeMemoryIndex,
  rebuildArchiveIndex,
  searchArchiveEvents,
} from '../storage/sqliteIndex.js'
import {
  appendObservations,
  recentObservations,
} from '../storage/observationStore.js'
import { createDisabledVectorIndex } from '../storage/vectorIndex.js'
import { rebuildVectorStore, searchVectorStore } from '../storage/vectorStore.js'
import { recentProfileSnapshots } from '../storage/profileStore.js'
import {
  proposalCandidateSummary,
  recentProposals,
  reviewProposal,
} from '../storage/proposalStore.js'
import { ingestConversationEvent } from '../ingest/archiveWriter.js'
import {
  ingestConversationEvents,
  parseIngressJsonl,
  readIngressEventsFromFile,
} from '../ingest/ingressApi.js'
import {
  ingestAdapterPayloads,
  planAdapterPayloads,
  parseAdapterPayloads,
  readAdapterPayloadsFromFile,
} from '../index.js'
import { adapterDeadLetterStats } from '../adapter/deadLetterStore.js'
import { listDirtyCheckpoints, listDirtyMarkers } from '../agent/dirtyQueue.js'
import {
  listFailedMemoryAgentJobs,
  listMemoryAgentJobs,
  observeMemoryAgentJobs,
  retryFailedMemoryAgentJobs,
} from '../agent/jobQueue.js'
import { shouldScheduleMemoryAgent } from '../agent/scheduler.js'
import {
  getMemoryWorkerStatus,
  runMemoryWorkerLoop,
  runMemoryWorkerOnce,
  type MemoryWorkerLoopOptions,
} from '../agent/workerLoop.js'
import { classifyArchiveEventsWithRules } from '../classify/ruleClassifier.js'
import { refineRuleObservationCandidates } from '../classify/refineObservations.js'
import { estimateTokens, getProjectMemoryDir } from '../index.js'
import { memoryContext } from '../retrieval/context.js'
import {
  confirmDelete,
  confirmDisable,
  confirmProposalReview,
  createDeleteDryRun,
  createDisableDryRun,
  createProposalReviewDryRun,
  exportUserMemory,
  listUserMemory,
  searchUserMemory,
  showUserMemory,
  type MemoryManageKind,
  type MemoryManageKindOrAll,
  type ProposalReviewAction,
} from '../management/userMemory.js'
import { generateTrialReport } from '../management/trialReport.js'
type ParsedArgs = {
  command: string
  query?: string
  home: string
  projectId: string
  limit?: number
  maxTokens?: number
  dryRun: boolean
  stdin: boolean
  file?: string
}

type CliPaths = {
  home: string
  root: string
  configPath: string
  projectId: string
  memoryDir: string
  sqlitePath: string
}

const FIXTURE_PROJECT_ID = 'project-phoenix'

const FIXTURE_EVENTS: ArchiveEvent[] = [
  fixtureEvent({
    eventId: 'evt_fixture_architecture',
    createdAt: '2026-05-04T00:00:00.000Z',
    sessionId: 'stage1',
    role: 'assistant',
    text: 'Stage 1 keeps the memory sidecar independent: archive JSONL, SQLite FTS, rule classification, and retrieval run without connecting to Mossen core.',
  }),
  fixtureEvent({
    eventId: 'evt_fixture_defaults',
    createdAt: '2026-05-04T00:01:00.000Z',
    sessionId: 'stage1',
    role: 'assistant',
    text: 'Capture, vector search, LLM classification, MCP retrieval, and team memory stay disabled by default.',
  }),
  fixtureEvent({
    eventId: 'evt_fixture_rebuild',
    createdAt: '2026-05-04T00:02:00.000Z',
    sessionId: 'stage1-rebuild',
    role: 'assistant',
    text: 'The local SQLite index is disposable and can be rebuilt from archive JSONL at any time.',
  }),
]

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv]
  const command = args.shift() ?? 'help'
  let home = join(homedir(), '.mossen')
  let projectId = FIXTURE_PROJECT_ID
  let limit: number | undefined
  let maxTokens: number | undefined
  const positional: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--home') {
      const value = args[index + 1]
      if (!value) throw new Error('--home requires a path')
      home = resolve(value)
      index += 1
      continue
    }
    if (arg === '--project-id') {
      const value = args[index + 1]
      if (!value) throw new Error('--project-id requires a value')
      projectId = value
      index += 1
      continue
    }
    if (arg === '--limit') {
      const value = args[index + 1]
      if (!value) throw new Error('--limit requires a number')
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--limit must be a positive integer')
      limit = parsed
      index += 1
      continue
    }
    if (arg === '--max-tokens') {
      const value = args[index + 1]
      if (!value) throw new Error('--max-tokens requires a number')
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--max-tokens must be a positive integer')
      maxTokens = parsed
      index += 1
      continue
    }
    if (arg === '--file') {
      const value = args[index + 1]
      if (!value) throw new Error('--file requires a path')
      positional.push('--file')
      positional.push(resolve(value))
      index += 1
      continue
    }
    if (arg === '--stdin') {
      positional.push('--stdin')
      continue
    }
    if (arg === '--dry-run') continue
    positional.push(arg)
  }

  return {
    command,
    query: positional.join(' ').trim() || undefined,
    home,
    projectId,
    limit,
    maxTokens,
    dryRun: args.includes('--dry-run'),
    stdin: args.includes('--stdin'),
    file: fileFromPositionals(positional),
  }
}

function fileFromPositionals(positionals: string[]): string | undefined {
  const index = positionals.indexOf('--file')
  return index >= 0 ? positionals[index + 1] : undefined
}

function pathsFor(home: string, projectId = FIXTURE_PROJECT_ID): CliPaths {
  const root = join(home, 'memory-sidecar')
  const memoryDir = getProjectMemoryDir({
    rootDir: root,
    projectId,
  })
  return {
    home,
    root,
    configPath: join(root, 'config.json'),
    projectId,
    memoryDir,
    sqlitePath: join(memoryDir, 'memory.db'),
  }
}

async function initStore(paths: CliPaths): Promise<MemorySidecarConfig> {
  await mkdir(paths.root, { recursive: true })
  await mkdir(paths.memoryDir, { recursive: true })

  const config = await readConfig(paths)
  await writeConfig(paths, config)
  await initializeMemoryIndex({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  return config
}

async function readConfig(paths: CliPaths): Promise<MemorySidecarConfig> {
  const fallback = mergeMemorySidecarConfig({
    ...createDefaultMemorySidecarConfig(),
    homeDir: paths.root,
    configPath: paths.configPath,
  })

  const raw = await readFile(paths.configPath, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })

  if (!raw) return fallback
  return mergeMemorySidecarConfig({
    ...JSON.parse(raw),
    homeDir: paths.root,
    configPath: paths.configPath,
  })
}

async function writeConfig(paths: CliPaths, config: MemorySidecarConfig): Promise<void> {
  await mkdir(paths.root, { recursive: true })
  await writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

async function setEnabled(paths: CliPaths, enabled: boolean): Promise<MemorySidecarConfig> {
  // W122-B.2: disable is config-only. Pre-fix `disable` went through
  // initStore, which mkdirs paths.memoryDir AND calls
  // initializeMemoryIndex(), recreating an empty memory.db on every
  // disable invocation. The disabled-safe contract requires no
  // project-side writes after `/memory-sidecar disable`, so the disable
  // path must skip initStore and only touch paths.root + paths.configPath
  // (writeConfig already mkdirs paths.root and writes config.json,
  // nothing else).
  const config = enabled
    ? await initStore(paths)
    : await readConfig(paths)
  const next: MemorySidecarConfig = {
    ...config,
    enabled,
    adapter: {
      ...config.adapter,
      enabled,
    },
    capture: {
      ...config.capture,
      enabled: false,
    },
  }
  await writeConfig(paths, next)
  return next
}

async function setupMemorySidecar(
  paths: CliPaths,
  query: string | undefined,
): Promise<MemorySidecarConfig> {
  // W119 H8: mossen-profile mode is rejected. Setup never writes
  // { kind: 'mossen-profile' } anymore. If the flag is passed we surface a
  // hard error so users (and scripts) discover the policy instead of
  // silently falling through to a half-configured state.
  if (hasOption(query, '--use-mossen-profile')) {
    throw new Error(
      'sidecar LLM must use independent openai-compatible config; ' +
      'mossen-profile mode is disabled (W119 H8). ' +
      'Use: bun memory-sidecar/src/cli/index.ts llm config ' +
      '--base-url <url> --model <id> --api-key-env <ENV>',
    )
  }
  const config = await initStore(paths)
  const next: MemorySidecarConfig = {
    ...config,
    enabled: true,
    adapter: {
      ...config.adapter,
      enabled: true,
    },
    capture: {
      ...config.capture,
      enabled: false,
    },
  }
  await writeConfig(paths, next)
  return next
}

async function importFixture(paths: CliPaths): Promise<number> {
  await initStore(paths)
  const existing = new Set(
    (await recentArchiveEvents({
      rootDir: paths.root,
      projectId: paths.projectId,
      limit: 1000,
    })).map(entry => entry.event.eventId),
  )

  const missing = FIXTURE_EVENTS.filter(event => !existing.has(event.eventId))
  for (const event of missing) {
    await appendArchiveEvent({
      rootDir: paths.root,
      projectId: paths.projectId,
      event,
    })
  }

  await rebuildArchiveIndex({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  return missing.length
}

async function importBenchmarkFixture(paths: CliPaths, count: number): Promise<number> {
  await initStore(paths)
  const safeCount = Math.max(0, Math.min(count, 100000))

  for (let index = 0; index < safeCount; index += 1) {
    await appendArchiveEvent({
      rootDir: paths.root,
      projectId: paths.projectId,
      event: fixtureEvent({
        eventId: `evt_benchmark_${index.toString().padStart(6, '0')}`,
        createdAt: new Date(Date.UTC(2026, 4, 4, 1, 0, index)).toISOString(),
        sessionId: `benchmark-${Math.floor(index / 1000)}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        text: `Benchmark memory sidecar event ${index}: project decision, preference, retrieval, and archive indexing fixture.`,
      }),
    })
  }

  await rebuildArchiveIndex({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  return safeCount
}

async function runBenchmark(paths: CliPaths, count: number): Promise<void> {
  const startedAt = Date.now()
  const imported = await importBenchmarkFixture(paths, count)
  const afterImportMs = Date.now()
  const rebuild = await rebuildArchiveIndex({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  const afterSqliteMs = Date.now()
  const vector = await rebuildVectorStore({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  const afterVectorMs = Date.now()
  const search = await searchArchiveEvents({
    rootDir: paths.root,
    projectId: paths.projectId,
    query: 'preference',
    scopeFilter: {
      scope: 'project',
      projectId: paths.projectId,
    },
  })
  const afterSearchMs = Date.now()

  printJson({
    imported,
    sqliteIndexed: rebuild.indexed,
    vectorIndexed: vector.recordsWritten,
    searchResults: search.length,
    durationsMs: {
      import: afterImportMs - startedAt,
      sqliteRebuild: afterSqliteMs - afterImportMs,
      vectorRebuild: afterVectorMs - afterSqliteMs,
      search: afterSearchMs - afterVectorMs,
      total: afterSearchMs - startedAt,
    },
  })
}

/**
 * W119.1 H1: compute the runtime enabled flag the same way every CLI ingest
 * path must use. Sidecar AND adapter must both be on; either off is "off".
 */
function isSidecarIngestEnabled(config: MemorySidecarConfig): boolean {
  return config.enabled === true && config.adapter.enabled === true
}

async function ingestFixture(paths: CliPaths): Promise<void> {
  const config = await readConfig(paths)
  const enabled = isSidecarIngestEnabled(config)
  // W119.1 H1: when disabled, do NOT call initStore (which materialises
  // dirs and may run init side-effects) and do NOT call the writer. Print
  // a skipped result so callers can detect the gate without a crash.
  if (!enabled) {
    printJson({
      status: 'skipped',
      reason: 'sidecar_disabled',
      enabled: false,
    })
    return
  }
  await initStore(paths)
  const result = await ingestConversationEvent({
    rootDir: paths.root,
    projectId: paths.projectId,
    enabled,
    event: {
      schemaVersion: 1,
      source: 'manual-fixture',
      sourceEventId: `fixture-${Date.now()}`,
      projectId: paths.projectId,
      sessionId: 'ingest-fixture',
      role: 'user',
      kind: 'message',
      text: '以后旁路记忆系统必须先完整存储，再异步理解整理。',
      createdAt: new Date().toISOString(),
      metadata: {
        model: 'fixture',
        permissionMode: 'readonly',
      },
    },
  })
  printJson({
    archiveEventId: result.archiveEvent.eventId,
    dirtyId: result.dirtyMarker?.dirtyId,
    jsonlPath: result.archiveLocation.jsonlPath,
  })
}

async function ingestExternal(paths: CliPaths, args: ParsedArgs): Promise<void> {
  // W119.1 H1: read config FIRST so that --home / --project-id pointing at
  // a disabled sidecar produces an all-skipped result and zero disk writes.
  // The earlier implementation called initStore (which mkdirs the project
  // tree) and ingestConversationEvents (which appends archive + dirty)
  // without ever consulting `config.enabled`.
  const config = await readConfig(paths)
  const enabled = isSidecarIngestEnabled(config)
  if (enabled) {
    await initStore(paths)
  }
  if (args.stdin) {
    const stdin = await new Response(Bun.stdin.stream()).text()
    printJson(await ingestConversationEvents({
      rootDir: paths.root,
      projectId: paths.projectId,
      enabled,
      events: parseIngressJsonl(stdin),
    }))
    return
  }
  if (args.file) {
    printJson(await ingestConversationEvents({
      rootDir: paths.root,
      projectId: paths.projectId,
      enabled,
      events: await readIngressEventsFromFile(args.file),
    }))
    return
  }
  throw new Error('ingest requires --stdin or --file <path>')
}

async function ingestAdapterExternal(paths: CliPaths, args: ParsedArgs): Promise<void> {
  const config = await readConfig(paths)
  if (!args.dryRun) {
    await initStore(paths)
  }
  if (args.stdin) {
    const stdin = await new Response(Bun.stdin.stream()).text()
    const payloads = parseAdapterPayloads(stdin)
    printJson(await runAdapterIngest(paths, payloads, args.dryRun, config))
    return
  }
  if (args.file) {
    const payloads = await readAdapterPayloadsFromFile(args.file)
    printJson(await runAdapterIngest(paths, payloads, args.dryRun, config))
    return
  }
  throw new Error('adapter-ingest requires --stdin or --file <path>')
}

async function runAdapterIngest(
  paths: CliPaths,
  payloads: unknown[],
  dryRun: boolean,
  config?: MemorySidecarConfig,
): Promise<unknown> {
  const options = {
    rootDir: paths.root,
    defaultProjectId: paths.projectId,
    payloads,
    enabled: config?.enabled === true && config.adapter.enabled,
    maxPayloadBytes: config?.adapter.maxPayloadBytes,
    maxTextChars: config?.adapter.maxTextChars,
    rejectToolPayloads: config?.adapter.rejectToolPayloads,
    deadLetter: config?.adapter.deadLetter,
  }
  return dryRun ? planAdapterPayloads(options) : ingestAdapterPayloads(options)
}

async function printAdapterStatus(paths: CliPaths): Promise<void> {
  const config = await readConfig(paths)
  printJson({
    enabled: config.enabled,
    adapter: config.adapter,
    deadLetter: await adapterDeadLetterStats({
      rootDir: paths.root,
      projectId: paths.projectId,
    }),
  })
}

async function printStatus(paths: CliPaths): Promise<void> {
  const config = await readConfig(paths)
  const manifest = await getArchiveStoreManifest({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  printJson({
    home: paths.home,
    root: paths.root,
    configPath: paths.configPath,
    memoryDir: paths.memoryDir,
    sqlitePath: paths.sqlitePath,
    archiveEvents: manifest.stats.archiveEventCount,
    enabled: config.enabled,
    capture: config.capture.enabled,
    vector: config.index.vector,
    llm: config.classification.llm,
    team: config.team.enabled,
  })
}

async function printSetup(
  paths: CliPaths,
  query: string | undefined,
): Promise<void> {
  const config = await setupMemorySidecar(paths, query)
  printJson({
    enabled: config.enabled,
    adapter: config.adapter.enabled,
    capture: config.capture.enabled,
    llm: config.classification.llm,
    llmProvider: config.classification.llmProviderConfig?.kind ??
      config.classification.llmProvider,
    configPath: paths.configPath,
    memoryDir: paths.memoryDir,
  })
}

async function printDoctor(paths: CliPaths): Promise<void> {
  printJson(await createMemorySidecarDoctorReport({
    paths,
    config: await readConfig(paths),
  }))
}

async function printTestLlm(paths: CliPaths): Promise<void> {
  const config = await readConfig(paths)
  const provider = createLlmProvider(config.classification.llmProviderConfig)
  const result = await provider.complete({
    operation: 'classify-observations',
    input: {
      events: [{
        eventId: 'test-llm',
        text: 'Memory sidecar diagnostic LLM probe. Return one tiny JSON observation.',
      }],
    },
  })
  printJson(summarizeLlmTestResult({
    providerKind: provider.kind,
    result,
  }))
}

async function printMaintenanceReport(paths: CliPaths): Promise<void> {
  printJson(await createMaintenanceStatusReport(paths, await readConfig(paths)))
}

async function printExport(paths: CliPaths, query: string | undefined): Promise<void> {
  const outDir = optionValue(query, '--out')
  if (!outDir) throw new Error('export requires --out <dir>')
  printJson(await exportMemorySidecarData({
    paths,
    config: await readConfig(paths),
    outDir,
  }))
}

async function printCleanup(
  paths: CliPaths,
  query: string | undefined,
  dryRun: boolean,
): Promise<void> {
  const confirmToken = optionValue(query, '--confirm')
  if (confirmToken) {
    printJson(await confirmCleanup(paths, confirmToken))
    return
  }

  if (!dryRun) {
    throw new Error('cleanup requires --dry-run first, then cleanup --confirm <token>')
  }

  printJson(await createCleanupDryRun(paths, cleanupScopeFromQuery(query)))
}

async function printRecent(paths: CliPaths): Promise<void> {
  const entries = await recentArchiveEvents({
    rootDir: paths.root,
    projectId: paths.projectId,
    limit: 20,
  })
  printJson(entries.map(entry => entry.event))
}

async function printSearch(paths: CliPaths, query: string): Promise<void> {
  await initStore(paths)
  const results = await searchArchiveEvents({
    rootDir: paths.root,
    projectId: paths.projectId,
    query,
    scopeFilter: {
      scope: 'project',
      projectId: paths.projectId,
    },
  })
  printJson(results.map(result => result.event))
}

async function printContext(paths: CliPaths, query: string, options: {
  limit?: number
  maxTokens?: number
} = {}): Promise<void> {
  await initStore(paths)
  const config = await readConfig(paths)
  printJson(await memoryContext({
    rootDir: paths.root,
    projectId: paths.projectId,
    query,
    scopeFilter: {
      scope: 'project',
      projectId: paths.projectId,
    },
    limit: options.limit ?? config.retrieval.maxResults,
    maxTokens: options.maxTokens ?? config.retrieval.maxTokens,
  }))
}

async function printGet(paths: CliPaths, eventId: string): Promise<void> {
  await initStore(paths)
  const [result] = await getArchiveEventsById({
    rootDir: paths.root,
    projectId: paths.projectId,
    eventIds: [eventId],
    scopeFilter: {
      scope: 'project',
      projectId: paths.projectId,
    },
  })
  printJson(result?.event ?? null)
}

async function classifyEvents(paths: CliPaths): Promise<ReturnType<typeof classifyArchiveEventsWithRules>> {
  const entries = await recentArchiveEvents({
    rootDir: paths.root,
    projectId: paths.projectId,
    limit: 100000,
  })
  return refineRuleObservationCandidates(classifyArchiveEventsWithRules(
    entries.map(entry => entry.event),
  ))
}

async function printClassify(paths: CliPaths): Promise<void> {
  printJson(await classifyEvents(paths))
}

async function printObservations(paths: CliPaths): Promise<void> {
  await initStore(paths)
  const observations = await classifyEvents(paths)
  const results = await appendObservations({
    rootDir: paths.root,
    projectId: paths.projectId,
    observations,
  })
  const recent = await recentObservations({
    rootDir: paths.root,
    projectId: paths.projectId,
    limit: 20,
  })
  printJson({
    generated: observations.length,
    written: results.filter(result => !result.skipped).length,
    skipped: results.filter(result => result.skipped).length,
    observations: recent.map(entry => entry.observation),
  })
}

function printVectorStatus(): void {
  const vectorIndex = createDisabledVectorIndex()
  printJson({
    enabled: vectorIndex.config.enabled,
    mode: vectorIndex.config.mode,
    dimensions: vectorIndex.config.dimensions,
    note: 'vector index is a disabled-by-default stage 1 interface only',
  })
}

async function printDirtyList(paths: CliPaths): Promise<void> {
  const markers = await listDirtyMarkers({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  const checkpoints = await listDirtyCheckpoints({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  const consumed = new Set(checkpoints.map(checkpoint => checkpoint.dirtyId))
  printJson({
    total: markers.length,
    consumed: consumed.size,
    unconsumed: markers.filter(marker => !consumed.has(marker.dirtyId)).length,
    markers,
    checkpoints,
  })
}

async function printJobsList(paths: CliPaths): Promise<void> {
  printJson(await listMemoryAgentJobs({
    rootDir: paths.root,
    projectId: paths.projectId,
  }))
}

async function printJobsFailed(paths: CliPaths): Promise<void> {
  printJson(await listFailedMemoryAgentJobs({
    rootDir: paths.root,
    projectId: paths.projectId,
  }))
}

async function printJobsRetry(paths: CliPaths): Promise<void> {
  printJson({
    retried: await retryFailedMemoryAgentJobs({
      rootDir: paths.root,
      projectId: paths.projectId,
    }),
  })
}

async function printAgentStatus(paths: CliPaths): Promise<void> {
  const config = await readConfig(paths)
  const dirtyMarkers = await listDirtyMarkers({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  const jobs = await listMemoryAgentJobs({
    rootDir: paths.root,
    projectId: paths.projectId,
  })
  printJson({
    dirtyMarkers: dirtyMarkers.length,
    schedule: shouldScheduleMemoryAgent({
      dirtyMarkers,
      dirtyCountThreshold: config.agent.schedule.dirtyCountThreshold,
      maxDirtyAgeMsThreshold: config.agent.schedule.maxDirtyAgeMsThreshold,
    }),
    jobs: observeMemoryAgentJobs(jobs),
  })
}

async function printWorkerRunOnce(paths: CliPaths): Promise<void> {
  const config = await readConfig(paths)
  printJson(await runMemoryWorkerOnce(workerOptions(paths, config, undefined)))
}

async function printWorkerStatus(paths: CliPaths): Promise<void> {
  printJson(await getMemoryWorkerStatus({
    rootDir: paths.root,
    projectId: paths.projectId,
  }))
}

async function printWorkerLoop(paths: CliPaths, query: string | undefined): Promise<void> {
  const config = await readConfig(paths)
  const options = workerOptions(paths, config, query)
  const jsonl = hasOption(query, '--jsonl')

  const result = await runMemoryWorkerLoop({
    ...options,
    onIteration: jsonl
      ? iteration => {
        console.log(JSON.stringify({ type: 'iteration', iteration }))
      }
      : undefined,
  })

  if (jsonl) {
    console.log(JSON.stringify({ type: 'result', result }))
    return
  }

  printJson(result)
}

function workerOptions(
  paths: CliPaths,
  config: MemorySidecarConfig,
  query: string | undefined,
): MemoryWorkerLoopOptions {
  return {
    rootDir: paths.root,
    projectId: paths.projectId,
    llmProviderConfig: config.classification.llm
      ? config.classification.llmProviderConfig
      : undefined,
    llmProviderConfigByJob: config.classification.llm
      ? config.classification.perJobProvider
      : undefined,
    intervalMs: positiveIntegerOption(query, '--interval-ms'),
    maxIterations: positiveIntegerOption(query, '--max-iterations'),
    maxIdleIterations: nonNegativeIntegerOption(query, '--max-idle-iterations'),
    force: hasOption(query, '--force'),
    retry: {
      enabled: !hasOption(query, '--no-retry'),
      maxAttempts: nonNegativeIntegerOption(query, '--retry-max-attempts'),
      backoffBaseMs: nonNegativeIntegerOption(query, '--retry-backoff-ms'),
      maxBackoffMs: nonNegativeIntegerOption(query, '--retry-max-backoff-ms'),
      markExhausted: !hasOption(query, '--no-mark-exhausted'),
    },
  }
}

async function printProfiles(paths: CliPaths): Promise<void> {
  const entries = await recentProfileSnapshots({
    rootDir: paths.root,
    projectId: paths.projectId,
    limit: 20,
  })
  printJson(entries.map(entry => entry.profile))
}

async function printProposals(paths: CliPaths): Promise<void> {
  const entries = await recentProposals({
    rootDir: paths.root,
    projectId: paths.projectId,
    limit: 20,
  })
  printJson(entries.map(entry => entry.proposal))
}

async function printProposalReview(
  paths: CliPaths,
  status: 'accepted' | 'rejected',
  proposalId: string,
): Promise<void> {
  printJson(await reviewProposal({
    rootDir: paths.root,
    projectId: paths.projectId,
    proposalId,
    status,
    decisionReason: `CLI ${status}`,
  }))
}

async function printMemoryManagement(
  paths: CliPaths,
  query: string | undefined,
  dryRun: boolean,
): Promise<void> {
  const parts = splitQuery(query)
  const action = parts[0]

  if (!action || action === 'help' || action === '--help') {
    printMemoryHelp()
    return
  }

  if (action === 'list') {
    const kind = parseMemoryKind(memoryKindAlias(parts[1] ?? 'all'), true)
    printJson(await listUserMemory({
      rootDir: paths.root,
      projectId: paths.projectId,
      kind,
      limit: optionNumber(query, '--limit') ?? 20,
      status: optionValue(query, '--status') as never,
    }))
    return
  }

  if (action === 'search') {
    const first = memoryKindAlias(parts[1])
    const hasKind = isMemoryKind(first, true)
    const kind = parseMemoryKind(hasKind ? first : 'all', true)
    const searchTerms = stripOptionArgs(parts.slice(hasKind ? 2 : 1)).join(' ').trim()
    if (!searchTerms) throw new Error('memory search requires: [kind] <query>')
    await initStore(paths)
    printJson(await searchUserMemory({
      rootDir: paths.root,
      projectId: paths.projectId,
      kind,
      query: searchTerms,
      limit: optionNumber(query, '--limit') ?? 20,
    }))
    return
  }

  if (action === 'show') {
    const kind = parseMemoryKind(memoryKindAlias(parts[1]), false) as MemoryManageKind
    const id = parts[2]
    if (!id) throw new Error('memory show requires: <archive|observation|profile|proposal> <id>')
    printJson(await showUserMemory({
      rootDir: paths.root,
      projectId: paths.projectId,
      kind,
      id,
    }))
    return
  }

  if (action === 'export') {
    const outDir = optionValue(query, '--out')
    if (!outDir) throw new Error('memory export requires --out <dir>')
    printJson(await exportUserMemory({
      paths,
      config: await readConfig(paths),
      outDir,
    }))
    return
  }

  if (action === 'delete') {
    const token = optionValue(query, '--confirm')
    if (token) {
      printJson(await confirmDelete({
        rootDir: paths.root,
        projectId: paths.projectId,
        paths,
        token,
      }))
      return
    }
    if (!dryRun) {
      throw new Error('memory delete requires --dry-run first, then memory delete --confirm <token>')
    }
    const kind = parseMemoryKind(memoryKindAlias(parts[1]), false) as MemoryManageKind
    const id = parts[2]
    if (!id) throw new Error('memory delete requires: <archive|observation|profile|proposal> <id>')
    printJson(await createDeleteDryRun({
      rootDir: paths.root,
      projectId: paths.projectId,
      paths,
      kind,
      id,
    }))
    return
  }

  if (action === 'disable') {
    const token = optionValue(query, '--confirm')
    if (token) {
      printJson(await confirmDisable({
        paths,
        token,
        writeConfig: config => writeConfig(paths, config),
      }))
      return
    }
    if (!dryRun) {
      throw new Error('memory disable requires --dry-run first, then memory disable --confirm <token>')
    }
    printJson(await createDisableDryRun({
      paths,
      config: await readConfig(paths),
    }))
    return
  }

  if (action === 'proposal') {
    const token = optionValue(query, '--confirm')
    if (token) {
      printJson(await confirmProposalReview({
        rootDir: paths.root,
        projectId: paths.projectId,
        paths,
        token,
      }))
      return
    }
    if (!dryRun) {
      throw new Error('memory proposal requires --dry-run first, then memory proposal --confirm <token>')
    }
    const proposalAction = parseProposalReviewAction(parts[1])
    const proposalId = parts[2]
    if (!proposalId) throw new Error('memory proposal requires: accept|reject|defer <proposalId>')
    printJson(await createProposalReviewDryRun({
      rootDir: paths.root,
      projectId: paths.projectId,
      paths,
      proposalId,
      action: proposalAction,
      reason: optionValue(query, '--reason'),
    }))
    return
  }

  throw new Error('memory requires: list | search | show | export | delete | disable | proposal')
}

async function printProposalSummary(paths: CliPaths): Promise<void> {
  printJson(await proposalCandidateSummary({
    rootDir: paths.root,
    projectId: paths.projectId,
    maxItems: 10,
  }))
}

async function printVectorRebuild(paths: CliPaths): Promise<void> {
  printJson(await rebuildVectorStore({
    rootDir: paths.root,
    projectId: paths.projectId,
  }))
}

async function printVectorSearch(paths: CliPaths, query: string): Promise<void> {
  printJson(await searchVectorStore({
    rootDir: paths.root,
    projectId: paths.projectId,
    query,
  }))
}

function fixtureEvent(input: {
  eventId: string
  createdAt: string
  sessionId: string
  role: ArchiveEvent['role']
  text: string
}): ArchiveEvent {
  return {
    schemaVersion: 1,
    eventId: input.eventId,
    scope: 'project',
    visibility: 'project',
    owner: {
      projectId: FIXTURE_PROJECT_ID,
      sessionId: input.sessionId,
    },
    projectId: FIXTURE_PROJECT_ID,
    sessionId: input.sessionId,
    role: input.role,
    kind: 'message',
    text: input.text,
    textHash: createHash('sha256').update(input.text).digest('hex'),
    tokenEstimate: estimateTokens(input.text),
    createdAt: input.createdAt,
    redaction: {
      applied: false,
      version: 1,
    },
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function optionValue(query: string | undefined, name: string): string | undefined {
  const parts = (query ?? '').split(/\s+/).filter(Boolean)
  const index = parts.indexOf(name)
  return index >= 0 ? parts[index + 1] : undefined
}

function optionNumber(query: string | undefined, name: string): number | undefined {
  const value = optionValue(query, name)
  if (!value) return undefined
  const number = Number.parseInt(value, 10)
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} requires a non-negative integer`)
  }
  return number
}

function splitQuery(query: string | undefined): string[] {
  return (query ?? '').split(/\s+/).filter(Boolean)
}

function stripOptionArgs(parts: string[]): string[] {
  const stripped: string[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.startsWith('--')) {
      index += 1
      continue
    }
    stripped.push(part)
  }
  return stripped
}

function parseMemoryKind(value: string | undefined, allowAll: boolean): MemoryManageKindOrAll {
  if (
    value === 'archive' ||
    value === 'observation' ||
    value === 'profile' ||
    value === 'proposal'
  ) {
    return value
  }
  if (allowAll && (!value || value === 'all')) return 'all'
  throw new Error(
    allowAll
      ? 'memory kind must be: all | archive | observation | profile | proposal'
      : 'memory kind must be: archive | observation | profile | proposal',
  )
}

function isMemoryKind(value: string | undefined, allowAll: boolean): boolean {
  return (
    value === 'archive' ||
    value === 'observation' ||
    value === 'profile' ||
    value === 'proposal' ||
    (allowAll && value === 'all')
  )
}

function memoryKindAlias(value: string | undefined): string | undefined {
  if (value === 'observations') return 'observation'
  if (value === 'profiles') return 'profile'
  if (value === 'proposals') return 'proposal'
  return value
}

function parseProposalReviewAction(value: string | undefined): ProposalReviewAction {
  if (value === 'accept' || value === 'reject' || value === 'defer') return value
  throw new Error('memory proposal action must be: accept | reject | defer')
}

function hasOption(query: string | undefined, name: string): boolean {
  return (query ?? '').split(/\s+/).filter(Boolean).includes(name)
}

function positiveIntegerOption(query: string | undefined, name: string): number | undefined {
  const value = optionValue(query, name)
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} requires a positive integer`)
  }
  return parsed
}

function nonNegativeIntegerOption(query: string | undefined, name: string): number | undefined {
  const value = optionValue(query, name)
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} requires a non-negative integer`)
  }
  return parsed
}

function cleanupScopeFromQuery(query: string | undefined): CleanupScope {
  const parts = (query ?? '').split(/\s+/).filter(Boolean)
  const scope = parts.find(part => !part.startsWith('--')) ?? 'dead-letter'
  if (scope === 'dead-letter' || scope === 'jobs' || scope === 'all') return scope
  if (scope === 'job-history') return 'jobs'
  throw new Error('cleanup scope must be: dead-letter | jobs | all')
}

function printHelp(): void {
  console.log(`mossen-memory <command> --home <path>

Commands:
  setup --use-mossen-profile
  doctor
  test-llm
  status
  report
  export --out <dir>
  cleanup [dead-letter|jobs|all] --dry-run
  cleanup --confirm <token>
  memory list [all|archive|observation|profile|proposal] [--limit <n>]
  memory search [all|archive|observation|profile|proposal] <query> [--limit <n>]
  memory show <archive|observation|profile|proposal> <id>
  memory export --out <dir>
  memory delete <archive|observation|profile|proposal> <id> --dry-run
  memory delete --confirm <token>
  memory disable --dry-run
  memory disable --confirm <token>
  memory proposal accept|reject|defer <proposalId> --dry-run
  memory proposal --confirm <token>
  init
  enable
  disable
  import-fixture
  benchmark-fixture <count>
  ingest-fixture
  ingest --stdin
  ingest --file <jsonl>
  adapter-ingest --stdin
  adapter-ingest --file <json-or-jsonl>
  adapter-status
  dirty-list
  jobs list
  jobs failed
  jobs retry
  agent-status
  worker run-once
  worker loop [--max-iterations N] [--interval-ms MS] [--force] [--retry-max-attempts N] [--retry-backoff-ms MS]
  worker status
  profiles
  proposals
  proposals summary
  proposal accept <proposalId>
  proposal reject <proposalId>
  recent
  search <query>
  context <query>
  benchmark <count>
  vector-rebuild
  vector-search <query>
  get <eventId>
  classify
  observations
  trial-report [--query <text>] [--limit <n>]
  stats
  verify --dry-run
  repair --dry-run
  vector-status
  rebuild`)
}

function printMemoryHelp(): void {
  console.log(`mossen-memory memory <command>

Read-only commands:
  memory list [all|archive|observation|profile|proposal] [--limit <n>]
  memory search [all|archive|observation|profile|proposal] <query> [--limit <n>]
  memory show <archive|observation|profile|proposal> <id>
  memory export --out <dir>

Mutations require a dry-run token:
  memory delete <archive|observation|profile|proposal> <id> --dry-run
  memory delete --confirm <token>
  memory disable --dry-run
  memory disable --confirm <token>
  memory proposal accept|reject|defer <proposalId> --dry-run
  memory proposal --confirm <token>`)
}

async function main(): Promise<void> {
  const parsed = parseArgs(Bun.argv.slice(2))
  const { command, query, home, dryRun } = parsed
  const paths = pathsFor(home, parsed.projectId)

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp()
      return
    case 'status':
      await printStatus(paths)
      return
    case 'setup':
      await printSetup(paths, query)
      return
    case 'doctor':
      await printDoctor(paths)
      return
    case 'test-llm':
      await printTestLlm(paths)
      return
    case 'report':
      await printMaintenanceReport(paths)
      return
    case 'export':
      await printExport(paths, query)
      return
    case 'cleanup':
      await printCleanup(paths, query, dryRun)
      return
    case 'memory':
      await printMemoryManagement(paths, query, dryRun)
      return
    case 'init':
      await initStore(paths)
      await printStatus(paths)
      return
    case 'enable':
      await setEnabled(paths, true)
      await printStatus(paths)
      return
    case 'disable':
      await setEnabled(paths, false)
      await printStatus(paths)
      return
    case 'import-fixture':
      printJson({
        imported: await importFixture(paths),
        memoryDir: paths.memoryDir,
      })
      return
    case 'benchmark-fixture': {
      const count = Number.parseInt(query ?? '1000', 10)
      if (!Number.isInteger(count) || count < 0) {
        throw new Error('benchmark-fixture requires a non-negative count')
      }
      printJson({
        imported: await importBenchmarkFixture(paths, count),
        memoryDir: paths.memoryDir,
      })
      return
    }
    case 'benchmark': {
      const count = Number.parseInt(query ?? '1000', 10)
      if (!Number.isInteger(count) || count < 0) {
        throw new Error('benchmark requires a non-negative count')
      }
      await runBenchmark(paths, count)
      return
    }
    case 'ingest-fixture':
      await ingestFixture(paths)
      return
    case 'ingest':
      await ingestExternal(paths, parsed)
      return
    case 'adapter-ingest':
      await ingestAdapterExternal(paths, parsed)
      return
    case 'adapter-status':
      await printAdapterStatus(paths)
      return
    case 'dirty-list':
      await printDirtyList(paths)
      return
    case 'jobs':
      if (query === 'list') {
        await printJobsList(paths)
        return
      }
      if (query === 'failed') {
        await printJobsFailed(paths)
        return
      }
      if (query === 'retry') {
        await printJobsRetry(paths)
        return
      }
      throw new Error('jobs requires: list | failed | retry')
    case 'proposal': {
      const [action, proposalId] = (query ?? '').split(/\s+/)
      if ((action === 'accept' || action === 'reject') && proposalId) {
        await printProposalReview(
          paths,
          action === 'accept' ? 'accepted' : 'rejected',
          proposalId,
        )
        return
      }
      throw new Error('proposal requires: accept <proposalId> | reject <proposalId>')
    }
    case 'agent-status':
      await printAgentStatus(paths)
      return
    case 'worker':
      if (query === 'run-once') {
        await printWorkerRunOnce(paths)
        return
      }
      if (query?.startsWith('loop')) {
        await printWorkerLoop(paths, query.slice('loop'.length).trim())
        return
      }
      if (query === 'status') {
        await printWorkerStatus(paths)
        return
      }
      throw new Error('worker requires: run-once | loop | status')
    case 'profiles':
      await printProfiles(paths)
      return
    case 'proposals':
      if (query === 'summary') {
        await printProposalSummary(paths)
        return
      }
      await printProposals(paths)
      return
    case 'recent':
      await printRecent(paths)
      return
    case 'search':
      if (!query) throw new Error('search requires a query')
      await printSearch(paths, query)
      return
    case 'context':
      if (!query) throw new Error('context requires a query')
      await printContext(paths, query, {
        limit: parsed.limit,
        maxTokens: parsed.maxTokens,
      })
      return
    case 'get':
      if (!query) throw new Error('get requires an eventId')
      await printGet(paths, query)
      return
    case 'classify':
      await printClassify(paths)
      return
    case 'observations':
      await printObservations(paths)
      return
    case 'trial-report': {
      const trialQuery = optionValue(query, '--query') ?? 'mossen旁路记忆'
      const trialLimit = parsed.limit ?? optionNumber(query, '--limit') ?? 5
      printJson(await generateTrialReport({
        rootDir: paths.root,
        projectId: paths.projectId,
        query: trialQuery,
        limit: trialLimit,
      }))
      return
    }
    case 'stats':
      printJson(await getArchiveStoreManifest({
        rootDir: paths.root,
        projectId: paths.projectId,
      }))
      return
    case 'verify':
      printJson(await verifyArchiveStore({
        rootDir: paths.root,
        projectId: paths.projectId,
      }))
      return
    case 'repair':
      if (dryRun) {
        printJson(await repairArchiveStore({
          rootDir: paths.root,
          projectId: paths.projectId,
          dryRun: true,
        }))
        return
      }
      if (query?.startsWith('--confirm ')) {
        printJson(await executeRepairArchiveStorePlan({
          rootDir: paths.root,
          projectId: paths.projectId,
          token: query.slice('--confirm '.length).trim(),
        }))
        return
      }
      printJson(await createRepairArchiveStorePlan({
        rootDir: paths.root,
        projectId: paths.projectId,
      }))
      return
    case 'vector-status':
      printVectorStatus()
      return
    case 'vector-rebuild':
      await printVectorRebuild(paths)
      return
    case 'vector-search':
      if (!query) throw new Error('vector-search requires a query')
      await printVectorSearch(paths, query)
      return
    case 'rebuild':
      printJson(await rebuildArchiveIndex({
        rootDir: paths.root,
        projectId: paths.projectId,
      }))
      return
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
