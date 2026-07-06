import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getSessionId,
  getSessionProjectDir,
  switchSession,
} from '../../../../bootstrap/state.js'
import { createJournal } from '../journal.js'
import {
  appendJournalEntry,
  appendJournalStartedEntry,
  clearActiveWorkflowRunsForTests,
  finalizeRunMeta,
  initRunArtifacts,
  listWorkflowRuns,
  loadWorkflowCheckpoint,
  loadJournal,
  loadWorkflowFinalReport,
  loadRunMeta,
  loadRunScript,
  markActiveWorkflowRunForTests,
  reapRunsUnder,
  RUN_RETENTION_MS,
  saveWorkflowFinalReport,
  STALE_RUNNING_WORKFLOW_MESSAGE,
  workflowCheckpointPath,
  workflowFinalReportPath,
} from '../journalStore.js'

describe('reapRunsUnder (run-artifact retention, path-injectable)', () => {
  let root: string
  const NOW = 1_000 * 24 * 60 * 60 * 1000 // a fixed "now" far from epoch

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wf-reap-'))
  })
  afterEach(() => {
    clearActiveWorkflowRunsForTests()
    rmSync(root, { recursive: true, force: true })
  })

  // Create <root>/<session>/subagents/workflows/<runId>/run.json with a meta.
  function makeRun(
    session: string,
    runId: string,
    meta: Record<string, unknown> | null,
  ): string {
    const dir = join(root, session, 'subagents', 'workflows', runId)
    mkdirSync(dir, { recursive: true })
    if (meta) writeFileSync(join(dir, 'run.json'), JSON.stringify(meta), 'utf8')
    return dir
  }
  const ageDaysAgo = (n: number) =>
    new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

  test('removes runs older than the retention window, keeps fresh ones', () => {
    const old = makeRun('sessA', 'wf_old', {
      runId: 'wf_old',
      createdAt: ageDaysAgo(10),
      status: 'completed',
    })
    const fresh = makeRun('sessA', 'wf_fresh', {
      runId: 'wf_fresh',
      createdAt: ageDaysAgo(1),
      status: 'completed',
    })
    const removed = reapRunsUnder(root, NOW, RUN_RETENTION_MS)
    expect(removed).toBe(1)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  test('reaps stale running runs but protects this-process active runs', () => {
    const staleRunning = makeRun('sessA', 'wf_run_stale', {
      runId: 'wf_run_stale',
      createdAt: ageDaysAgo(100),
      status: 'running',
    })
    const activeRunning = makeRun('sessA', 'wf_run_active', {
      runId: 'wf_run_active',
      createdAt: ageDaysAgo(100),
      status: 'running',
    })
    markActiveWorkflowRunForTests('wf_run_active')

    expect(reapRunsUnder(root, NOW, RUN_RETENTION_MS)).toBe(1)
    expect(existsSync(staleRunning)).toBe(false)
    expect(existsSync(activeRunning)).toBe(true)
  })

  test('keeps fresh stale running runs inside the retention window', () => {
    const running = makeRun('sessA', 'wf_run_fresh_stale', {
      runId: 'wf_run_fresh_stale',
      createdAt: ageDaysAgo(1),
      status: 'running',
    })
    expect(reapRunsUnder(root, NOW, RUN_RETENTION_MS)).toBe(0)
    expect(existsSync(running)).toBe(true)
  })

  test('reaps across multiple sessions', () => {
    makeRun('sessA', 'wf_a', { runId: 'wf_a', createdAt: ageDaysAgo(30), status: 'completed' })
    makeRun('sessB', 'wf_b', { runId: 'wf_b', createdAt: ageDaysAgo(30), status: 'failed' })
    expect(reapRunsUnder(root, NOW, RUN_RETENTION_MS)).toBe(2)
  })

  test('a torn run.json falls back to directory mtime (fresh dir survives)', () => {
    const dir = join(root, 'sessA', 'subagents', 'workflows', 'wf_torn')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'run.json'), '{ this is not json', 'utf8')
    // Just-created dir → mtime ~now → not older than the window → survives.
    expect(reapRunsUnder(root, NOW, RUN_RETENTION_MS)).toBe(0)
    expect(existsSync(dir)).toBe(true)
  })

  test('empty / missing projects root is a no-op', () => {
    expect(reapRunsUnder(join(root, 'does-not-exist'), NOW)).toBe(0)
  })
})

// journalStore resolves runDir via getProjectsDir()+getSessionId(), which need
// a configured MOSSEN home. Rather than stub the whole session layer, we test
// the journal<->disk contract through the onRecord sink + a hand-rolled file
// round-trip that mirrors journalStore's append/load format (one JSON per line).
// The store module's own append/load are thin wrappers over this exact format;
// the integration with real session paths is covered by the engine smoke.

