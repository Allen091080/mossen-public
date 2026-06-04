// Dashboard-side Unix socket client. Bridges the calling process's stdio
// to the worker's PTY for a single attach session, then resolves once the
// user hits the detach chord (Ctrl-A d) or the job exits.
//
// Architecture note (post-W408):
//
//   This bridge runs only while the caller (cli/handlers/agentsTui.tsx) has
//   already unmounted the Ink dashboard, so stdio is fully ours. There are
//   no other readable listeners to coordinate with and no rawModeEnabledCount
//   to keep in sync — the bridge owns process.stdin/process.stdout for its
//   entire lifetime, then resolves and the caller renders a fresh Ink
//   instance.

import { Socket } from 'net'
import { stat } from 'fs/promises'
import {
  ATTACH_FRAME_TYPE,
  AttachFrameDecoder,
  decodeExit,
  encodeAttachData,
  encodeAttachResize,
} from './attachFraming.js'

export type AttachReason =
  | 'detached'
  | 'job_exited'
  | 'connect_failed'
  | 'aborted'
  // Another dashboard attached to the same job and the worker chose
  // "new wins". The current attach view should clean up, splash the
  // user with a message explaining why, then hand control back to the
  // dashboard list — NOT show a job-exited splash.
  | 'evicted'

export type AttachToWorkerOptions = {
  socketPath: string
  /** Standard input — usually process.stdin. */
  stdin: NodeJS.ReadStream
  /** Standard output — usually process.stdout. */
  stdout: NodeJS.WriteStream
  /** Initial terminal geometry. */
  cols: number
  rows: number
  /** Fallback raw-mode setter for environments where stdin.setRawMode is
   *  missing (test stdins). The bridge calls stdin.setRawMode directly when
   *  available. */
  setRawMode: (raw: boolean) => void
  /** If true, also flip stdout cursor visibility while attached. Default true. */
  hideCursorWhileAttached?: boolean
  /**
   * Fires when the PTY child exits before the user detaches. The exit code
   * is passed through. Awaited so the caller can render an "exited" splash
   * before this function resolves.
   */
  onJobExit?: (exitCode: number) => void | Promise<void>
  /**
   * Fires when the worker sends an EVICT frame because a newer dashboard
   * has taken over this job. Awaited so the caller can render an
   * "evicted" splash before this function resolves with
   * reason='evicted'. (W411)
   */
  onEvicted?: () => void | Promise<void>
}

export type AttachResult = {
  reason: AttachReason
  exitCode: number | null
  error?: string
}

// Detach chord: press Esc TWICE within DETACH_DOUBLE_TAP_MS. The first Esc
// is held briefly (ESC_FLUSH_TIMEOUT_MS) — if a follow-up byte arrives, the
// scanner classifies the sequence:
//   - second Esc within the double-tap window → DETACH
//   - `[` → start of a CSI escape sequence (arrow keys, function keys, etc.)
//          → forward intact so ← / → / ↑ / ↓ move the cursor inside the
//          mossen REPL normally
//   - anything else → forward Esc + that byte (Alt+key, paste delimiters)
// A lone Esc with no follow-up inside the window is forwarded to the PTY so
// the user's single-Esc bindings (cancel overlay, etc.) still work.
const ESC_BYTE = 0x1b
const CSI_OPEN = 0x5b // '['
// Window between the first Esc and the second one for the double-tap to
// register as detach. The same window also bounds how long we hold a lone
// Esc before forwarding it to the PTY — so an isolated Esc inside the REPL
// gets through after at most this delay.
const ESC_FLUSH_TIMEOUT_MS = 350

// Cursor / screen control escapes.
const CSI_HIDE_CURSOR = '\x1b[?25l'
const CSI_SHOW_CURSOR = '\x1b[?25h'
const CSI_RESET_ATTRIBUTES = '\x1b[0m'
// DEC private mode 1049: switch to the alternate screen buffer + clear it.
// Wrapping every attach session in an alt-screen pair gives us guaranteed
// fresh screen state on every (re)entry — the worker's ring-buffer replay
// can't leak across sessions because the alt-screen is destroyed on detach.
const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H'
const EXIT_ALT_SCREEN = '\x1b[?1049l'
// Mouse tracking modes the host terminal may have left on. We disable all
// the common variants when detaching so the cooked-mode shell doesn't echo
// SGR motion bytes onto the screen after we hand stdio back.
const DISABLE_MOUSE_TRACKING =
  '\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l'

