import { describe, expect, test } from 'bun:test'
import {
  getEmptyToolPermissionContext,
  type Tools,
  type ToolUseContext,
} from '../../../../Tool.js'
import type { PermissionMode } from '../../../../types/permissions.js'
import type { AgentDefinition } from '../../../AgentTool/loadAgentsDir.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '../../../SyntheticOutputTool/SyntheticOutputTool.js'
import {
  assertWorkflowAgentSchema,
  buildRemoteWorkflowAgentPrompt,
  coerceRemoteWorkflowAgentResult,
  createWorkflowAgentRunner,
  extractStructuredOutputFromMessages,
  filterWorkflowAgentTools,
  formatMissingStructuredOutputAfterNudges,
  runHostedRemoteWorkflowAgent,
  withStructuredOutputAllowed,
  withStructuredOutputTool,
  WORKFLOW_AGENT_DIRECT_USER_TOOLS,
  type WorkflowAgentRunnerDeps,
  WorkflowSchemaError,
} from '../agentRunner.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../../../AskUserQuestionTool/prompt.js'
import {
  BRIEF_TOOL_NAME,
  LEGACY_BRIEF_TOOL_NAME,
} from '../../../BriefTool/prompt.js'
import { PUSH_NOTIFICATION_TOOL_NAME } from '../../../PushNotificationTool/prompt.js'
import { SEND_MESSAGE_TOOL_NAME } from '../../../SendMessageTool/constants.js'
import { SEND_USER_FILE_TOOL_NAME } from '../../../SendUserFileTool/prompt.js'

const OBJECT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
  },
  required: ['ok'],
  additionalProperties: false,
}

function testAgent(agentType: string): AgentDefinition {
  return {
    agentType,
    whenToUse: 'test',
    getSystemPrompt: () => 'system',
    source: 'projectSettings',
  } as unknown as AgentDefinition
}

function workflowRunnerContext(params: {
  agents: AgentDefinition[]
  allowRules?: string[]
  askRules?: string[]
  deniedRules?: string[]
  mode?: PermissionMode
  shouldAvoidPermissionPrompts?: boolean
  mcpTools?: Tools
}): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'test-model',
      tools: [],
      verbose: false,
      thinkingConfig: {},
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: {
        activeAgents: params.agents,
        allAgents: params.agents,
      },
    },
    abortController: new AbortController(),
    readFileState: {} as ToolUseContext['readFileState'],
    getAppState: () =>
      ({
        toolPermissionContext: {
          ...getEmptyToolPermissionContext(),
          mode: params.mode ?? 'default',
          alwaysAllowRules: {
            localSettings: params.allowRules ?? [],
          },
          alwaysAskRules: {
            localSettings: params.askRules ?? [],
          },
          alwaysDenyRules: {
            userSettings: params.deniedRules ?? [],
          },
          shouldAvoidPermissionPrompts:
            params.shouldAvoidPermissionPrompts ?? false,
        },
        mcp: { tools: params.mcpTools ?? [] },
      }) as unknown as ReturnType<ToolUseContext['getAppState']>,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

