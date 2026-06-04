import { describe, expect, test } from 'bun:test'
import { analyzeWorkflowStaticSummary } from '../staticSummary.js'

describe('analyzeWorkflowStaticSummary', () => {
  test('groups sequential agent calls and detects a workflow return', () => {
    const summary = analyzeWorkflowStaticSummary(`
      const first = await agent('inspect the diff')
      const second = await agent('verify the tests')
      return [first, second]
    `)

    expect(summary?.phases).toHaveLength(1)
    expect(summary?.phases[0]?.kind).toBe('sequential')
    expect(summary?.phases[0]?.agents.map(agent => agent.prompt)).toEqual([
      'inspect the diff',
      'verify the tests',
    ])
    expect(summary?.estimatedAgents).toBe(2)
    expect(summary?.hasReturn).toBe(true)
  })

  test('summarizes parallel and loop agent calls like the official permission review', () => {
    const summary = analyzeWorkflowStaticSummary(`
      const found = await parallel([
        () => agent('find api bugs'),
        () => agent(\`find ui bugs for \${target}\`),
      ])
      for (const finding of found) {
        await agent(\`verify \${finding.title}\`)
      }
    `)

    expect(summary?.phases.map(phase => phase.kind)).toEqual([
      'parallel',
      'loop',
    ])
    expect(summary?.phases[0]?.agents.map(agent => agent.prompt)).toEqual([
      'find api bugs',
      'find ui bugs for ${...}',
    ])
    expect(summary?.phases[1]?.annotation).toBe('const finding of found')
    expect(summary?.phases[1]?.agents[0]?.prompt).toBe('verify ${...}')
    expect(summary?.estimatedAgents).toBe(9)
    expect(summary?.hasReturn).toBe(false)
  })

  test('returns null when a script does not call agent', () => {
    expect(analyzeWorkflowStaticSummary(`log('nothing to fan out')`)).toBeNull()
  })
})
