export type ParsedMcpAddTemplateArgs = {
  templateName?: string
  serverName?: string
  scope?: string
  root?: string
  db?: string
  confirmToken?: string
  unsupportedFlag?: string
}

function readFlagValue(parts: string[], flag: string): string | undefined {
  const index = parts.indexOf(flag)
  if (index === -1) return undefined
  return parts[index + 1]
}

export function parseMcpAddTemplateArgs(
  parts: string[],
): ParsedMcpAddTemplateArgs {
  const unsupported = parts.find(
    part =>
      part.startsWith('--') &&
      ![
        '--name',
        '--scope',
        '--root',
        '--db',
        '--confirm',
      ].includes(part),
  )
  if (unsupported) {
    return { unsupportedFlag: unsupported }
  }

  const confirmToken = readFlagValue(parts, '--confirm')
  const positional = parts.filter((part, index) => {
    if (part.startsWith('--')) return false
    const previous = parts[index - 1]
    return ![
      '--name',
      '--scope',
      '--root',
      '--db',
      '--confirm',
    ].includes(previous)
  })

  return {
    templateName: positional[0],
    serverName: readFlagValue(parts, '--name'),
    scope: readFlagValue(parts, '--scope'),
    root: readFlagValue(parts, '--root'),
    db: readFlagValue(parts, '--db'),
    confirmToken,
  }
}
