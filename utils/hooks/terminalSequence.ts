const MAX_TERMINAL_SEQUENCE_CHARS = 2000

// Only keep printable text, whitespace, and SGR color/style CSI sequences.
// Strip OSC/title/bell/cursor-movement/private-mode controls so hook output
// cannot corrupt the TUI, prompt, or terminal title.
const SAFE_SGR_PATTERN = /^\x1b\[[0-9;]*m/
const CSI_PATTERN = /^\x1b\[[0-9;?]*[ -/]*[@-~]/

export function sanitizeHookTerminalSequence(input: string): string {
  let output = ''
  for (let index = 0; index < input.length && output.length < MAX_TERMINAL_SEQUENCE_CHARS; ) {
    const char = input[index]!
    if (char === '\x1b') {
      const rest = input.slice(index)
      if (rest.startsWith('\x1b]')) {
        const bellEnd = input.indexOf('\x07', index + 2)
        const stEnd = input.indexOf('\x1b\\', index + 2)
        const candidates = [bellEnd, stEnd].filter(value => value >= 0)
        index =
          candidates.length > 0
            ? Math.min(...candidates) + (Math.min(...candidates) === stEnd ? 2 : 1)
            : input.length
        continue
      }
      const sgr = rest.match(SAFE_SGR_PATTERN)?.[0]
      if (sgr) {
        output += sgr
        index += sgr.length
        continue
      }
      const csi = rest.match(CSI_PATTERN)?.[0]
      if (csi) {
        index += csi.length
        continue
      }
      index += 1
      continue
    }
    const code = char.charCodeAt(0)
    if (char === '\n' || char === '\r' || char === '\t' || code >= 0x20) {
      output += char
    }
    index += 1
  }
  return output
}

export function emitHookTerminalSequence(sequence: string): boolean {
  const sanitized = sanitizeHookTerminalSequence(sequence)
  if (!sanitized) return false
  if (!process.stderr.isTTY) return false
  process.stderr.write(sanitized)
  return true
}
