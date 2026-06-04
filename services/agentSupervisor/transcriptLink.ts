import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { getMossenConfigHomeDir } from '../../utils/envUtils.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { getAgentSupervisorJobPaths } from './paths.js'
import {
  AgentSupervisorTranscriptLinkSchema,
  type AgentSupervisorJobId,
  type AgentSupervisorTranscriptLink,
} from './schema.js'
import { atomicWriteSupervisorJsonFile } from './state.js'

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

export function getAgentSupervisorTranscriptPathForCwd(
  cwd: string,
  sessionId: string,
): string {
  return join(
    getMossenConfigHomeDir(),
    'projects',
    sanitizePath(cwd),
    `${sessionId}.jsonl`,
  )
}

export async function writeAgentSupervisorTranscriptLink(
  link: AgentSupervisorTranscriptLink,
): Promise<void> {
  await atomicWriteSupervisorJsonFile(
    getAgentSupervisorJobPaths(link.jobId).transcriptLink,
    AgentSupervisorTranscriptLinkSchema.parse(link),
  )
}

export async function readAgentSupervisorTranscriptLink(
  jobId: AgentSupervisorJobId,
): Promise<AgentSupervisorTranscriptLink | null> {
  const path = getAgentSupervisorJobPaths(jobId).transcriptLink
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isENOENT(error)) return null
    throw error
  }
  const parsed = AgentSupervisorTranscriptLinkSchema.safeParse(JSON.parse(raw))
  return parsed.success ? parsed.data : null
}

export async function agentSupervisorTranscriptExists(
  link: AgentSupervisorTranscriptLink,
): Promise<boolean> {
  if (!link.transcriptPath) return false
  try {
    const info = await stat(link.transcriptPath)
    return info.isFile()
  } catch (error) {
    if (isENOENT(error)) return false
    throw error
  }
}