describe('journal onRecord sink (disk-persistence contract, S1)', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wf-journal-'))
    file = join(dir, 'journal.jsonl')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('every recorded entry fires onRecord exactly once', () => {
    const seen: number[] = []
    const j = createJournal('wf_test', null, e => seen.push(e.index))
    j.record(0, 'h0', { value: 'a', tokens: 1, ok: true })
    j.record(1, 'h1', { value: 'b', tokens: 2, ok: true })
    expect(seen).toEqual([0, 1])
  })

  test('every started entry fires onStart exactly once', () => {
    const seen: number[] = []
    const j = createJournal(
      'wf_test',
      null,
      undefined,
      e => seen.push(e.agentNumber),
    )
    j.start(0, 'h0', {
      label: 'scan',
      phase: null,
      agentNumber: 1,
      opts: {},
    })
    j.start(1, 'h1', {
      label: 'fix',
      phase: 'Patch',
      agentNumber: 2,
      opts: { model: 'fast' },
    })
    expect(seen).toEqual([1, 2])
  })

  test('onRecord payload matches the in-memory toData() entries', () => {
    const appended: string[] = []
    const j = createJournal('wf_test', null, e => appended.push(JSON.stringify(e)))
    j.record(0, 'h0', { value: { n: 5 }, tokens: 7, toolCalls: 2, ok: true })
    const data = j.toData()
    expect(JSON.parse(appended[0]!)).toEqual(data.entries[0]!)
  })

  test('append-then-load round-trip reconstructs JournalData (jsonl format)', () => {
    // Simulate journalStore.appendJournalEntry: one JSON object per line.
    const appendLine = (e: unknown) => {
      const fs = require('node:fs') as typeof import('node:fs')
      fs.appendFileSync(file, `${JSON.stringify(e)}\n`, 'utf8')
    }
    const j = createJournal('wf_run', null, appendLine, appendLine)
    j.start(0, 'ha', {
      label: 'first',
      phase: null,
      agentNumber: 1,
      opts: {},
    })
    j.record(0, 'ha', { value: 'first', tokens: 3, toolCalls: 2, ok: true })
    j.record(1, 'hb', { value: 'second', tokens: 4, toolCalls: 1, ok: false })

    expect(existsSync(file)).toBe(true)
    const entries = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ kind: 'started', index: 0, hash: 'ha' })
    expect(entries[1]).toMatchObject({
      index: 0,
      hash: 'ha',
      value: 'first',
      toolCalls: 2,
      ok: true,
    })
    expect(entries[2]).toMatchObject({
      index: 1,
      hash: 'hb',
      value: 'second',
      toolCalls: 1,
      ok: false,
    })

    // Feed the reloaded entries back as `prior` → prefix cache hits.
    const resumed = createJournal('wf_run', {
      runId: 'wf_run',
      entries: entries.filter(e => e.kind !== 'started'),
      started: entries.filter(e => e.kind === 'started'),
    })
    expect(resumed.lookup(0, 'ha')).toEqual({
      value: 'first',
      tokens: 3,
      toolCalls: 2,
      ok: true,
    })
    expect(resumed.lookup(1, 'hb')).toEqual({
      value: 'second',
      tokens: 4,
      toolCalls: 1,
      ok: false,
    })
    expect(resumed.hits()).toBe(2)
  })

  test('a torn trailing line is skipped on parse (crash-safety)', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    fs.writeFileSync(
      file,
      `${JSON.stringify({ index: 0, hash: 'h', value: 'ok', tokens: 1, ok: true })}\n{partial`,
      'utf8',
    )
    const parsed = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap(l => {
        try {
          return [JSON.parse(l)]
        } catch {
          return []
        }
      })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ index: 0 })
  })
})

