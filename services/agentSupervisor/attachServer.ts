// Worker-side Unix domain socket. Accepts at most one attached client at a
// time (the dashboard) and shovels bytes between the PTY and that client.
// When no client is attached, the PTY continues running and its output keeps
// accumulating in the PtySession's ring buffer. New attachments flush the
// ring first, then live-tail.

import { createServer, type Server, type Socket } from 'net'
import { Buffer } from 'buffer'
import { readFileSync, statSync } from 'fs'
import { mkdir, unlink } from 'fs/promises'
import { dirname } from 'path'
import {
  ATTACH_FRAME_TYPE,
  AttachFrameDecoder,
  decodeExit,
  decodeResize,
  encodeAttachData,
  encodeAttachEvict,
  encodeAttachExit,
} from './attachFraming.js'
import type { PtySession } from './ptyBun.js'

export type AttachServer = {
  /** The socket path being listened on. */
  readonly socketPath: string
  /** Whether a client is currently attached. */
  readonly attached: boolean
  /** Close the server and drop any attached client. */
  close: () => Promise<void>
  /**
   * Notify the currently-attached client (if any) that the PTY has exited.
   * Sends an EXIT frame and ends the socket. Safe to call multiple times.
   */
  notifyExit: (exitCode: number) => void
}

export type CreateAttachServerOptions = {
  socketPath: string
  pty: PtySession
  /**
   * Optional hook: every fresh attachment fires this so the worker can log
   * attach events or update job state. Detach fires it with `null`.
   */
  onAttachChange?: (client: { peerCols: number; peerRows: number } | null) => void
  /**
   * On-disk transcript log written by the worker via spawnPty's
   * transcriptPath. When the PTY's in-memory ring buffer is empty at
   * attach time (worker just started, or this worker is a restart of a
   * crashed predecessor), the server preloads the dashboard with the
   * tail of this file as a cold-path replay. Default behaviour when
   * unset is just ring-buffer replay (W408 baseline).
   */
  transcriptPath?: string
  /**
   * Max bytes read from the transcript file at cold-replay. Default
   * 4 MiB so the cold path can hand off ~4 MiB of history (matching
   * the PTY ring buffer ceiling).
   */
  coldReplayBytes?: number
}

function readTranscriptTail(
  transcriptPath: string,
  maxBytes: number,
): Buffer {
  // Read .1 (older) + live transcript in order so the tail keeps the
  // append-only chronology. spawnPty's rotate is single-deep — we look
  // for one rotated file plus the live file, no further history.
  const parts: Buffer[] = []
  for (const candidate of [`${transcriptPath}.1`, transcriptPath]) {
    try {
      const info = statSync(candidate)
      if (info.size === 0) continue
      parts.push(readFileSync(candidate))
    } catch {
      // Missing file is normal (no rotation yet, or no transcript yet).
    }
  }
  if (parts.length === 0) return Buffer.alloc(0)
  const concat = Buffer.concat(parts)
  if (concat.length <= maxBytes) return concat
  // Keep only the last maxBytes — older bytes were already evicted by
  // the rotation cap, and the dashboard's terminal won't usefully scroll
  // beyond what fits in its scrollback anyway.
  return concat.subarray(concat.length - maxBytes)
}

