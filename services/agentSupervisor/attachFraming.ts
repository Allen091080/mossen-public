// Wire-level framing for the supervisor attach Unix socket. Each frame is
// [type:u8][length:u32 BE][payload:length bytes]. The framing is symmetric
// across client and server; only the set of valid type IDs per direction
// differs (see comments). Keep this file free of node-specific globals so the
// dashboard side and worker side can share it without runtime dependencies.

export const ATTACH_FRAME_HEADER_SIZE = 5

export const ATTACH_FRAME_TYPE = {
  // Raw byte payload.
  //   - server → client: PTY master output bytes
  //   - client → server: keystrokes to write into the PTY master
  DATA: 0x01,
  // 4-byte payload: cols u16 BE, rows u16 BE. client → server only.
  RESIZE: 0x02,
  // 4-byte payload: exit code i32 BE. server → client only. After this frame
  // the server closes the socket. Code -1 means killed by signal.
  EXIT: 0x03,
  // Empty payload. Heartbeat — either direction may send; receiver ignores.
  PING: 0x04,
  // Empty payload. Server → client only. Sent right before the server
  // disconnects a client because a NEWER dashboard attach has taken its
  // place. The client renders an explicit "evicted" splash so the user
  // sees why their attach view closed, instead of mistaking it for a
  // job exit. Backwards-compatible: an old client that doesn't know this
  // type will just drop the frame at the framing layer (default unknown-
  // type behaviour) and fall through to the subsequent socket end.
  EVICT: 0x05,
} as const

export type AttachFrameType =
  (typeof ATTACH_FRAME_TYPE)[keyof typeof ATTACH_FRAME_TYPE]

export const ATTACH_MAX_FRAME_LEN = 1 << 20 // 1 MiB, generous safety bound

export function encodeAttachFrame(
  type: AttachFrameType,
  payload: Uint8Array,
): Buffer {
  if (payload.length > ATTACH_MAX_FRAME_LEN) {
    throw new Error(
      `attach frame too large: ${payload.length} > ${ATTACH_MAX_FRAME_LEN}`,
    )
  }
  const out = Buffer.allocUnsafe(ATTACH_FRAME_HEADER_SIZE + payload.length)
  out.writeUInt8(type, 0)
  out.writeUInt32BE(payload.length, 1)
  if (payload.length > 0) {
    out.set(payload, ATTACH_FRAME_HEADER_SIZE)
  }
  return out
}

export function encodeAttachResize(cols: number, rows: number): Buffer {
  const payload = Buffer.allocUnsafe(4)
  payload.writeUInt16BE(Math.max(1, Math.min(0xffff, cols | 0)), 0)
  payload.writeUInt16BE(Math.max(1, Math.min(0xffff, rows | 0)), 2)
  return encodeAttachFrame(ATTACH_FRAME_TYPE.RESIZE, payload)
}

export function encodeAttachExit(code: number): Buffer {
  const payload = Buffer.allocUnsafe(4)
  payload.writeInt32BE(code | 0, 0)
  return encodeAttachFrame(ATTACH_FRAME_TYPE.EXIT, payload)
}

export function encodeAttachData(data: Uint8Array): Buffer {
  return encodeAttachFrame(ATTACH_FRAME_TYPE.DATA, data)
}

export function encodeAttachPing(): Buffer {
  return encodeAttachFrame(ATTACH_FRAME_TYPE.PING, new Uint8Array(0))
}

export function encodeAttachEvict(): Buffer {
  return encodeAttachFrame(ATTACH_FRAME_TYPE.EVICT, new Uint8Array(0))
}

/**
 * Stream decoder. Feed incoming buffer chunks via {@link push}, then call
 * {@link drain} repeatedly to pull out fully-parsed frames. Holds a small
 * internal buffer for partially-received frames; never drops bytes.
 */
export class AttachFrameDecoder {
  private buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): void {
    if (this.buf.length === 0) {
      this.buf = chunk
      return
    }
    this.buf = Buffer.concat([this.buf, chunk])
  }

  /**
   * Pull the next complete frame from the internal buffer.
   * Returns null when the buffer doesn't yet hold one full frame.
   * Throws if a frame exceeds ATTACH_MAX_FRAME_LEN — the caller should
   * treat that as a protocol error and close the socket.
   */
  next(): { type: AttachFrameType; payload: Buffer } | null {
    if (this.buf.length < ATTACH_FRAME_HEADER_SIZE) return null
    const type = this.buf.readUInt8(0) as AttachFrameType
    const length = this.buf.readUInt32BE(1)
    if (length > ATTACH_MAX_FRAME_LEN) {
      throw new Error(`attach frame length out of bounds: ${length}`)
    }
    const total = ATTACH_FRAME_HEADER_SIZE + length
    if (this.buf.length < total) return null
    const payload = this.buf.subarray(ATTACH_FRAME_HEADER_SIZE, total)
    // Copy out so callers can hold the slice past the next push().
    const copy = Buffer.from(payload)
    this.buf = this.buf.subarray(total)
    return { type, payload: copy }
  }
}

export function decodeResize(payload: Buffer): {
  cols: number
  rows: number
} | null {
  if (payload.length !== 4) return null
  return {
    cols: payload.readUInt16BE(0),
    rows: payload.readUInt16BE(2),
  }
}

export function decodeExit(payload: Buffer): { exitCode: number } | null {
  if (payload.length !== 4) return null
  return { exitCode: payload.readInt32BE(0) }
}
