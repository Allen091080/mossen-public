import type { LogOption } from '../types/logs.js'
import { getLocalizedText } from './uiLanguage.js'

function expandComparablePathVariants(path: string): string[] {
  const normalized = path.normalize('NFC')
  const variants = new Set([normalized])

  if (process.platform === 'darwin') {
    if (normalized.startsWith('/private/')) {
      variants.add(normalized.slice('/private'.length))
    } else if (
      normalized === '/tmp' ||
      normalized.startsWith('/tmp/') ||
      normalized === '/var' ||
      normalized.startsWith('/var/')
    ) {
      variants.add(`/private${normalized}`)
    }
  }

  return [...variants]
}

function areComparablePathsEqual(left?: string, right?: string): boolean {
  if (!left || !right) {
    return false
  }

  const rightVariants = new Set(expandComparablePathVariants(right))
  return expandComparablePathVariants(left).some(candidate =>
    rightVariants.has(candidate),
  )
}

export function isLogInCurrentWorktree(
  log: LogOption,
  currentCwd: string,
): boolean {
  return areComparablePathsEqual(log.projectPath, currentCwd)
}

export function prioritizeCurrentWorktreeLogs(
  logs: LogOption[],
  currentCwd: string,
): LogOption[] {
  const currentWorktreeLogs = logs.filter(log =>
    isLogInCurrentWorktree(log, currentCwd),
  )
  if (
    currentWorktreeLogs.length === 0 ||
    currentWorktreeLogs.length === logs.length
  ) {
    return logs
  }

  return [
    ...currentWorktreeLogs,
    ...logs.filter(log => !isLogInCurrentWorktree(log, currentCwd)),
  ]
}

export function selectPreferredCurrentWorktreeLog(
  logs: LogOption[],
  currentCwd: string,
): LogOption | null {
  if (logs.length === 1) {
    return logs[0] ?? null
  }

  const currentWorktreeLogs = logs.filter(log =>
    isLogInCurrentWorktree(log, currentCwd),
  )

  if (currentWorktreeLogs.length === 1) {
    return currentWorktreeLogs[0] ?? null
  }

  return null
}

export function getWorktreeMetadataSuffix(
  log: LogOption,
  currentCwd: string,
): string {
  if (!log.projectPath) {
    return ''
  }

  if (isLogInCurrentWorktree(log, currentCwd)) {
    return getLocalizedText({
      en: ' · current worktree',
      zh: ' · 当前工作树',
    })
  }

  if (log.worktreeSession?.worktreeName) {
    return ` · ${log.worktreeSession.worktreeName}`
  }

  return ` · ${log.projectPath}`
}
