import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export type PackageManagerAutoUpdateMode =
  | 'default'
  | 'enabled'
  | 'disabled'
  | 'unrecognized'

export type TerminalEnvControlSnapshot = {
  alternateScreen: 'default' | 'disabled'
  noFlicker: 'default' | 'enabled' | 'disabled'
  synchronizedOutput: 'auto' | 'forced'
  noColor: 'default' | 'enabled'
  packageManagerAutoUpdate: PackageManagerAutoUpdateMode
  packageManagerAutoUpdateRaw: string | undefined
}

export const TERMINAL_ENV_CONTROL_NAMES = {
  disableAlternateScreen: 'MOSSEN_CODE_DISABLE_ALTERNATE_SCREEN',
  disableAlternateScreenAliases: [
    'MOSSEN_DISABLE_ALTERNATE_SCREEN',
  ],
  noFlicker: 'MOSSEN_CODE_NO_FLICKER',
  noFlickerAliases: ['MOSSEN_NO_FLICKER'],
  forceSyncOutput: 'MOSSEN_CODE_FORCE_SYNC_OUTPUT',
  forceSyncOutputAliases: ['MOSSEN_FORCE_SYNC_OUTPUT'],
  packageManagerAutoUpdate: 'MOSSEN_CODE_PACKAGE_MANAGER_AUTO_UPDATE',
  packageManagerAutoUpdateAliases: ['DISABLE_UPDATES'],
} as const

function readEnvWithAliases(primary: string, aliases: readonly string[]): string | undefined {
  for (const name of [primary, ...aliases]) {
    const value = process.env[name]
    if (value !== undefined) return value
  }
  return undefined
}

export function isAlternateScreenDisabledByEnv(): boolean {
  return isEnvTruthy(
    readEnvWithAliases(
      TERMINAL_ENV_CONTROL_NAMES.disableAlternateScreen,
      TERMINAL_ENV_CONTROL_NAMES.disableAlternateScreenAliases,
    ),
  )
}

export function isNoFlickerEnabledByEnv(): boolean {
  return isEnvTruthy(
    readEnvWithAliases(
      TERMINAL_ENV_CONTROL_NAMES.noFlicker,
      TERMINAL_ENV_CONTROL_NAMES.noFlickerAliases,
    ),
  )
}

export function isNoFlickerDisabledByEnv(): boolean {
  return isEnvDefinedFalsy(
    readEnvWithAliases(
      TERMINAL_ENV_CONTROL_NAMES.noFlicker,
      TERMINAL_ENV_CONTROL_NAMES.noFlickerAliases,
    ),
  )
}

export function isSynchronizedOutputForcedByEnv(): boolean {
  return isEnvTruthy(
    readEnvWithAliases(
      TERMINAL_ENV_CONTROL_NAMES.forceSyncOutput,
      TERMINAL_ENV_CONTROL_NAMES.forceSyncOutputAliases,
    ),
  )
}

export function getPackageManagerAutoUpdateMode(): PackageManagerAutoUpdateMode {
  const raw = process.env[TERMINAL_ENV_CONTROL_NAMES.packageManagerAutoUpdate]
  if (raw === undefined || raw.trim() === '') {
    const disableUpdatesRaw = process.env.DISABLE_UPDATES
    if (disableUpdatesRaw === undefined || disableUpdatesRaw.trim() === '') {
      return 'default'
    }
    if (isEnvTruthy(disableUpdatesRaw)) {
      return 'disabled'
    }
    if (isEnvDefinedFalsy(disableUpdatesRaw)) {
      return 'default'
    }
    return 'unrecognized'
  }
  if (isEnvTruthy(raw)) {
    return 'enabled'
  }
  if (isEnvDefinedFalsy(raw)) {
    return 'disabled'
  }
  return 'unrecognized'
}

export function isPackageManagerAutoUpdateDisabledByEnv(): boolean {
  return getPackageManagerAutoUpdateMode() === 'disabled'
}

export function getTerminalEnvControlSnapshot(): TerminalEnvControlSnapshot {
  return {
    alternateScreen: isAlternateScreenDisabledByEnv()
      ? 'disabled'
      : 'default',
    noFlicker: isNoFlickerEnabledByEnv()
      ? 'enabled'
      : isNoFlickerDisabledByEnv()
        ? 'disabled'
        : 'default',
    synchronizedOutput: isSynchronizedOutputForcedByEnv() ? 'forced' : 'auto',
    noColor: process.env.NO_COLOR !== undefined ? 'enabled' : 'default',
    packageManagerAutoUpdate: getPackageManagerAutoUpdateMode(),
    packageManagerAutoUpdateRaw:
      readEnvWithAliases(
        TERMINAL_ENV_CONTROL_NAMES.packageManagerAutoUpdate,
        TERMINAL_ENV_CONTROL_NAMES.packageManagerAutoUpdateAliases,
      ),
  }
}

export function describePackageManagerAutoUpdateMode(
  mode: PackageManagerAutoUpdateMode,
): { en: string; zh: string } {
  switch (mode) {
    case 'enabled':
      return {
        en: 'enabled by env (status prompt only)',
        zh: '由环境变量启用（仅状态提示）',
      }
    case 'disabled':
      return {
        en: 'disabled by env',
        zh: '由环境变量禁用',
      }
    case 'unrecognized':
      return {
        en: 'unrecognized env value',
        zh: '环境变量值无法识别',
      }
    case 'default':
      return {
        en: 'default',
        zh: '默认',
      }
  }
}
