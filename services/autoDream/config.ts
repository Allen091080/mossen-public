// Leaf config module — intentionally minimal imports so UI components
// can read the auto-dream enabled state without dragging in the forked
// agent / task registry / message builder chain that autoDream.ts pulls in.

import { getInitialSettings } from '../../utils/settings/settings.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../config/featureFlags.js'

/**
 * Whether background memory consolidation should run. User setting
 * (autoDreamEnabled in settings.json) overrides the local-config default
 * when explicitly set; otherwise falls through to mossen.autoDream.config.
 */
export function isAutoDreamEnabled(): boolean {
  const setting = getInitialSettings().autoDreamEnabled
  if (setting !== undefined) return setting
  const gb = getFeatureValue_CACHED_MAY_BE_STALE<{ enabled?: unknown } | null>(
    'mossen.autoDream.config',
    null,
  )
  return gb?.enabled === true
}
