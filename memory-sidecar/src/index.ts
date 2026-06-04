export * from './schema/archiveEvent.js'
export * from './schema/observation.js'
export * from './schema/profile.js'
export * from './schema/proposal.js'
export * from './schema/scope.js'
export * from './schema/contract.js'
export * from './config/config.js'
export * from './redaction/redact.js'
export * from './storage/jsonlArchiveStore.js'
export * from './storage/manifest.js'
export * from './storage/maintenance.js'
export * from './storage/verifyRepair.js'
export * from './storage/sqliteIndex.js'
export * from './storage/observationStore.js'
export * from './storage/profileStore.js'
export * from './storage/proposalStore.js'
export * from './storage/vectorIndex.js'
export * from './storage/vectorStore.js'
export * from './ingest/conversationEvent.js'
export * from './ingest/archiveWriter.js'
export * from './ingest/ingressApi.js'
export * from './adapter/payload.js'
export * from './adapter/ingestAdapter.js'
export * from './adapter/deadLetterStore.js'
export * from './agent/dirtyQueue.js'
export * from './agent/jobQueue.js'
export * from './agent/jobRunner.js'
export * from './agent/scheduler.js'
export * from './agent/workerRunOnce.js'
export * from './agent/workerLoop.js'
export * from './classify/ruleClassifier.js'
export * from './classify/refineObservations.js'
export * from './classify/evaluateClassifier.js'
export * from './llm/provider.js'
export * from './classify/llmClassifier.js'
export * from './profile/synthesizeProfile.js'
export * from './proposal/detectProposals.js'
export * from './retrieval/search.js'
export * from './retrieval/get.js'
export * from './retrieval/timeline.js'
export * from './retrieval/context.js'
export * from './retrieval/recallForMossen.js'
export * from './management/userMemory.js'
export * from './management/trialReport.js'
export * from './management/healthReport.js'
export * from './management/explainCapture.js'
export * from './management/recallTest.js'
export * from './management/dataIntegrityReport.js'
export * from './management/repairPlan.js'
export * from './management/workerReport.js'
export * from './management/runOnceReport.js'
export * from './agent/releaseLock.js'
export * from './llm/llmTest.js'

import type {
  ObservationDomain,
  ObservationKind,
  ObservationLifecycle,
  ObservationRetrievalPolicy,
  ObservationType,
} from './schema/observation'
import type { ProposalType } from './schema/proposal'
import type { MemoryScope, Visibility } from './schema/scope'
import type { LlmProviderConfig, LlmProviderConfigByJob } from './llm/provider'

export type MemoryRootOptions = {
  projectId: string
  memoryDir?: string
  rootDir?: string
  llmProviderConfig?: LlmProviderConfig
  llmProviderConfigByJob?: LlmProviderConfigByJob
}

export type ScopeFilter = {
  scope: MemoryScope
  projectId?: string
  sessionId?: string
  workspaceId?: string
  userId?: string
  teamId?: string
}

export type LightweightMemoryResult = {
  id: string
  source: 'archive' | 'observation' | 'profile' | 'proposal'
  scope: MemoryScope
  score: number
  tokenEstimate: number
  title?: string
  summary?: string
  textPreview?: string
  type?: ObservationType | ProposalType
  kind?: ObservationKind
  domain?: ObservationDomain
  lifecycle?: ObservationLifecycle
  retrievalPolicy?: ObservationRetrievalPolicy
  createdAt?: string
  projectId?: string
  sessionId?: string
  evidenceIds?: string[]
  evidenceEventIds?: string[]
}

export function estimateTokens(text: string | undefined): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

export function getProjectMemoryDir(options: MemoryRootOptions): string {
  if (options.memoryDir) return options.memoryDir

  const home = process.env.HOME ?? '.'
  const rootDir = options.rootDir ?? `${home}/.mossen`
  return `${rootDir}/projects/${options.projectId}/memory`
}

export function visibilityForScope(scope: MemoryScope): Visibility {
  if (scope === 'team') return 'team'
  if (scope === 'workspace') return 'workspace'
  if (scope === 'project') return 'project'
  return 'private'
}

export function assertScopeFilter(scopeFilter: ScopeFilter): void {
  if (!scopeFilter?.scope) {
    throw new Error('scopeFilter.scope is required for memory retrieval')
  }

  if (
    (scopeFilter.scope === 'session' || scopeFilter.scope === 'project') &&
    !scopeFilter.projectId
  ) {
    throw new Error(`scopeFilter.projectId is required for ${scopeFilter.scope} scope`)
  }

  if (scopeFilter.scope === 'session' && !scopeFilter.sessionId) {
    throw new Error('scopeFilter.sessionId is required for session scope')
  }
}
