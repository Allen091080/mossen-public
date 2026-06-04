import {
  appendSupervisorJsonlLine,
  buildSupervisorJsonlEnvelope,
  getNextSupervisorJsonlSeq,
  readSupervisorJsonlTolerant,
} from './jsonl.js'
import { getAgentSupervisorJobPaths } from './paths.js'
import { upsertAgentSupervisorRosterJob } from './roster.js'
import {
  AgentSupervisorJobIdSchema,
  type AgentSupervisorEventMessage,
  type AgentSupervisorInputMessage,
  type AgentSupervisorJobId,
  type AgentSupervisorJobState,
  type AgentSupervisorLastQuestion,
  type AgentSupervisorOutputMessage,
  type AgentSupervisorResultPayload,
} from './schema.js'
import {
  readAgentSupervisorJobState,
  updateAgentSupervisorJobState,
} from './state.js'
import { isProcessAlive } from './daemon.js'
import { startAgentSupervisorJobWorkerProcess } from './launch.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  formatAgentSupervisorResultPayload,
  latestAgentSupervisorResultPayload,
} from './resultPayload.js'

export type AgentSupervisorPeekSnapshot = {
  job: AgentSupervisorJobState
  inputLines: string[]
  outputLines: string[]
  eventLines: string[]
  resultPayload: AgentSupervisorResultPayload | null
  lastQuestion: AgentSupervisorLastQuestion
  diagnostics: {
    malformedOutputLines: number
    partialOutputLine: boolean
    malformedEventLines: number
    partialEventLine: boolean
  }
}

function parseJobId(rawJobId: string): AgentSupervisorJobId {
  return AgentSupervisorJobIdSchema.parse(rawJobId)
}

async function requireJobState(
  jobId: AgentSupervisorJobId,
): Promise<AgentSupervisorJobState> {
  const state = await readAgentSupervisorJobState(jobId)
  if (!state) throw new Error(`Agent supervisor job not found: ${jobId}`)
  return state
}

function formatOutputRecord(record: Partial<AgentSupervisorOutputMessage>): string {
  if (record.kind === 'assistant_text') return record.text ?? ''
  if (record.kind === 'tool_call') {
    return `› ${record.tool ?? 'tool'} ${record.input ?? ''}`
  }
  if (record.kind === 'tool_result') {
    const tail = record.stderrTail ?? record.stdoutTail ?? ''
    return `‹ ${record.tool ?? 'tool'} exit=${record.exitCode ?? 'n/a'} ${tail}`
  }
  return JSON.stringify(record)
}

function formatInputRecord(record: Partial<AgentSupervisorInputMessage>): string {
  if (record.kind === 'user_message') return record.content ?? ''
  if (record.kind === 'choice') return `choice ${record.choiceKey ?? '?'}`
  if (record.kind === 'soft_interrupt') return 'soft interrupt'
  return JSON.stringify(record)
}

function formatEventRecord(record: Partial<AgentSupervisorEventMessage>): string {
  if (record.kind === 'result_payload') {
    return formatAgentSupervisorResultPayload(record.payload) ?? '◆ result payload'
  }
  if (record.kind === 'needs_input') return `? ${record.question ?? ''}`
  if (record.kind === 'activity') return record.detail ?? 'activity'
  if (record.kind === 'assistant_done') return `✓ ${record.summary ?? ''}`
  if (record.kind === 'started') return `started pid=${record.pid ?? 'unknown'}`
  if (record.kind === 'exited') {
    return `exited code=${record.exitCode ?? 'n/a'} signal=${record.signal ?? 'n/a'}`
  }
  if (record.kind === 'input_received') return `input received #${record.fromInputSeq ?? '?'}`
  if (record.kind === 'stop_requested') return 'stop requested'
  return JSON.stringify(record)
}

function hasLiveWorker(state: AgentSupervisorJobState): boolean {
  return Boolean(
    state.process.pid &&
      state.process.pid !== process.pid &&
      isProcessAlive(state.process.pid),
  )
}

