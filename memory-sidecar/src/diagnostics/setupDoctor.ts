import { access, stat } from 'node:fs/promises'
import type { MemorySidecarConfig } from '../config/config.js'
import { resolveMossenProfile } from '../llm/provider.js'

export type MemorySidecarDiagnosticStatus = 'ok' | 'warn' | 'fail'

export type MemorySidecarDoctorPaths = {
  home: string
  root: string
  configPath: string
  projectId: string
  memoryDir: string
  sqlitePath: string
}

export type MemorySidecarDoctorCheck = {
  id: string
  status: MemorySidecarDiagnosticStatus
  summary: string
  detail?: string
}

export type MemorySidecarDoctorReport = {
  status: MemorySidecarDiagnosticStatus
  generatedAt: string
  projectId: string
  paths: MemorySidecarDoctorPaths
  checks: MemorySidecarDoctorCheck[]
}

export type MemorySidecarLlmTestReport = {
  status: 'completed' | 'skipped' | 'failed'
  providerKind: string
  operation: 'classify-observations'
  reason?: string
  hasJson: boolean
  textPreview?: string
  metadata?: Record<string, unknown>
}

export async function createMemorySidecarDoctorReport(options: {
  paths: MemorySidecarDoctorPaths
  config: MemorySidecarConfig
}): Promise<MemorySidecarDoctorReport> {
  const { paths, config } = options
  const checks: MemorySidecarDoctorCheck[] = [
    await fileCheck('config', paths.configPath, 'config file exists'),
    await dirCheck('root', paths.root, 'sidecar root exists'),
    await dirCheck('memory-dir', paths.memoryDir, 'project memory dir exists'),
    {
      id: 'enabled',
      status: config.enabled ? 'ok' : 'warn',
      summary: config.enabled ? 'sidecar is enabled' : 'sidecar is disabled',
    },
    {
      id: 'adapter',
      status: config.adapter.enabled ? 'ok' : 'warn',
      summary: config.adapter.enabled
        ? 'adapter ingest is enabled'
        : 'adapter ingest is disabled',
    },
    {
      id: 'sqlite',
      status: config.index.sqlite && config.index.fts ? 'ok' : 'warn',
      summary: config.index.sqlite && config.index.fts
        ? 'sqlite and fts indexing are enabled'
        : 'sqlite or fts indexing is disabled',
      detail: paths.sqlitePath,
    },
    llmCheck(config),
    {
      id: 'retrieval',
      status: config.retrieval.mcp ? 'ok' : 'warn',
      summary: config.retrieval.mcp
        ? 'retrieval mcp is enabled'
        : 'retrieval mcp is disabled',
    },
  ]

  return {
    status: aggregateStatus(checks),
    generatedAt: new Date().toISOString(),
    projectId: paths.projectId,
    paths,
    checks,
  }
}

export function summarizeLlmTestResult(options: {
  providerKind: string
  result: {
    status: 'completed' | 'skipped' | 'failed'
    reason?: string
    text?: string
    json?: unknown
    metadata?: Record<string, unknown>
  }
}): MemorySidecarLlmTestReport {
  const { providerKind, result } = options
  return {
    status: result.status,
    providerKind,
    operation: 'classify-observations',
    reason: result.reason ? redactSecretLikeText(result.reason) : undefined,
    hasJson: result.json !== undefined,
    textPreview: result.text ? redactSecretLikeText(compact(result.text, 240)) : undefined,
    metadata: sanitizeMetadata(result.metadata),
  }
}

async function fileCheck(
  id: string,
  path: string,
  okSummary: string,
): Promise<MemorySidecarDoctorCheck> {
  return access(path)
    .then(() => ({
      id,
      status: 'ok' as const,
      summary: okSummary,
      detail: path,
    }))
    .catch(() => ({
      id,
      status: 'warn' as const,
      summary: `${id} is missing`,
      detail: path,
    }))
}

async function dirCheck(
  id: string,
  path: string,
  okSummary: string,
): Promise<MemorySidecarDoctorCheck> {
  try {
    const current = await stat(path)
    return {
      id,
      status: current.isDirectory() ? 'ok' : 'fail',
      summary: current.isDirectory() ? okSummary : `${id} is not a directory`,
      detail: path,
    }
  } catch {
    return {
      id,
      status: 'warn',
      summary: `${id} is missing`,
      detail: path,
    }
  }
}

function llmCheck(config: MemorySidecarConfig): MemorySidecarDoctorCheck {
  if (!config.classification.llm) {
    return {
      id: 'llm',
      status: 'warn',
      summary: 'llm classification is disabled',
    }
  }

  const providerKind =
    config.classification.llmProviderConfig?.kind ??
    config.classification.llmProvider
  if (providerKind === 'mossen-profile') {
    // W121-A.1: mossen-profile is fully deprecated. Doctor surfaces a fail
    // with the migration hint instead of probing settings.json.
    const resolved = resolveMossenProfile({ kind: 'mossen-profile' })
    return {
      id: 'llm',
      status: 'fail',
      summary: 'mossen-profile sidecar LLM mode is deprecated',
      detail: resolved.reason,
    }
  }

  return {
    id: 'llm',
    status: providerKind === 'disabled' ? 'warn' : 'ok',
    summary: `llm provider: ${providerKind}`,
  }
}

function aggregateStatus(
  checks: MemorySidecarDoctorCheck[],
): MemorySidecarDiagnosticStatus {
  if (checks.some(check => check.status === 'fail')) return 'fail'
  if (checks.some(check => check.status === 'warn')) return 'warn'
  return 'ok'
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (/api.?key|token|authorization|secret/i.test(key)) {
      sanitized[key] = '[redacted]'
    } else if (typeof value === 'string') {
      sanitized[key] = redactSecretLikeText(value)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

function redactSecretLikeText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(sk-[A-Za-z0-9._-]{6,})\b/g, '[redacted]')
    .replace(/\b([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, '[redacted]')
}

function compact(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= maxLength
    ? collapsed
    : `${collapsed.slice(0, maxLength - 3)}...`
}
