import * as React from 'react';
import { Passes } from '../../components/Passes/Passes.js';
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import { getCachedRemainingPasses } from '../../services/api/referral.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  // Mark that user has visited /passes so we stop showing the upsell
  const config = getGlobalConfig();
  const isFirstVisit = !config.hasVisitedPasses;
  if (isFirstVisit) {
    const remaining = getCachedRemainingPasses();
    saveGlobalConfig(current => ({
      ...current,
      hasVisitedPasses: true,
      passesLastSeenRemaining: remaining ?? current.passesLastSeenRemaining
    }));
  }
  logMossenEvent('mossen.passes.visited', {
    is_first_visit: isFirstVisit
  });
  return <Passes onDone={onDone} />;
}
