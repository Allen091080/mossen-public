import { existsSync } from 'fs'
import { appendFile, readFile, rename, stat } from 'fs/promises'
import { basename } from 'path'
import { z } from 'zod/v4'
import { isInBundledMode } from '../../utils/bundledMode.js'
import {
  ensureAgentSupervisorBaseDirs,
  getAgentSupervisorJobsDir,
  getAgentSupervisorLockPath,
  getAgentSupervisorLogPath,
  getAgentSupervisorRosterPath,
} from './paths.js'
import {
  readAgentSupervisorRoster,
  upsertAgentSupervisorRosterJob,
} from './roster.js'
import {
  AGENT_SUPERVISOR_SCHEMA_VERSION,
  type AgentSupervisorJobState,
} from './schema.js'
import {
  atomicWriteSupervisorJsonFile,
  readAgentSupervisorJobState,
  updateAgentSupervisorJobState,
} from './state.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

const SUPERVISOR_LOCK_STALE_MS = 30_000
const DEFAULT_SUPERVISOR_LOG_MAX_BYTES = 1024 * 1024
const CLOCK_FUTURE_SKEW_MS = 30_000
const CLOCK_HEARTBEAT_LAG_MS = 5 * 60_000
const CLOCK_JUMP_PROCESS_RECONCILE_GRACE_MS = 60_000
const PROCESS_RECONCILE_INTERVAL_MS = 15_000

let lastProcessReconcileAt = 0
let lastClockJumpSignature: string | null = null
let processReconcileGraceUntil = 0

type AgentSupervisorClockJumpReason =
  | 'heartbeat_future'
  | 'roster_future'
  | 'heartbeat_lag'

const AgentSupervisorLockSchema = z.object({
  schemaVersion: z.literal(AGENT_SUPERVISOR_SCHEMA_VERSION),
  pid: z.number().int().positive().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  heartbeatAt: z.string().nullable(),
  cmdline: z.string().nullable(),
  releasedAt: z.string().nullable(),
})

export type AgentSupervisorLock = z.infer<typeof AgentSupervisorLockSchema>

export type AgentSupervisorDoctorStatus = {
  disabled: boolean
  disabledReason: string | null
  paths: {
    roster: string
    jobsDir: string
    lock: string
    log: string
  }
  lock: {
    exists: boolean
    pid: number | null
    alive: boolean
    stale: boolean
    heartbeatAt: string | null
  }
  roster: {
    jobs: number
  }
  lifecycle: {
    heartbeatAgeMs: number | null
    clockJumpDetected: boolean
    clockJumpReason: AgentSupervisorClockJumpReason | null
    clockJumpGraceActive: boolean
    staleProcessJobs: number
    entrypoint: string
    entrypointExists: boolean
    recoveryHint: string | null
  }
  capabilities: {
    notificationsMode: 'off' | 'needs_input' | 'all'
    resultPayload: boolean
    legacyJobCompatibility: boolean
    highDensityView: boolean
  }
}

export type AgentSupervisorSettingsLike = {
  agentView?: {
    disableAgentView?: boolean
  }
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

export function isAgentSupervisorDisabled(
  settings?: AgentSupervisorSettingsLike,
): { disabled: boolean; reason: string | null } {
  if (isEnvTruthy(process.env.MOSSEN_CODE_DISABLE_AGENT_VIEW)) {
    return { disabled: true, reason: 'MOSSEN_CODE_DISABLE_AGENT_VIEW' }
  }
  if (settings?.agentView?.disableAgentView === true) {
    return { disabled: true, reason: 'settings.agentView.disableAgentView' }
  }
  return { disabled: false, reason: null }
}

function getAgentSupervisorNotificationMode(
  raw = process.env.MOSSEN_AGENT_VIEW_NOTIFICATIONS,
): 'off' | 'needs_input' | 'all' {
  if (raw === '0' || raw === 'off' || raw === 'false') return 'off'
  if (raw === 'all') return 'all'
  return 'needs_input'
}

export function isProcessAlive(pid: number | null | undefined): boolean {
  if (typeof pid !== 'number' || pid <= 0 || !Number.isInteger(pid)) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null
        ? (error as { code?: string }).code
        : undefined
    return code === 'EPERM'
  }
}

