import axios from 'axios'
import { createHash } from 'crypto'
import memoize from 'lodash-es/memoize.js'
import { getOrCreateUserID } from '../../utils/config.js'
import { isInternalOperatorMode } from '../../utils/internalUserMode.js'
import { logError } from '../../utils/log.js'
import { getCanonicalName } from '../../utils/model/model.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { MODEL_COSTS } from '../../utils/modelCost.js'
import { isAnalyticsDisabled } from './config.js'
import { getEventMetadata } from './metadata.js'

const DATADOG_LOGS_ENDPOINT =
  'https://http-intake.logs.us5.datadoghq.com/api/v2/logs'
const DATADOG_CLIENT_TOKEN = 'pubbbf48e6d78dae54bceaa4acf463299bf'
const DEFAULT_FLUSH_INTERVAL_MS = 15000
const MAX_BATCH_SIZE = 100
const NETWORK_TIMEOUT_MS = 5000
const LEGACY_DATADOG_EVENT_PREFIX = 'ten' + 'gu_'
const legacyDatadogEvent = (suffix: string): string =>
  LEGACY_DATADOG_EVENT_PREFIX + suffix

const DATADOG_ALLOWED_EVENTS = new Set([
  'chrome_bridge_connection_succeeded',
  'chrome_bridge_connection_failed',
  'chrome_bridge_disconnected',
  'chrome_bridge_tool_call_completed',
  'chrome_bridge_tool_call_error',
  'chrome_bridge_tool_call_started',
  'chrome_bridge_tool_call_timeout',
  legacyDatadogEvent('api_error'),
  legacyDatadogEvent('api_success'),
  legacyDatadogEvent('brief_mode_enabled'),
  legacyDatadogEvent('brief_mode_toggled'),
  legacyDatadogEvent('brief_send'),
  legacyDatadogEvent('cancel'),
  legacyDatadogEvent('compact_failed'),
  legacyDatadogEvent('exit'),
  legacyDatadogEvent('flicker'),
  legacyDatadogEvent('init'),
  legacyDatadogEvent('model_fallback_triggered'),
  legacyDatadogEvent('oauth_error'),
  legacyDatadogEvent('oauth_success'),
  legacyDatadogEvent('oauth_token_refresh_failure'),
  legacyDatadogEvent('oauth_token_refresh_success'),
  legacyDatadogEvent('oauth_token_refresh_lock_acquiring'),
  legacyDatadogEvent('oauth_token_refresh_lock_acquired'),
  legacyDatadogEvent('oauth_token_refresh_starting'),
  legacyDatadogEvent('oauth_token_refresh_completed'),
  legacyDatadogEvent('oauth_token_refresh_lock_releasing'),
  legacyDatadogEvent('oauth_token_refresh_lock_released'),
  legacyDatadogEvent('query_error'),
  legacyDatadogEvent('session_file_read'),
  legacyDatadogEvent('started'),
  legacyDatadogEvent('tool_use_error'),
  legacyDatadogEvent('tool_use_granted_in_prompt_permanent'),
  legacyDatadogEvent('tool_use_granted_in_prompt_temporary'),
  legacyDatadogEvent('tool_use_rejected_in_prompt'),
  legacyDatadogEvent('tool_use_success'),
  legacyDatadogEvent('uncaught_exception'),
  legacyDatadogEvent('unhandled_rejection'),
  legacyDatadogEvent('voice_recording_started'),
  legacyDatadogEvent('voice_toggled'),
  legacyDatadogEvent('team_mem_sync_pull'),
  legacyDatadogEvent('team_mem_sync_push'),
  legacyDatadogEvent('team_mem_sync_started'),
  legacyDatadogEvent('team_mem_entries_capped'),
])

const TAG_FIELDS = [
  'arch',
  'clientType',
  'errorType',
  'http_status_range',
  'http_status',
  'kairosActive',
  'model',
  'platform',
  'provider',
  'skillMode',
  'subscriptionType',
  'toolName',
  'userBucket',
  'userType',
  'version',
  'versionBase',
]

function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

type DatadogLog = {
  ddsource: string
  ddtags: string
  message: string
  service: string
  hostname: string
  [key: string]: unknown
}

let logBatch: DatadogLog[] = []
let flushTimer: NodeJS.Timeout | null = null
let datadogInitialized: boolean | null = null

async function flushLogs(): Promise<void> {
  if (logBatch.length === 0) return

  const logsToSend = logBatch
  logBatch = []

  try {
    await axios.post(DATADOG_LOGS_ENDPOINT, logsToSend, {
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': DATADOG_CLIENT_TOKEN,
      },
      timeout: NETWORK_TIMEOUT_MS,
    })
  } catch (error) {
    logError(error)
  }
}

function scheduleFlush(): void {
  if (flushTimer) return

  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushLogs()
  }, getFlushIntervalMs()).unref()
}

export const initializeDatadog = memoize(async (): Promise<boolean> => {
  if (isAnalyticsDisabled()) {
    datadogInitialized = false
    return false
  }

  try {
    datadogInitialized = true
    return true
  } catch (error) {
    logError(error)
    datadogInitialized = false
    return false
  }
})

