import {
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from './hooks/hooksConfigSnapshot.js'

export function isSessionGoalUnavailableByHooksPolicy(): boolean {
  return (
    shouldDisableAllHooksIncludingManaged() ||
    shouldAllowManagedHooksOnly()
  )
}
