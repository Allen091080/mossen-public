import { getOriginalCwd } from '../bootstrap/state.js'
import { listSessionsImpl } from '../utils/listSessionsImpl.js'
import {
  getProjectsDir,
  getTranscriptPath,
} from '../utils/sessionStorage.js'
import type { SessionsRuntimeSnapshot } from './runtimeTypes.js'

export async function getSessionsRuntimeSnapshot(): Promise<SessionsRuntimeSnapshot> {
  const sessions = await listSessionsImpl({
    dir: getOriginalCwd(),
    limit: 20,
    includeWorktrees: true,
  })

  return {
    currentTranscriptPath: getTranscriptPath(),
    projectSessions: sessions.length,
    projectsDir: getProjectsDir(),
  }
}
