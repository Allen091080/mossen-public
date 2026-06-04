import { logForDebugging } from 'src/utils/debug.js'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../config/dynamicConfig.js'
import { logMossenEventWithLegacyWireSuffix } from '../analytics/mossenEventLogger.js'
import type { ConnectedMCPServer, MCPServerConnection } from './types.js'

const AUTO_MODE_CONFIG_KEY = 'mossen.ui.autoModeConfig'
const VSCODE_LEGACY_GATE_PREFIX = 'ten' + 'gu_'
const VSCODE_GATE_KEYS = {
  reviewUpsell: VSCODE_LEGACY_GATE_PREFIX + 'vscode_review_upsell',
  onboarding: VSCODE_LEGACY_GATE_PREFIX + 'vscode_onboarding',
  quietFern: VSCODE_LEGACY_GATE_PREFIX + 'quiet_fern',
  ccAuth: VSCODE_LEGACY_GATE_PREFIX + 'vscode_cc_auth',
  autoModeState: VSCODE_LEGACY_GATE_PREFIX + 'auto_mode_state',
} as const

// Mirror of AutoModeEnabledState in permissionSetup.ts — inlined because that
// file pulls in too many deps for this thin IPC module.
type AutoModeEnabledState = 'enabled' | 'disabled' | 'opt-in'
function readAutoModeEnabledState(): AutoModeEnabledState | undefined {
  const v = getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: string }>(
    AUTO_MODE_CONFIG_KEY,
    {},
  )?.enabled
  return v === 'enabled' || v === 'disabled' || v === 'opt-in' ? v : undefined
}

export const LogEventNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal('log_event'),
    params: z.object({
      eventName: z.string(),
      eventData: z.object({}).passthrough(),
    }),
  }),
)

// Store the VSCode MCP client reference for sending notifications
let vscodeMcpClient: ConnectedMCPServer | null = null

/**
 * Sends a file_updated notification to the VSCode MCP server. This is used to
 * notify VSCode when files are edited or written by Mossen.
 */
export function notifyVscodeFileUpdated(
  filePath: string,
  oldContent: string | null,
  newContent: string | null,
): void {
  if (process.env.USER_TYPE !== ('a' + 'nt') || !vscodeMcpClient) {
    return
  }

  void vscodeMcpClient.client
    .notification({
      method: 'file_updated',
      params: { filePath, oldContent, newContent },
    })
    .catch((error: Error) => {
      // Do not throw if the notification failed
      logForDebugging(
        `[VSCode] Failed to send file_updated notification: ${error.message}`,
      )
    })
}

/**
 * Sets up the speicial internal VSCode MCP for bidirectional communication using notifications.
 */
export function setupVscodeSdkMcp(sdkClients: MCPServerConnection[]): void {
  const client = sdkClients.find(client => client.name === 'mossen-vscode')

  if (client && client.type === 'connected') {
    // Store the client reference for later use
    vscodeMcpClient = client

    client.client.setNotificationHandler(
      LogEventNotificationSchema(),
      async notification => {
        const { eventName, eventData } = notification.params
        logMossenEventWithLegacyWireSuffix(
          `mossen.vscode.${eventName}`,
          `vscode_${eventName}`,
          eventData as { [key: string]: boolean | number | undefined },
        )
      },
    )

    // Send necessary experiment gates to VSCode immediately.
    const gates: Record<string, boolean | string> = {
      [VSCODE_GATE_KEYS.reviewUpsell]:
        checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
          'mossen.mcp.vscodeReviewUpsellEnabled',
        ),
      [VSCODE_GATE_KEYS.onboarding]:
        checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
          'mossen.mcp.vscodeOnboardingEnabled',
        ),
      // Browser support.
      [VSCODE_GATE_KEYS.quietFern]: getFeatureValue_CACHED_MAY_BE_STALE(
        'mossen.mcp.quietFernEnabled',
        false,
      ),
      // In-band OAuth via hosted_authenticate (vs. extension-native PKCE).
      [VSCODE_GATE_KEYS.ccAuth]: getFeatureValue_CACHED_MAY_BE_STALE(
        'mossen.mcp.vscodeCcAuthEnabled',
        false,
      ),
    }
    // Tri-state: 'enabled' | 'disabled' | 'opt-in'. Omit if unknown so VSCode
    // fails closed (treats absent as 'disabled').
    const autoModeState = readAutoModeEnabledState()
    if (autoModeState !== undefined) {
      gates[VSCODE_GATE_KEYS.autoModeState] = autoModeState
    }
    void client.client.notification({
      method: 'experiment_gates',
      params: { gates },
    })
  }
}
