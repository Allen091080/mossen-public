import { useStartupNotification } from './useStartupNotification.js'

/**
 * Mossen hard-cut builds do not probe or advertise legacy hosted subscriptions.
 * Backend credentials are configured through the Mossen provider adapter instead.
 */
export function useCanSwitchToExistingSubscription(): void {
  useStartupNotification(async () => null)
}