/**
 * Flush remaining Datadog logs and shut down.
 * Called from gracefulShutdown() before process.exit() since
 * forceExit() prevents the beforeExit handler from firing.
 */
export async function shutdownDatadog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flushLogs()
}

// NOTE: use via src/services/analytics/index.ts > logEvent
export async function trackDatadogEvent(
  eventName: string,
  properties: { [key: string]: boolean | number | undefined },
): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    return
  }

  // Don't send events for 3P providers (Bedrock, Vertex, Foundry)
  if (getAPIProvider() !== 'firstParty') {
    return
  }

  // Fast path: use cached result if available to avoid await overhead
  let initialized = datadogInitialized
  if (initialized === null) {
    initialized = await initializeDatadog()
  }
  if (!initialized || !DATADOG_ALLOWED_EVENTS.has(eventName)) {
    return
  }

  try {
    const metadata = await getEventMetadata({
      model: properties.model,
      betas: properties.betas,
    })
    // Destructure to avoid duplicate envContext (once nested, once flattened)
    const { envContext, ...restMetadata } = metadata
    const allData: Record<string, unknown> = {
      ...restMetadata,
      ...envContext,
      ...properties,
      userBucket: getUserBucket(),
    }

    // Normalize MCP tool names to "mcp" for cardinality reduction
    if (
      typeof allData.toolName === 'string' &&
      allData.toolName.startsWith('mcp__')
    ) {
      allData.toolName = 'mcp'
    }

    // Normalize model names for cardinality reduction (external users only)
    if (!isInternalOperatorMode() && typeof allData.model === 'string') {
      const shortName = getCanonicalName(allData.model.replace(/\[1m]$/i, ''))
      allData.model = shortName in MODEL_COSTS ? shortName : 'other'
    }

    // Truncate dev version to base + date (remove timestamp and sha for cardinality reduction)
    // e.g. "2.0.53-dev.20251124.t173302.sha526cc6a" -> "2.0.53-dev.20251124"
    if (typeof allData.version === 'string') {
      allData.version = allData.version.replace(
        /^(\d+\.\d+\.\d+-dev\.\d{8})\.t\d+\.sha[a-f0-9]+$/,
        '$1',
      )
    }

    // Transform status to http_status and http_status_range to avoid Datadog reserved field
    if (allData.status !== undefined && allData.status !== null) {
      const statusCode = String(allData.status)
      allData.http_status = statusCode

      // Determine status range (1xx, 2xx, 3xx, 4xx, 5xx)
      const firstDigit = statusCode.charAt(0)
      if (firstDigit >= '1' && firstDigit <= '5') {
        allData.http_status_range = `${firstDigit}xx`
      }

      // Remove original status field to avoid conflict with Datadog's reserved field
      delete allData.status
    }

    // Build ddtags with high-cardinality fields for filtering.
    // event:<name> is prepended so the event name is searchable via the
    // log search API — the `message` field (where eventName also lives)
    // is a DD reserved field and is NOT queryable from dashboard widget
    // queries or the aggregation API. See scripts/release/MONITORING.md.
    const allDataRecord = allData
    const tags = [
      `event:${eventName}`,
      ...TAG_FIELDS.filter(
        field =>
          allDataRecord[field] !== undefined && allDataRecord[field] !== null,
      ).map(field => `${camelToSnakeCase(field)}:${allDataRecord[field]}`),
    ]

    const log: DatadogLog = {
      ddsource: 'nodejs',
      ddtags: tags.join(','),
      message: eventName,
      service: 'mossen-code',
      hostname: 'mossen-code',
      env: process.env.USER_TYPE,
    }

    // Add all fields as searchable attributes (not duplicated in tags)
    for (const [key, value] of Object.entries(allData)) {
      if (value !== undefined && value !== null) {
        log[camelToSnakeCase(key)] = value
      }
    }

    logBatch.push(log)

    // Flush immediately if batch is full, otherwise schedule
    if (logBatch.length >= MAX_BATCH_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      void flushLogs()
    } else {
      scheduleFlush()
    }
  } catch (error) {
    logError(error)
  }
}

const NUM_USER_BUCKETS = 30

/**
 * Gets a 'bucket' that the user ID falls into.
 *
 * For alerting purposes, we want to alert on the number of users impacted
 * by an issue, rather than the number of events- often a small number of users
 * can generate a large number of events (e.g. due to retries). To approximate
 * this without ruining cardinality by counting user IDs directly, we hash the user ID
 * and assign it to one of a fixed number of buckets.
 *
 * This allows us to estimate the number of unique users by counting unique buckets,
 * while preserving user privacy and reducing cardinality.
 */
const getUserBucket = memoize((): number => {
  const userId = getOrCreateUserID()
  const hash = createHash('sha256').update(userId).digest('hex')
  return parseInt(hash.slice(0, 8), 16) % NUM_USER_BUCKETS
})

function getFlushIntervalMs(): number {
  // Allow tests to override to not block on the default flush interval.
  return (
    parseInt(process.env.MOSSEN_CODE_DATADOG_FLUSH_INTERVAL_MS || '', 10) ||
    DEFAULT_FLUSH_INTERVAL_MS
  )
}
