// PTY wrapper for the Agent View worker process under Bun.
//
// Why this exists (matches the empirical spike report at
// /tmp/pty-spike/REPORT.md):
//   1. `bun install` strips the executable bit from
//      node-pty/prebuilds/darwin-arm64/spawn-helper, so node-pty's UnixTerminal
//      constructor errors with `posix_spawnp failed` until we chmod +x it.
//   2. node-pty's UnixTerminal wraps the master fd in `tty.ReadStream`. Under
//      Bun that wrapper silently consumes bytes without firing `data` events,
//      losing PTY output. We therefore bypass the wrapper and call the native
//      addon's `fork()` directly.
//   3. Bun's `fs.read` / `Bun.file().stream()` / `net.Socket` all error EAGAIN
//      on a non-blocking PTY master, and even with O_NONBLOCK cleared
//      `fs.read` truncates mid-stream. We clear O_NONBLOCK ourselves via FFI
//      fcntl, then read in a Worker thread with FFI `read()`. Writes go via
//      FFI `write()` too — bypassing Bun's stream layer entirely.
//   4. Real-size SIGWINCH is what makes Ink redraw on re-attach; a no-op
//      "same size" toggle is suppressed. The `resize(cols, rows)` exported
//      here always changes the recorded geometry so callers can drive a real
//      SIGWINCH.
//
// This module owns the master fd, the read Worker, and the ring buffer used
// for replay on re-attach. Spawned children survive across attach/detach: the
// only paths that kill them are explicit kill() or the child exiting on its
// own.

import { Buffer } from 'buffer'
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  writeSync,
} from 'fs'
import { dirname, join } from 'path'
import { dlopen, FFIType } from 'bun:ffi'

// node-pty's TypeScript types describe the high-level UnixTerminal we
// deliberately do not use. We narrow the `.native` shape we touch here.
type NativeForkResult = { fd: number; pid: number; pty: string }
type NodePtyNative = {
  fork: (
    file: string,
    args: readonly string[],
    env: readonly string[],
    cwd: string,
    cols: number,
    rows: number,
    uid: number,
    gid: number,
    utf8: boolean,
    helperPath: string,
    onexit: (code: number, signal: number) => void,
  ) => NativeForkResult
  resize: (fd: number, cols: number, rows: number) => void
  open: (cols: number, rows: number) => { master: number; slave: number; pty: string }
  process: (fd: number, ptsName: string) => string | null
}

// Bun's FFI types lean on bigint for u64 / i64. We coerce on the boundary.
const libc = dlopen('libc.dylib', {
  fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
  write: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
  kill: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
})

const F_GETFL = 3
const F_SETFL = 4
const O_NONBLOCK = 0x4

const SIGHUP = 1
const SIGKILL = 9

let cachedNative: NodePtyNative | null = null
let cachedHelperPath: string | null = null
let cachedHelperChecked = false

function loadNative(): NodePtyNative {
  if (cachedNative) return cachedNative
  // node-pty's main entrypoint exports the bound addon via `native` on the
  // module namespace.
  // We use a runtime require-like path because Bun's static import resolves
  // the TS facade types but we want the actual JS exports too.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ns = require('node-pty') as { native?: NodePtyNative }
  if (!ns.native) {
    throw new Error('node-pty native binding not loaded (Bun + macOS expected)')
  }
  cachedNative = ns.native
  return cachedNative
}

function resolveHelperPath(): string {
  if (cachedHelperPath) return cachedHelperPath
  // `require.resolve` on the package main lets us derive the package root.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgMain = require.resolve('node-pty')
  // node-pty/lib/index.js → parent = node-pty/lib → parent.parent = node-pty
  const pkgRoot = dirname(dirname(pkgMain))
  // arch-specific prebuild. Bun on Apple Silicon ships darwin-arm64. We fall
  // back to other dirs only if the platform happens to load this code from a
  // different arch (e.g. Rosetta).
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const candidate = join(pkgRoot, 'prebuilds', `darwin-${arch}`, 'spawn-helper')
  cachedHelperPath = candidate
  return candidate
}