describe('journalStore session scoping', () => {
  let root: string
  let previousHome: string | undefined
  let previousConfigDir: string | undefined
  const previousSession = getSessionId()
  const previousProjectDir = getSessionProjectDir()
  const sessionA = '11111111-1111-4111-8111-111111111111' as ReturnType<
    typeof getSessionId
  >
  const sessionB = '22222222-2222-4222-8222-222222222222' as ReturnType<
    typeof getSessionId
  >

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wf-session-scope-'))
    previousHome = process.env.MOSSEN_HOME
    previousConfigDir = process.env.MOSSEN_CONFIG_DIR
    process.env.MOSSEN_HOME = root
    process.env.MOSSEN_CONFIG_DIR = root
    switchSession(sessionA)
  })

  afterEach(() => {
    clearActiveWorkflowRunsForTests()
    switchSession(previousSession, previousProjectDir)
    if (previousHome === undefined) {
      delete process.env.MOSSEN_HOME
    } else {
      process.env.MOSSEN_HOME = previousHome
    }
    if (previousConfigDir === undefined) {
      delete process.env.MOSSEN_CONFIG_DIR
    } else {
      process.env.MOSSEN_CONFIG_DIR = previousConfigDir
    }
    rmSync(root, { recursive: true, force: true })
  })

  test('current-session workflow views do not expose runs from a different session', () => {
    const runId = 'wf_session_a'
    const source = `
export const meta = { name: 'session-a', description: 'session A flow' }
return 1
`
    initRunArtifacts(runId, source, {
      runId,
      workflowName: 'session-a',
      description: 'session A flow',
      createdAt: new Date(0).toISOString(),
      status: 'running',
    })

    expect(listWorkflowRuns().some(run => run.runId === runId)).toBe(true)
    expect(loadRunMeta(runId)?.workflowName).toBe('session-a')
    expect(loadRunScript(runId)).toContain("name: 'session-a'")

    switchSession(sessionB)

    expect(listWorkflowRuns().some(run => run.runId === runId)).toBe(false)
    expect(loadRunMeta(runId)).toBeNull()
    expect(loadRunScript(runId)).toBeNull()
    expect(loadJournal(runId)).toBeNull()
  })

  test('stale running metadata is archived as interrupted instead of shown as live', () => {
    const runId = 'wf_interrupted_run'
    const source = `
export const meta = { name: 'interrupted', description: 'interrupted flow' }
return 1
`
    initRunArtifacts(runId, source, {
      runId,
      workflowName: 'interrupted',
      description: 'interrupted flow',
      createdAt: new Date(0).toISOString(),
      status: 'running',
    })
    clearActiveWorkflowRunsForTests()

    const meta = loadRunMeta(runId)
    expect(meta?.status).toBe('failed')
    expect(meta?.failures).toContain(STALE_RUNNING_WORKFLOW_MESSAGE)
    expect(listWorkflowRuns().find(run => run.runId === runId)?.status).toBe(
      'failed',
    )
    expect(loadWorkflowCheckpoint(runId)).toMatchObject({
      runId,
      status: 'failed',
      resumeSafety: {
        canResume: false,
        nextAction: 'relaunch',
      },
    })
  })

  test('persists checkpoint summaries across start, journal append, and finalize', () => {
    const runId = 'wf_checkpoint'
    const source = `
export const meta = { name: 'checkpoint', description: 'checkpoint flow' }
return 1
`
    initRunArtifacts(runId, source, {
      runId,
      workflowName: 'checkpoint',
      description: 'checkpoint flow',
      createdAt: new Date(0).toISOString(),
      status: 'running',
    })
    expect(workflowCheckpointPath(runId)).toContain('checkpoint.json')
    expect(loadWorkflowCheckpoint(runId)).toMatchObject({
      runId,
      status: 'running',
      scriptExists: true,
      counts: {
        started: 0,
        completed: 0,
        pendingStarted: 0,
      },
      resumeSafety: {
        canResume: false,
        nextAction: 'wait',
      },
    })

    appendJournalStartedEntry(runId, {
      kind: 'started',
      index: 0,
      hash: 'h0',
      label: 'scan',
      phase: 'Plan',
      agentNumber: 1,
      opts: {},
    })
    expect(loadWorkflowCheckpoint(runId)).toMatchObject({
      counts: {
        started: 1,
        completed: 0,
        pendingStarted: 1,
      },
      pendingStartedAgents: [
        {
          index: 0,
          agentNumber: 1,
          label: 'scan',
          phase: 'Plan',
        },
      ],
    })

    appendJournalEntry(runId, {
      index: 0,
      hash: 'h0',
      value: 'done',
      tokens: 5,
      ok: true,
    })
    finalizeRunMeta(runId, {
      status: 'killed',
      agentCount: 1,
      tokensSpent: 5,
      totalToolCalls: 0,
    })

    expect(loadWorkflowCheckpoint(runId)).toMatchObject({
      status: 'killed',
      counts: {
        started: 1,
        completed: 1,
        pendingStarted: 0,
      },
      lastStartedIndex: 0,
      lastCompletedIndex: 0,
      resumeSafety: {
        canResume: true,
        nextAction: 'resume',
      },
    })
  })

  test('persists and loads machine-readable workflow final reports', () => {
    const runId = 'wf_final_report'
    const path = saveWorkflowFinalReport(runId, {
      version: 1,
      runId,
      workflowName: 'final-report',
      status: 'completed',
      evidenceState: 'verified',
      summary: 'verified',
      evidence: ['unit tests passed'],
      validationCommands: ['bun test tools/WorkflowTool/__tests__/finalReport.test.ts'],
      artifacts: ['/tmp/wf/final-report.json'],
      failures: [],
      openQuestions: [],
      reportPath: '/tmp/wf/report.md',
      resultPreview: 'verified',
      generatedAt: '2026-07-06T00:00:00.000Z',
    })

    expect(path).toBe(workflowFinalReportPath(runId))
    expect(loadWorkflowFinalReport(runId)).toMatchObject({
      runId,
      workflowName: 'final-report',
      evidenceState: 'verified',
      evidence: ['unit tests passed'],
    })
  })
})
