import { appendFileSync } from 'fs'
import { getSessionId } from 'src/bootstrap/state.js'
import { redactErrorMessage } from '../memory-sidecar/src/redaction/redactPaths.js'
import { isEnvTruthy } from './envBooleans.js'

export type TurnDiagnosticPhase =
  | 'turn_start'
  | 'attachments_resolved'
  | 'memory_injected'
  | 'tool_schema_ready'
  | 'api_request_built'
  | 'first_token'
  | 'tool_use_start'
  | 'tool_use_end'
  | 'turn_end'

export type TurnDiagnosticEvent = {
  phase: TurnDiagnosticPhase
  turnId: string
  elapsedMs: number
  tokenEstimate?: number
  toolCount?: number
  attachmentCount?: number
  memoryItemCount?: number
  model?: string
  timestamp: string
  session_id: string
}

// eslint-disable-next-line custom-rules/no-process-env-top-level
const ENABLED = isEnvTruthy(process.env.MOSSEN_CODE_TURN_DIAG)
// eslint-disable-next-line custom-rules/no-process-env-top-level
const OUTPUT_FILE = process.env.MOSSEN_CODE_TURN_DIAG_FILE
const turnStarts = new Map<string, number>()

export function shouldRecordTurnDiagnostics(): boolean {
  return ENABLED
}

function sanitizeText(value: string): string {
  return redactErrorMessage(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function sanitizeNumber(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined
  }
  return Math.max(0, Math.round(value))
}

export function recordTurnDiagnostic(options: {
  phase: TurnDiagnosticPhase
  turnId: string | undefined
  tokenEstimate?: number
  toolCount?: number
  attachmentCount?: number
  memoryItemCount?: number
  model?: string
}): void {
  if (!ENABLED) {
    return
  }

  try {
    const turnId = sanitizeText(options.turnId || 'unknown-turn')
    const now = performance.now()
    const startedAt =
      options.phase === 'turn_start'
        ? now
        : (turnStarts.get(turnId) ?? now)
    if (options.phase === 'turn_start') {
      turnStarts.set(turnId, now)
    }
    const event: TurnDiagnosticEvent = {
      phase: options.phase,
      turnId,
      elapsedMs: Math.max(0, Math.round(now - startedAt)),
      tokenEstimate: sanitizeNumber(options.tokenEstimate),
      toolCount: sanitizeNumber(options.toolCount),
      attachmentCount: sanitizeNumber(options.attachmentCount),
      memoryItemCount: sanitizeNumber(options.memoryItemCount),
      model:
        typeof options.model === 'string'
          ? sanitizeText(options.model)
          : undefined,
      timestamp: new Date().toISOString(),
      session_id: getSessionId(),
    }
    const line = `${JSON.stringify(event)}\n`
    if (OUTPUT_FILE) {
      appendFileSync(OUTPUT_FILE, line, 'utf8')
    } else {
      process.stderr.write(line)
    }
    if (options.phase === 'turn_end') {
      turnStarts.delete(turnId)
    }
  } catch {
    // Diagnostics must never affect the user turn.
  }
}