export async function readAgentSupervisorPeekSnapshot(
  rawJobId: string,
  options: { limit?: number } = {},
): Promise<AgentSupervisorPeekSnapshot> {
  const jobId = parseJobId(rawJobId)
  const job = await requireJobState(jobId)
  const paths = getAgentSupervisorJobPaths(jobId)
  const limit = Math.max(1, options.limit ?? 20)
  const output =
    await readSupervisorJsonlTolerant<Partial<AgentSupervisorOutputMessage>>(
      paths.output,
    )
  const input =
    await readSupervisorJsonlTolerant<Partial<AgentSupervisorInputMessage>>(
      paths.input,
    )
  const events =
    await readSupervisorJsonlTolerant<Partial<AgentSupervisorEventMessage>>(
      paths.events,
    )
  return {
    job,
    inputLines: input.records.slice(-limit).map(formatInputRecord),
    outputLines: output.records.slice(-limit).map(formatOutputRecord),
    eventLines: events.records.slice(-limit).map(formatEventRecord),
    resultPayload:
      job.resultPayload ?? latestAgentSupervisorResultPayload(events.records),
    lastQuestion: job.lastQuestion,
    diagnostics: {
      malformedOutputLines: output.malformedLines,
      partialOutputLine: output.partialTrailingLine,
      malformedEventLines: events.malformedLines,
      partialEventLine: events.partialTrailingLine,
    },
  }
}

async function appendInputAndMarkReceived(
  jobId: AgentSupervisorJobId,
  input: AgentSupervisorInputMessage,
): Promise<AgentSupervisorJobState> {
  const paths = getAgentSupervisorJobPaths(jobId)
  await appendSupervisorJsonlLine(paths.input, input)
  const eventSeq = await getNextSupervisorJsonlSeq(paths.events)
  await appendSupervisorJsonlLine(paths.events, {
    ...buildSupervisorJsonlEnvelope({
      seq: eventSeq,
      kind: 'input_received',
      source: 'agent_view',
    }),
    fromInputSeq: input.seq,
  })
  let shouldStartWorker = false
  const updated = await updateAgentSupervisorJobState(jobId, current => {
    if (!current) throw new Error(`Agent supervisor job not found: ${jobId}`)
    const liveWorker = hasLiveWorker(current)
    shouldStartWorker =
      !liveWorker &&
      (current.status === 'completed' ||
        current.status === 'failed' ||
        current.status === 'stopped' ||
        current.status === 'idle' ||
        current.status === 'needs_input')
    return {
      ...current,
      updatedAt: new Date().toISOString(),
      status: shouldStartWorker
        ? 'queued'
        : current.status === 'needs_input'
          ? 'working'
          : current.status,
      process: shouldStartWorker
        ? {
            ...current.process,
            pid: null,
            alive: false,
            exitCode: null,
            signal: null,
            expectedCmdlineSubstring: `--supervisor-job ${jobId}`,
          }
        : current.process,
      counters: {
        ...current.counters,
        inputSeqHigh: Math.max(current.counters.inputSeqHigh, input.seq),
        eventSeqHigh: Math.max(current.counters.eventSeqHigh, eventSeq),
      },
      lastQuestion: current.status === 'needs_input' ? null : current.lastQuestion,
    }
  })
  await upsertAgentSupervisorRosterJob(updated)
  if (shouldStartWorker) {
    startAgentSupervisorJobWorkerProcess(jobId, {
      cwd: updated.cwd,
      testMode: isEnvTruthy(process.env.MOSSEN_CODE_AGENT_SUPERVISOR_TEST_CONTINUATION),
    })
  }
  return updated
}

export async function appendAgentSupervisorUserMessage(
  rawJobId: string,
  content: string,
): Promise<AgentSupervisorJobState> {
  const jobId = parseJobId(rawJobId)
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Reply cannot be empty.')
  await requireJobState(jobId)
  const paths = getAgentSupervisorJobPaths(jobId)
  const seq = await getNextSupervisorJsonlSeq(paths.input)
  const input: AgentSupervisorInputMessage = {
    ...buildSupervisorJsonlEnvelope({ seq, kind: 'user_message', source: 'agent_view' }),
    kind: 'user_message',
    content: trimmed,
  }
  return await appendInputAndMarkReceived(jobId, input)
}

export async function appendAgentSupervisorChoice(
  rawJobId: string,
  choiceKey: string,
): Promise<AgentSupervisorJobState> {
  const jobId = parseJobId(rawJobId)
  const state = await requireJobState(jobId)
  const question = state.lastQuestion
  if (!question) throw new Error('No pending question is available for this job.')
  const option = question.options.find(item => item.key === choiceKey)
  if (!option) throw new Error(`Unknown choice: ${choiceKey}`)
  const paths = getAgentSupervisorJobPaths(jobId)
  const seq = await getNextSupervisorJsonlSeq(paths.input)
  const input: AgentSupervisorInputMessage = {
    ...buildSupervisorJsonlEnvelope({ seq, kind: 'choice', source: 'agent_view' }),
    kind: 'choice',
    choiceKey,
    fromQuestionEventSeq: question.fromEventSeq,
  }
  return await appendInputAndMarkReceived(jobId, input)
}
