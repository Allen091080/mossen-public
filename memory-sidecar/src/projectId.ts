import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryRootOptions } from './index'
import { getProjectMemoryDir } from './index'

function projectsRootDir(options: MemoryRootOptions): string {
  if (options.memoryDir) {
    // memoryDir points to <root>/projects/<id>/memory; walk up to projects/
    return join(options.memoryDir, '..', '..')
  }
  const home = process.env.HOME ?? '.'
  const rootDir = options.rootDir ?? `${home}/.mossen`
  return `${rootDir}/projects`
}

/**
 * Generate candidate project ID aliases for a given cwd-derived projectId.
 *
 * Order matters: callers should try each alias in order and use the first
 * one that has existing data.
 */
export function projectIdAliases(projectId: string): string[] {
  const aliases: string[] = [projectId]

  // basename alias: "-Users-allen-Documents-aiproject-mossensrc" → "mossensrc"
  // Strip leading dashes from the sanitized form
  const bare = projectId.replace(/^-+/, '')
  const parts = bare.split(/-+/)
  const lastPart = parts[parts.length - 1]
  if (lastPart && lastPart !== projectId) {
    aliases.push(lastPart)
  }

  // Full basename without sanitization (e.g. actual dir name)
  // This handles cases where the cwd basename differs from the sanitized last segment
  if (lastPart) {
    aliases.push(lastPart.toLowerCase())
  }

  // Deduplicate while preserving order
  return [...new Set(aliases)]
}

export type ResolvedProjectId = {
  projectId: string
  requestedProjectId: string
  aliases: string[]
  aliasReason?: string
}

/**
 * W119 H3: discover sanitized variants of a bare basename by scanning the
 * sidecar projects/ directory. Powers the reverse direction of alias
 * resolution: query "mossensrc" finds data under
 * "-Users-allen-Documents-aiproject-mossensrc".
 *
 * Pure read-only directory listing. Returns at most a handful of matches in
 * practice (one project tree per cwd Allen has used).
 */
export async function discoverProjectIdAliases(
  options: MemoryRootOptions & { projectId: string },
): Promise<string[]> {
  const root = projectsRootDir(options)
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const requestedBare = options.projectId.replace(/^-+/, '').toLowerCase()
  const requestedLastPart = requestedBare.split(/-+/).pop() ?? requestedBare
  const matches: string[] = []
  for (const name of entries) {
    if (name === options.projectId) continue
    const bare = name.replace(/^-+/, '').toLowerCase()
    const lastPart = bare.split(/-+/).pop() ?? bare
    if (lastPart === requestedLastPart || lastPart === requestedBare || bare === requestedBare) {
      matches.push(name)
    }
  }
  return matches
}

/**
 * Resolve a projectId to the one that actually has data in the sidecar.
 *
 * Checks for meaningful data (archive events, observations, profiles, proposals),
 * not just directory existence. Returns the first alias with real data, or falls
 * back to the original projectId.
 */
export async function resolveProjectId(
  options: MemoryRootOptions & { projectId: string },
): Promise<ResolvedProjectId> {
  const requested = options.projectId
  // W119 H3: combine forward (sanitized→bare) + reverse (bare→sanitized via
  // dir scan) so recall finds data regardless of which form the caller used.
  const forwardAliases = projectIdAliases(requested)
  const discovered = await discoverProjectIdAliases(options)
  const aliases = [...new Set([...forwardAliases, ...discovered])]

  let primaryHasData = false
  let aliasWithDatum: string | undefined

  for (const alias of aliases) {
    const hasData = await projectHasMeaningfulData(options, alias)
    if (alias === requested) {
      primaryHasData = hasData
    } else if (hasData && !aliasWithDatum) {
      aliasWithDatum = alias
    }
  }

  // Primary has data — use it directly
  if (primaryHasData) {
    return {
      projectId: requested,
      requestedProjectId: requested,
      aliases,
    }
  }

  // Primary empty but alias has data — fallback
  if (aliasWithDatum) {
    return {
      projectId: aliasWithDatum,
      requestedProjectId: requested,
      aliases,
      aliasReason: 'primary-empty alias-has-data',
    }
  }

  // Nothing found — return primary as-is
  return {
    projectId: requested,
    requestedProjectId: requested,
    aliases,
  }
}

/**
 * Check whether a project directory has meaningful sidecar data.
 *
 * Meaningful = at least one of:
 * - archive sessions with .jsonl files
 * - observations store file
 * - profile snapshots file
 * - proposals store file
 */
async function projectHasMeaningfulData(
  options: MemoryRootOptions,
  projectId: string,
): Promise<boolean> {
  const dir = getProjectMemoryDir({ ...options, projectId })

  // Check archive sessions — the primary data store
  const archiveDir = join(dir, 'archive/sessions')
  try {
    const files = await readdir(archiveDir)
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
    for (const f of jsonlFiles) {
      const s = await stat(join(archiveDir, f))
      if (s.size > 0) return true
    }
  } catch {
    // no archive dir
  }

  // W119 H2: stores are JSONL, not JSON. The earlier .json check was a
  // typo and silently broke alias-fallback for projects that had
  // observations/profiles/proposals but no archive sessions.
  if (await hasNonEmptyFile(join(dir, 'observations.jsonl'))) return true
  if (await hasNonEmptyFile(join(dir, 'profiles.jsonl'))) return true
  if (await hasNonEmptyFile(join(dir, 'proposals.jsonl'))) return true

  // Do NOT count sqlite memory.db — it can exist with schema only and 0 rows

  return false
}

async function hasNonEmptyFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile() && s.size > 0
  } catch {
    return false
  }
}
