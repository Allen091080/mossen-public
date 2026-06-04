import { homedir } from 'os'
import { join } from 'path'

const CANONICAL_PROJECT_INSTRUCTIONS_FILENAME = 'MOSSEN.md'
const CANONICAL_CONFIG_DIRNAME = '.mossen'
const CANONICAL_CONFIG_DIR_ENV = 'MOSSEN_CONFIG_DIR'

export function getProjectInstructionsDisplayName(): string {
  return CANONICAL_PROJECT_INSTRUCTIONS_FILENAME
}

export function getCanonicalConfigDirName(): string {
  return CANONICAL_CONFIG_DIRNAME
}

export function getCanonicalConfigDirEnvName(): string {
  return CANONICAL_CONFIG_DIR_ENV
}

export function getCanonicalConfigHomeDir(): string {
  const canonicalOverride = process.env[CANONICAL_CONFIG_DIR_ENV]
  if (canonicalOverride) {
    return canonicalOverride.normalize('NFC')
  }
  return join(homedir(), CANONICAL_CONFIG_DIRNAME).normalize('NFC')
}

export function getConfigHomeDirCandidates(): string[] {
  const canonicalOverride = process.env[CANONICAL_CONFIG_DIR_ENV]
  if (canonicalOverride) {
    return [canonicalOverride.normalize('NFC')]
  }
  return [join(homedir(), CANONICAL_CONFIG_DIRNAME).normalize('NFC')]
}

export function getResolvedConfigHomeDir(): string {
  return getConfigHomeDirCandidates()[0] ?? ''
}

export function getPrimaryProjectInstructionsPath(dir: string): string {
  return join(dir, CANONICAL_PROJECT_INSTRUCTIONS_FILENAME)
}

export function getProjectInstructionsReadCandidates(dir: string): string[] {
  return [getPrimaryProjectInstructionsPath(dir)]
}

export function getPrimaryScopedConfigDir(dir: string): string {
  return join(dir, CANONICAL_CONFIG_DIRNAME)
}

export function getScopedConfigDirReadCandidates(dir: string): string[] {
  return [getPrimaryScopedConfigDir(dir)]
}

export function getScopedConfigInstructionsReadCandidates(
  dir: string,
): string[] {
  return [join(getPrimaryScopedConfigDir(dir), CANONICAL_PROJECT_INSTRUCTIONS_FILENAME)]
}

export function getScopedRulesDirReadCandidates(dir: string): string[] {
  return [join(getPrimaryScopedConfigDir(dir), 'rules')]
}

export function getHomeInstructionsReadCandidates(): string[] {
  return [join(getCanonicalConfigHomeDir(), CANONICAL_PROJECT_INSTRUCTIONS_FILENAME)]
}

export function getHomeRulesDirReadCandidates(): string[] {
  return [join(getCanonicalConfigHomeDir(), 'rules')]
}
