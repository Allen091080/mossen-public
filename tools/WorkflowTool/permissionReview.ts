import { readFileSync } from 'node:fs'
import { loadRunScript } from './engine/journalStore.js'
import { extractMeta } from './engine/meta.js'
import type { WorkflowMeta } from './engine/types.js'
import { workflowUsageConsentHash } from './usageConsent.js'

const MAX_PREVIEW_CHARS = 1200
const MAX_SCRIPT_LINES = 18

export type WorkflowPermissionInput = {
  script?: unknown
  scriptPath?: unknown
  args?: unknown
  timeoutMs?: unknown
  resumeFromRunId?: unknown
  run_in_background?: unknown
}

export type WorkflowPermissionReview = {
  sourceKind: 'inline' | 'file' | 'resume' | 'missing'
  sourceLabel: string
  meta: WorkflowMeta | null
  metaError: string | null
  argsPreview: string | null
  scriptPreview: string | null
  usageConsentHash: string | null
  timeoutMs: number | null
  resumeFromRunId: string | null
  runInBackground: boolean
  showUsageWarning: boolean
}

function truncatePreview(text: string, maxChars = MAX_PREVIEW_CHARS): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 16)}\n... [truncated]`
}

function previewUnknown(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value === 'string') return truncatePreview(value)
  try {
    return truncatePreview(JSON.stringify(value, null, 2) ?? String(value))
  } catch {
    return truncatePreview(String(value))
  }
}

function scriptPreview(source: string): string {
  const lines = source.split(/\r?\n/).slice(0, MAX_SCRIPT_LINES)
  return truncatePreview(lines.join('\n'))
}

function resolveWorkflowSource(input: WorkflowPermissionInput): {
  sourceKind: WorkflowPermissionReview['sourceKind']
  sourceLabel: string
  source: string | null
  readError: string | null
} {
  if (typeof input.script === 'string' && input.script.trim()) {
    return {
      sourceKind: 'inline',
      sourceLabel: 'inline script',
      source: input.script,
      readError: null,
    }
  }

  if (typeof input.scriptPath === 'string' && input.scriptPath.trim()) {
    try {
      return {
        sourceKind: 'file',
        sourceLabel: input.scriptPath,
        source: readFileSync(input.scriptPath, 'utf8'),
        readError: null,
      }
    } catch (err) {
      return {
        sourceKind: 'file',
        sourceLabel: input.scriptPath,
        source: null,
        readError: (err as Error).message,
      }
    }
  }

  if (
    typeof input.resumeFromRunId === 'string' &&
    input.resumeFromRunId.trim()
  ) {
    const runId = input.resumeFromRunId.trim()
    const persisted = loadRunScript(runId)
    return {
      sourceKind: 'resume',
      sourceLabel: runId,
      source: persisted,
      readError: persisted ? null : `No persisted script found for ${runId}.`,
    }
  }

  return {
    sourceKind: 'missing',
    sourceLabel: 'missing script',
    source: null,
    readError: 'Workflow requires either script, scriptPath, or resumeFromRunId.',
  }
}

export function buildWorkflowPermissionReview(
  input: WorkflowPermissionInput,
  options: { showUsageWarning?: boolean } = {},
): WorkflowPermissionReview {
  const resolved = resolveWorkflowSource(input)
  let meta: WorkflowMeta | null = null
  let metaError = resolved.readError
  if (resolved.source) {
    try {
      meta = extractMeta(resolved.source).meta
      metaError = null
    } catch (err) {
      metaError = (err as Error).message
    }
  }

  return {
    sourceKind: resolved.sourceKind,
    sourceLabel: resolved.sourceLabel,
    meta,
    metaError,
    argsPreview: previewUnknown(input.args),
    scriptPreview: resolved.source ? scriptPreview(resolved.source) : null,
    usageConsentHash: resolved.source
      ? workflowUsageConsentHash(resolved.source)
      : null,
    timeoutMs:
      typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
        ? input.timeoutMs
        : null,
    resumeFromRunId:
      typeof input.resumeFromRunId === 'string' && input.resumeFromRunId.trim()
        ? input.resumeFromRunId.trim()
        : null,
    runInBackground: input.run_in_background === true,
    showUsageWarning: options.showUsageWarning !== false,
  }
}