describe('workflow agent structured output helpers', () => {
  test('adds a schema-specific StructuredOutput tool and de-duplicates prior copies', () => {
    const first = withStructuredOutputTool([], OBJECT_SCHEMA)
    expect(first).toHaveLength(1)
    expect(first[0]!.name).toBe(SYNTHETIC_OUTPUT_TOOL_NAME)
    expect(first[0]!.inputJSONSchema === OBJECT_SCHEMA).toBe(true)

    const second = withStructuredOutputTool(first, OBJECT_SCHEMA)
    expect(second).toHaveLength(1)
    expect(second[0]!.name).toBe(SYNTHETIC_OUTPUT_TOOL_NAME)
  })

  test('rejects invalid workflow schemas before launching an agent', () => {
    expect(() =>
      withStructuredOutputTool(
        [],
        { type: 'not-a-json-schema-type' },
      ),
    ).toThrow(WorkflowSchemaError)
    expect(() =>
      assertWorkflowAgentSchema({ type: 'not-a-json-schema-type' }),
    ).toThrow('agent({schema}) received an invalid JSON Schema:')
  })

  test('formats missing StructuredOutput exhaustion like the workflow contract', () => {
    expect(formatMissingStructuredOutputAfterNudges()).toBe(
      'agent({schema}): subagent completed without calling StructuredOutput (after 2 in-conversation nudges)',
    )
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

  test('filters direct user-input tools from workflow agents', () => {
    const tools = [
      { name: 'Read' },
      { name: ASK_USER_QUESTION_TOOL_NAME },
      { name: BRIEF_TOOL_NAME },
      { name: LEGACY_BRIEF_TOOL_NAME },
      { name: SEND_USER_FILE_TOOL_NAME },
      { name: PUSH_NOTIFICATION_TOOL_NAME },
      { name: SEND_MESSAGE_TOOL_NAME },
      { name: 'Bash' },
    ] as unknown as Tools

    expect(filterWorkflowAgentTools(tools).map(tool => tool.name)).toEqual([
      'Read',
      SEND_MESSAGE_TOOL_NAME,
      'Bash',
    ])
    expect(WORKFLOW_AGENT_DIRECT_USER_TOOLS).toEqual(
      new Set([
        ASK_USER_QUESTION_TOOL_NAME,
        BRIEF_TOOL_NAME,
        LEGACY_BRIEF_TOOL_NAME,
        SEND_USER_FILE_TOOL_NAME,
        PUSH_NOTIFICATION_TOOL_NAME,
      ]),
    )
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

describe('workflow local agent resolution', () => {
  test('runs local workflow agents in acceptEdits while inheriting permission rules', async () => {
    const observed: Array<{
      mode: PermissionMode
      agentPermissionMode?: PermissionMode
      agentModel?: string
      runAgentModel?: string
      allowRules: string[]
      askRules: string[]
      denyRules: string[]
      shouldAvoidPermissionPrompts?: boolean
      toolNames: string[]
    }> = []
    const runAgentImpl: NonNullable<
      WorkflowAgentRunnerDeps['runAgentImpl']
    > = async function* ({
      agentDefinition,
      toolUseContext,
      availableTools,
      model,
    }) {
      const permissionContext =
        toolUseContext.getAppState().toolPermissionContext
      observed.push({
        mode: permissionContext.mode,
        agentPermissionMode: agentDefinition.permissionMode,
        agentModel: agentDefinition.model,
        runAgentModel: model,
        allowRules: [
          ...(permissionContext.alwaysAllowRules.localSettings ?? []),
        ],
        askRules: [...(permissionContext.alwaysAskRules.localSettings ?? [])],
        denyRules: [...(permissionContext.alwaysDenyRules.userSettings ?? [])],
        shouldAvoidPermissionPrompts:
          permissionContext.shouldAvoidPermissionPrompts,
        toolNames: availableTools.map(tool => tool.name),
      })
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'ok' }],
          usage: {
            input_tokens: 1,
            output_tokens: 2,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      } as never
    }
    const agent = {
      ...testAgent('general-purpose'),
      permissionMode: 'plan',
      model: 'haiku',
    } as AgentDefinition
    const runner = createWorkflowAgentRunner({
      toolUseContext: workflowRunnerContext({
        agents: [agent],
        mode: 'bypassPermissions',
        allowRules: ['Bash(npm test)'],
        askRules: ['WebFetch(example.com)'],
        deniedRules: ['Bash(rm -rf *)'],
        shouldAvoidPermissionPrompts: true,
        mcpTools: [
          { name: ASK_USER_QUESTION_TOOL_NAME, isEnabled: () => true },
          { name: BRIEF_TOOL_NAME, isEnabled: () => true },
          { name: SEND_USER_FILE_TOOL_NAME, isEnabled: () => true },
          { name: PUSH_NOTIFICATION_TOOL_NAME, isEnabled: () => true },
        ] as unknown as Tools,
      }),
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      runId: 'wf-test',
      runAgentImpl,
    })

    await expect(
      runner('inspect the repo', {}, {
        agentNumber: 1,
        phase: null,
        label: 'inspect',
      }),
    ).resolves.toMatchObject({ value: 'ok', ok: true })

    expect(observed).toEqual([
      {
        mode: 'acceptEdits',
        agentPermissionMode: 'acceptEdits',
        agentModel: 'inherit',
        runAgentModel: undefined,
        allowRules: ['Bash(npm test)'],
        askRules: ['WebFetch(example.com)'],
        denyRules: ['Bash(rm -rf *)'],
        shouldAvoidPermissionPrompts: true,
        toolNames: expect.not.arrayContaining([
          ASK_USER_QUESTION_TOOL_NAME,
          BRIEF_TOOL_NAME,
          SEND_USER_FILE_TOOL_NAME,
          PUSH_NOTIFICATION_TOOL_NAME,
        ]),
      },
    ])
  })

  test('preserves workflow script model routing over agent frontmatter defaults', async () => {
    const observed: Array<{ agentModel?: string; runAgentModel?: string }> = []
    const runAgentImpl: NonNullable<
      WorkflowAgentRunnerDeps['runAgentImpl']
    > = async function* ({ agentDefinition, model }) {
      observed.push({
        agentModel: agentDefinition.model,
        runAgentModel: model,
      })
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      } as never
    }
    const runner = createWorkflowAgentRunner({
      toolUseContext: workflowRunnerContext({
        agents: [
          {
            ...testAgent('general-purpose'),
            model: 'haiku',
          } as AgentDefinition,
        ],
      }),
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      runId: 'wf-test',
      runAgentImpl,
    })

    await expect(
      runner('inspect the repo', { model: 'sonnet' }, {
        agentNumber: 1,
        phase: null,
        label: 'inspect',
      }),
    ).resolves.toMatchObject({ value: 'ok', ok: true })

    expect(observed).toEqual([
      {
        agentModel: 'inherit',
        runAgentModel: 'sonnet',
      },
    ])
  })

  test('reports live local tool progress from the subagent stream', async () => {
    const updates: Array<{
      tokens?: number
      toolCalls?: number
      lastToolName?: string
      lastToolSummary?: string
      recentToolCalls?: Array<{ name: string; summary?: string }>
      resultPreview?: string
    }> = []
    const runAgentImpl: NonNullable<
      WorkflowAgentRunnerDeps['runAgentImpl']
    > = async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Read',
              input: { file_path: 'src/index.ts' },
            },
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'Bash',
              input: { command: 'npm test' },
            },
          ],
          usage: {
            input_tokens: 5,
            output_tokens: 7,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      } as never
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'finished inspection' }],
          usage: {
            input_tokens: 8,
            output_tokens: 9,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      } as never
    }
    const runner = createWorkflowAgentRunner({
      toolUseContext: workflowRunnerContext({
        agents: [testAgent('general-purpose')],
      }),
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      runId: 'wf-test',
      runAgentImpl,
    })

    const result = await runner('inspect the repo', {}, {
      agentNumber: 1,
      phase: null,
      label: 'inspect',
      onProgress: update => updates.push(update),
    })

    expect(updates[0]).toMatchObject({
      tokens: 12,
      toolCalls: 2,
      lastToolName: 'Bash',
      lastToolSummary: 'npm test',
      recentToolCalls: [
        { name: 'Read', summary: 'src/index.ts' },
        { name: 'Bash', summary: 'npm test' },
      ],
    })
    expect(updates.at(-1)).toMatchObject({
      tokens: 17,
      toolCalls: 2,
      recentToolCalls: [
        { name: 'Read', summary: 'src/index.ts' },
        { name: 'Bash', summary: 'npm test' },
      ],
      resultPreview: 'finished inspection',
    })
    expect(result).toMatchObject({
      value: 'finished inspection',
      tokens: 17,
      toolCalls: 2,
      ok: true,
    })
  })

  test('reports denied agentType with the official workflow error shape', async () => {
    const runner = createWorkflowAgentRunner({
      toolUseContext: workflowRunnerContext({
        agents: [testAgent('Reviewer')],
        deniedRules: ['Agent(Reviewer)'],
      }),
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      runId: 'wf-test',
    })

    await expect(
      runner('review the diff', { agentType: 'Reviewer' }, {
        agentNumber: 1,
        phase: null,
        label: 'review',
      }),
    ).rejects.toThrow(
      "agent({agentType}): 'Reviewer' is denied by permission rule 'Agent(Reviewer)' from userSettings.",
    )
  })

  test('reports missing agentType with the official workflow error shape', async () => {
    const runner = createWorkflowAgentRunner({
      toolUseContext: workflowRunnerContext({
        agents: [testAgent('Explore'), testAgent('Reviewer')],
        deniedRules: ['Agent(Reviewer)'],
      }),
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      runId: 'wf-test',
    })

    await expect(
      runner('review the diff', { agentType: 'Missing' }, {
        agentNumber: 1,
        phase: null,
        label: 'review',
      }),
    ).rejects.toThrow(
      "agent({agentType}): agent type 'Missing' not found. Available agents: Explore",
    )
  })
})

