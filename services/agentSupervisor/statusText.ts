import type {
  AgentSupervisorError,
  AgentSupervisorProcessState,
  AgentSupervisorStatus,
} from './schema.js'

export function isTerminalAgentSupervisorStatus(
  status: AgentSupervisorStatus,
): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped'
}

export function normalizeAgentSupervisorExitCode(
  status: AgentSupervisorStatus,
  processState: Pick<AgentSupervisorProcessState, 'exitCode' | 'signal'>,
): number | null {
  if (
    status === 'failed' &&
    processState.signal &&
    processState.exitCode === 0
  ) {
    return null
  }
  return processState.exitCode
}

export function formatAgentSupervisorProcessOutcome(
  status: AgentSupervisorStatus,
  processState: Pick<AgentSupervisorProcessState, 'exitCode' | 'signal'>,
  errors: AgentSupervisorError[] = [],
): string {
  const exitCode = normalizeAgentSupervisorExitCode(status, processState)
  const parts = [`exit=${exitCode === null ? 'n/a' : String(exitCode)}`]
  if (processState.signal) parts.push(`signal=${processState.signal}`)
  const lastError = errors.at(-1)?.message.trim()
  if (lastError) parts.push(`error=${lastError}`)
  return parts.join(', ')
}