function ensureHelperExecutable(helperPath: string): void {
  if (cachedHelperChecked) return
  cachedHelperChecked = true
  try {
    const info = statSync(helperPath)
    // mode & 0o111 — any execute bit set is enough; posix_spawn just needs to
    // be able to exec the helper.
    if ((info.mode & 0o111) === 0) {
      chmodSync(helperPath, info.mode | 0o755)
    }
  } catch {
    // If stat/chmod fails we let fork() surface the real error path. Worst
    // case the user sees `posix_spawnp failed` and re-runs install.
  }
}

// Read-worker source. Embedded so the worker process doesn't have to
// resolve a sibling file at runtime (which is brittle across bundling /
// install layouts). It is intentionally tiny — one FFI dlopen, one synchronous
// blocking read loop, one postMessage per chunk. The main thread keeps the
// fd in blocking mode so this worker's `read()` parks until the kernel has
// data, which matches how a real terminal emulator would consume a PTY.
const PTY_READ_WORKER_SOURCE = `
import { dlopen, FFIType } from "bun:ffi"

const libc = dlopen("libc.dylib", {
  read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
})

self.onmessage = (event) => {
  const fd = event.data.fd
  const buf = new Uint8Array(64 * 1024)
  while (true) {
    const n = Number(libc.symbols.read(fd, buf, BigInt(buf.length)))
    if (n <= 0) {
      self.postMessage({ type: "eof", n })
      break
    }
    const copy = buf.slice(0, n)
    self.postMessage({ type: "data", buf: copy }, [copy.buffer])
  }
}
`

export type SpawnPtyOptions = {
  cwd?: string
  cols?: number
  rows?: number
  env?: NodeJS.ProcessEnv
  /** Override TERM. Default xterm-256color. */
  term?: string
  /**
   * Max bytes retained for re-attach replay. Trimmed from the head when
   * exceeded. Default 4 MiB — comfortably covers an idle dashboard sitting
   * outside an attach for an hour while the worker streams turn-level
   * output. Bigger ring = more "scroll-back" available on re-attach.
   */
  ringLimit?: number
  /**
   * If set, every PTY master chunk is fan-out written here as a raw byte
   * log. attachServer reads this file when its in-memory ring is empty or
   * undersized (e.g. cold replay after worker restart), so re-attach can
   * still see history that predates the current in-memory ring. The file
   * rotates to `${transcriptPath}.1` at `transcriptRotateBytes` (default
   * 1 MiB), keeping at most one rotation behind plus the live file (~2 MiB
   * total on-disk cap per job).
   */
  transcriptPath?: string
  /** Rotate threshold for `transcriptPath`. Default 1 MiB. */
  transcriptRotateBytes?: number
}

const TRANSCRIPT_ROTATE_DEFAULT = 1 << 20

export type PtySession = {
  readonly pid: number
  readonly fd: number
  readonly ptsName: string
  /** Currently-recorded geometry. Updated by resize(). */
  readonly cols: number
  readonly rows: number
  /** Write bytes/string to the PTY master. Returns bytes written. */
  write: (data: string | Uint8Array) => number
  /** Issue TIOCSWINSZ on the PTY. Triggers SIGWINCH to the child if size changes. */
  resize: (cols: number, rows: number) => void
  /**
   * Subscribe to the live data stream. By default flushes the ring buffer
   * to the subscriber first (so a fresh subscriber sees the current screen
   * state) and then issues a real-size SIGWINCH so the child re-renders into
   * the new sink. Replaces any previous subscriber.
   */
  attachReader: (
    cb: (chunk: Buffer) => void,
    options?: { replay?: boolean; sigwinch?: boolean },
  ) => void
  /** Stop forwarding to any subscriber. Reads continue into the ring buffer. */
  detachReader: () => void
  /** Bytes currently buffered for replay. */
  ringSize: () => number
  /** Cheap liveness probe via kill(pid, 0). */
  isAlive: () => boolean
  /** Send SIGHUP (default) or SIGKILL. */
  kill: (signal?: 'SIGHUP' | 'SIGKILL') => void
  /** Register a one-shot exit handler. Fires once with the child's exit. */
  onExit: (cb: (info: { exitCode: number; signal: number }) => void) => void
}

