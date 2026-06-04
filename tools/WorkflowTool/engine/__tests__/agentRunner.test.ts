import { describe, expect, test } from 'bun:test'
import type { AgentDefinition } from '../../../AgentTool/loadAgentsDir.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '../../../SyntheticOutputTool/SyntheticOutputTool.js'
import {
  buildRemoteWorkflowAgentPrompt,
  coerceRemoteWorkflowAgentResult,
  extractStructuredOutputFromMessages,
  runHostedRemoteWorkflowAgent,
  withStructuredOutputAllowed,
  withStructuredOutputTool,
  WorkflowSchemaError,
} from '../agentRunner.js'

const OBJECT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
  },
  required: ['ok'],
  additionalProperties: false,
}

describe('workflow agent structured output helpers', () => {
  test('adds a schema-specific StructuredOutput tool and de-duplicates prior copies', () => {
    const first = withStructuredOutputTool([], OBJECT_SCHEMA, 'check')
    expect(first).toHaveLength(1)
    expect(first[0]!.name).toBe(SYNTHETIC_OUTPUT_TOOL_NAME)
    expect(first[0]!.inputJSONSchema === OBJECT_SCHEMA).toBe(true)

    const second = withStructuredOutputTool(first, OBJECT_SCHEMA, 'check')
    expect(second).toHaveLength(1)
    expect(second[0]!.name).toBe(SYNTHETIC_OUTPUT_TOOL_NAME)
  })

  test('rejects invalid workflow schemas before launching an agent', () => {
    expect(() =>
      withStructuredOutputTool(
        [],
        { type: 'not-a-json-schema-type' },
        'broken',
      ),
    ).toThrow(WorkflowSchemaError)
  })

  test('adds StructuredOutput to explicit agent tool allowlists', () => {
    const agent = {
      agentType: 'restricted',
      whenToUse: 'test',
      tools: ['Read'],
      getSystemPrompt: () => 'system',
      source: 'project',
    } as unknown as AgentDefinition

    const updated = withStructuredOutputAllowed(agent)
    expect(updated.tools).toEqual(['Read', SYNTHETIC_OUTPUT_TOOL_NAME])
    expect(agent.tools).toEqual(['Read'])
  })

  test('leaves wildcard agents unchanged', () => {
    const agent = {
      agentType: 'general',
      whenToUse: 'test',
      tools: ['*'],
      getSystemPrompt: () => 'system',
      source: 'project',
    } as unknown as AgentDefinition

    expect(withStructuredOutputAllowed(agent)).toBe(agent)
  })

  test('extracts the latest structured output attachment from agent messages', () => {
    const messages = [
      { type: 'assistant', message: { content: [] } },
      {
        type: 'attachment',
        attachment: { type: 'structured_output', data: { ok: false } },
      },
      {
        type: 'attachment',
        attachment: { type: 'structured_output', data: { ok: true } },
      },
    ]

    expect(extractStructuredOutputFromMessages(messages)).toEqual({ ok: true })
  })
})

describe('workflow remote agent helpers', () => {
  test('builds a remote prompt with workflow metadata and schema instruction', () => {
    const prompt = buildRemoteWorkflowAgentPrompt(
      'inspect the repo',
      { schema: OBJECT_SCHEMA, agentType: 'reviewer' },
      { agentNumber: 3, phase: 'Review', label: 'repo-review' },
    )

    expect(prompt).toContain('remote workflow agent')
    expect(prompt).toContain('Workflow agent: #3 repo-review')
    expect(prompt).toContain('Workflow phase: Review')
    expect(prompt).toContain('Requested agent type: reviewer')
    expect(prompt).toContain('"ok"')
  })

  test('coerces a successful remote result message to text', () => {
    const result = coerceRemoteWorkflowAgentResult(
      [{ type: 'result', subtype: 'success', result: 'done remotely' }],
      {},
      'remote',
    )

    expect(result).toEqual({
      value: 'done remotely',
      tokens: 0,
      toolCalls: 0,
      ok: true,
    })
  })

  test('falls back to the last assistant text when no result text is present', () => {
    const result = coerceRemoteWorkflowAgentResult(
      [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'remote assistant text' }],
          },
        },
      ],
      {},
      'remote',
    )

    expect(result.value).toBe('remote assistant text')
  })

  test('validates schema results from remote JSON text', () => {
    const result = coerceRemoteWorkflowAgentResult(
      [{ type: 'result', subtype: 'success', result: '{"ok":true}' }],
      { schema: OBJECT_SCHEMA },
      'remote-schema',
    )

    expect(result.value).toEqual({ ok: true })
  })

  test('throws a remote session error for non-success result messages', () => {
    expect(() =>
      coerceRemoteWorkflowAgentResult(
        [{ type: 'result', subtype: 'error', errors: ['failed remotely'] }],
        {},
        'remote',
      ),
    ).toThrow('remote session returned an error: failed remotely')
  })

  test('launches and polls a hosted remote workflow agent via injected deps', async () => {
    const seen: string[] = []
    const result = await runHostedRemoteWorkflowAgent(
      'do remote work',
      {},
      { agentNumber: 1, phase: null, label: 'remote-work' },
      undefined,
      {
        launch: async options => {
          seen.push(options.initialMessage)
          return { id: 'session_remote_1', title: options.title }
        },
        poll: async () => ({
          newEvents: [
            { type: 'result', subtype: 'success', result: 'remote done' },
          ],
          lastEventId: 'evt_1',
          sessionStatus: 'idle',
        }),
        getSessionUrl: id => `https://example.invalid/code/${id}`,
        sleep: async () => {},
      },
    )

    expect(seen[0]).toContain('do remote work')
    expect(result.value).toBe('remote done')
  })
})
