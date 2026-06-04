import { existsSync } from 'fs'
import { resolve } from 'path'
import { feature } from 'bun:bundle'
import type { DirectConnectRuntimeSnapshot } from './runtimeTypes.js'
import { auditOfficialCacheForNeedles } from './officialCacheAudit.js'

const SERVER_MODULES = [
  'server/server.ts',
  'server/sessionManager.ts',
  'server/backends/dangerousBackend.ts',
  'server/serverBanner.ts',
  'server/serverLog.ts',
  'server/lockfile.ts',
]

const OPEN_MODULES = [
  'server/parseConnectUrl.ts',
  'server/connectHeadless.ts',
]

const CLIENT_MODULES = [
  'server/createDirectConnectSession.ts',
  'server/directConnectManager.ts',
  'hooks/useDirectConnect.ts',
]

function missingModules(paths: string[]): string[] {
  return paths.filter(path => !existsSync(resolve(import.meta.dir, '..', path)))
}

export function getDirectConnectRuntimeSnapshot(): DirectConnectRuntimeSnapshot {
  const featureEnabled = feature('DIRECT_CONNECT') ? true : false
  const missingServerModules = featureEnabled ? missingModules(SERVER_MODULES) : []
  const missingOpenModules = featureEnabled ? missingModules(OPEN_MODULES) : []
  const missingClientModules = featureEnabled ? missingModules(CLIENT_MODULES) : []
  const missing = [...new Set([...missingServerModules, ...missingOpenModules])]
  const cacheAudit =
    featureEnabled && missing.length > 0
      ? auditOfficialCacheForNeedles([
          'server/server',
          'server/sessionManager',
          'dangerousBackend',
          'serverBanner',
          'serverLog',
          'lockfile',
          'parseConnectUrl',
          'connectHeadless',
        ])
      : {
          cachePathsChecked: [],
          cachePathsPresent: [],
          recoverableSourceHits: [],
          recoverableFromLocalCache: false,
        }
  const serverRuntimeAvailable =
    featureEnabled && missingServerModules.length === 0
  const openRuntimeAvailable = featureEnabled && missingOpenModules.length === 0
  const clientSessionCreateAvailable =
    featureEnabled && !missingClientModules.includes('server/createDirectConnectSession.ts')
  const clientSessionManagerAvailable =
    featureEnabled && !missingClientModules.includes('server/directConnectManager.ts')
  const replHookAvailable =
    featureEnabled && !missingClientModules.includes('hooks/useDirectConnect.ts')

  let statusReason: string | null = null
  if (!featureEnabled) {
    statusReason = 'DIRECT_CONNECT feature gate is disabled.'
  } else if (!serverRuntimeAvailable || !openRuntimeAvailable) {
    statusReason = `Direct-connect source modules are missing from this snapshot: ${missing.join(', ')}`
    if (
      cacheAudit.cachePathsPresent.length > 0 &&
      !cacheAudit.recoverableFromLocalCache
    ) {
      statusReason +=
        ' Local provider package caches are binary-only for this path and do not contain recoverable source files for these modules.'
    }
    if (
      clientSessionCreateAvailable ||
      clientSessionManagerAvailable ||
      replHookAvailable
    ) {
      const partials = [
        clientSessionCreateAvailable
          ? 'server/createDirectConnectSession.ts'
          : null,
        clientSessionManagerAvailable
          ? 'server/directConnectManager.ts'
          : null,
        replHookAvailable ? 'hooks/useDirectConnect.ts' : null,
      ].filter(Boolean)
      statusReason += ` Client-side direct-connect pieces still present: ${partials.join(', ')}.`
    }
  }

  return {
    featureEnabled,
    serverCommandExposed: serverRuntimeAvailable,
    openCommandExposed:
      openRuntimeAvailable && clientSessionCreateAvailable,
    serverRuntimeAvailable,
    openRuntimeAvailable,
    clientSessionCreateAvailable,
    clientSessionManagerAvailable,
    replHookAvailable,
    missingServerModules,
    missingOpenModules,
    cachePathsChecked: cacheAudit.cachePathsChecked,
    cachePathsPresent: cacheAudit.cachePathsPresent,
    recoverableSourceHits: cacheAudit.recoverableSourceHits,
    recoverableFromLocalCache: cacheAudit.recoverableFromLocalCache,
    statusReason,
  }
}
