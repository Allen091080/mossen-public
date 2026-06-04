import { existsSync } from 'fs'
import { resolve } from 'path'
import { feature } from 'bun:bundle'
import type { SSHRuntimeSnapshot } from './runtimeTypes.js'
import { auditOfficialCacheForNeedles } from './officialCacheAudit.js'

const SSH_MODULES = ['ssh/createSSHSession.ts']
const SSH_ADJACENT_MODULES = ['hooks/useSSHSession.ts', 'ssh/SSHSessionManager.ts']

function missingModules(paths: string[]): string[] {
  return paths.filter(path => !existsSync(resolve(import.meta.dir, '..', path)))
}

export function getSSHRuntimeSnapshot(): SSHRuntimeSnapshot {
  const featureEnabled = feature('SSH_REMOTE') ? true : false
  const missing = featureEnabled ? missingModules(SSH_MODULES) : []
  const missingAdjacent = featureEnabled
    ? missingModules(SSH_ADJACENT_MODULES)
    : []
  const cacheAudit =
    featureEnabled && missing.length > 0
      ? auditOfficialCacheForNeedles(['createSSHSession'])
      : {
          cachePathsChecked: [],
          cachePathsPresent: [],
          recoverableSourceHits: [],
          recoverableFromLocalCache: false,
        }
  const localTestAvailable = featureEnabled && missing.length === 0
  const remoteSessionAvailable = localTestAvailable
  const replHookAvailable =
    featureEnabled && !missingAdjacent.includes('hooks/useSSHSession.ts')
  const sessionFactoryAvailable =
    featureEnabled && !missing.includes('ssh/createSSHSession.ts')
  const sessionManagerAvailable =
    featureEnabled && !missingAdjacent.includes('ssh/SSHSessionManager.ts')

  let statusReason: string | null = null
  if (!featureEnabled) {
    statusReason = 'SSH_REMOTE feature gate is disabled.'
  } else if (!localTestAvailable) {
    const allMissing = [...new Set([...missing, ...missingAdjacent])]
    statusReason = `SSH source modules are missing from this snapshot: ${allMissing.join(', ')}`
    if (
      cacheAudit.cachePathsPresent.length > 0 &&
      !cacheAudit.recoverableFromLocalCache
    ) {
      statusReason +=
        ' Local provider package caches are binary-only for this path and do not contain recoverable source files for these modules.'
    }
    if (replHookAvailable || sessionManagerAvailable) {
      const partials = [
        replHookAvailable ? 'hooks/useSSHSession.ts' : null,
        sessionManagerAvailable ? 'ssh/SSHSessionManager.ts' : null,
      ].filter(Boolean)
      statusReason += ` Adjacent SSH pieces still present: ${partials.join(', ')}.`
    }
  }

  return {
    featureEnabled,
    commandExposed: sessionFactoryAvailable && sessionManagerAvailable,
    localTestAvailable,
    remoteSessionAvailable,
    replHookAvailable,
    sessionFactoryAvailable,
    sessionManagerAvailable,
    missingModules: missing,
    missingAdjacentModules: missingAdjacent,
    cachePathsChecked: cacheAudit.cachePathsChecked,
    cachePathsPresent: cacheAudit.cachePathsPresent,
    recoverableSourceHits: cacheAudit.recoverableSourceHits,
    recoverableFromLocalCache: cacheAudit.recoverableFromLocalCache,
    statusReason,
  }
}
