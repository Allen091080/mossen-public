import { getSessionTrustAccepted } from '../bootstrap/state.js'
import { SandboxManager } from '../utils/sandbox/sandbox-adapter.js'
import { isEnvTruthy } from '../utils/envBooleans.js'
import {
  getConfiguredHardDenyRuleCount,
  getHardDenySettingsMode,
} from '../utils/permissions/hardDeny.js'
import { PERMISSION_MODES } from '../utils/permissions/PermissionMode.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import type { SecurityRuntimeSnapshot } from './runtimeTypes.js'

export function getSecurityRuntimeSnapshot(): SecurityRuntimeSnapshot {
  const settings = getInitialSettings()

  return {
    defaultPermissionMode: settings.permissions?.defaultMode ?? null,
    availablePermissionModes: [...PERMISSION_MODES],
    sessionTrustAccepted: getSessionTrustAccepted(),
    sandboxEnabled: SandboxManager.isSandboxingEnabled(),
    unsandboxedCommandsAllowed: SandboxManager.areUnsandboxedCommandsAllowed(),
    bypassPermissionsRequested: isEnvTruthy(
      process.env.MOSSEN_CODE_ALLOW_BYPASS_PERMISSIONS,
    ),
    hardDenyRuleCount: getConfiguredHardDenyRuleCount(),
    hardDenySettingsMode: getHardDenySettingsMode(),
  }
}
