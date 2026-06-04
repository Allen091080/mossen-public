import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { isEnvTruthy } from '../../utils/envBooleans.js'

export type LspToolEnablement = {
  effective: boolean
  configured: boolean
  envEnabled: boolean
}

export function getLspToolEnablement(): LspToolEnablement {
  const configured = getGlobalConfig().lspToolEnabled === true
  const envEnabled = isEnvTruthy(process.env.ENABLE_LSP_TOOL)
  return {
    effective: configured || envEnabled,
    configured,
    envEnabled,
  }
}

export function isLspToolEnabled(): boolean {
  return getLspToolEnablement().effective
}

export function setLspToolEnabled(enabled: boolean): LspToolEnablement {
  saveGlobalConfig(current => {
    if (current.lspToolEnabled === enabled) return current
    return {
      ...current,
      lspToolEnabled: enabled,
    }
  })
  return getLspToolEnablement()
}