function currentCmdline(): string {
  return [process.argv[0], ...process.argv.slice(1)].join(' ')
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getSupervisorEntrypointStatus(): {
  entrypoint: string
  exists: boolean
} {
  const entrypoint = isInBundledMode()
    ? process.execPath
    : process.argv[1] ?? process.execPath
  return {
    entrypoint,
    exists: existsSync(entrypoint),
  }
}

function summarizeClockState(
  lock: AgentSupervisorLock | null,
  rosterUpdatedAt: string,
  nowMs = Date.now(),
): {
  heartbeatAgeMs: number | null
  clockJumpDetected: boolean
  clockJumpReason: AgentSupervisorClockJumpReason | null
} {
  const heartbeatMs = timestampMs(lock?.heartbeatAt)
  const rosterMs = timestampMs(rosterUpdatedAt)
  const heartbeatAgeMs = heartbeatMs === null ? null : nowMs - heartbeatMs
  if (heartbeatMs !== null && heartbeatMs - nowMs > CLOCK_FUTURE_SKEW_MS) {
    return {
      heartbeatAgeMs,
      clockJumpDetected: true,
      clockJumpReason: 'heartbeat_future',
    }
  }
  if (rosterMs !== null && rosterMs - nowMs > CLOCK_FUTURE_SKEW_MS) {
    return {
      heartbeatAgeMs,
      clockJumpDetected: true,
      clockJumpReason: 'roster_future',
    }
  }
  if (heartbeatAgeMs !== null && heartbeatAgeMs > CLOCK_HEARTBEAT_LAG_MS) {
    return {
      heartbeatAgeMs,
      clockJumpDetected: true,
      clockJumpReason: 'heartbeat_lag',
    }
  }
  return {
    heartbeatAgeMs,
    clockJumpDetected: false,
    clockJumpReason: null,
  }
}

function shouldReconcileProcess(state: AgentSupervisorJobState): boolean {
  return state.process.alive && !isProcessAlive(state.process.pid)
}

export async function reconcileAgentSupervisorStaleProcesses(
  options: { force?: boolean; ignoreClockJumpGrace?: boolean } = {},
): Promise<{
  checked: number
  staleProcessJobs: number
  skipped: boolean
  clockJumpGraceActive: boolean
}> {
  const nowMs = Date.now()
  const lock = await readAgentSupervisorLock()
  const roster = await readAgentSupervisorRoster()
  const clock = summarizeClockState(lock, roster.updatedAt, nowMs)
  const clockJumpSignature = clock.clockJumpDetected
    ? `${clock.clockJumpReason}:${lock?.heartbeatAt ?? 'no-heartbeat'}:${roster.updatedAt}`
    : null
  if (
    !options.ignoreClockJumpGrace &&
    clockJumpSignature &&
    clockJumpSignature !== lastClockJumpSignature
  ) {
    lastClockJumpSignature = clockJumpSignature
    processReconcileGraceUntil = Math.max(
      processReconcileGraceUntil,
      nowMs + CLOCK_JUMP_PROCESS_RECONCILE_GRACE_MS,
    )
  }
  const clockJumpGraceActive =
    !options.ignoreClockJumpGrace && nowMs < processReconcileGraceUntil
  if (clockJumpGraceActive) {
    return {
      checked: 0,
      staleProcessJobs: 0,
      skipped: true,
      clockJumpGraceActive: true,
    }
  }
  if (!options.force && nowMs - lastProcessReconcileAt < PROCESS_RECONCILE_INTERVAL_MS) {
    return {
      checked: 0,
      staleProcessJobs: 0,
      skipped: true,
      clockJumpGraceActive: false,
    }
  }
  lastProcessReconcileAt = nowMs
  let checked = 0
  let staleProcessJobs = 0
  for (const job of roster.jobs) {
    const state = await readAgentSupervisorJobState(job.id).catch(() => null)
    if (!state) continue
    checked += 1
    if (!shouldReconcileProcess(state)) continue
    staleProcessJobs += 1
    const now = new Date().toISOString()
    const next = await updateAgentSupervisorJobState(state.id, current => {
      if (!current) return current
      return {
        ...current,
        updatedAt: now,
        process: {
          ...current.process,
          alive: false,
          lastExitedAt: current.process.lastExitedAt ?? now,
        },
        errors: [
          ...current.errors,
          {
            ts: now,
            source: 'lifecycle',
            message: 'Recorded process liveness was stale; marked process as not alive.',
          },
        ],
      }
    })
    if (next) {
      await upsertAgentSupervisorRosterJob(next)
    }
  }
  return { checked, staleProcessJobs, skipped: false, clockJumpGraceActive: false }
}

function formatClockJumpReason(
  reason: AgentSupervisorClockJumpReason,
): string {
  switch (reason) {
    case 'heartbeat_future':
      return getLocalizedText({
        en: 'heartbeat timestamp is in the future',
        zh: 'heartbeat 时间戳位于未来',
      })
    case 'roster_future':
      return getLocalizedText({
        en: 'roster timestamp is in the future',
        zh: 'roster 时间戳位于未来',
      })
    case 'heartbeat_lag':
      return getLocalizedText({
        en: 'heartbeat lag is larger than the sleep/wake window',
        zh: 'heartbeat 延迟超过睡眠/唤醒窗口',
      })
  }
}

export async function readAgentSupervisorLock(): Promise<AgentSupervisorLock | null> {
  try {
    const raw = await readFile(getAgentSupervisorLockPath(), 'utf8')
    const parsed = AgentSupervisorLockSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if (isENOENT(error)) return null
    return null
  }
}

function lockIsStale(lock: AgentSupervisorLock | null, nowMs = Date.now()): boolean {
  if (!lock?.pid) return true
  if (!isProcessAlive(lock.pid)) return true
  if (!lock.heartbeatAt) return false
  return nowMs - Date.parse(lock.heartbeatAt) > SUPERVISOR_LOCK_STALE_MS
}

async function writeAgentSupervisorLock(lock: AgentSupervisorLock): Promise<void> {
  await ensureAgentSupervisorBaseDirs()
  await atomicWriteSupervisorJsonFile(getAgentSupervisorLockPath(), lock)
}

export async function claimAgentSupervisorLock(): Promise<{
  lock: AgentSupervisorLock
  stoleStaleLock: boolean
}> {
  await ensureAgentSupervisorBaseDirs()
  const existing = await readAgentSupervisorLock()
  if (existing?.pid && !lockIsStale(existing)) {
    throw new Error(`Agent supervisor already running: pid ${existing.pid}`)
  }

  const now = new Date().toISOString()
  const lock: AgentSupervisorLock = {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    pid: process.pid,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    heartbeatAt: now,
    cmdline: currentCmdline(),
    releasedAt: null,
  }
  await writeAgentSupervisorLock(lock)
  return { lock, stoleStaleLock: existing !== null && existing.pid !== null }
}

export async function refreshAgentSupervisorHeartbeat(): Promise<AgentSupervisorLock> {
  const now = new Date().toISOString()
  const existing = await readAgentSupervisorLock()
  const lock: AgentSupervisorLock = {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    pid: process.pid,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    heartbeatAt: now,
    cmdline: currentCmdline(),
    releasedAt: null,
  }
  await writeAgentSupervisorLock(lock)
  await appendAgentSupervisorLog({
    level: 'info',
    message: 'heartbeat',
    ts: now,
  })
  return lock
}

export async function releaseAgentSupervisorLock(): Promise<void> {
  const now = new Date().toISOString()
  const existing = await readAgentSupervisorLock()
  const lock: AgentSupervisorLock = {
    schemaVersion: AGENT_SUPERVISOR_SCHEMA_VERSION,
    pid: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    heartbeatAt: existing?.heartbeatAt ?? null,
    cmdline: existing?.cmdline ?? null,
    releasedAt: now,
  }
  await writeAgentSupervisorLock(lock)
}

export async function appendAgentSupervisorLog(
  entry: { ts?: string; level: 'info' | 'warn' | 'error'; message: string },
  options: { maxBytes?: number } = {},
): Promise<void> {
  await ensureAgentSupervisorBaseDirs()
  const logPath = getAgentSupervisorLogPath()
  const maxBytes = options.maxBytes ?? DEFAULT_SUPERVISOR_LOG_MAX_BYTES
  const size = await stat(logPath)
    .then(info => info.size)
    .catch(error => (isENOENT(error) ? 0 : Promise.reject(error)))
  if (size > maxBytes) {
    await rename(logPath, `${logPath}.1`).catch(() => undefined)
  }
  await appendFile(
    logPath,
    JSON.stringify({
      ts: entry.ts ?? new Date().toISOString(),
      level: entry.level,
      message: entry.message,
    }) + '\n',
    { encoding: 'utf8', mode: 0o600 },
  )
}

export async function getAgentSupervisorDoctorStatus(
  settings?: AgentSupervisorSettingsLike,
): Promise<AgentSupervisorDoctorStatus> {
  const disabled = isAgentSupervisorDisabled(settings)
  await ensureAgentSupervisorBaseDirs()
  const lock = await readAgentSupervisorLock()
  const alive = isProcessAlive(lock?.pid)
  const reconcile = await reconcileAgentSupervisorStaleProcesses({ force: true })
  const roster = await readAgentSupervisorRoster()
  const clock = summarizeClockState(lock, roster.updatedAt)
  const entrypoint = getSupervisorEntrypointStatus()
  const recoveryHint =
    clock.clockJumpDetected || lockIsStale(lock) || reconcile.staleProcessJobs > 0 || !entrypoint.exists
      ? getLocalizedText({
          en: 'Run `mossen agents --doctor` again after opening Agent View, or use `mossen respawn --all` for terminal jobs that should continue.',
          zh: '打开 Agent View 后再次运行 `mossen agents --doctor`；若终态任务需要继续，可运行 `mossen respawn --all`。',
        })
      : null
  return {
    disabled: disabled.disabled,
    disabledReason: disabled.reason,
    paths: {
      roster: getAgentSupervisorRosterPath(),
      jobsDir: getAgentSupervisorJobsDir(),
      lock: getAgentSupervisorLockPath(),
      log: getAgentSupervisorLogPath(),
    },
    lock: {
      exists: lock !== null,
      pid: lock?.pid ?? null,
      alive,
      stale: lockIsStale(lock),
      heartbeatAt: lock?.heartbeatAt ?? null,
    },
    roster: {
      jobs: roster.jobs.length,
    },
    lifecycle: {
      heartbeatAgeMs: clock.heartbeatAgeMs,
      clockJumpDetected: clock.clockJumpDetected,
      clockJumpReason: clock.clockJumpReason,
      clockJumpGraceActive: reconcile.clockJumpGraceActive,
      staleProcessJobs: reconcile.staleProcessJobs,
      entrypoint: entrypoint.entrypoint,
      entrypointExists: entrypoint.exists,
      recoveryHint,
    },
    capabilities: {
      notificationsMode: getAgentSupervisorNotificationMode(),
      resultPayload: true,
      legacyJobCompatibility: true,
      highDensityView: true,
    },
  }
}

export function formatAgentSupervisorDoctorStatus(
  status: AgentSupervisorDoctorStatus,
): string {
  const lines = [
    'Agent View supervisor',
    `status: ${status.disabled ? 'disabled' : 'enabled'}`,
  ]
  if (status.disabledReason) {
    lines.push(`disabled reason: ${status.disabledReason}`)
  }
  lines.push(
    `lock: ${status.lock.exists ? 'present' : 'missing'} · pid=${status.lock.pid ?? 'none'} · alive=${status.lock.alive ? 'yes' : 'no'} · stale=${status.lock.stale ? 'yes' : 'no'}`,
    `lifecycle: heartbeatAgeMs=${status.lifecycle.heartbeatAgeMs ?? 'n/a'} · clockJump=${status.lifecycle.clockJumpDetected ? 'yes' : 'no'} · clockGrace=${status.lifecycle.clockJumpGraceActive ? 'yes' : 'no'} · staleProcesses=${status.lifecycle.staleProcessJobs}`,
    `entrypoint: ${status.lifecycle.entrypointExists ? 'ok' : 'missing'} · ${basename(status.lifecycle.entrypoint)}`,
    `jobs: ${status.roster.jobs}`,
    `roster: ${status.paths.roster}`,
    `jobs dir: ${status.paths.jobsDir}`,
    `log: ${basename(status.paths.log)}`,
    getLocalizedText({
      en: `notifications: ${status.capabilities.notificationsMode} (needs_input fires only when terminal focus is blurred)`,
      zh: `通知：${status.capabilities.notificationsMode}（仅在终端失焦时提示 needs_input）`,
    }),
    getLocalizedText({
      en: `result payload: ${status.capabilities.resultPayload ? 'installed' : 'missing'} (additive result_payload events, no transcript writes)`,
      zh: `结果载荷：${status.capabilities.resultPayload ? '已安装' : '缺失'}（追加 result_payload 事件，不写主 transcript）`,
    }),
    getLocalizedText({
      en: `legacy jobs: ${status.capabilities.legacyJobCompatibility ? 'compatible' : 'unsupported'} (missing resultPayload falls back to summary/output/events)`,
      zh: `旧任务：${status.capabilities.legacyJobCompatibility ? '兼容' : '不支持'}（缺少 resultPayload 时回退到 summary/output/events）`,
    }),
    getLocalizedText({
      en: `high density: ${status.capabilities.highDensityView ? 'automatic' : 'disabled'} (narrow or many-job views hide low-value columns)`,
      zh: `高密度视图：${status.capabilities.highDensityView ? '自动' : '关闭'}（窄屏或多任务时隐藏低价值列）`,
    }),
  )
  if (status.lifecycle.clockJumpReason) {
    lines.push(
      getLocalizedText({
        en: `clock note: ${formatClockJumpReason(status.lifecycle.clockJumpReason)}`,
        zh: `时钟提示：${formatClockJumpReason(status.lifecycle.clockJumpReason)}`,
      }),
    )
  }
  if (status.lifecycle.recoveryHint) {
    lines.push(
      getLocalizedText({
        en: `recovery: ${status.lifecycle.recoveryHint}`,
        zh: `恢复建议：${status.lifecycle.recoveryHint}`,
      }),
    )
  }
  return lines.join('\n')
}
