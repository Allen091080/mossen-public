/**
 * Load LSP server config from user / project scope.
 * Plugin scope is handled in services/lsp/config.ts.
 * Failures return error in result rather than throwing — caller decides surfacing.
 */

import * as fs from 'fs/promises'
import * as path from 'path'

import { getOriginalCwd } from '../../bootstrap/state.js'
import { getMossenConfigHomeDir } from '../../utils/envUtils.js'

import type { ScopedLspServerConfig } from './types.js'

export type LspConfigSource = 'user' | 'project'

export type LspConfigLoadResult = {
  servers: Record<string, ScopedLspServerConfig>
  /** Absolute path that was attempted (even if file did not exist). */
  path: string
  /** True if the file existed AND was successfully parsed. */
  loaded: boolean
  /** Populated when file existed but failed to parse / validate; null otherwise. */
  error: string | null
}

const SERVER_NAME_RE = /^[a-zA-Z0-9_-]+$/
const SERVER_NAME_MAX_LEN = 64

export function getUserLspConfigPath(): string {
  return path.join(getMossenConfigHomeDir(), 'lsp', 'servers.json')
}

export function getProjectLspConfigPath(cwd?: string): string {
  return path.join(cwd ?? getOriginalCwd(), '.mossen', 'lsp.json')
}

export async function loadUserLspConfig(): Promise<LspConfigLoadResult> {
  const filePath = getUserLspConfigPath()
  return loadAndTag(filePath, 'user')
}

export async function loadProjectLspConfig(
  cwd?: string,
): Promise<LspConfigLoadResult> {
  const filePath = getProjectLspConfigPath(cwd)
  return loadAndTag(filePath, 'project')
}

async function loadAndTag(
  filePath: string,
  source: LspConfigSource,
): Promise<LspConfigLoadResult> {
  // Existence check — quietly absent is not an error.
  let exists = true
  try {
    await fs.access(filePath)
  } catch {
    exists = false
  }
  if (!exists) {
    return { servers: {}, path: filePath, loaded: false, error: null }
  }

  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    return {
      servers: {},
      path: filePath,
      loaded: false,
      error: `${filePath}: failed to read (${(err as Error).message})`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      servers: {},
      path: filePath,
      loaded: false,
      error: `${filePath}: invalid JSON (${(err as Error).message})`,
    }
  }

  const validated = validateLspServersDoc(parsed)
  if (validated.ok !== true) {
    return {
      servers: {},
      path: filePath,
      loaded: false,
      error: `${filePath}: ${(validated as { ok: false; error: string }).error}`,
    }
  }
  const okValidated = validated as { ok: true; servers: Record<string, LspServerConfigShape> }

  const tag = `${source}:${filePath}`
  const servers: Record<string, ScopedLspServerConfig> = {}
  for (const [name, cfg] of Object.entries(okValidated.servers)) {
    servers[name] = {
      ...cfg,
      scope: 'dynamic',
      source: tag,
    }
  }

  return { servers, path: filePath, loaded: true, error: null }
}

type ValidationResult =
  | { ok: true; servers: Record<string, LspServerConfigShape> }
  | { ok: false; error: string }

// Local mirror of LspServerConfig keyed shape — kept here only for validation
// boundaries; we still emit ScopedLspServerConfig from the public API.
type LspServerConfigShape = {
  command: string
  args?: string[]
  extensionToLanguage: Record<string, string>
  transport?: 'stdio' | 'socket'
  env?: Record<string, string>
  initializationOptions?: unknown
  settings?: unknown
  workspaceFolder?: string
  startupTimeout?: number
  shutdownTimeout?: number
  restartOnCrash?: boolean
  maxRestarts?: number
  rootPatterns?: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function isPosFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isNonNegFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false
  }
  return true
}

function isNonEmptyStringRecord(
  value: unknown,
): value is Record<string, string> {
  return isStringRecord(value) && Object.keys(value).length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string')
}

function validateLspServersDoc(doc: unknown): ValidationResult {
  if (!isPlainObject(doc)) {
    return { ok: false, error: 'missing or invalid lspServers' }
  }
  const lspServers = (doc as Record<string, unknown>).lspServers
  if (lspServers === undefined || !isPlainObject(lspServers)) {
    return { ok: false, error: 'missing or invalid lspServers' }
  }

  const out: Record<string, LspServerConfigShape> = {}
  for (const [name, entry] of Object.entries(lspServers)) {
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > SERVER_NAME_MAX_LEN ||
      !SERVER_NAME_RE.test(name)
    ) {
      return {
        ok: false,
        error: `Invalid server '${name}': name must match [a-zA-Z0-9_-]{1,${SERVER_NAME_MAX_LEN}}`,
      }
    }
    const checked = validateServerEntry(name, entry)
    if (checked.ok !== true) {
      return { ok: false, error: (checked as { ok: false; error: string }).error }
    }
    out[name] = (checked as { ok: true; config: LspServerConfigShape }).config
  }

  return { ok: true, servers: out }
}

