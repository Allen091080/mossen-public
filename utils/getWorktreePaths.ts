import { realpath } from 'fs/promises'
import { sep } from 'path'
import { logMossenEvent } from '../services/analytics/mossenEventLogger.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { gitExe } from './git.js'

async function canonicalizeComparablePath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path.normalize('NFC')
  }
}

/**
 * Returns the paths of all worktrees for the current git repository.
 * If git is not available, not in a git repo, or only has one worktree,
 * returns an empty array.
 *
 * This version includes analytics tracking and uses the CLI's gitExe()
 * resolver. For a portable version without CLI deps, use
 * getWorktreePathsPortable().
 *
 * @param cwd Directory to run the command from
 * @returns Array of absolute worktree paths
 */
export async function getWorktreePaths(cwd: string): Promise<string[]> {
  const startTime = Date.now()
  const comparableCwd = await canonicalizeComparablePath(cwd)

  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    ['worktree', 'list', '--porcelain'],
    {
      cwd,
      preserveOutputOnError: false,
    },
  )

  const durationMs = Date.now() - startTime

  if (code !== 0) {
    logMossenEvent('mossen.worktree.detection', {
      duration_ms: durationMs,
      worktree_count: 0,
      success: false,
    })
    return []
  }

  // Parse porcelain output - lines starting with "worktree " contain paths
  // Example:
  // worktree /Users/foo/repo
  // HEAD abc123
  // branch refs/heads/main
  //
  // worktree /Users/foo/repo-wt1
  // HEAD def456
  // branch refs/heads/feature
  const worktreePaths = stdout
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).normalize('NFC'))

  logMossenEvent('mossen.worktree.detection', {
    duration_ms: durationMs,
    worktree_count: worktreePaths.length,
    success: true,
  })

  // Sort worktrees: current worktree first, then alphabetically
  const comparableWorktreePaths = await Promise.all(
    worktreePaths.map(path => canonicalizeComparablePath(path)),
  )
  const currentWorktreeIndex = comparableWorktreePaths.findIndex(
    path => comparableCwd === path || comparableCwd.startsWith(path + sep),
  )
  const currentWorktree =
    currentWorktreeIndex >= 0 ? worktreePaths[currentWorktreeIndex] : undefined
  const otherWorktrees = worktreePaths
    .filter(path => path !== currentWorktree)
    .sort((a, b) => a.localeCompare(b))

  return currentWorktree ? [currentWorktree, ...otherWorktrees] : otherWorktrees
}