export function spawnPty(
  file: string,
  args: readonly string[],
  options: SpawnPtyOptions = {},
): PtySession {
  const native = loadNative()
  const helperPath = resolveHelperPath()
  ensureHelperExecutable(helperPath)

  const cols = options.cols ?? 120
  const rows = options.rows ?? 30
  const cwd = options.cwd ?? process.cwd()
  const term = options.term ?? 'xterm-256color'
  const envSource = options.env ?? process.env
  const envArray = Object.entries({ ...envSource, TERM: term }).map(
    ([k, v]) => `${k}=${v ?? ''}`,
  )
  const ringLimit = options.ringLimit ?? 4 << 20
  const transcriptPath = options.transcriptPath ?? null
  const transcriptRotateBytes =
    options.transcriptRotateBytes ?? TRANSCRIPT_ROTATE_DEFAULT
  // Transcript fan-out state. `transcriptFd` is null when the option is
  // unset OR when a prior open / write / rotate failed irrecoverably; in
  // either case we silently keep running off the in-memory ring buffer.
  let transcriptFd: number | null = null
  let transcriptBytesSinceRotate = 0
  if (transcriptPath) {
    try {
      mkdirSync(dirname(transcriptPath), { recursive: true, mode: 0o700 })
      // Carry over the existing file's size into the rotate counter so a
      // worker restart on a near-full file rotates promptly instead of
      // doubling up to the threshold.
      let priorSize = 0
      try {
        priorSize = statSync(transcriptPath).size
      } catch {
        // File doesn't exist yet — fine.
      }
      transcriptFd = openSync(transcriptPath, 'a', 0o600)
      transcriptBytesSinceRotate = priorSize
    } catch {
      transcriptFd = null
    }
  }
  function writeTranscript(chunk: Buffer): void {
    if (transcriptFd === null || !transcriptPath) return
    try {
      writeSync(transcriptFd, chunk, 0, chunk.length)
      transcriptBytesSinceRotate += chunk.length
      if (transcriptBytesSinceRotate >= transcriptRotateBytes) {
        // Close → rename live → reopen. The .1 rotation overwrites any
        // older .1 (one-deep history is intentional — we are not a syslog
        // collector). If anything in this sequence fails, drop the fd and
        // stop trying; subsequent attaches fall back to the in-memory
        // ring buffer.
        try {
          closeSync(transcriptFd)
        } catch {
          // ignore
        }
        try {
          renameSync(transcriptPath, `${transcriptPath}.1`)
        } catch {
          // ignore — rotation best-effort
        }
        try {
          transcriptFd = openSync(transcriptPath, 'a', 0o600)
          transcriptBytesSinceRotate = 0
        } catch {
          transcriptFd = null
        }
      }
    } catch {
      // Stop writing on the first error. Don't bring down the PTY for a
      // disk-full or permission glitch on the transcript log.
      try {
        if (transcriptFd !== null) closeSync(transcriptFd)
      } catch {
        // ignore
      }
      transcriptFd = null
    }
  }
  function closeTranscript(): void {
    if (transcriptFd === null) return
    try {
      closeSync(transcriptFd)
    } catch {
      // ignore
    }
    transcriptFd = null
  }

  let exitListener:
    | ((info: { exitCode: number; signal: number }) => void)
    | null = null
  let exitInfo: { exitCode: number; signal: number } | null = null
  function fireExit(info: { exitCode: number; signal: number }): void {
    if (exitInfo) return
    exitInfo = info
    try {
      exitListener?.(info)
    } catch {
      // Listeners must not break the worker. Swallow.
    }
  }

  const term_ = native.fork(
    file,
    args,
    envArray,
    cwd,
    cols,
    rows,
    -1,
    -1,
    true,
    helperPath,
    (code, signal) => fireExit({ exitCode: code, signal }),
  )
  const fd = term_.fd
  const pid = term_.pid
  const pts = term_.pty

  // Blocking mode is required so the worker thread's read() syscall parks
  // until data is available. Bun does not poll PTY master fds the way Node
  // does; non-blocking mode produces EAGAIN with no readiness signal.
  const flags = Number(libc.symbols.fcntl(fd, F_GETFL, 0))
  libc.symbols.fcntl(fd, F_SETFL, flags & ~O_NONBLOCK)

  const blob = new Blob([PTY_READ_WORKER_SOURCE], {
    type: 'application/javascript',
  })
  const workerUrl = URL.createObjectURL(blob)
  const worker = new Worker(workerUrl, { type: 'module' })

  let ringChunks: Buffer[] = []
  let ringBytes = 0
  let liveCb: ((chunk: Buffer) => void) | null = null
  let cur = { cols, rows }
  let workerStopped = false

  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as
      | { type: 'data'; buf: Uint8Array }
      | { type: 'eof'; n: number }
    if (msg.type === 'data') {
      const chunk = Buffer.from(msg.buf.buffer, msg.buf.byteOffset, msg.buf.byteLength)
      ringChunks.push(chunk)
      ringBytes += chunk.length
      while (ringBytes > ringLimit && ringChunks.length > 1) {
        const dropped = ringChunks.shift()!
        ringBytes -= dropped.length
      }
      // Fan-out to the on-disk transcript before notifying the live sink
      // so a crash in the sink callback can't lose the byte from disk.
      writeTranscript(chunk)
      if (liveCb) {
        try {
          liveCb(chunk)
        } catch {
          // Sink errors must not block reads. Detach the broken sink.
          liveCb = null
        }
      }
    } else if (msg.type === 'eof') {
      workerStopped = true
      closeTranscript()
      try {
        worker.terminate()
      } catch {
        // Worker may already be exiting.
      }
      // The native onexit callback usually fires first, but EOF on the master
      // fd also means the child closed its PTY slave. Fire a best-effort
      // exit if onexit has not arrived yet.
      if (!exitInfo) {
        fireExit({ exitCode: 0, signal: 0 })
      }
    }
  }
  worker.onerror = () => {
    // Surface worker crashes as an exit so callers don't hang forever.
    workerStopped = true
    closeTranscript()
    if (!exitInfo) fireExit({ exitCode: 1, signal: 0 })
  }
  worker.postMessage({ fd })

  const session: PtySession = {
    pid,
    fd,
    ptsName: pts,
    get cols(): number {
      return cur.cols
    },
    get rows(): number {
      return cur.rows
    },
    write(data) {
      const bytes =
        typeof data === 'string' ? new TextEncoder().encode(data) : data
      const n = Number(
        libc.symbols.write(fd, bytes, BigInt(bytes.length)),
      )
      return n
    },
    resize(c, r) {
      try {
        native.resize(fd, c, r)
        cur = { cols: c, rows: r }
      } catch {
        // resize on a closed fd would throw — ignore so callers don't have to
        // race the exit.
      }
    },
    attachReader(cb, opts) {
      const replay = opts?.replay ?? true
      const doSigwinch = opts?.sigwinch ?? true
      liveCb = cb
      if (replay && ringChunks.length > 0) {
        const merged = Buffer.concat(ringChunks, ringBytes)
        try {
          cb(merged)
        } catch {
          liveCb = null
        }
      }
      if (doSigwinch) {
        // A real size change is required to make Ink redraw — same-size
        // resize is suppressed by the renderer. Toggle rows by ±1 then back.
        try {
          native.resize(fd, cur.cols, Math.max(1, cur.rows - 1))
          native.resize(fd, cur.cols, cur.rows)
        } catch {
          // Race with exit. Ignore.
        }
      }
    },
    detachReader() {
      liveCb = null
    },
    ringSize() {
      return ringBytes
    },
    isAlive() {
      try {
        return Number(libc.symbols.kill(pid, 0)) === 0
      } catch {
        return false
      }
    },
    kill(signal = 'SIGHUP') {
      try {
        libc.symbols.kill(pid, signal === 'SIGKILL' ? SIGKILL : SIGHUP)
      } catch {
        // Process already gone.
      }
      closeTranscript()
      if (workerStopped) return
      try {
        worker.terminate()
        workerStopped = true
      } catch {
        // Worker may have already exited.
      }
    },
    onExit(cb) {
      exitListener = cb
      // If the exit already fired before subscription, deliver synchronously.
      if (exitInfo) {
        try {
          cb(exitInfo)
        } catch {
          // Swallow listener errors.
        }
      }
    },
  }

  return session
}
