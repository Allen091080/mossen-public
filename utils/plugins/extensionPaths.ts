import { join } from 'path'
import { getSkillsPath } from '../../skills/loadSkillsDir.js'
import { getMossenConfigHomeDir } from '../envUtils.js'
import {
  getCanonicalConfigDirName,
  getPrimaryScopedConfigDir,
} from '../naming.js'
import { getManagedFilePath } from '../settings/managedPath.js'
import {
  getMarketplacesCacheDir,
} from './marketplaceManager.js'
import {
  getPluginSeedDirs,
  getPluginsDirectory,
} from './pluginDirectories.js'

export type ExtensionPathGroup = {
  label: string
  scope: 'user' | 'project' | 'policy' | 'plugin'
  paths: Array<{
    kind:
      | 'skills'
      | 'commands'
      | 'agents'
      | 'plugins-root'
      | 'plugin-cache'
      | 'marketplaces'
      | 'seed'
    path: string
  }>
}

export type ExtensionPathsSummary = {
  configHome: string
  groups: ExtensionPathGroup[]
  notes: string[]
}

export function describeExtensionPaths(): ExtensionPathsSummary {
  const managed = getPrimaryScopedConfigDir(getManagedFilePath())
  const projectConfig = getCanonicalConfigDirName()
  const pluginRoot = getPluginsDirectory()

  return {
    configHome: getMossenConfigHomeDir(),
    groups: [
      {
        label: 'User extensions',
        scope: 'user',
        paths: [
          { kind: 'skills', path: getSkillsPath('userSettings', 'skills') },
          {
            kind: 'commands',
            path: getSkillsPath('userSettings', 'commands'),
          },
          { kind: 'agents', path: join(getMossenConfigHomeDir(), 'agents') },
        ],
      },
      {
        label: 'Project extensions',
        scope: 'project',
        paths: [
          {
            kind: 'skills',
            path: getSkillsPath('projectSettings', 'skills'),
          },
          {
            kind: 'commands',
            path: getSkillsPath('projectSettings', 'commands'),
          },
          { kind: 'agents', path: join(projectConfig, 'agents') },
        ],
      },
      {
        label: 'Policy extensions',
        scope: 'policy',
        paths: [
          {
            kind: 'skills',
            path: getSkillsPath('policySettings', 'skills'),
          },
          {
            kind: 'commands',
            path: getSkillsPath('policySettings', 'commands'),
          },
          { kind: 'agents', path: join(managed, 'agents') },
        ],
      },
      {
        label: 'Plugin extension system',
        scope: 'plugin',
        paths: [
          { kind: 'plugins-root', path: pluginRoot },
          { kind: 'plugin-cache', path: join(pluginRoot, 'cache') },
          { kind: 'marketplaces', path: getMarketplacesCacheDir() },
          ...getPluginSeedDirs().map(path => ({
            kind: 'seed' as const,
            path,
          })),
        ],
      },
    ],
    notes: [
      'Project paths are relative to the current working directory.',
      'Plugin components are loaded through plugin manifests and marketplace entries.',
      'This summary is read-only and does not create directories.',
    ],
  }
}
