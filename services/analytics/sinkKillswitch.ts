import { getDynamicConfig_CACHED_MAY_BE_STALE } from '../config/dynamicConfig.js'

const SINK_KILLSWITCH_CONFIG_NAME = 'mossen.analytics.sinkKillswitch'

export type SinkName = 'datadog' | 'firstParty'

/**
 * JSON config that disables individual analytics sinks.
 * Shape: { datadog?: boolean, firstParty?: boolean }
 * A value of true for a key stops all dispatch to that sink.
 * Default {} (nothing killed). Fail-open: missing/malformed config = sink stays on.
 *
 * NOTE: Must NOT be called from inside the dynamic-config resolver; a lookup
 * here from that path would recurse.
 * Call at per-event dispatch sites instead.
 */
export function isSinkKilled(sink: SinkName): boolean {
  const config = getDynamicConfig_CACHED_MAY_BE_STALE<
    Partial<Record<SinkName, boolean>>
  >(SINK_KILLSWITCH_CONFIG_NAME, {})
  // getFeatureValue_CACHED_MAY_BE_STALE guards on `!== undefined`, so a
  // cached JSON null leaks through instead of falling back to {}.
  return config?.[sink] === true
}
