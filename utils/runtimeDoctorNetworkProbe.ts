import {
  getCustomBackendBaseUrl,
  getCustomBackendName,
  getCustomBackendProtocol,
  isPlaceholderHostedPlatformUrl,
} from './customBackend.js'
import { getDisplayAppVersion } from './version.js'

type RuntimeDoctorCheckStatus = 'ok' | 'warn' | 'fail' | 'unavailable'
type RuntimeDoctorCheckSeverity = 'info' | 'warning' | 'error'

export type RuntimeDoctorCheck = {
  id: string
  title: string
  status: RuntimeDoctorCheckStatus
  severity: RuntimeDoctorCheckSeverity
  summary: string
}

type RuntimeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type RuntimeDoctorNetworkProbeOptions = {
  baseUrl?: null | string
  backendName?: string
  protocol?: string
  fetchImpl?: RuntimeFetch
  timeoutMs?: number
}

const NETWORK_PROBE_TIMEOUT_MS = 1500
const USER_AGENT = 'mossen-runtime-doctor'

function sanitizedProbeError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'unknown error'

  return raw
    .replace(/https?:\/\/[^\s"')]+/gi, '[url]')
    .replace(/\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/-]+/gi, '[credential]')
    .replace(/\b(?:sk|pk)-[A-Za-z0-9._-]{12,}\b/gi, '[credential]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .slice(0, 180)
}

function statusForHttpStatus(status: number): RuntimeDoctorCheckStatus {
  if (status >= 200 && status < 500) return 'ok'
  if (status >= 500) return 'warn'
  return 'unavailable'
}

function severityForStatus(
  status: RuntimeDoctorCheckStatus,
): RuntimeDoctorCheckSeverity {
  if (status === 'fail') return 'error'
  if (status === 'warn') return 'warning'
  return 'info'
}

function formatBackendLabel(
  backendName: string,
  protocol: null | string,
  url: URL,
): string {
  const protocolSuffix = protocol ? ` (${protocol})` : ''
  return `${backendName}${protocolSuffix} at ${url.host}`
}

export async function buildRuntimeDoctorNetworkProbeChecks(
  options: RuntimeDoctorNetworkProbeOptions = {},
): Promise<RuntimeDoctorCheck[]> {
  const baseUrl =
    options.baseUrl === undefined ? getCustomBackendBaseUrl() : options.baseUrl
  const backendName = options.backendName ?? getCustomBackendName()
  const protocol = options.protocol ?? getCustomBackendProtocol()
  const timeoutMs = options.timeoutMs ?? NETWORK_PROBE_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  const checks: RuntimeDoctorCheck[] = []

  if (!baseUrl) {
    checks.push({
      id: 'network_probe',
      title: 'Backend reachability',
      status: 'unavailable',
      severity: 'info',
      summary:
        'no custom backend base URL configured; network probe skipped without reading credentials',
    })
  } else {
    try {
      const target = new URL(baseUrl)
      const label = formatBackendLabel(backendName, protocol, target)

      if (isPlaceholderHostedPlatformUrl(target.toString())) {
        checks.push({
          id: 'network_probe',
          title: 'Backend reachability',
          status: 'unavailable',
          severity: 'warning',
          summary: `${label} is a placeholder URL; no network request was made`,
        })
      } else if (typeof fetchImpl !== 'function') {
        checks.push({
          id: 'network_probe',
          title: 'Backend reachability',
          status: 'unavailable',
          severity: 'warning',
          summary: `${label} could not be probed because fetch is unavailable`,
        })
      } else {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const response = await fetchImpl(target.toString(), {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
              'User-Agent': USER_AGENT,
            },
          })
          const status = statusForHttpStatus(response.status)
          checks.push({
            id: 'network_probe',
            title: 'Backend reachability',
            status,
            severity: severityForStatus(status),
            summary: `${label} reachable: HTTP ${response.status}; no credentials sent`,
          })
        } catch (error) {
          const aborted =
            error instanceof Error && error.name === 'AbortError'
          checks.push({
            id: 'network_probe',
            title: 'Backend reachability',
            status: aborted ? 'warn' : 'fail',
            severity: aborted ? 'warning' : 'error',
            summary: `${label} probe ${
              aborted ? `timed out after ${timeoutMs}ms` : 'failed'
            }: ${sanitizedProbeError(error)}; no credentials sent`,
          })
        } finally {
          clearTimeout(timer)
        }
      }
    } catch {
      checks.push({
        id: 'network_probe',
        title: 'Backend reachability',
        status: 'fail',
        severity: 'error',
        summary:
          'configured custom backend base URL is invalid; no network request was made',
      })
    }
  }

  checks.push({
    id: 'version_probe',
    title: 'Runtime version',
    status: 'ok',
    severity: 'info',
    summary: `local version ${getDisplayAppVersion()}; remote latest-version lookup is not performed`,
  })

  return checks
}
