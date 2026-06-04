/**
 * services/config — Mossen 配置门面公共入口 (G1-4).
 *
 * 调用方应只 import from 'services/config/index.js' 或 services/config/types.js,
 * 不应直接 import providers/* 或 facade.ts 内部.
 */

export {
  getMossenFeatureValue,
  getMossenDynamicConfig,
  checkMossenGate,
  onMossenConfigRefresh,
  setMossenConfigOverride,
  clearMossenConfigOverrides,
  getAllMossenConfigValues,
  resolveMossenConfig,
  notifyRefreshListeners,
  facade,
  _resetFacadeForTesting,
} from './facade.js'

export type {
  ConfigValueSource,
  ConfigOverrideScope,
  ProviderResult,
  MossenConfigProvider,
  MossenConfigRefreshListener,
  MossenConfigFacade,
  LegacyConfigAliasMap,
} from './types.js'

export { MOSSEN_KEY_PATTERN, validateMossenKey, PROVIDER_PRIORITY } from './types.js'

export { LEGACY_TO_MOSSEN_ALIAS, resolveAliasedKey } from './aliasMap.js'

export { MOSSEN_BUILTIN_DEFAULTS } from './defaults.js'

export {
  PROFILE_PROVIDER_VALUES,
  maskApiKey,
  desensitizeProfile,
  desensitizeProfiles,
  validateProfile,
  validateProfileName,
  getProfiles,
  getActiveProfileName,
  getActiveProfile,
  getProfileByName,
  setProfile,
  deleteProfile,
  setActiveProfile,
  clearActiveProfile,
  setSessionActiveProfile,
  clearSessionActiveProfile,
  getDefaultActiveProfileName,
  testProfile,
  testProfileChat,
  getFallbackProfile,
  listAllProfiles,
  getCurrentProfile,
  getDefaultProfile,
  migrateFallbackProfile,
  resolveProfileApiKey,
  describeProfileCredential,
} from './profiles.js'

export type {
  ProfileProvider,
  ProfileSchema,
  ProfilesMap,
  DesensitizedProfile,
  ProfileTestResult,
  ProfileChatTestResult,
  ListedProfile,
  ProfileSource,
  MigrateFallbackResult,
  ProfileCredentialResolution,
} from './profiles.js'

export {
  defaultProfileApiKeyRef,
  describeApiKeyRef,
  isModelProfileKeychainAvailable,
  readProfileApiKeyFromKeychain,
  validateApiKeyRef,
  writeProfileApiKeyToKeychain,
} from './keychain.js'

export type {
  ProfileApiKeyRef,
  KeychainReadResult,
  KeychainWriteResult,
} from './keychain.js'

export {
  createModelProfileKeychainImportPlan,
  createModelProfileKeychainMigrationPlan,
  executeModelProfileKeychainPlan,
  getModelProfileKeychainStatus,
  _resetModelProfileKeychainPlanStoreForTesting,
} from './profileKeychain.js'

export type {
  ProfileKeychainExecuteResult,
  ProfileKeychainPlanPreview,
} from './profileKeychain.js'

export {
  isModelProfileFlagPresent,
  handleModelProfileCliFlag,
} from './profileCli.js'

/**
 * 处理 mossen --get-mossen-config / --set-mossen-config / --clear-mossen-config CLI flag
 * (D-G05-A=a Allen 决策).
 *
 * Fast-path: 不启动 mossen 主流程, 只 read/write 配置然后 exit.
 *
 * 用法:
 *   mossen --get-mossen-config <key>
 *   mossen --set-mossen-config <key> <value-as-json> [--scope user|project|override]
 *   mossen --clear-mossen-config <key> [--scope user|project|override]
 *   mossen --list-mossen-config
 *
 * Output: stdout = JSON.stringify(value); exit 0 = OK, 1 = error.
 *
 * 仅 internal/debug + R5/R6 测试用. --help 不展示 (隐藏 flag).
 */
export async function handleConfigCliFlag(args: readonly string[]): Promise<{
  handled: boolean
  exitCode: number
}> {
  const getIdx = args.indexOf('--get-mossen-config')
  const setIdx = args.indexOf('--set-mossen-config')
  const clearIdx = args.indexOf('--clear-mossen-config')
  const listIdx = args.indexOf('--list-mossen-config')

  if (getIdx === -1 && setIdx === -1 && clearIdx === -1 && listIdx === -1) {
    return { handled: false, exitCode: 0 }
  }

  // 解析 --scope (default 'override' for set/clear)
  const scopeIdx = args.indexOf('--scope')
  const scope =
    scopeIdx !== -1 && scopeIdx + 1 < args.length
      ? (args[scopeIdx + 1] as 'user' | 'project' | 'override')
      : 'override'
  if (!['user', 'project', 'override'].includes(scope)) {
    process.stderr.write(`error: invalid --scope "${scope}"; expected user|project|override\n`)
    return { handled: true, exitCode: 1 }
  }

  const facadeMod = await import('./facade.js')

  if (getIdx !== -1) {
    const key = args[getIdx + 1]
    if (!key) {
      process.stderr.write('error: --get-mossen-config requires a key argument\n')
      return { handled: true, exitCode: 1 }
    }
    const r = facadeMod.resolveMossenConfig<unknown>(key, null)
    process.stdout.write(`${JSON.stringify(r.value)}\n`)
    return { handled: true, exitCode: 0 }
  }

  if (setIdx !== -1) {
    const key = args[setIdx + 1]
    const valueStr = args[setIdx + 2]
    if (!key || valueStr === undefined) {
      process.stderr.write(
        'error: --set-mossen-config requires <key> <value-as-json>\n',
      )
      return { handled: true, exitCode: 1 }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(valueStr)
    } catch (e) {
      process.stderr.write(
        `error: --set-mossen-config value must be valid JSON: ${(e as Error).message}\n`,
      )
      return { handled: true, exitCode: 1 }
    }
    facadeMod.setMossenConfigOverride(key, parsed, scope)
    return { handled: true, exitCode: 0 }
  }

  if (clearIdx !== -1) {
    const key = args[clearIdx + 1]
    if (!key) {
      process.stderr.write('error: --clear-mossen-config requires a key argument\n')
      return { handled: true, exitCode: 1 }
    }
    facadeMod.clearMossenConfigOverrides(scope, key)
    return { handled: true, exitCode: 0 }
  }

  if (listIdx !== -1) {
    process.stdout.write(
      `${JSON.stringify(facadeMod.getAllMossenConfigValues(), null, 2)}\n`,
    )
    return { handled: true, exitCode: 0 }
  }

  return { handled: false, exitCode: 0 }
}
