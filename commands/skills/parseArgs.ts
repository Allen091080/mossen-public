export type ParsedSkillsCommand =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'doctor' }
  | {
      type: 'install'
      target?: string
      confirmToken?: string
    }

export function parseSkillsArgs(args?: string): ParsedSkillsCommand {
  const trimmed = args?.trim()
  if (!trimmed) return { type: 'menu' }

  const parts = trimmed.split(/\s+/)
  const command = parts[0]?.toLowerCase()
  if (command === 'help' || command === '--help' || command === '-h') {
    return { type: 'help' }
  }

  if (command === 'doctor' || command === 'diag' || command === 'diagnose') {
    return { type: 'doctor' }
  }

  if (command === 'install' || command === 'i') {
    const confirmIdx = parts.findIndex(p => p === '--confirm')
    const confirmToken =
      confirmIdx >= 0 ? parts[confirmIdx + 1]?.trim() || undefined : undefined
    const targetParts = parts
      .slice(1)
      .filter((_part, idx) => {
        const absoluteIdx = idx + 1
        return absoluteIdx !== confirmIdx && absoluteIdx !== confirmIdx + 1
      })
    const target = targetParts.join(' ').trim() || undefined
    return { type: 'install', target, confirmToken }
  }

  return { type: 'menu' }
}
