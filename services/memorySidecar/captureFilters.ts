// services/memorySidecar/captureFilters.ts
// W121-A item 9 (L6): shared capture filters reused by turnCapture and
// the adapter ingest path. See docs/upgrade/W121A-memory-audit-closure.md.
//
// W121-A item 5 (L2): isAssistantControlOutput Chinese short-op patterns
// tightened — `^现在`/`^运行`/`^我来`/`^好了` standalone prefixes were
// dropping real sentences such as "运行结果让我确认...". Patterns are
// now anchored to specific operational verbs / completions.

/**
 * Tightened Chinese short-operation patterns for isAssistantControlOutput.
 * Each pattern is sense-anchored to a specific operational verb or completion
 * marker so legitimate sentences sharing a common opener (现在/运行/我来/好了)
 * are not dropped. Combined with the `length < 40` precondition each match
 * is a clear control-plane utterance.
 *
 * DOES skip: "现在运行 smoke", "我来检查文件", "好了。", "全部通过",
 *            "修复完成", "运行完成"
 * DOES NOT skip: "运行结果让我确认这个方案可行", "我来这个项目是为了长期验证记忆"
 */
// Note on `\b`: JavaScript's `\b` is ASCII-only — between two CJK chars or
// between a CJK char and whitespace there is no word boundary, so anchoring
// CJK alternations with `\b` would silently match nothing. The alternation
// itself is the discriminator: `^我来检查` matches "我来检查文件" but not
// "我来这个项目..." because "这" is not in the list. We keep `\b` only on the
// trailing `i`-flagged ASCII verbs (push/commit) where it actually fires.
export const CN_SHORT_OPS_PATTERNS: RegExp[] = [
  /^全部通过/,                     // explicit completion
  /^修复完成/,                     // explicit completion
  /^好了[\s　，,。.！!？?]*$/, // bare "好了" with optional trailing punctuation only
  /^现在(开始|运行|跑|测试|去做|看看|检查|修|改)/,
  /^运行(完成|完毕|成功|失败|超时|结束|完了)/,
  /^我来(看看|安装|启动|执行|运行|跑|查|检查|修|改|加|写|提交|测试|跑测)/,
  /^我来(push|commit)\b/i,
]

/**
 * Detect control-plane messages that should not be captured as long-term memory.
 * These include slash commands, wave instruction packets, and local command
 * output. W119 H6: English equivalents added; previously CN-only filters
 * leaked all English wave instructions into archive.
 */
export function isControlPlaneMessage(text: string): boolean {
  const trimmed = text.trim()

  // Slash commands: /memory-sidecar, /memory, /model, /config, etc.
  if (trimmed.startsWith('/')) return true

  // Terminal-output wrappers (W119 H6: previously only 2 of 6 covered).
  if (
    trimmed.startsWith('<command-name>') ||
    trimmed.startsWith('<command-message>') ||
    trimmed.startsWith('<local-command-stdout>') ||
    trimmed.startsWith('<local-command-stderr>') ||
    trimmed.startsWith('<local-command-caveat>') ||
    trimmed.startsWith('<bash-input>') ||
    trimmed.startsWith('<bash-stdout>') ||
    trimmed.startsWith('<bash-stderr>')
  ) {
    return true
  }

  // System-reminder injection — never user intent.
  if (trimmed.startsWith('<system-reminder>')) return true

  // Wave instruction packets — Chinese.
  if (/^执行 W/i.test(trimmed)) return true
  if (/^启动 W/i.test(trimmed)) return true
  // W119 H6: Wave instruction packets — English. Match common imperative
  // verbs followed by a wave id (W57 / W110 / W110a etc.). Anchored to
  // start of message so casual mid-sentence "implement W116" doesn't drop
  // unrelated user text.
  if (/^(implement|run|start|launch|execute|kick off|do|finish)\s+w\d{2,3}[a-z]?\b/i.test(trimmed)) {
    return true
  }
  // English wave-final-report style packets.
  if (/^w\d{2,3}[a-z]?\s+(final report|completion report|status|round)\b/i.test(trimmed)) {
    return true
  }

  // Chinese control instruction markers (existing).
  if (
    trimmed.includes('硬红线：') ||
    trimmed.includes('硬红线:') ||
    trimmed.includes('最终报告必须包含') ||
    trimmed.includes('Commit：') ||
    trimmed.includes('Commit:') ||
    trimmed.includes('Smoke 要求') ||
    trimmed.includes('验证命令：') ||
    trimmed.includes('验证命令:')
  ) {
    return true
  }

  // W119 H6: English equivalents. Required to be at start-of-line (anchored)
  // so casual mid-sentence mentions don't trigger false positives.
  if (
    /^red lines?:/im.test(trimmed) ||
    /^smoke requirements?:/im.test(trimmed) ||
    /^validation commands?:/im.test(trimmed) ||
    /^changed files?:/im.test(trimmed) ||
    /^commit hashes?:/im.test(trimmed) ||
    /^final report must (include|contain)/im.test(trimmed) ||
    /^push\s*=\s*false\b/im.test(trimmed) ||
    /^must (include|contain|cover|verify):/im.test(trimmed)
  ) {
    return true
  }

  return false
}

