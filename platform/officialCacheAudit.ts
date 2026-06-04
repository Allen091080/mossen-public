import { existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, relative } from 'path'

const OFFICIAL_CACHE_ROOT = join(homedir(), '.bun/install/cache/@mossen')

export type LocalOfficialCacheAudit = {
  cachePathsChecked: string[]
  cachePathsPresent: string[]
  recoverableSourceHits: string[]
  recoverableFromLocalCache: boolean
}

function walkFiles(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      walkFiles(root, fullPath, out)
      continue
    }
    if (stats.isFile()) {
      out.push(relative(root, fullPath))
    }
  }
}

function getOfficialCacheRoots(): string[] {
  if (!existsSync(OFFICIAL_CACHE_ROOT)) return []

  return readdirSync(OFFICIAL_CACHE_ROOT, { withFileTypes: true })
    .filter(
      entry =>
        entry.isDirectory() &&
        (entry.name.startsWith('mossen-code@') ||
          entry.name.startsWith('mossen-code-darwin-arm64@')),
    )
    .map(entry => join(OFFICIAL_CACHE_ROOT, entry.name))
}

export function auditOfficialCacheForNeedles(
  needles: string[],
): LocalOfficialCacheAudit {
  const cachePathsChecked = getOfficialCacheRoots()
  const cachePathsPresent = cachePathsChecked.filter(path => existsSync(path))
  const recoverableSourceHits: string[] = []

  for (const root of cachePathsPresent) {
    const files: string[] = []
    walkFiles(root, root, files)
    for (const file of files) {
      if (needles.some(needle => file.includes(needle))) {
        recoverableSourceHits.push(`${root}:${file}`)
      }
    }
  }

  return {
    cachePathsChecked,
    cachePathsPresent,
    recoverableSourceHits,
    recoverableFromLocalCache: recoverableSourceHits.length > 0,
  }
}
