import { redactMemoryText } from '../redaction/redact.js'

/**
 * W147-A: parse JSONL contents into per-line records, tolerating
 * corrupt / partial lines.
 *
 * Pre-W147 every memory-sidecar list helper used:
 *
 *   contents.split('\n').map(l => l.trim()).filter(Boolean)
 *     .map(line => JSON.parse(line) as unknown)
 *
 * which throws SyntaxError on the first malformed line and bricks
 * every downstream surface (status / health / repair / governance /
 * integrity). appendJsonlLine writes are kernel-atomic for records
 * ≤ PIPE_BUF (4 KB), so corruption is rare; but jobs.jsonl `error`
 * fields that hold a long stack trace can exceed 4 KB and lose the
 * atomicity guarantee on a process crash mid-write.
 *
 * This helper:
 *   - splits on '\n', trims, drops empty lines.
 *   - JSON.parse each line with try/catch.
 *   - on parse failure: emits one stderr warning per bad line and
 *     skips it.
 *   - warning text is redacted via redactMemoryText and truncated to
 *     WARN_DETAIL_MAX_LEN; the warning never includes raw line
 *     content.
 *   - never throws across the helper boundary; ENOENT / IO errors
 *     are expected to be handled by the caller before invoking this
 *     helper.
 *
 * Returns records as unknown[]; the caller is expected to schema-
 * filter (e.g. via isDirtyMarker / isMemoryAgentJob) for type
 * narrowing.
 */

const WARN_DETAIL_MAX_LEN = 80

export type ParseJsonlOptions = {
  /** Short label used in the stderr warning, e.g. 'dirty-markers'. */
  context: string
  /** Test seam — defaults to console.warn on stderr. */
  warn?: (message: string) => void
}

function defaultWarn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(message)
}

function truncateRedactedDetail(raw: string): string {
  const safe = redactMemoryText(raw).text
  if (safe.length <= WARN_DETAIL_MAX_LEN) return safe
  return safe.slice(0, WARN_DETAIL_MAX_LEN - 1) + '…'
}

export function parseJsonlLinesTolerant(
  contents: string,
  options: ParseJsonlOptions,
): unknown[] {
  const warn = options.warn ?? defaultWarn
  const records: unknown[] = []
  const lines = contents.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? ''
    if (line.length === 0) continue
    try {
      records.push(JSON.parse(line))
    } catch (error) {
      const detail = truncateRedactedDetail(
        error instanceof Error ? error.message : String(error),
      )
      warn(
        `[memory-sidecar] tolerant-parse: skipping malformed jsonl line in ${options.context} at index ${i}: ${detail}`,
      )
    }
  }
  return records
}
