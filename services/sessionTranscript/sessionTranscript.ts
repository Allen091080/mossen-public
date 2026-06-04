import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { Message } from '../../types/message.js'
import { getMossenConfigHomeDir } from '../../utils/envUtils.js'

function getTranscriptDir(): string {
  return join(getMossenConfigHomeDir(), 'session-transcripts')
}

function getDailyTranscriptPath(date: string): string {
  return join(getTranscriptDir(), `${date}.jsonl`)
}

function getMessageDate(message: Message): string | null {
  if ('timestamp' in message && typeof message.timestamp === 'string') {
    const match = message.timestamp.match(/^\d{4}-\d{2}-\d{2}/)
    if (match) {
      return match[0]
    }
  }
  return null
}

async function appendSegment(date: string, messages: Message[]): Promise<void> {
  if (messages.length === 0) return
  await mkdir(getTranscriptDir(), { recursive: true })
  const payload = messages
    .map(message =>
      JSON.stringify({
        timestamp:
          ('timestamp' in message && typeof message.timestamp === 'string')
            ? message.timestamp
            : null,
        type: message.type,
        message,
      }),
    )
    .join('\n')
  await appendFile(getDailyTranscriptPath(date), `${payload}\n`, 'utf8')
}

export async function writeSessionTranscriptSegment(
  messages: Message[],
): Promise<void> {
  const buckets = new Map<string, Message[]>()
  for (const message of messages) {
    const date = getMessageDate(message)
    if (!date) continue
    const bucket = buckets.get(date)
    if (bucket) {
      bucket.push(message)
    } else {
      buckets.set(date, [message])
    }
  }

  for (const [date, bucket] of buckets) {
    await appendSegment(date, bucket)
  }
}

export async function flushOnDateChange(
  messages: Message[],
  currentDate: string,
): Promise<void> {
  const priorMessages = messages.filter(message => {
    const date = getMessageDate(message)
    return date !== null && date < currentDate
  })
  await writeSessionTranscriptSegment(priorMessages)
}