export async function createAttachServer(
  options: CreateAttachServerOptions,
): Promise<AttachServer> {
  const { socketPath, pty } = options

  // Cleanup any stale socket from a previous worker that did not exit
  // cleanly. Unix domain sockets refuse to bind on existing paths.
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 })
  await unlink(socketPath).catch(error => {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code !== 'ENOENT'
    ) {
      throw error
    }
  })

  let currentClient: Socket | null = null
  let closed = false
  let exitNotified = false

  function attachClient(socket: Socket): void {
    if (currentClient) {
      // Multi-attach policy: NEW WINS. Two dashboards attaching to the same
      // job is an edge case (it requires `mossen agents` running in two
      // terminals + entering the same row); we let the newer attach evict
      // the older rather than reject it, otherwise a hung previous dashboard
      // would permanently lock everyone else out.
      //
      // W411: write an EVICT frame BEFORE the socket end so the older
      // client renders an explicit "another dashboard took over, returning
      // to list" splash instead of misreading the clean end as
      // reason='job_exited' (which makes it look like the job died).
      try {
        currentClient.write(encodeAttachEvict())
      } catch {
        // socket may already be torn down — that's fine, the end below
        // still completes the disconnect.
      }
      try {
        currentClient.end()
      } catch {
        // Ignore — the socket may already be in a teardown state.
      }
    }
    currentClient = socket
    const decoder = new AttachFrameDecoder()

    socket.on('data', chunk => {
      try {
        decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        while (true) {
          const frame = decoder.next()
          if (!frame) break
          if (frame.type === ATTACH_FRAME_TYPE.DATA) {
            if (frame.payload.length > 0) {
              pty.write(frame.payload)
            }
          } else if (frame.type === ATTACH_FRAME_TYPE.RESIZE) {
            const r = decodeResize(frame.payload)
            if (r) pty.resize(r.cols, r.rows)
          } else if (frame.type === ATTACH_FRAME_TYPE.PING) {
            // ignore — keepalive
          }
          // EXIT from client → server is invalid; ignore for now.
        }
      } catch (error) {
        // Protocol error → drop client.
        try {
          socket.destroy(error as Error)
        } catch {
          // Already destroyed.
        }
      }
    })

    function cleanup(): void {
      if (currentClient !== socket) return
      currentClient = null
      pty.detachReader()
      options.onAttachChange?.(null)
    }
    socket.once('end', cleanup)
    socket.once('close', cleanup)
    socket.once('error', cleanup)

    // W409 cold-path replay: when the in-memory ring is empty (worker just
    // started or this is a fresh worker on a job that has prior transcript
    // bytes from a crashed predecessor), preload the dashboard with the
    // file tail so it doesn't see a blank screen before the first SIGWINCH
    // forces mossen TUI to redraw. The hot path — ring non-empty — falls
    // straight through to pty.attachReader(replay=true) below; we avoid
    // double-replay because file + ring contain overlapping bytes only when
    // the ring is non-empty, in which case we skip the file.
    if (options.transcriptPath && pty.ringSize() === 0) {
      try {
        const tail = readTranscriptTail(
          options.transcriptPath,
          options.coldReplayBytes ?? 4 << 20,
        )
        if (tail.length > 0) {
          socket.write(encodeAttachData(tail))
        }
      } catch {
        // Best-effort cold replay. A missing or unreadable file just
        // means the dashboard sees the live SIGWINCH-driven repaint
        // alone, same as W408 baseline.
      }
    }

    // Hand the PTY's live stream to this client. Replay + SIGWINCH happen
    // inside attachReader.
    pty.attachReader(chunk => {
      if (currentClient !== socket) return
      // .write may return false (backpressure). We accept the slight risk of
      // memory growth in pathological cases — the dashboard reads quickly.
      try {
        socket.write(encodeAttachData(chunk))
      } catch {
        // Socket died mid-write. Cleanup is already wired through close.
      }
    })

    options.onAttachChange?.({
      // We don't know peer geometry until the client sends a RESIZE frame.
      // Use current PTY geometry as a sensible default.
      peerCols: pty.cols,
      peerRows: pty.rows,
    })
  }

  const server: Server = createServer(socket => {
    if (closed) {
      try {
        socket.destroy()
      } catch {
        // Ignore.
      }
      return
    }
    attachClient(socket)
  })

  await new Promise<void>((resolveFn, rejectFn) => {
    server.once('error', rejectFn)
    server.listen(socketPath, () => {
      server.off('error', rejectFn)
      resolveFn()
    })
  })

  return {
    socketPath,
    get attached() {
      return currentClient !== null
    },
    async close() {
      if (closed) return
      closed = true
      if (currentClient) {
        try {
          currentClient.end()
        } catch {
          // Ignore — already torn down.
        }
        currentClient = null
      }
      await new Promise<void>(resolveFn => {
        server.close(() => resolveFn())
      })
      await unlink(socketPath).catch(() => {
        // Best-effort socket file cleanup.
      })
    },
    notifyExit(exitCode) {
      if (exitNotified) return
      exitNotified = true
      if (currentClient) {
        try {
          currentClient.write(encodeAttachExit(exitCode))
          currentClient.end()
        } catch {
          // Client already gone.
        }
      }
    },
  }
}

export { decodeExit, decodeResize }
