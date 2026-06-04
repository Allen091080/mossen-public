export type ParsedMcpAddArgs = {
  serverName?: string
  scope?: string
  transport?: string
  commandOrUrl?: string
  args?: string[]
  env?: string[]
  headers?: string[]
  confirmToken?: string
  unsupportedFlag?: string
}

const VALUE_FLAGS = new Set([
  '--scope',
  '-s',
  '--transport',
  '-t',
  '--env',
  '-e',
  '--header',
  '-H',
  '--confirm',
])

const SUPPORTED_FLAGS = new Set([...VALUE_FLAGS, '--dry-run'])

function readFlagValue(parts: string[], longFlag: string, shortFlag?: string): string | undefined {
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (part === longFlag || (shortFlag && part === shortFlag)) {
      return parts[index + 1]
    }
  }
  return undefined
}

function readRepeatedFlagValues(
  parts: string[],
  longFlag: string,
  shortFlag?: string,
): string[] | undefined {
  const values: string[] = []
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (part === longFlag || (shortFlag && part === shortFlag)) {
      if (parts[index + 1]) values.push(parts[index + 1])
    }
  }
  return values.length > 0 ? values : undefined
}

export function parseMcpAddArgs(parts: string[]): ParsedMcpAddArgs {
  const confirmToken = readFlagValue(parts, '--confirm')
  if (confirmToken) return { confirmToken }

  const delimiterIndex = parts.indexOf('--')
  const beforeCommand =
    delimiterIndex === -1 ? parts : parts.slice(0, delimiterIndex)
  const commandParts =
    delimiterIndex === -1 ? [] : parts.slice(delimiterIndex + 1)

  const unsupported = beforeCommand.find(
    part => part.startsWith('-') && !SUPPORTED_FLAGS.has(part),
  )
  if (unsupported) return { unsupportedFlag: unsupported }

  const positional: string[] = []
  for (let index = 0; index < beforeCommand.length; index++) {
    const part = beforeCommand[index]
    if (part === '--dry-run') continue
    if (VALUE_FLAGS.has(part)) {
      index++
      continue
    }
    positional.push(part)
  }

  const transport = readFlagValue(beforeCommand, '--transport', '-t')
  const serverName = positional[0]
  const commandOrUrl =
    commandParts[0] ??
    (transport === 'http' || transport === 'sse' ? positional[1] : undefined)

  return {
    serverName,
    scope: readFlagValue(beforeCommand, '--scope', '-s'),
    transport,
    commandOrUrl,
    args: commandParts.length > 0 ? commandParts.slice(1) : [],
    env: readRepeatedFlagValues(beforeCommand, '--env', '-e'),
    headers: readRepeatedFlagValues(beforeCommand, '--header', '-H'),
  }
}
