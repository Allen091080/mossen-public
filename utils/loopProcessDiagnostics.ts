export const LOOP_PROCESS_PS_COMMAND =
  "ps -axo pid=,ppid=,etime=,pcpu=,command= | rg 'codex|mossen|supervisor|bun test'"

const DEFAULT_LONG_RUNNING_AFTER_MS = 6 * 60 * 60 * 1000
const DEFAULT_HIGH_CPU_PERCENT = 50

export type LoopProcessIssue =
  | 'long_running'
  | 'high_cpu'
  | 'long_running_high_cpu'

export type LoopProcessRow = {
  pid: number
  ppid: number
  elapsedRaw: string
  elapsedMs: number
  pcpu: number
  command: string
}

export type LoopProcessFinding = LoopProcessRow & {
  issue: LoopProcessIssue
  action: string
}

export type LoopProcessDiagnosticsReport = {
  generatedAt: string
  command: string
  findings: LoopProcessFinding[]
  checkedRows: number
}

function parseElapsedMs(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const daySplit = text.split('-')
  const time = daySplit.length === 2 ? daySplit[1]! : daySplit[0]!
  const days = daySplit.length === 2 ? Number(daySplit[0]) : 0
  const parts = time.split(':').map(part => Number(part))
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return null
  let seconds = 0
  if (parts.length === 3) {
    seconds = parts[0]! * 60 * 60 + parts[1]! * 60 + parts[2]!
  } else if (parts.length === 2) {
    seconds = parts[0]! * 60 + parts[1]!
  } else if (parts.length === 1) {
    seconds = parts[0]!
  } else {
    return null
  }
  return (days * 24 * 60 * 60 + seconds) * 1000
}

function isLoopProcessCommand(command: string): boolean {
  return /\b(codex|mossen|supervisor)\b/i.test(command) ||
    /\bbun\b[\s\S]*\btest\b/i.test(command)
}

export function parseLoopProcessRows(psOutput: string): LoopProcessRow[] {
  const rows: LoopProcessRow[] = []
  for (const line of psOutput.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const elapsedRaw = match[3]!
    const pcpu = Number(match[4])
    const command = match[5]!
    const elapsedMs = parseElapsedMs(elapsedRaw)
    if (
      !Number.isInteger(pid) ||
      !Number.isInteger(ppid) ||
      !Number.isFinite(pcpu) ||
      elapsedMs === null
    ) {
      continue
    }
    rows.push({ pid, ppid, elapsedRaw, elapsedMs, pcpu, command })
  }
  return rows
}

function issueFor(
  row: LoopProcessRow,
  options: { longRunningAfterMs: number; highCpuPercent: number },
): LoopProcessIssue | null {
  if (!isLoopProcessCommand(row.command)) return null
  const longRunning = row.elapsedMs >= options.longRunningAfterMs
  const highCpu = row.pcpu >= options.highCpuPercent
  if (longRunning && highCpu) return 'long_running_high_cpu'
  if (longRunning) return 'long_running'
  if (highCpu) return 'high_cpu'
  return null
}

function actionFor(issue: LoopProcessIssue): string {
  switch (issue) {
    case 'long_running_high_cpu':
      return 'Inspect the process owner, logs, and task state; stop it only after explicit operator confirmation.'
    case 'long_running':
      return 'Confirm whether the process has an active owner or timeout before stopping it.'
    case 'high_cpu':
      return 'Inspect current task state and CPU trend before taking action.'
  }
}

export function buildLoopProcessDiagnosticsReport(
  psOutput: string,
  options: {
    longRunningAfterMs?: number
    highCpuPercent?: number
    generatedAt?: string
  } = {},
): LoopProcessDiagnosticsReport {
  const rows = parseLoopProcessRows(psOutput)
  const thresholds = {
    longRunningAfterMs:
      options.longRunningAfterMs ?? DEFAULT_LONG_RUNNING_AFTER_MS,
    highCpuPercent: options.highCpuPercent ?? DEFAULT_HIGH_CPU_PERCENT,
  }
  const findings = rows.flatMap(row => {
    const issue = issueFor(row, thresholds)
    return issue
      ? [{ ...row, issue, action: actionFor(issue) }]
      : []
  })
  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    command: LOOP_PROCESS_PS_COMMAND,
    findings,
    checkedRows: rows.length,
  }
}
