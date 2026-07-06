import { describe, expect, test } from 'bun:test'
import {
  buildLoopProcessDiagnosticsReport,
  parseLoopProcessRows,
} from '../loopProcessDiagnostics.js'

describe('parseLoopProcessRows', () => {
  test('parses ps rows while preserving the full command', () => {
    const rows = parseLoopProcessRows(
      '19446 45412 1-22:03:04 99.1 bun test sessionGoalEvaluator.test.ts\n',
    )

    expect(rows).toEqual([
      {
        pid: 19446,
        ppid: 45412,
        elapsedRaw: '1-22:03:04',
        elapsedMs: ((24 + 22) * 60 * 60 + 3 * 60 + 4) * 1000,
        pcpu: 99.1,
        command: 'bun test sessionGoalEvaluator.test.ts',
      },
    ])
  })
})

describe('buildLoopProcessDiagnosticsReport', () => {
  test('flags long-running high-cpu loop-like processes', () => {
    const report = buildLoopProcessDiagnosticsReport(
      [
        '44827 1 9-00:00:00 99.7 supervisor --dangerously-skip-permissions',
        '19446 45412 1-22:03:04 99.1 bun test sessionGoalEvaluator.test.ts',
        '22222 1 00:01 0.0 node unrelated.js',
      ].join('\n'),
      {
        generatedAt: '2026-07-06T00:00:00.000Z',
      },
    )

    expect(report.findings.map(finding => finding.pid)).toEqual([44827, 19446])
    expect(report.findings.map(finding => finding.issue)).toEqual([
      'long_running_high_cpu',
      'long_running_high_cpu',
    ])
    expect(report.findings[0]?.action).toContain('explicit operator confirmation')
  })

  test('does not flag short low-cpu loop-like processes', () => {
    const report = buildLoopProcessDiagnosticsReport(
      '16074 1 00:10 4.8 supervisor job\n',
    )

    expect(report.findings).toEqual([])
    expect(report.checkedRows).toBe(1)
  })
})
