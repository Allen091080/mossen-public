// Mossen-local neutral feature flag facade.
//
// Background: Mossen inherits a legacy feature flag layer from the
// compatibility layer. Business code historically imported gate helpers from
// a legacy analytics wrapper, which leaked implementation details into
// every gate-aware module.
//
// W162-E1 introduces this facade as the single import point for
// feature gate decisions in new code. The underlying implementation is
// now isolated behind the local dynamic-config compatibility module;
// this facade re-exports only the parts of that surface that are about
// gate decisions, not flag-platform lifecycle.
//
// Migration plan:
//   - W162-E2: rewrite business-code imports to use this facade.
//   - W162-E3: rename the underlying gate keys to Mossen-native names
//     with read-side aliases for back-compat.
//   - W163-B: collapse the old analytics wrapper to a deprecation shim
//     once no business code imports it directly.
//
// Why neutral names:
//   - `checkGate(...)` — the operation the caller actually performs
//   - `getFlagValue(...)` — the operation the caller actually performs
//   - The legacy `_CACHED_MAY_BE_STALE` / `_CACHED_WITH_REFRESH` /
//     `_CACHED_OR_BLOCKING` / `_DEPRECATED` suffixes preserve the
//     real call-shape semantics and are intentionally kept so
//     downstream readers don't have to learn a new staleness contract.

export {
  checkGate_CACHED_OR_BLOCKING,
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  checkSecurityRestrictionGate,
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_WITH_REFRESH,
  getFeatureValue_DEPRECATED,
  hasDynamicConfigEnvOverride as hasFeatureFlagEnvOverride,
} from '../analytics/localDynamicConfigCompat.js'
