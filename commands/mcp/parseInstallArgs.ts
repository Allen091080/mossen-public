export type ParsedMcpInstallArgs = {
  source?: string
  serverName?: string
  scope?: string
  confirmToken?: string
  unsupportedFlag?: string
}

function readFlagValue(parts: string[], flag: string): string | undefined {
  const index = parts.indexOf(flag)
  if (index === -1) return undefined
  return parts[index + 1]
}

export function parseMcpInstallArgs(parts: string[]): ParsedMcpInstallArgs {
  const unsupported = parts.find(
    part =>
      part.startsWith('--') &&
      !['--name', '--scope', '--confirm', '--dry-run'].includes(part),
  )
  if (unsupported) {
    return { unsupportedFlag: unsupported }
  }

  const confirmToken = readFlagValue(parts, '--confirm')
  const positional = parts.filter((part, index) => {
    if (part.startsWith('--')) return false
    const previous = parts[index - 1]
    return !['--name', '--scope', '--confirm'].includes(previous)
  })

  return {
    source: positional[0],
    serverName: readFlagValue(parts, '--name'),
    scope: readFlagValue(parts, '--scope'),
    confirmToken,
  }
}
