import { getTeleportedSessionInfo } from '../bootstrap/state.js'
import { isEnvTruthy } from '../utils/envBooleans.js'
import { isPolicyAllowed } from '../services/policyLimits/index.js'
import type { RemoteRuntimeSnapshot } from './runtimeTypes.js'

export async function getRemoteRuntimeSnapshot(): Promise<RemoteRuntimeSnapshot> {
  const teleportInfo = getTeleportedSessionInfo()
  const policyAllowed = isPolicyAllowed('allow_remote_sessions')

  return {
    policyAllowed,
    bridgeAvailable: false,
    disabledReason: 'Remote Control is not available in this build',
    runningInRemoteSession: isEnvTruthy(process.env.MOSSEN_CODE_REMOTE),
    remoteEnvironmentType: process.env.MOSSEN_CODE_REMOTE_ENVIRONMENT_TYPE ?? null,
    teleportedSession: teleportInfo?.isTeleported ?? false,
    teleportedSessionId: teleportInfo?.sessionId ?? null,
    unixSocketAuthProxy: Boolean(process.env.MOSSEN_CODE_UNIX_SOCKET),
  }
}
