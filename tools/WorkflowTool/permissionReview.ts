import { getProjectRoot } from '../../bootstrap/state.js'
import { extractMeta } from './engine/meta.js'
import {
  analyzeWorkflowStaticSummary,
  type WorkflowStaticSummary,
} from './engine/staticSummary.js'
import type { WorkflowMeta } from './engine/types.js'
import {
  getAllWorkflows,
  resolveWorkflowFromSources,
  type SavedWorkflowRef,
} from './savedWorkflows.js'
import { readWorkflowScriptFile } from './scriptFile.js'
import { workflowUsageConsentHash } from './usageConsent.js'

const MAX_PREVIEW_CHARS = 1200
const MAX_SCRIPT_LINES = 18

export type WorkflowPermissionInput = {
  script?: unknown
  name?: unknown
  description?: unknown
  title?: unknown
  scriptPath?: unknown
  args?: unknown
  timeoutMs?: unknown
  resumeFromRunId?: unknown
}

export type WorkflowPermissionReview = {
  sourceKind: 'inline' | 'file' | 'named' | 'missing'
  sourceLabel: string
  meta: WorkflowMeta | null
  metaError: string | null
  argsPreview: string | null
  scriptSource: string | null
  scriptPreview: string | null
  staticSummary: WorkflowStaticSummary | null
  usageConsentHash: string | null
  timeoutMs: number | null
  resumeFromRunId: string | null
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

function sourceFromWorkflowRef(
  ref: SavedWorkflowRef,
  requestedName: string,
): { source: string | null; readError: string | null } {
  if (ref.source) return { source: ref.source, readError: null }
  if (ref.scriptPath) {
    try {
      return { source: readWorkflowScriptFile(ref.scriptPath), readError: null }
    } catch (err) {
      return { source: null, readError: (err as Error).message }
    }
  }
  return {
    source: null,
    readError: `workflow("${requestedName}"): workflow has no source or scriptPath.`,
  }
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
        source: readWorkflowScriptFile(input.scriptPath),
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

  if (typeof input.name === 'string' && input.name.trim()) {
    const name = input.name.trim()
    const root = getProjectRoot()
    const ref = resolveWorkflowFromSources(root, name)
    if (!ref) {
      const available = getAllWorkflows(root).map(wf => wf.commandName)
      return {
        sourceKind: 'named',
        sourceLabel: name,
        source: null,
        readError: `Workflow "${name}" not found. Available: ${
          available.length ? available.join(', ') : '(none)'
        }`,
      }
    }
    const resolved = sourceFromWorkflowRef(ref, name)
    return {
      sourceKind: 'named',
      sourceLabel: name,
      source: resolved.source,
      readError: resolved.readError,
    }
  }

  return {
    sourceKind: 'missing',
    sourceLabel: 'missing script',
    source: null,
    readError: 'Must provide script, name, or scriptPath',
  }
}

export function buildWorkflowPermissionReview(
  input: WorkflowPermissionInput,
  options: { showUsageWarning?: boolean } = {},
): WorkflowPermissionReview {
  const resolved = resolveWorkflowSource(input)
  let meta: WorkflowMeta | null = null
  let metaError = resolved.readError
  let staticSummarySource = resolved.source
  if (resolved.source) {
    try {
      const extracted = extractMeta(resolved.source)
      meta = extracted.meta
      staticSummarySource = extracted.scriptBody
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
    scriptSource: resolved.source,
    scriptPreview: resolved.source ? scriptPreview(resolved.source) : null,
    staticSummary: staticSummarySource
      ? analyzeWorkflowStaticSummary(staticSummarySource)
      : null,
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
    showUsageWarning: options.showUsageWarning !== false,
  }
}
