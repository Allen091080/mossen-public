import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getSessionId } from '../../bootstrap/state.js'
import { getProjectsDir } from '../../utils/sessionStorage.js'

const RECEIPTS_FILE = 'workbench-action-receipts.jsonl'
const MAX_RECEIPTS = 50

export type WorkbenchWorkflowActionReceiptStatus =
  | 'received'
  | 'accepted'
  | 'rejected'
  | 'failed'

export type WorkbenchWorkflowActionReceipt = {
  version: 1
  receiptId: string
  actionId: string
  status: WorkbenchWorkflowActionReceiptStatus
  createdAt: string
  input: string | null
  command: string | null
  runId: string | null
  workflowName: string | null
  message: string | null
  source: 'workbench' | 'cli' | 'system'
}

export function workbenchActionReceiptsPath(): string {
  return join(
    getProjectsDir(),
    getSessionId(),
    'subagents',
    'workflows',
    RECEIPTS_FILE,
  )
}

function stableReceiptId(params: {
  actionId: string
  createdAt: string
  input?: string | null
  command?: string | null
  runId?: string | null
}): string {
  const payload = [
    params.actionId,
    params.createdAt,
    params.input ?? '',
    params.command ?? '',
    params.runId ?? '',
  ].join('|')
  let hash = 0
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0
  }
  return `wfr_${hash.toString(16).padStart(8, '0')}`
}

export function recordWorkbenchWorkflowActionReceipt(params: {
  actionId: string
  status?: WorkbenchWorkflowActionReceiptStatus
  input?: string | null
  command?: string | null
  runId?: string | null
  workflowName?: string | null
  message?: string | null
  source?: WorkbenchWorkflowActionReceipt['source']
  createdAt?: string
}): WorkbenchWorkflowActionReceipt | null {
  try {
    const createdAt = params.createdAt ?? new Date().toISOString()
    const receipt: WorkbenchWorkflowActionReceipt = {
      version: 1,
      receiptId: stableReceiptId({
        actionId: params.actionId,
        createdAt,
        input: params.input,
        command: params.command,
        runId: params.runId,
      }),
      actionId: params.actionId,
      status: params.status ?? 'received',
      createdAt,
      input: params.input ?? null,
      command: params.command ?? null,
      runId: params.runId ?? null,
      workflowName: params.workflowName ?? null,
      message: params.message ?? null,
      source: params.source ?? 'workbench',
    }
    const path = workbenchActionReceiptsPath()
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(receipt)}\n`, 'utf8')
    return receipt
  } catch {
    return null
  }
}

function parseReceipt(value: unknown): WorkbenchWorkflowActionReceipt | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WorkbenchWorkflowActionReceipt>
  if (
    candidate.version !== 1 ||
    typeof candidate.receiptId !== 'string' ||
    typeof candidate.actionId !== 'string' ||
    typeof candidate.createdAt !== 'string' ||
    !['received', 'accepted', 'rejected', 'failed'].includes(
      String(candidate.status),
    )
  ) {
    return null
  }
  return {
    version: 1,
    receiptId: candidate.receiptId,
    actionId: candidate.actionId,
    status: candidate.status as WorkbenchWorkflowActionReceiptStatus,
    createdAt: candidate.createdAt,
    input: typeof candidate.input === 'string' ? candidate.input : null,
    command: typeof candidate.command === 'string' ? candidate.command : null,
    runId: typeof candidate.runId === 'string' ? candidate.runId : null,
    workflowName:
      typeof candidate.workflowName === 'string' ? candidate.workflowName : null,
    message: typeof candidate.message === 'string' ? candidate.message : null,
    source:
      candidate.source === 'cli' || candidate.source === 'system'
        ? candidate.source
        : 'workbench',
  }
}

export function loadWorkbenchWorkflowActionReceipts(
  max = MAX_RECEIPTS,
): WorkbenchWorkflowActionReceipt[] {
  try {
    const path = workbenchActionReceiptsPath()
    if (!existsSync(path)) return []
    const receipts: WorkbenchWorkflowActionReceipt[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = parseReceipt(JSON.parse(trimmed))
        if (parsed) receipts.push(parsed)
      } catch {
        // Ignore corrupt trailing or legacy lines. The receipt log is advisory.
      }
    }
    return receipts
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, max))
  } catch {
    return []
  }
}
