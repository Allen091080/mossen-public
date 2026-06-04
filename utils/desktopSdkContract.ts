import type { DiagnosticInfo } from './doctorDiagnostic.js'
import { getCwd } from './cwd.js'
import { getInteractiveLanguageTag } from './uiLanguage.js'
import { getRipgrepStatus, type RipgrepStatusMode } from './ripgrep.js'
import type { PlatformRuntimeSnapshot } from '../platform/runtimeTypes.js'

export type DesktopCapabilityHint = {
  supportsImagePreview?: boolean
  supportsOpenFile?: boolean
  supportsTerminalSequences?: boolean
}

export type DesktopSdkSearchBackend =
  | 'vendor-rg'
  | 'system-rg'
  | 'embedded-rg'
  | 'js-fallback'

export type DesktopSdkContract = {
  version: 1
  cwd: string
  model: string | null
  providerProtocol: string | null
  permissionPromptTool: string | null
  searchBackend: DesktopSdkSearchBackend
  memorySidecar: {
    enabled: boolean
  }
  mcp: {
    summary: {
      enterprise: number
      user: number
      project: number
      local: number
      errors: number
      pluginOnly: boolean
      managedOnly: boolean
    }
  }
  plugin: {
    summary: {
      enabled: number
      disabled: number
      errors: number
    }
  }
  i18n: {
    locale: 'en' | 'zh'
  }
  desktop: {
    acceptedCapabilities: DesktopCapabilityHint
  }
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function normalizeDesktopCapabilityHint(
  input: unknown,
): DesktopCapabilityHint {
  if (!input || typeof input !== 'object') {
    return {}
  }

  const record = input as Record<string, unknown>
  return {
    ...(toBoolean(record.supportsImagePreview) !== undefined
      ? { supportsImagePreview: toBoolean(record.supportsImagePreview) }
      : {}),
    ...(toBoolean(record.supportsOpenFile) !== undefined
      ? { supportsOpenFile: toBoolean(record.supportsOpenFile) }
      : {}),
    ...(toBoolean(record.supportsTerminalSequences) !== undefined
      ? {
          supportsTerminalSequences: toBoolean(
            record.supportsTerminalSequences,
          ),
        }
      : {}),
  }
}

function mapSearchBackend(mode: RipgrepStatusMode): DesktopSdkSearchBackend {
  if (mode === 'system') return 'system-rg'
  if (mode === 'embedded') return 'embedded-rg'
  if (mode === 'js-fallback') return 'js-fallback'
  return 'vendor-rg'
}

export function buildDesktopSdkContract({
  platformRuntime,
  model,
  permissionPromptTool,
  desktopCapabilities,
  cwd = getCwd(),
}: {
  platformRuntime: PlatformRuntimeSnapshot
  model?: string | null
  permissionPromptTool?: string | null
  desktopCapabilities?: unknown
  cwd?: string
}): DesktopSdkContract {
  const ripgrepStatus = getRipgrepStatus()
  const acceptedCapabilities =
    normalizeDesktopCapabilityHint(desktopCapabilities)

  return {
    version: 1,
    cwd,
    model: model ?? platformRuntime.provider.model,
    providerProtocol: platformRuntime.provider.protocol,
    permissionPromptTool: permissionPromptTool ?? null,
    searchBackend: mapSearchBackend(ripgrepStatus.mode),
    memorySidecar: {
      enabled: platformRuntime.memory.enabled,
    },
    mcp: {
      summary: {
        enterprise: platformRuntime.mcp.enterpriseServers,
        user: platformRuntime.mcp.userServers,
        project: platformRuntime.mcp.projectServers,
        local: platformRuntime.mcp.localServers,
        errors: platformRuntime.mcp.totalErrors,
        pluginOnly: platformRuntime.mcp.pluginOnly,
        managedOnly: platformRuntime.mcp.managedOnly,
      },
    },
    plugin: {
      summary: {
        enabled: platformRuntime.plugins.enabled,
        disabled: platformRuntime.plugins.disabled,
        errors: platformRuntime.plugins.errors,
      },
    },
    i18n: {
      locale: getInteractiveLanguageTag(),
    },
    desktop: {
      acceptedCapabilities,
    },
  }
}

export function buildDesktopSdkContractFromDiagnostic({
  diagnostic,
  permissionPromptTool,
  desktopCapabilities,
  model,
}: {
  diagnostic: DiagnosticInfo
  permissionPromptTool?: string | null
  desktopCapabilities?: unknown
  model?: string | null
}): DesktopSdkContract {
  return buildDesktopSdkContract({
    platformRuntime: diagnostic.platformRuntime,
    model,
    permissionPromptTool,
    desktopCapabilities,
  })
}