describe('workflow local agent stall detection', () => {
  test('returns a stalled control result when the subagent makes no progress', async () => {
    const neverProgressRunAgent: NonNullable<
      WorkflowAgentRunnerDeps['runAgentImpl']
    > = async function* ({ override }) {
      await new Promise<void>((_resolve, reject) => {
        const signal = override?.abortController?.signal
        if (!signal) return
        signal.addEventListener(
          'abort',
          () => reject(new Error('agent aborted')),
          { once: true },
        )
      })
    }
    const runner = createWorkflowAgentRunner({
      toolUseContext: workflowRunnerContext({
        agents: [testAgent('general-purpose')],
      }),
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      runId: 'wf-test',
      abortController: new AbortController(),
      localAgentStallTimeoutMs: 5,
      runAgentImpl: neverProgressRunAgent,
    })

    const result = await runner('stall forever', {}, {
      agentNumber: 1,
      phase: null,
      label: 'stall-check',
    })

    expect(result).toEqual({
      value: null,
      tokens: 0,
      toolCalls: 0,
      ok: false,
      status: 'stalled',
      stallTimeoutMs: 5,
    })
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
      [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', id: 'toolu_1' }],
          },
        },
        {
          type: 'result',
          subtype: 'success',
          result: 'done remotely',
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 2,
          },
        },
      ],
      {},
      'remote',
    )

    expect(result).toEqual({
      value: 'done remotely',
      tokens: 19,
      toolCalls: 1,
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

  test('validates schema results from remote structured output', () => {
    const result = coerceRemoteWorkflowAgentResult(
      [
        {
          type: 'result',
          subtype: 'success',
          structured_output: { ok: true },
          modelUsage: {
            'mossen-model': {
              inputTokens: 8,
              outputTokens: 2,
              cacheCreationInputTokens: 1,
              cacheReadInputTokens: 4,
            },
          },
          toolCalls: 3,
        },
      ],
      { schema: OBJECT_SCHEMA },
      'remote-schema',
    )

    expect(result).toEqual({
      value: { ok: true },
      tokens: 15,
      toolCalls: 3,
      ok: true,
    })
  })

  test('falls back to schema results from remote JSON text', () => {
    const result = coerceRemoteWorkflowAgentResult(
      [{ type: 'result', subtype: 'success', result: '{"ok":true}' }],
      { schema: OBJECT_SCHEMA },
      'remote-schema',
    )

    expect(result.value).toEqual({ ok: true })
  })

  test('reports remote structured output retry exhaustion for schema agents', () => {
    expect(() =>
      coerceRemoteWorkflowAgentResult(
        [{ type: 'result', subtype: 'error_max_structured_output_retries' }],
        { schema: OBJECT_SCHEMA },
        'remote-schema',
      ),
    ).toThrow(
      "agent({isolation:'remote', schema}) completed without structured output: the remote agent called StructuredOutput but every attempt failed schema validation.",
    )
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
    expect(result.remoteSessionId).toBe('session_remote_1')
  })

  test('fails fast when a remote workflow agent requires action', async () => {
    await expect(
      runHostedRemoteWorkflowAgent(
        'do remote work',
        {},
        { agentNumber: 1, phase: null, label: 'remote-work' },
        undefined,
        {
          launch: async () => ({ id: 'session_remote_1' }),
          poll: async () => ({
            newEvents: [],
            lastEventId: null,
            sessionStatus: 'requires_action',
          }),
          getSessionUrl: id => `https://example.invalid/code/${id}`,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow(
      "Remote session session_remote_1 entered 'requires_action'",
    )
  })

  test('stops polling after repeated remote metadata fetch failures', async () => {
    let polls = 0
    await expect(
      runHostedRemoteWorkflowAgent(
        'do remote work',
        {},
        { agentNumber: 1, phase: null, label: 'remote-work' },
        undefined,
        {
          launch: async () => ({ id: 'session_remote_1' }),
          poll: async () => {
            polls++
            return {
              newEvents: [],
              lastEventId: null,
              metadataFetchError: `miss-${polls}`,
            }
          },
          getSessionUrl: id => `https://example.invalid/code/${id}`,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow(
      'Remote session session_remote_1: fetchSession failed 10 times in a row (last error: miss-10). Bailing instead of polling to the 30-min timeout.',
    )
    expect(polls).toBe(10)
  })

  test('stops polling after repeated idle empty remote pages', async () => {
    let polls = 0
    await expect(
      runHostedRemoteWorkflowAgent(
        'do remote work',
        {},
        { agentNumber: 1, phase: null, label: 'remote-work' },
        undefined,
        {
          launch: async () => ({ id: 'session_remote_1' }),
          poll: async () => {
            polls++
            return {
              newEvents: [],
              lastEventId: null,
              sessionStatus: 'idle',
            }
          },
          getSessionUrl: id => `https://example.invalid/code/${id}`,
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow(
      'remote session returned an error: idle before producing output (https://example.invalid/code/session_remote_1)',
    )
    expect(polls).toBe(5)
  })

  test('rejects invalid remote schemas before launching a remote agent', async () => {
    let launched = false
    const runner = createWorkflowAgentRunner({
      toolUseContext: workflowRunnerContext({
        agents: [testAgent('general-purpose')],
      }),
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      runId: 'wf-test',
      remoteAgentRunner: async () => {
        launched = true
        return { value: 'should not launch', tokens: 0, toolCalls: 0, ok: true }
      },
    })

    await expect(
      runner(
        'do remote work',
        { isolation: 'remote', schema: { type: 'not-a-json-schema-type' } },
        { agentNumber: 1, phase: null, label: 'remote-schema' },
      ),
    ).rejects.toThrow('agent({schema}) received an invalid JSON Schema:')
    expect(launched).toBe(false)
  })
})
