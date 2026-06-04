/**
 * Shared analytics configuration
 *
 * Common logic for determining when analytics should be disabled
 * across all analytics systems (Datadog, 1P)
 */

import { isCustomBackendEnabled } from '../../utils/customBackend.js'
import { isEnvTruthy } from '../../utils/envBooleans.js'
import { isTelemetryDisabled } from '../../utils/privacyLevel.js'

// W438: single env switch that re-enables all feedback survey UI surfaces
// + the transcript-share network call. Default OFF — mossen is a single-
// user fork with no telemetry backend, surveys serve no purpose. Operators
// who plumb their own telemetry pipe set this to '1' to opt in.
export const FEEDBACK_SURVEY_OPT_IN_ENV = 'MOSSEN_ENABLE_FEEDBACK_SURVEYS'

/**
 * Check if analytics operations should be disabled
 *
 * Analytics is disabled in the following cases:
 * - Test environment (NODE_ENV === 'test')
 * - Third-party cloud providers (Bedrock/Vertex)
 * - Privacy level is no-telemetry or essential-traffic
 */
export function isAnalyticsDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    isCustomBackendEnabled() ||
    isEnvTruthy(process.env.MOSSEN_CODE_USE_BEDROCK) ||
    isEnvTruthy(process.env.MOSSEN_CODE_USE_VERTEX) ||
    isEnvTruthy(process.env.MOSSEN_CODE_USE_FOUNDRY) ||
    isTelemetryDisabled()
  )
}

/**
 * Check if the feedback survey should be suppressed.
 *
 * W438: mossen is single-user / no-telemetry by default. Surveys are
 * opt-in via `MOSSEN_ENABLE_FEEDBACK_SURVEYS=1`. The opt-in path also
 * still honors the historical `MOSSEN_CODE_DISABLE_FEEDBACK_SURVEY=1`
 * override (an explicit "off" wins over the opt-in switch).
 */
export function isFeedbackSurveyDisabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true
  if (isTelemetryDisabled()) return true
  if (isEnvTruthy(process.env.MOSSEN_CODE_DISABLE_FEEDBACK_SURVEY)) return true
  if (!isEnvTruthy(process.env[FEEDBACK_SURVEY_OPT_IN_ENV])) return true
  return false
}