type EntryResult =
  | { ok: true; config: LspServerConfigShape }
  | { ok: false; error: string }

function validateServerEntry(name: string, entry: unknown): EntryResult {
  if (!isPlainObject(entry)) {
    return { ok: false, error: `Invalid server '${name}': entry must be an object` }
  }

  const e = entry as Record<string, unknown>

  if (typeof e.command !== 'string' || e.command.length === 0) {
    return {
      ok: false,
      error: `Invalid server '${name}': command must be a non-empty string`,
    }
  }
  if (e.args !== undefined && !isStringArray(e.args)) {
    return {
      ok: false,
      error: `Invalid server '${name}': args must be string[]`,
    }
  }
  if (!isNonEmptyStringRecord(e.extensionToLanguage)) {
    return {
      ok: false,
      error: `Invalid server '${name}': extensionToLanguage must be a non-empty Record<string,string>`,
    }
  }
  if (
    e.transport !== undefined &&
    e.transport !== 'stdio' &&
    e.transport !== 'socket'
  ) {
    return {
      ok: false,
      error: `Invalid server '${name}': transport must be 'stdio' or 'socket'`,
    }
  }
  if (e.env !== undefined && !isStringRecord(e.env)) {
    return {
      ok: false,
      error: `Invalid server '${name}': env must be Record<string,string>`,
    }
  }
  if (e.workspaceFolder !== undefined && typeof e.workspaceFolder !== 'string') {
    return {
      ok: false,
      error: `Invalid server '${name}': workspaceFolder must be a string`,
    }
  }
  if (e.startupTimeout !== undefined && !isPosFiniteNumber(e.startupTimeout)) {
    return {
      ok: false,
      error: `Invalid server '${name}': startupTimeout must be a finite number > 0`,
    }
  }
  if (e.shutdownTimeout !== undefined && !isPosFiniteNumber(e.shutdownTimeout)) {
    return {
      ok: false,
      error: `Invalid server '${name}': shutdownTimeout must be a finite number > 0`,
    }
  }
  if (e.restartOnCrash !== undefined && typeof e.restartOnCrash !== 'boolean') {
    return {
      ok: false,
      error: `Invalid server '${name}': restartOnCrash must be boolean`,
    }
  }
  if (e.maxRestarts !== undefined && !isNonNegFiniteNumber(e.maxRestarts)) {
    return {
      ok: false,
      error: `Invalid server '${name}': maxRestarts must be a finite number >= 0`,
    }
  }
  if (e.rootPatterns !== undefined) {
    if (!Array.isArray(e.rootPatterns)) {
      return {
        ok: false,
        error: `Invalid server '${name}': rootPatterns must be a string[]`,
      }
    }
    for (const item of e.rootPatterns) {
      if (typeof item !== 'string' || item.length === 0) {
        return {
          ok: false,
          error: `Invalid server '${name}': rootPatterns entries must be non-empty strings`,
        }
      }
    }
  }

  const config: LspServerConfigShape = {
    command: e.command as string,
    extensionToLanguage: e.extensionToLanguage as Record<string, string>,
  }
  if (e.args !== undefined) config.args = e.args as string[]
  if (e.transport !== undefined) {
    config.transport = e.transport as 'stdio' | 'socket'
  }
  if (e.env !== undefined) config.env = e.env as Record<string, string>
  if (e.initializationOptions !== undefined) {
    config.initializationOptions = e.initializationOptions
  }
  if (e.settings !== undefined) config.settings = e.settings
  if (e.workspaceFolder !== undefined) config.workspaceFolder = e.workspaceFolder as string
  if (e.startupTimeout !== undefined) config.startupTimeout = e.startupTimeout as number
  if (e.shutdownTimeout !== undefined) config.shutdownTimeout = e.shutdownTimeout as number
  if (e.restartOnCrash !== undefined) config.restartOnCrash = e.restartOnCrash as boolean
  if (e.maxRestarts !== undefined) config.maxRestarts = e.maxRestarts as number
  if (e.rootPatterns !== undefined) config.rootPatterns = e.rootPatterns as string[]

  return { ok: true, config }
}
