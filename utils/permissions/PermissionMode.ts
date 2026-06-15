import { feature } from 'bun:bundle'
import z from 'zod/v4'
import { PAUSE_ICON } from '../../constants/figures.js'
import { getLocalizedText } from '../uiLanguage.js'
import { getUserType } from '../userType.js'
// Types extracted to src/types/permissions.ts to break import cycles
import {
  EXTERNAL_PERMISSION_MODES,
  EXTERNAL_PERMISSION_MODE_INPUTS,
  type ExternalPermissionMode,
  normalizeExternalPermissionModeInput,
  normalizePermissionModeInput,
  PERMISSION_MODE_INPUTS,
  PERMISSION_MODES,
  type PermissionMode,
} from '../../types/permissions.js'
import { lazySchema } from '../lazySchema.js'

// Re-export for backwards compatibility
export {
  EXTERNAL_PERMISSION_MODES,
  EXTERNAL_PERMISSION_MODE_INPUTS,
  normalizeExternalPermissionModeInput,
  normalizePermissionModeInput,
  PERMISSION_MODE_INPUTS,
  PERMISSION_MODES,
  type ExternalPermissionMode,
  type PermissionMode,
}

export const permissionModeSchema = lazySchema(() =>
  z.preprocess(
    value =>
      typeof value === 'string'
        ? (normalizePermissionModeInput(value) ?? value)
        : value,
    z.enum(PERMISSION_MODES),
  ),
)
export const externalPermissionModeSchema = lazySchema(() =>
  z.preprocess(
    value =>
      typeof value === 'string'
        ? (normalizeExternalPermissionModeInput(value) ?? value)
        : value,
    z.enum(EXTERNAL_PERMISSION_MODES),
  ),
)

type ModeColorKey =
  | 'text'
  | 'planMode'
  | 'permission'
  | 'autoAccept'
  | 'error'
  | 'warning'

type PermissionModeConfig = {
  title: string
  shortTitle: string
  symbol: string
  color: ModeColorKey
  external: ExternalPermissionMode
}

const PERMISSION_MODE_CONFIG: Partial<
  Record<PermissionMode, PermissionModeConfig>
> = {
  default: {
    title: 'Ask for approval',
    shortTitle: 'Ask',
    symbol: '',
    color: 'text',
    external: 'default',
  },
  plan: {
    title: 'Plan Mode',
    shortTitle: 'Plan',
    symbol: PAUSE_ICON,
    color: 'planMode',
    external: 'plan',
  },
  acceptEdits: {
    title: 'Auto Edit',
    shortTitle: 'Auto Edit',
    symbol: '⏵⏵',
    color: 'autoAccept',
    external: 'acceptEdits',
  },
  bypassPermissions: {
    title: 'YOLO Mode',
    shortTitle: 'YOLO',
    symbol: '⏵⏵',
    color: 'error',
    external: 'bypassPermissions',
  },
  dontAsk: {
    title: "Don't Ask",
    shortTitle: 'DontAsk',
    symbol: '⏵⏵',
    color: 'error',
    external: 'dontAsk',
  },
  ...(feature('TRANSCRIPT_CLASSIFIER')
    ? {
        auto: {
          title: 'Approve for me',
          shortTitle: 'Approve',
          symbol: '⏵⏵',
          color: 'warning' as ModeColorKey,
          external: 'default' as ExternalPermissionMode,
        },
      }
    : {}),
}

/**
 * Type guard to check if a PermissionMode is an ExternalPermissionMode.
 * auto is internal-only and excluded from external modes.
 */
export function isExternalPermissionMode(
  mode: PermissionMode,
): mode is ExternalPermissionMode {
  // External users can't have auto, so always true for them
  if (getUserType() !== 'internal') {
    return true
  }
  return mode !== 'auto' && mode !== 'bubble'
}

function getModeConfig(mode: PermissionMode): PermissionModeConfig {
  return PERMISSION_MODE_CONFIG[mode] ?? PERMISSION_MODE_CONFIG.default!
}

