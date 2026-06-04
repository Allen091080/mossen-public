function handleEPIPE(
  stream: NodeJS.WriteStream,
): (err: NodeJS.ErrnoException) => void {
  return (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      stream.destroy()
    }
  }
}

// Prevents memory leak when pipe is broken (e.g., `mossen -p | head -1`)
export function registerProcessOutputErrorHandlers(): void {
  process.stdout.on('error', handleEPIPE(process.stdout))
  process.stderr.on('error', handleEPIPE(process.stderr))
}

function writeOut(stream: NodeJS.WriteStream, data: string): void {
  if (stream.destroyed) {
    return
  }

  // Note: we don't handle backpressure (write() returning false).
  //
  // We should consider handling the callback to ensure we wait for data to flush.
  stream.write(data /* callback to handle here */)
}

export function writeToStdout(data: string): void {
  writeOut(process.stdout, data)
}

export function writeToStderr(data: string): void {
  writeOut(process.stderr, data)
}

/**
 * Wait for process.stdout's userspace queue to drain before the caller's
 * next blocking operation (typically process.exit).
 *
 * Why: writeOut() above does not honor backpressure — when write() returns
 * false (kernel pipe buffer full), the unflushed payload accrues in the
 * stream's internal queue (writableLength). process.exit() does not wait
 * for that queue, so any bytes still queued at exit time are silently
 * dropped if the downstream reader hasn't drained them.
 *
 * This bit a SDK consumer reading stdout slowly: `mossen --print-history`
 * produced ~600KB of stream-json envelopes, the Electron parent read
 * stdout off the main thread, and the producer raced ahead. mossen
 * exited mid-payload → ~47% of the bytes never reached the reader, even
 * though the producer reported exit code 0.
 *
 * Polling complement to `drain`: 'drain' only fires once per
 * high-watermark crossing, so a queue that drains incrementally without
 * crossing the threshold never fires the event. The interval probe
 * catches that case. `setTimeout(fuse, timeoutMs)` is the broken-pipe
 * fallback — a dead reader will never drain anything, so we cap the
 * wait.
 */
export function drainStdoutPipe(timeoutMs = 5000): Promise<void> {
  const stream = process.stdout
  if (stream.destroyed || stream.writableLength === 0) {
    return Promise.resolve()
  }
  return new Promise<void>(resolve => {
    let settled = false
    const cleanup = () => {
      stream.off('drain', finish)
      stream.off('error', finish)
      clearInterval(poll)
      clearTimeout(fuse)
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    stream.once('drain', finish)
    stream.once('error', finish)
    // eslint-disable-next-line no-restricted-syntax -- bounded poll for queue empty; race fused by setTimeout
    const poll = setInterval(() => {
      if (stream.writableLength === 0) finish()
    }, 25)
    // eslint-disable-next-line no-restricted-syntax -- pipe-broken fuse, not a sleep
    const fuse = setTimeout(finish, timeoutMs)
  })
}

// Write error to stderr and exit with code 1. Consolidates the
// console.error + process.exit(1) pattern used in entrypoint fast-paths.
export function exitWithError(message: string): never {
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.error(message)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}

// Wait for a stdin-like stream to close, but give up after ms if no data ever
// arrives. First data chunk cancels the timeout — after that, wait for end
// unconditionally (caller's accumulator needs all chunks, not just the first).
// Returns true on timeout, false on end. Used by -p mode to distinguish a
// real pipe producer from an inherited-but-idle parent stdin.
export function peekForStdinData(
  stream: NodeJS.EventEmitter,
  ms: number,
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const done = (timedOut: boolean) => {
      clearTimeout(peek)
      stream.off('end', onEnd)
      stream.off('data', onFirstData)
      void resolve(timedOut)
    }
    const onEnd = () => done(false)
    const onFirstData = () => clearTimeout(peek)
    // eslint-disable-next-line no-restricted-syntax -- not a sleep: races timeout against stream end/data events
    const peek = setTimeout(done, ms, true)
    stream.once('end', onEnd)
    stream.once('data', onFirstData)
  })
}
