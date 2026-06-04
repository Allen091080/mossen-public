// Mossen-local neutral dynamic-config facade.
//
// Background: Mossen inherits a legacy dynamic-config layer from the
// compatibility layer. Business code historically imported the config helpers
// and lifecycle hooks directly from an analytics wrapper, which leaked
// implementation details into every config-aware module.
//
// W162-E1 introduces this facade as the single import point for
// dynamic config / lifecycle wiring in new code. Gate-decision APIs
// live in `services/config/featureFlags.ts`. The underlying impl is
// isolated behind a local compatibility module.
//
// See `services/config/featureFlags.ts` for the W162-E migration plan
// and the rationale behind the neutral surface.

export {
  // Dynamic config readers (the values the flag platform serves
  // beyond simple booleans).
  getDynamicConfig_CACHED_MAY_BE_STALE,
  getDynamicConfig_BLOCKS_ON_INIT,
  // Lifecycle (init / refresh / reset). Keep the legacy names exposed
  // through this neutral facade so business code does not reference the
  // retired implementation name.
  initializeDynamicConfigRuntime,
  resetDynamicConfigRuntime,
  refreshDynamicConfigFeatures,
  refreshDynamicConfigAfterAuthChange,
  setupPeriodicDynamicConfigRefresh,
  stopPeriodicDynamicConfigRefresh,
  onDynamicConfigRefresh,
  // Override / inspection (used by tests, doctor, and the smoke
  // fixtures).
  getAllDynamicConfigValues,
  getDynamicConfigOverrides,
  setDynamicConfigOverride,
  clearDynamicConfigOverrides,
  getApiBaseUrlHost,
  // Gate decisions — also re-exported here so a single facade import
  // can satisfy any business-code call site during the W162-E2 bulk
  // migration. New code targeting only gate decisions should still
  // prefer `services/config/featureFlags.ts` for clearer intent.
  checkGate_CACHED_OR_BLOCKING,
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  checkSecurityRestrictionGate,
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_WITH_REFRESH,
  getFeatureValue_DEPRECATED,
  hasDynamicConfigEnvOverride,
} from '../analytics/localDynamicConfigCompat.js'

export type { DynamicConfigUserAttributes } from '../analytics/localDynamicConfigCompat.js'
