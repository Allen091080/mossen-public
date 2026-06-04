/**
 * Preconnect to the Mossen API adapter to overlap TCP+TLS handshake with startup.
 *
 * The TCP+TLS handshake is ~100-200ms that normally blocks inside the first
 * API call. Kicking a fire-and-forget fetch during init lets the handshake
 * happen in parallel with action-handler work (~100ms of setup/commands/mcp
 * before the API request in -p mode; unbounded "user is typing" window in
 * interactive mode).
 *
 * Bun's fetch shares a keep-alive connection pool globally, so the real API
 * request reuses the warmed connection.
 *
 * Called from init.ts AFTER applyExtraCACertsFromConfig() + configureGlobalAgents()
 * so settings.json env vars are applied and the TLS cert store is finalized.
 * The early cli.tsx call site was removed — it ran before settings.json loaded,
 * so Mossen API/proxy/mTLS settings would be invisible and preconnect
 * would warm the wrong pool (or worse, lock BoringSSL's cert store before
 * NODE_EXTRA_CA_CERTS was applied).
 *
 * Skipped when:
 * - proxy/mTLS/unix socket configured (preconnect would use wrong transport —
 *   the SDK passes a custom dispatcher/agent that doesn't share the global pool)
 * - Bedrock/Vertex/Foundry (different endpoints, different auth)
 */

import { getCustomBackendBaseUrl, isCustomBackendEnabled } from './customBackend.js'
import { isEnvTruthy } from './envUtils.js'

let fired = false

export function preconnectMossenApi(): void {
  if (fired) return
  fired = true

  // Skip if using a cloud provider — different endpoint + auth
  if (
    isEnvTruthy(process.env.MOSSEN_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.MOSSEN_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.MOSSEN_CODE_USE_FOUNDRY)
  ) {
    return
  }
  // Skip if proxy/mTLS/unix — SDK's custom dispatcher won't reuse this pool
  if (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.MOSSEN_CODE_UNIX_SOCKET ||
    process.env.MOSSEN_CODE_CLIENT_CERT ||
    process.env.MOSSEN_CODE_CLIENT_KEY
  ) {
    return
  }

  // Only preconnect when an explicit Mossen adapter/custom gateway is configured.
  // NODE_EXTRA_CA_CERTS no longer a skip — init.ts applied it before this fires.
  const baseUrl =
    (isCustomBackendEnabled()
      ? getCustomBackendBaseUrl()
      : process.env.MOSSEN_CODE_API_BASE_URL) ||
    undefined

  if (!baseUrl) {
    return
  }

  // Fire and forget. HEAD means no response body — the connection is eligible
  // for keep-alive pool reuse immediately after headers arrive. 10s timeout
  // so a slow network doesn't hang the process; abort is fine since the real
  // request will handshake fresh if needed.
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  void fetch(baseUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}
