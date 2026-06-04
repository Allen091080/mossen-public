import { join } from 'node:path'
import { safeMemoryPathSegment } from '../schema/scope.js'

export function getProjectMemoryRoot(home: string, projectId: string): string {
  return join(home, 'projects', safeMemoryPathSegment(projectId), 'memory')
}

export function getArchiveSessionsDir(home: string, projectId: string): string {
  return join(getProjectMemoryRoot(home, projectId), 'archive', 'sessions')
}

export function getArchiveSessionPath(home: string, projectId: string, sessionId: string): string {
  return join(getArchiveSessionsDir(home, projectId), `${safeMemoryPathSegment(sessionId)}.jsonl`)
}

export function getMemoryDbPath(home: string, projectId: string): string {
  return join(getProjectMemoryRoot(home, projectId), 'memory.db')
}
