import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { QueryEngine } from '../../../QueryEngine.js'
import {
  appendObservations,
  appendProposals,
  createDefaultMemorySidecarConfig,
  projectIdFromCwd,
  type Observation,
  type Proposal,
} from '../../../memory-sidecar/src/index.js'
import { createTmpMemoryRoot } from '../../../memory-sidecar/src/__tests__/_fixtures/tmpRoot.js'
import { MEMORY_SIDECAR_SCHEMA_VERSION } from '../../../memory-sidecar/src/schema/scope.js'
import { getDefaultAppState, type AppState } from '../../../state/AppStateStore.js'
import type { Message } from '../../../types/message.js'
import { createAssistantMessage, getUserMessageText } from '../../../utils/messages.js'
import { createFileStateCacheWithSizeLimit } from '../../../utils/fileStateCache.js'
import { productionDeps, type QueryDeps } from '../../../query/deps.js'

const START = '2026-06-02T09:00:00.000Z'
const SESSION_ID = 'sess-query-engine-prefetch-old'

function observation(projectId: string): Observation {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    observationId: 'obs-query-engine-prefetch',
    scope: 'project',
    visibility: 'project',
    projectId,
    sessionId: SESSION_ID,
    type: 'decision',
    kind: 'semantic',
    domain: 'memory',
    lifecycle: 'active',
    retrievalPolicy: 'hint',
    title: 'Capture pipeline validation should precede main-loop work',
    summary: 'Past decision: use sidecar recall evidence for the capture pipeline before changing the primary query loop.',
    evidenceIds: ['evt-query-engine-prefetch'],
    evidenceEventIds: ['evt-query-engine-prefetch'],
    files: [],
    tags: ['capture', 'pipeline', 'memory-sidecar'],
    confidence: 0.93,
    source: 'llm',
    promotionStatus: 'candidate',
    createdAt: START,
  }
}

function proposal(projectId: string): Proposal {
  return {
    schemaVersion: MEMORY_SIDECAR_SCHEMA_VERSION,
    proposalId: 'proposal-query-engine-prefetch',
    type: 'workflow',
    status: 'candidate',
    projectId,
    title: 'Use capture pipeline recall as prefetch proof',
    rationale: 'Proposal: prefetch should surface capture pipeline memory for natural Chinese queries.',
    evidenceEventIds: ['evt-query-engine-prefetch'],
    createdAt: START,
    confidence: 0.86,
  }
}

async function writeEnabledConfig(rootDir: string): Promise<void> {
  const config = createDefaultMemorySidecarConfig({
    ...process.env,
    MOSSEN_MEMORY_SIDECAR_HOME: rootDir,
  })
  config.enabled = true
  config.retrieval.maxResults = 5
  config.retrieval.maxTokens = 900
  await writeFile(
    join(rootDir, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  )
}

describe('QueryEngine sidecar prefetch integration', () => {
  test('injects sidecar memory into the request without persisting it to engine history', async () => {
    const fixture = await createTmpMemoryRoot('mossen-query-engine-prefetch-')
    const previousHome = process.env.MOSSEN_MEMORY_SIDECAR_HOME

    try {
      process.env.MOSSEN_MEMORY_SIDECAR_HOME = fixture.rootDir
      await writeEnabledConfig(fixture.rootDir)

      const cwd = join(fixture.rootDir, 'workspace', 'mossensrc')
      await mkdir(cwd, { recursive: true })
      const projectId = projectIdFromCwd(cwd)
      await appendObservations({
        rootDir: fixture.rootDir,
        projectId,
        observations: [observation(projectId)],
      })
      await appendProposals({
        rootDir: fixture.rootDir,
        projectId,
        proposals: [proposal(projectId)],
      })

      let capturedMessages: Message[] | null = null
      const deps: QueryDeps = {
        ...productionDeps(),
        callModel: async function* (params) {
          capturedMessages = params.messages as Message[]
          yield createAssistantMessage({ content: 'ok' })
        },
      }

      let appState: AppState = getDefaultAppState()
      const engine = new QueryEngine({
        cwd,
        tools: [],
        commands: [],
        mcpClients: [],
        agents: [],
        canUseTool: async (_tool, input) => ({
          behavior: 'allow' as const,
          updatedInput: input,
        }),
        getAppState: () => appState,
        setAppState: updater => {
          appState = updater(appState)
        },
        readFileCache: createFileStateCacheWithSizeLimit(20),
        customSystemPrompt: 'You are a test assistant.',
        thinkingConfig: { type: 'disabled' },
        queryDeps: deps,
      })

      const outputs = []
      for await (const output of engine.submitMessage('捕获 管线 怎么验证')) {
        outputs.push(output)
      }

      expect(outputs.some(output => output.type === 'assistant')).toBe(true)
      expect(capturedMessages).not.toBeNull()
      const requestText = capturedMessages!
        .map(message => getUserMessageText(message))
        .filter(Boolean)
        .join('\n')
      expect(requestText).toContain('Relevant prior sidecar memory for this turn')
      expect(requestText).toContain('obs-query-engine-prefetch')
      expect(requestText).toContain('proposal-query-engine-prefetch')

      const persistedText = engine.getMessages()
        .map(message => getUserMessageText(message))
        .filter(Boolean)
        .join('\n')
      expect(persistedText).toContain('捕获 管线 怎么验证')
      expect(persistedText).not.toContain('Relevant prior sidecar memory for this turn')
      expect(persistedText).not.toContain('obs-query-engine-prefetch')
    } finally {
      if (previousHome === undefined) {
        delete process.env.MOSSEN_MEMORY_SIDECAR_HOME
      } else {
        process.env.MOSSEN_MEMORY_SIDECAR_HOME = previousHome
      }
      await fixture.cleanup()
    }
  })
})
