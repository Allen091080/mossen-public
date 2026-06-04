import { mkdir, readFile } from 'node:fs/promises'
import type { MemoryRootOptions } from '../index'
import { getProjectMemoryDir } from '../index'
import {
  summarizeProposalCandidates,
  type ProposalUserSummary,
} from '../proposal/detectProposals.js'
import type { Proposal, ProposalStatus, ProposalType } from '../schema/proposal'
import { isProposal } from '../schema/proposal'
import { appendJsonlLine } from './jsonlAppend'

export type AppendProposalOptions = MemoryRootOptions & {
  proposal: Proposal
}

export type AppendProposalsOptions = MemoryRootOptions & {
  proposals: Proposal[]
}

export type AppendProposalResult = {
  proposal: Proposal
  jsonlPath: string
  byteOffset?: number
  byteLength?: number
  skipped: boolean
  reason?: 'duplicate_candidate_proposal_id'
}

export type ProposalWithLocation = {
  proposal: Proposal
  jsonlPath: string
  byteOffset: number
  byteLength: number
}

export type ListProposalsOptions = MemoryRootOptions & {
  type?: ProposalType
  status?: ProposalStatus
  projectId?: string
  limit?: number
}

export type RecentProposalsOptions = MemoryRootOptions & {
  type?: ProposalType
  status?: ProposalStatus
  projectId?: string
  limit?: number
}

export type ReviewProposalOptions = MemoryRootOptions & {
  proposalId: string
  status: Extract<ProposalStatus, 'accepted' | 'rejected' | 'candidate'>
  decisionReason?: string
  reviewedAt?: string
}

export type ProposalCandidateSummaryOptions = RecentProposalsOptions & {
  maxItems?: number
}

export function getProposalsPath(options: MemoryRootOptions): string {
  return `${getProjectMemoryDir(options)}/proposals.jsonl`
}

export async function appendProposal(
  options: AppendProposalOptions,
): Promise<AppendProposalResult> {
  const [result] = await appendProposals({
    ...options,
    proposals: [options.proposal],
  })

  return result
}

export async function appendProposals(
  options: AppendProposalsOptions,
): Promise<AppendProposalResult[]> {
  const jsonlPath = getProposalsPath(options)
  await mkdir(getProjectMemoryDir(options), { recursive: true })

  const existing = await readProposalsFromPath(jsonlPath)
  const seenCandidateProposalIds = new Set(
    existing
      .filter(({ proposal }) => proposal.status === 'candidate')
      .map(({ proposal }) => proposal.proposalId),
  )

  const results: AppendProposalResult[] = []

  for (const proposal of options.proposals) {
    assertProposalForProject(proposal, options.projectId)

    if (
      proposal.status === 'candidate' &&
      seenCandidateProposalIds.has(proposal.proposalId) &&
      !isCandidateReviewRecord(proposal)
    ) {
      results.push({
        proposal,
        jsonlPath,
        skipped: true,
        reason: 'duplicate_candidate_proposal_id',
      })
      continue
    }

    const { byteOffset, byteLength } = await appendJsonlLine(jsonlPath, proposal)

    if (proposal.status === 'candidate' && !isCandidateReviewRecord(proposal)) {
      seenCandidateProposalIds.add(proposal.proposalId)
    }
    results.push({
      proposal,
      jsonlPath,
      byteOffset,
      byteLength,
      skipped: false,
    })
  }

  return results
}

export async function listProposals(
  options: ListProposalsOptions,
): Promise<ProposalWithLocation[]> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  if (limit <= 0) return []

  const proposals = await readProposalsFromPath(getProposalsPath(options))
  return proposals
    .filter(({ proposal }) => matchesProposalFilter(proposal, options))
    .slice(0, limit)
}

export async function recentProposals(
  options: RecentProposalsOptions,
): Promise<ProposalWithLocation[]> {
  const limit = options.limit ?? 20
  if (limit <= 0) return []

  const proposals = await readProposalsFromPath(getProposalsPath(options))
  return latestProposalRecords(proposals
    .filter(({ proposal }) => matchesProposalFilter(proposal, options))
  )
    .sort((a, b) => proposalSortKey(b.proposal).localeCompare(proposalSortKey(a.proposal)))
    .slice(0, limit)
}

export async function reviewProposal(
  options: ReviewProposalOptions,
): Promise<AppendProposalResult> {
  const [latest] = await listProposals({
    rootDir: options.rootDir,
    memoryDir: options.memoryDir,
    projectId: options.projectId,
    limit: Number.POSITIVE_INFINITY,
  }).then(proposals =>
    proposals
      .filter(({ proposal }) => proposal.proposalId === options.proposalId)
      .sort((a, b) => proposalSortKey(b.proposal).localeCompare(proposalSortKey(a.proposal))),
  )

  if (!latest) {
    throw new Error(`proposal not found: ${options.proposalId}`)
  }

  return appendProposal({
    ...options,
    proposal: {
      ...latest.proposal,
      status: options.status,
      updatedAt: options.reviewedAt ?? new Date().toISOString(),
      reviewedAt: options.reviewedAt ?? new Date().toISOString(),
      decisionReason: options.decisionReason,
    },
  })
}

export async function proposalCandidateSummary(
  options: ProposalCandidateSummaryOptions,
): Promise<ProposalUserSummary> {
  const entries = await recentProposals({
    ...options,
    status: options.status ?? 'candidate',
  })

  return summarizeProposalCandidates(
    entries.map(entry => entry.proposal),
    { maxItems: options.maxItems },
  )
}

function proposalSortKey(proposal: Proposal): string {
  return proposal.updatedAt ?? proposal.reviewedAt ?? proposal.createdAt
}

function isCandidateReviewRecord(proposal: Proposal): boolean {
  return proposal.status === 'candidate' && Boolean(proposal.reviewedAt || proposal.decisionReason)
}

function latestProposalRecords(records: ProposalWithLocation[]): ProposalWithLocation[] {
  const latest = new Map<string, ProposalWithLocation>()
  for (const record of records) {
    const current = latest.get(record.proposal.proposalId)
    if (!current || proposalSortKey(record.proposal) >= proposalSortKey(current.proposal)) {
      latest.set(record.proposal.proposalId, record)
    }
  }
  return [...latest.values()]
}

async function readProposalsFromPath(jsonlPath: string): Promise<ProposalWithLocation[]> {
  const contents = await readFile(jsonlPath, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })

  const proposals: ProposalWithLocation[] = []
  let byteOffset = 0
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trimEnd()
    const byteLength = Buffer.byteLength(`${rawLine}\n`)
    if (line.trim()) {
      const parsed = JSON.parse(line) as unknown
      if (!isProposal(parsed)) {
        throw new Error(`invalid proposal record at byte offset ${byteOffset}`)
      }
      proposals.push({
        proposal: parsed,
        jsonlPath,
        byteOffset,
        byteLength,
      })
    }
    byteOffset += byteLength
  }

  return proposals
}

function assertProposalForProject(proposal: Proposal, projectId: string): void {
  if (!isProposal(proposal)) {
    throw new Error('proposal must match Proposal schema')
  }

  if (proposal.projectId !== projectId) {
    throw new Error('proposal.projectId must match append projectId')
  }
}

function matchesProposalFilter(
  proposal: Proposal,
  options: ListProposalsOptions,
): boolean {
  return (
    (!options.type || proposal.type === options.type) &&
    (!options.status || proposal.status === options.status) &&
    (!options.projectId || proposal.projectId === options.projectId)
  )
}
