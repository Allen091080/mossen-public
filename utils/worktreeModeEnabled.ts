/**
 * Worktree mode is now unconditionally enabled for all users.
 *
 * Previously gated by a remote-config flag, but the
 * CACHED_MAY_BE_STALE pattern returns the default (false) on first launch
 * before the cache is populated, silently swallowing --worktree.
 * See linked issue for the worktree flag gating bug.
 */
export function isWorktreeModeEnabled(): boolean {
  return true
}
