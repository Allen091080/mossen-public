import { existsSync } from 'fs'
import { resolve } from 'path'
import type { LocalGitRuntimeSnapshot } from './runtimeTypes.js'
import { getGhAuthStatus } from '../utils/github/ghAuthStatus.js'
import { which } from '../utils/which.js'

const COMMIT_PUSH_PR_COMMAND = resolve(
  import.meta.dir,
  '..',
  'commands',
  'commit-push-pr.ts',
)

export async function getLocalGitRuntimeSnapshot(): Promise<LocalGitRuntimeSnapshot> {
  const [gitPath, ghPath, ghAuthStatus] = await Promise.all([
    which('git'),
    which('gh'),
    getGhAuthStatus(),
  ])

  const gitInstalled = gitPath !== null
  const ghInstalled = ghPath !== null
  const ghAuthenticated = ghAuthStatus === 'authenticated'
  const commitPushPrCommandExposed = existsSync(COMMIT_PUSH_PR_COMMAND)
  const localGitReady = gitInstalled
  const localPrReady =
    gitInstalled && ghInstalled && ghAuthenticated && commitPushPrCommandExposed

  let statusReason: string | null = null
  if (!gitInstalled) {
    statusReason =
      'Git CLI is not installed, so local repository workflows are unavailable.'
  } else if (!ghInstalled) {
    statusReason =
      'GitHub CLI is not installed. Local git still works, but PR automation is unavailable.'
  } else if (!ghAuthenticated) {
    statusReason =
      'GitHub CLI is not authenticated. Local git still works, but PR automation is unavailable until `gh auth login`.'
  }

  return {
    gitInstalled,
    gitPath,
    ghInstalled,
    ghPath,
    ghAuthenticated,
    commitPushPrCommandExposed,
    localGitReady,
    localPrReady,
    statusReason,
  }
}
