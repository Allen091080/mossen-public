import { describe, expect, test } from 'bun:test'
import { buildWorkflowResumeNextInput } from '../workflows.js'

describe('/workflows resume', () => {
  test('queues an official-shaped Workflow tool call with scriptPath, resumeFromRunId, and args', () => {
    const nextInput = buildWorkflowResumeNextInput(
      'wf_resume1',
      '/tmp/workflows/wf_resume1/script.js',
      { ticket: 42 },
    )

    expect(nextInput).toContain(
      "Workflow({scriptPath: '/tmp/workflows/wf_resume1/script.js'",
    )
    expect(nextInput).toContain("resumeFromRunId: 'wf_resume1'")
    expect(nextInput).toContain('args: {"ticket":42}')
    expect(nextInput).not.toContain('no new script')
  })
})
