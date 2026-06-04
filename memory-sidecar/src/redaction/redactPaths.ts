/**
 * W148-A: shared error-message redactor for memory-sidecar surfaces.
 *
 * Pre-W148 healthReport.redactHealthError and dataIntegrityReport.redact
 * were two separate implementations that drifted (healthReport missed
 * /opt/<name>/, Windows C:\Users\, and used `~` vs `<path>` inconsistently
 * for HOME). Both surfaces could leak Linux/opt + Windows paths to the
 * doctor output. This helper unifies the path scrubbing so any redactor
 * that surfaces error messages to the operator routes through a single
 * implementation.
 *
 * Scope: this is path + token scrubbing for fs/sqlite-style error
 * messages. It is NOT a replacement for redactMemoryText (rules-based
 * secret/token redaction across rich content) used for archive/observation
 * payloads — use that helper for arbitrary user content.
 */

const TOKEN_LIKE_PATTERN =
  /(sk-[A-Za-z0-9_-]{8,})|(eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)|(AKIA[A-Z0-9]{12,})|(\b[a-f0-9]{32,}\b)|(\bBearer\s+[A-Za-z0-9._-]{8,})/g

/**
 * Strip absolute-path-style substrings from an error message.
 *
 *   - Active $HOME paths   → `<path>` (same uniform redaction as below;
 *                            W148/P1-5 — no longer collapsed to `~`)
 *   - /Users/<user>/...  → `<path>`
 *   - /home/<user>/...   → `<path>`
 *   - Windows drive paths C:\... → `<path>`
 *   - /opt/<name>/...    → `<path>` (homebrew + many CI runners)
 *   - /private/var/...   → `<path>` (macOS sandbox tmp)
 *   - /var/folders/...   → `<path>` (macOS user tmp)
 *   - /tmp/...           → `<path>`
 */
export function redactErrorPaths(raw: string): string {
  // W148/P1-5: redact ALL filesystem paths uniformly to <path>. Previously
  // the current $HOME was collapsed to '~' first, leaving home-relative
  // paths (e.g. ~/.mossen/foo.json) only username-scrubbed — bypassing the
  // <path> full-redaction every other path family gets. Uniform <path> is
  // the security-correct behavior for operator-facing error messages.
  return raw
    .replace(/\/Users\/[^/\s'"]+(?:\/[^\s'"]*)?/g, '<path>')
    .replace(/\/home\/[^/\s'"]+(?:\/[^\s'"]*)?/g, '<path>')
    .replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>')
    .replace(/\/opt\/[^\s'"]+/g, '<path>')
    .replace(/\/private\/var\/[^\s'"]+/g, '<path>')
    .replace(/\/var\/folders\/[^\s'"]+/g, '<path>')
    .replace(/\/tmp\/[^\s'"]+/g, '<path>')
}

/**
 * Path-scrub + token-shape scrub. Use this for error messages that
 * surface to the operator (status / doctor / repair / governance).
 * Token redaction is defense-in-depth: most fs/sqlite errors do not
 * carry secrets, but a future provider/library could embed one.
 */
export function redactErrorMessage(raw: string): string {
  return redactErrorPaths(raw).replace(TOKEN_LIKE_PATTERN, '[REDACTED]')
}