export function toExternalPermissionMode(
  mode: PermissionMode,
): ExternalPermissionMode {
  return getModeConfig(mode).external
}

export function permissionModeFromString(str: string): PermissionMode {
  return normalizePermissionModeInput(str) ?? 'default'
}

export function permissionModeProtocolName(mode: PermissionMode): string {
  switch (mode) {
    case 'default':
      return 'askForApproval'
    case 'acceptEdits':
      return 'autoEdit'
    case 'bypassPermissions':
      return 'yolo'
    case 'auto':
      return 'approveForMe'
    case 'bubble':
      return 'delegatePrompt'
    default:
      return mode
  }
}

export function permissionModeTitle(mode: PermissionMode): string {
  const title = getModeConfig(mode).title
  switch (mode) {
    case 'default':
      return getLocalizedText({ en: title, zh: '请求确认' })
    case 'plan':
      return getLocalizedText({ en: title, zh: '规划模式' })
    case 'acceptEdits':
      return getLocalizedText({ en: title, zh: '自动编辑' })
    case 'bypassPermissions':
      return getLocalizedText({ en: title, zh: 'YOLO 模式' })
    case 'dontAsk':
      return getLocalizedText({ en: title, zh: '不再询问' })
    case 'auto':
      return getLocalizedText({ en: title, zh: '自动审批' })
    default:
      return title
  }
}

export function isDefaultMode(mode: PermissionMode | undefined): boolean {
  return mode === 'default' || mode === undefined
}

export function permissionModeShortTitle(mode: PermissionMode): string {
  const shortTitle = getModeConfig(mode).shortTitle
  switch (mode) {
    case 'default':
      return getLocalizedText({ en: shortTitle, zh: '确认' })
    case 'plan':
      return getLocalizedText({ en: shortTitle, zh: '规划' })
    case 'acceptEdits':
      return getLocalizedText({ en: shortTitle, zh: '编辑' })
    case 'bypassPermissions':
      return getLocalizedText({ en: shortTitle, zh: 'YOLO' })
    case 'dontAsk':
      return getLocalizedText({ en: shortTitle, zh: '免问' })
    case 'auto':
      return getLocalizedText({ en: shortTitle, zh: '审批' })
    default:
      return shortTitle
  }
}

export function permissionModeSymbol(mode: PermissionMode): string {
  return getModeConfig(mode).symbol
}

export function getModeColor(mode: PermissionMode): ModeColorKey {
  return getModeConfig(mode).color
}

/**
 * P1-6 — 权限模式 vs 执行模式语义分离的 UI 提示。
 *
	 * 当前 schema 把"权限策略"和"执行策略"塞在同一个枚举里，导致用户报：
	 * "明明是 YOLO on，为什么自己进入 plan mode" — 实际是 mode 字段从
	 * YOLO 跳到 plan，但 UI 只显示"plan 已开启"看不出语义差。
 *
 * 这个 helper 给每个 mode 标注它属于哪类：
	 * - **权限**: askForApproval / autoEdit / yolo / dontAsk
 *   控制"工具调用前是否要用户确认"
 * - **执行**: plan
 *   控制"agent 是计划还是直接执行"
 * - **混合/自动**: auto
 *
 * UI 在显示 mode 时附加类别后缀，让用户一眼分清"动了哪类"。
 */
export function permissionModeCategory(
  mode: PermissionMode,
): 'permission' | 'execution' | 'auto' {
  switch (mode) {
    case 'plan':
      return 'execution'
    case 'auto':
      return 'auto'
    default:
      return 'permission'
  }
}

export function permissionModeCategoryLabel(mode: PermissionMode): string {
  const cat = permissionModeCategory(mode)
  switch (cat) {
    case 'permission':
      return getLocalizedText({ en: 'permission', zh: '权限' })
    case 'execution':
      return getLocalizedText({ en: 'execution', zh: '执行' })
    case 'auto':
      return getLocalizedText({ en: 'auto', zh: '自动' })
  }
}
