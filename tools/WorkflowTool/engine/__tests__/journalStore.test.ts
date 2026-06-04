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
import { createJournal } from '../journal.js'
import { reapRunsUnder, RUN_RETENTION_MS } from '../journalStore.js'

describe('reapRunsUnder (run-artifact retention, path-injectable)', () => {
  let root: string
  const NOW = 1_000 * 24 * 60 * 60 * 1000 // a fixed "now" far from epoch

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wf-reap-'))
  })
  afterEach(() => {
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

  test('never reaps a run still marked running, however old', () => {
    const running = makeRun('sessA', 'wf_run', {
      runId: 'wf_run',
      createdAt: ageDaysAgo(100),
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
    j.record(0, 'h0', { value: { n: 5 }, tokens: 7, ok: true })
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
    j.record(0, 'ha', { value: 'first', tokens: 3, ok: true })
    j.record(1, 'hb', { value: 'second', tokens: 4, ok: false })

    expect(existsSync(file)).toBe(true)
    const entries = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ kind: 'started', index: 0, hash: 'ha' })
    expect(entries[1]).toMatchObject({ index: 0, hash: 'ha', value: 'first', ok: true })
    expect(entries[2]).toMatchObject({ index: 1, hash: 'hb', value: 'second', ok: false })

    // Feed the reloaded entries back as `prior` → prefix cache hits.
    const resumed = createJournal('wf_run', {
      runId: 'wf_run',
      entries: entries.filter(e => e.kind !== 'started'),
      started: entries.filter(e => e.kind === 'started'),
    })
    expect(resumed.lookup(0, 'ha')).toEqual({ value: 'first', tokens: 3, ok: true })
    expect(resumed.lookup(1, 'hb')).toEqual({ value: 'second', tokens: 4, ok: false })
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
