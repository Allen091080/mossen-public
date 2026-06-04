import { appendFile, stat } from 'node:fs/promises'

/**
 * W148-D: branded marker for "this offset is best-effort and must not
 * be used as a seek key". The brand widens to `number` for storage
 * type compatibility, but constructing a fresh `DiagnosticByteOffset`
 * requires an explicit cast — so the only legal way to mint one is
 * via appendJsonlLine. See the JsonlAppendLocation comment for the
 * full rationale.
 */
declare const __diagnosticByteOffsetMarker: unique symbol
export type DiagnosticByteOffset = number & {
  readonly [__diagnosticByteOffsetMarker]: true
}

export type JsonlAppendLocation = {
  byteOffset: DiagnosticByteOffset
  byteLength: number
}

/**
 * W120 M2: kernel-level atomic JSONL append.
 *
 * The previous pattern across every store was:
 *
 *   const file = await open(path, 'a+')
 *   const offset = (await file.stat()).size
 *   await file.write(line, offset, 'utf8')
 *
 * Two concurrent appenders observe the same `.size`, then write at the
 * same explicit offset, corrupting the file. `fs/promises.appendFile`
 * opens with O_APPEND so the kernel always positions the write at the
 * current end-of-file atomically with respect to other O_APPEND writers
 * on the same machine.
 *
 * Single-line constraint: each call MUST receive exactly one record.
 * The trailing newline is added here so callers cannot accidentally
 * split a record across two appends.
 *
 * Returned `byteOffset` is best-effort (computed via `stat` after the
 * append): if a concurrent appender slips in between our append and our
 * stat, the reported offset is off by their byte length. This is fine
 * because byteOffset is used only as a diagnostic/audit column in the
 * sqlite index and as a parser-error position; the on-disk data and the
 * full event JSON stored in sqlite remain correct. byteOffset is NEVER
 * used to seek-read events from JSONL — retrieval reads from sqlite's
 * `event_json` column.
 */
export async function appendJsonlLine(
  path: string,
  record: unknown,
): Promise<JsonlAppendLocation> {
  const line = `${JSON.stringify(record)}\n`
  const byteLength = Buffer.byteLength(line)
  await appendFile(path, line, { encoding: 'utf8' })
  const byteOffsetRaw = await currentFileSize(path).then(size =>
    Math.max(0, size - byteLength),
  )
  // W148-D: the cast is the documented mint point. Anywhere else in
  // the codebase that wants to mint a DiagnosticByteOffset must go
  // through this helper — otherwise the brand mark is missing and the
  // assignment fails at typecheck.
  return { byteOffset: byteOffsetRaw as DiagnosticByteOffset, byteLength }
}

export function jsonlLineByteLength(record: unknown): number {
  return Buffer.byteLength(`${JSON.stringify(record)}\n`)
}

async function currentFileSize(path: string): Promise<number> {
  return stat(path)
    .then(info => info.size)
    .catch(error => {
      if (error?.code === 'ENOENT') return 0
      throw error
    })
}