function setRawModeDirect(
  stdin: NodeJS.ReadStream,
  fallback: (raw: boolean) => void,
  value: boolean,
): void {
  try {
    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(value)
      return
    }
  } catch {
    // fall through to fallback
  }
  try {
    fallback(value)
  } catch {
    // best-effort
  }
}

/** Wait up to ~8 s for the worker to create its attach socket. The worker
 *  is spawned detached from the dashboard, so a freshly-dispatched job needs
 *  a couple of seconds to boot mossen, spawn the PTY child, and create the
 *  Unix socket. Polling here keeps the dashboard's "Enter on queued row →
 *  TUI" experience consistent without forcing the user to manually retry. */
async function waitForAttachSocket(
  socketPath: string,
  timeoutMs = 8000,
  pollIntervalMs = 200,
): Promise<{ ok: true } | { ok: false; lastError: string }> {
  const startedAt = Date.now()
  let lastError = 'socket never appeared'
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await stat(socketPath)
      return { ok: true }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
  return { ok: false, lastError }
}

export async function attachToWorker(
  options: AttachToWorkerOptions,
): Promise<AttachResult> {
  // Show a brief connecting splash while the worker boots and creates its
  // socket. Entering the alt-screen here matches what the bridge does on
  // socket-connect, so the screen state stays continuous either way.
  let splashRendered = false
  try {
    options.stdout.write(`${ENTER_ALT_SCREEN}\x1b[2;2H\x1b[2mConnecting to agent terminal…\x1b[0m`)
    splashRendered = true
  } catch {
    // best-effort splash; if stdout is wedged we'll surface the real error
    // when the socket retry times out.
  }
  const waitResult = await waitForAttachSocket(options.socketPath)
  if (waitResult.ok === false) {
    const { lastError } = waitResult
    if (splashRendered) {
      try {
        options.stdout.write(EXIT_ALT_SCREEN)
      } catch {
        // ignore
      }
    }
    return {
      reason: 'connect_failed',
      exitCode: null,
      error: `attach socket not found at ${options.socketPath} after retries (${lastError})`,
    }
  }

  return new Promise<AttachResult>(resolveFn => {
    const { stdin, stdout, setRawMode } = options
    const hideCursor = options.hideCursorWhileAttached ?? true
    const decoder = new AttachFrameDecoder()
    const socket = new Socket()

    let resolved = false
    // Detach scanner state machine. Two states:
    //   'normal' — no pending Esc.
    //   'esc'    — saw an Esc, waiting up to ESC_FLUSH_TIMEOUT_MS for the
    //              next byte to classify the sequence (second Esc = detach,
    //              `[` = CSI escape forwarded intact, other = Alt-combo
    //              forwarded). On timeout the buffered Esc is forwarded
    //              alone so lone Esc still reaches the PTY.
    type ScanState = 'normal' | 'esc'
    let scanState: ScanState = 'normal'
    let escFlushTimer: ReturnType<typeof setTimeout> | null = null
    let lastResize = { cols: options.cols, rows: options.rows }

    function clearEscFlushTimer(): void {
      if (escFlushTimer) {
        clearTimeout(escFlushTimer)
        escFlushTimer = null
      }
    }

    function armEscFlush(): void {
      clearEscFlushTimer()
      escFlushTimer = setTimeout(() => {
        // Window elapsed with no follow-up — the user pressed Esc alone.
        // Forward it to the PTY so single-Esc bindings (cancel overlay,
        // exit input box, etc.) inside the attached REPL still fire.
        if (scanState !== 'esc') return
        try {
          socket.write(encodeAttachData(Buffer.from([ESC_BYTE])))
        } catch {
          // Socket gone; ignore.
        }
        scanState = 'normal'
        escFlushTimer = null
      }, ESC_FLUSH_TIMEOUT_MS)
    }

    function finish(result: AttachResult): void {
      if (resolved) return
      resolved = true
      // Restore terminal state in the inverse order of setup. Order matters:
      //   1. disable mouse tracking BEFORE leaving raw mode so the shell
      //      doesn't get a final burst of motion bytes in cooked mode
      //   2. restore cursor + colors
      //   3. EXIT the alt-screen LAST — that's what swaps the visible buffer
      //      back to whatever was underneath (shell prompt or the next Ink
      //      dashboard's alt-screen)
      try {
        stdout.write(DISABLE_MOUSE_TRACKING)
        if (hideCursor) stdout.write(CSI_SHOW_CURSOR)
        stdout.write(CSI_RESET_ATTRIBUTES)
        stdout.write(EXIT_ALT_SCREEN)
      } catch {
        // stdout may already be gone.
      }
      stdin.removeListener('data', handleStdinData)
      stdin.removeListener('error', handleStdinError)
      process.removeListener('SIGWINCH', handleResize)
      setRawModeDirect(stdin, setRawMode, false)
      try {
        socket.destroy()
      } catch {
        // Already gone.
      }
      clearEscFlushTimer()
      resolveFn(result)
    }

    function handleStdinData(rawChunk: Buffer | string): void {
      // Node sets stdin encoding to 'utf8' if anyone called setEncoding;
      // the 'data' callback then receives strings. Normalize to Buffer so
      // the byte-level scanner doesn't crash on string.subarray().
      const chunk: Buffer = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk, 'utf8')

      // Walk byte-by-byte through the scanner state machine.
      //   normal  → '\x1b' transitions to 'esc' (buffer the byte, arm
      //             flush timer for lone-Esc forwarding)
      //   esc     → '\x1b' (second Esc inside the double-tap window)
      //              → DETACH. Forward any trailing bytes from the same
      //              chunk so the user doesn't lose post-chord keystrokes.
      //           → '[' (CSI introducer)
      //              → forward the buffered Esc, current `[`, AND the rest
      //              of the chunk as one frame. Arrow keys / function keys
      //              / mouse reports are all CSI sequences — letting them
      //              pass through means ← still moves the REPL cursor.
      //           → other byte
      //              → forward Esc + that byte (Alt-X combinations etc.)
      //   normal  → anything else: contiguous-slice forwarder below.
      let i = 0
      while (i < chunk.length) {
        const byte = chunk[i]!
        if (scanState === 'esc') {
          clearEscFlushTimer()
          if (byte === ESC_BYTE) {
            // Double Esc detected. Drain anything trailing in this chunk
            // to the PTY before detaching (rare in practice — two-key
            // chords almost never share a chunk with the next user key —
            // but cheap to preserve).
            const trailing = chunk.subarray(i + 1)
            if (trailing.length > 0) {
              try {
                socket.write(encodeAttachData(trailing))
              } catch {
                // Socket gone; ignore.
              }
            }
            finish({ reason: 'detached', exitCode: null })
            return
          }
          if (byte === CSI_OPEN) {
            // Forward Esc + the entire remaining chunk as one CSI escape.
            // We don't try to parse its final byte here — terminals send
            // CSI in unpredictable chunks (mouse reports, paste
            // delimiters, bracketed-paste markers). Once we commit to
            // "this is a CSI", hand the bytes to the PTY and let mossen's
            // parser disambiguate. We prepend the buffered Esc explicitly
            // rather than slicing it from `chunk`, because the original
            // Esc may have arrived in a *prior* chunk (cross-chunk CSI is
            // common at this byte rate).
            socket.write(
              encodeAttachData(
                Buffer.concat([Buffer.from([ESC_BYTE]), chunk.subarray(i)]),
              ),
            )
            scanState = 'normal'
            i = chunk.length
            continue
          }
          // Esc followed by some other byte — Alt-X combo. Forward both.
          socket.write(encodeAttachData(Buffer.from([ESC_BYTE, byte])))
          scanState = 'normal'
          i += 1
          continue
        }
        // scanState === 'normal'
        if (byte === ESC_BYTE) {
          scanState = 'esc'
          armEscFlush()
          i += 1
          continue
        }
        // Forward a contiguous span of non-Esc bytes in one frame.
        let j = i + 1
        while (j < chunk.length && chunk[j] !== ESC_BYTE) {
          j += 1
        }
        socket.write(encodeAttachData(chunk.subarray(i, j)))
        i = j
      }
    }

    function handleStdinError(err: Error): void {
      finish({
        reason: 'aborted',
        exitCode: null,
        error: `stdin error: ${err.message}`,
      })
    }

    function handleResize(): void {
      const next = {
        cols: stdout.columns ?? lastResize.cols,
        rows: stdout.rows ?? lastResize.rows,
      }
      if (next.cols === lastResize.cols && next.rows === lastResize.rows) {
        return
      }
      lastResize = next
      try {
        socket.write(encodeAttachResize(next.cols, next.rows))
      } catch {
        // Socket gone.
      }
    }

    socket.once('connect', () => {
      try {
        setRawModeDirect(stdin, setRawMode, true)
      } catch (rawError) {
        finish({
          reason: 'aborted',
          exitCode: null,
          error: `raw mode unsupported: ${
            rawError instanceof Error ? rawError.message : String(rawError)
          }`,
        })
        return
      }
      try {
        // Enter the alt-screen + clear, so the previous Ink dashboard frame
        // and any prior attach session's PTY output can't leak through.
        // On detach we EXIT_ALT_SCREEN to restore whatever was underneath
        // (the shell prompt or another Ink instance).
        stdout.write(ENTER_ALT_SCREEN)
        if (hideCursor) stdout.write(CSI_HIDE_CURSOR)
      } catch {
        // stdout write errors surface again on first data write.
      }
      try {
        socket.write(encodeAttachResize(lastResize.cols, lastResize.rows))
      } catch {
        // Connection died immediately.
      }
      stdin.on('data', handleStdinData)
      stdin.on('error', handleStdinError)
      stdin.resume()
      process.on('SIGWINCH', handleResize)
    })

    socket.on('data', chunk => {
      try {
        decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        while (true) {
          const frame = decoder.next()
          if (!frame) break
          if (frame.type === ATTACH_FRAME_TYPE.DATA) {
            try {
              stdout.write(frame.payload)
            } catch {
              finish({ reason: 'aborted', exitCode: null })
              return
            }
          } else if (frame.type === ATTACH_FRAME_TYPE.EXIT) {
            const info = decodeExit(frame.payload)
            const code = info?.exitCode ?? 0
            const exitPromise = options.onJobExit?.(code)
            if (exitPromise && typeof exitPromise.then === 'function') {
              void exitPromise.finally(() => {
                finish({ reason: 'job_exited', exitCode: code })
              })
            } else {
              finish({ reason: 'job_exited', exitCode: code })
            }
            return
          } else if (frame.type === ATTACH_FRAME_TYPE.EVICT) {
            // W411: another dashboard took over this job. Splash the
            // user so they understand why their attach view is
            // closing, then resolve with reason='evicted'. The shell
            // loop treats it like 'detached' (return to dashboard
            // list) but the splash text is different.
            const evictPromise = options.onEvicted?.()
            if (evictPromise && typeof evictPromise.then === 'function') {
              void evictPromise.finally(() => {
                finish({ reason: 'evicted', exitCode: null })
              })
            } else {
              finish({ reason: 'evicted', exitCode: null })
            }
            return
          }
          // PING / RESIZE from server → ignored on the client side.
        }
      } catch (decodeError) {
        finish({
          reason: 'aborted',
          exitCode: null,
          error: `decode error: ${
            decodeError instanceof Error
              ? decodeError.message
              : String(decodeError)
          }`,
        })
      }
    })

    socket.once('error', err => {
      finish({
        reason: 'connect_failed',
        exitCode: null,
        error: err.message,
      })
    })
    socket.once('close', () => {
      finish({ reason: 'job_exited', exitCode: null })
    })

    socket.connect(options.socketPath)
  })
}