/**
 * Detect assistant process output that is a response to control-plane
 * instructions and should not be long-term memory. This is conservative —
 * only skip clearly mechanical/operational responses.
 *
 * W119 H6: added English short-op patterns and case-insensitive matching.
 * W121-A item 5 (L2): Chinese short-op prefixes tightened — see
 * CN_SHORT_OPS_PATTERNS above.
 */
export function isAssistantControlOutput(text: string): boolean {
  const trimmed = text.trim()

  // Short operational responses that are clearly control-plane.
  // Only skip very short operational lines that are clearly not conversation.
  if (trimmed.length < 40) {
    if (CN_SHORT_OPS_PATTERNS.some(re => re.test(trimmed))) return true
    // W119 H6: English short-ops, case-insensitive.
    if (/^(let me|i'?ll|i will|i'?m going to|running tests|running smoke|checking|fixing|applying|committing|done\.?$|ok\.?$|sure\.?$|got it\.?$)/i.test(trimmed)) {
      return true
    }
  }

  // Commit reports — Chinese & English.
  if (/^\*\*Commit\*\*:/.test(trimmed) || /^Commit:?\s+`[0-9a-f]{7,}/i.test(trimmed)) return true
  // W119 H6: bare "commit <hash>" reports without backticks.
  if (/^commit\s+[0-9a-f]{7,}\b/i.test(trimmed)) return true
  // W119 H6: "Commit hashes:" / "Changed files:" English report headers.
  if (/^(commit hashes?|changed files?|pushed range|smoke results?)\s*:/im.test(trimmed)) return true

  // "修复完成。" followed by commit hash
  if (/^修复完成[。.]\s*\n.*Commit/i.test(trimmed)) return true

  return false
}

/**
 * W119 H5: strip <think>...</think> blocks (multi-line, case-insensitive)
 * before any text reaches the archive. Internal model reasoning is not
 * conversation and must not become long-term memory. The tag itself is
 * removed too — we keep neither the marker nor its content. Returns the
 * trimmed remainder; callers treat empty-after-strip as "skip capture".
 */
export function stripInternalReasoning(text: string): string {
  // W435b: case-insensitive early-exit guard. Pre-fix this used
  // text.includes('<think') which only matched lowercase, causing uppercase
  // <THINK>...</THINK> blocks to bypass the regex below despite its /i flag.
  if (!text || !/<think/i.test(text)) return text
  // Multi-line, non-greedy. Tolerates attributes inside the opening tag and
  // both <think>...</think> and stray <think>...EOT for resilience.
  const stripped = text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/i, '')
  return stripped.trim()
}
