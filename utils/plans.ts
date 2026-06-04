import { randomUUID } from 'crypto'
import { copyFile, writeFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join, resolve, sep } from 'path'
import type { AgentId, SessionId } from 'src/types/ids.js'
import type { LogOption } from 'src/types/logs.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  SystemFileSnapshotMessage,
  UserMessage,
} from 'src/types/message.js'
import { getPlanSlugCache, getSessionId } from '../bootstrap/state.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../tools/ExitPlanModeTool/constants.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { getMossenConfigHomeDir } from './envUtils.js'
import { isENOENT } from './errors.js'
import { getEnvironmentKind } from './filePersistence/outputsScanner.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import { getInitialSettings } from './settings/settings.js'
import { generateWordSlug } from './words.js'
import { validateWorktreeSlug } from './worktree.js'

const MAX_SLUG_RETRIES = 10

// W52 Named Plan Files v0 — prompt-derived ASCII-safe slug.
// Caps below are intentionally smaller than MAX_WORKTREE_SLUG_LENGTH (64) to
// leave room for `-2`/`-3` suffix on collision and the `-agent-{agentId}`
// suffix used by getPlanFilePath for subagents.
const PROMPT_SLUG_MAX_LENGTH = 48
const PROMPT_SLUG_MIN_LENGTH = 2
const PROMPT_SLUG_INPUT_SAMPLE = 120
const PROMPT_SLUG_ASCII_RATIO_FLOOR = 0.5

// ANSI escape sequences. Two forms: CSI (ESC `[ … final-byte`) and OSC
// (ESC `] … BEL|ST`). Stripping both before any text normalization so a
// pasted shell prompt with colors doesn't leak control bytes into the slug.
const ANSI_CSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
// eslint-disable-next-line no-control-regex
const ANSI_OSC_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/**
 * Derive an ASCII-safe slug from a user prompt for use as a plan file name.
 *
 * Returns null when the prompt cannot produce a safe slug — caller MUST
 * fall back to {@link generateWordSlug}. Cases that return null:
 *   - empty / whitespace-only input
 *   - mostly non-ASCII content (CJK, emoji-only, etc) — bias check
 *   - result shorter than {@link PROMPT_SLUG_MIN_LENGTH}
 *   - result fails {@link validateWorktreeSlug}
 *
 * Character set is strictly limited to `[a-z0-9-]`. CJK / non-ASCII
 * characters are NOT transliterated; they collapse to the separator. v0
 * design (W52 §2.5 C') keeps slug worktree/branch/file safe at the cost
 * of CJK semantic naming, which a future v2 can add via a separate
 * display-title field decoupled from the slug.
 *
 * Pure: no IO, no network, no session/global state.
 */
export function generatePromptPlanSlug(prompt: string): string | null {
  if (typeof prompt !== 'string') return null

  const trimmed = prompt.trim()
  if (trimmed.length === 0) return null

  // 1. Sample first PROMPT_SLUG_INPUT_SAMPLE chars (after trim) so that
  //    a giant prompt doesn't blow past validateWorktreeSlug's 64-char cap.
  const sample = trimmed.slice(0, PROMPT_SLUG_INPUT_SAMPLE)

  // 2. Strip ANSI escape sequences first — they contain `[`, digits, and
  //    `;` which would otherwise pollute the slug.
  const ansiStripped = sample
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_OSC_PATTERN, '')

  // 3. Lowercase. Only ASCII letters fold; non-ASCII passes through and is
  //    later collapsed to the separator in step 4.
  const lowered = ansiStripped.toLowerCase()

  // 4. Bias check before normalization: count ASCII alnum in the body and
  //    compare against total non-whitespace chars. If non-ASCII dominates
  //    (CJK paragraph, emoji-only, etc.), return null so caller falls back
  //    to word-slug. This also catches markdown-only / punctuation-only
  //    inputs that would otherwise produce empty slug.
  const asciiAlnumCount = (lowered.match(/[a-z0-9]/g) ?? []).length
  const nonWhitespaceCount = lowered.replace(/\s+/g, '').length
  if (
    nonWhitespaceCount === 0 ||
    asciiAlnumCount / nonWhitespaceCount < PROMPT_SLUG_ASCII_RATIO_FLOOR
  ) {
    return null
  }

  // 5. Collapse anything not in [a-z0-9] to a single dash. This covers
  //    markdown decorations (# * _ ` ~ > | etc), path-dangerous chars
  //    (/ \ : ? * < > | "), CJK, emoji, and all whitespace/punctuation
  //    in one pass.
  const collapsed = lowered.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (collapsed.length === 0) return null

  // 6. Truncate to PROMPT_SLUG_MAX_LENGTH and re-strip trailing dashes
  //    introduced by truncation mid-word.
  const truncated = collapsed
    .slice(0, PROMPT_SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
  if (truncated.length < PROMPT_SLUG_MIN_LENGTH) return null

  // 7. Final safety check via worktree slug validator (single source of
  //    truth for worktree/branch/file three-way safety). Rejects anything
  //    that slipped through above.
  try {
    validateWorktreeSlug(truncated)
  } catch {
    return null
  }

  return truncated
}

/**
 * Find a unique slug by trying `base`, then `base-2`, `base-3`, ... up to
 * MAX_SLUG_RETRIES. Returns null if all candidates collide.
 *
 * Caller provides the existence predicate so this function stays pure and
 * testable independent of filesystem state.
 */
function findUniqueSlugWithSuffix(
  base: string,
  exists: (slug: string) => boolean,
): string | null {
  if (!exists(base)) return base
  for (let i = 2; i <= MAX_SLUG_RETRIES; i++) {
    const candidate = `${base}-${i}`
    if (!exists(candidate)) return candidate
  }
  return null
}

/**
 * Get or generate a slug for the current session's plan.
 *
 * The slug is generated lazily on first access and cached for the session.
 *
 * When `options.firstUserPrompt` is supplied AND the prompt yields a safe
 * ASCII slug via {@link generatePromptPlanSlug}, that slug is preferred (with
 * `-2`/`-3` numeric suffix on collision). Otherwise — including the default
 * call shape `getPlanSlug()` / `getPlanSlug(sessionId)` — falls back to the
 * pre-existing word-slug behavior. Collisions in either path retry up to
 * {@link MAX_SLUG_RETRIES} candidates.
 *
 * Backward-compatibility:
 *   - All existing callers (`getPlanSlug()` / `getPlanSlug(id)`) hit the
 *     word-slug branch with byte-for-byte original behavior.
 *   - `setPlanSlug` / `clearPlanSlug` / `copyPlanForResume` /
 *     `copyPlanForFork` are unchanged and never invoke
 *     {@link generatePromptPlanSlug} — resumed/forked sessions reuse the
 *     slug carried by the source log.
 */
export function getPlanSlug(
  sessionId?: SessionId,
  options?: { firstUserPrompt?: string },
): string {
  const id = sessionId ?? getSessionId()
  const cache = getPlanSlugCache()
  let slug = cache.get(id)
  if (!slug) {
    const plansDir = getPlansDirectory()
    const fs = getFsImplementation()
    const exists = (candidate: string): boolean =>
      fs.existsSync(join(plansDir, `${candidate}.md`))

    // Prefer prompt-derived slug when caller passes a usable prompt. Returning
    // null from generatePromptPlanSlug (empty / mostly non-ASCII / fails
    // worktree validator) silently falls through to the word-slug branch
    // below — never throws, never blocks plan creation.
    const promptSeed = options?.firstUserPrompt
    if (typeof promptSeed === 'string' && promptSeed.length > 0) {
      const promptSlug = generatePromptPlanSlug(promptSeed)
      if (promptSlug) {
        const unique = findUniqueSlugWithSuffix(promptSlug, exists)
        if (unique) {
          slug = unique
        }
      }
    }

    // Fallback (also the path for every existing caller): random word slug
    // with collision retry. Behavior identical to the pre-W52 implementation.
    if (!slug) {
      for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
        slug = generateWordSlug()
        const filePath = join(plansDir, `${slug}.md`)
        if (!fs.existsSync(filePath)) {
          break
        }
      }
    }
    cache.set(id, slug!)
  }
  return slug!
}

/**
 * Set a specific plan slug for a session (used when resuming a session)
 */
export function setPlanSlug(sessionId: SessionId, slug: string): void {
  getPlanSlugCache().set(sessionId, slug)
}

/**
 * Clear the plan slug for the current session.
 * This should be called on /clear to ensure a fresh plan file is used.
 */
export function clearPlanSlug(sessionId?: SessionId): void {
  const id = sessionId ?? getSessionId()
  getPlanSlugCache().delete(id)
}

/**
 * Clear ALL plan slug entries (all sessions).
 * Use this on /clear to free sub-session slug entries.
 */
export function clearAllPlanSlugs(): void {
  getPlanSlugCache().clear()
}

// Memoized: called from render bodies (FileReadTool/FileEditTool/FileWriteTool UI.tsx)
// and permission checks. Inputs (initial settings + cwd) are fixed at startup, so the
// mkdirSync result is stable for the session. Without memoization, each rendered tool
// message triggers a mkdirSync syscall (regressed in #20005).
export const getPlansDirectory = memoize(function getPlansDirectory(): string {
  const settings = getInitialSettings()
  const settingsDir = settings.plansDirectory
  let plansPath: string

  if (settingsDir) {
    // Settings.json (relative to project root)
    const cwd = getCwd()
    const resolved = resolve(cwd, settingsDir)

    // Validate path stays within project root to prevent path traversal
    if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
      logError(
        new Error(`plansDirectory must be within project root: ${settingsDir}`),
      )
      plansPath = join(getMossenConfigHomeDir(), 'plans')
    } else {
      plansPath = resolved
    }
  } else {
    // Default
    plansPath = join(getMossenConfigHomeDir(), 'plans')
  }

  // Ensure directory exists (mkdirSync with recursive: true is a no-op if it exists)
  try {
    getFsImplementation().mkdirSync(plansPath)
  } catch (error) {
    logError(error)
  }

  return plansPath
})

/**
 * Get the file path for a session's plan
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 * For main conversation (no agentId), returns {planSlug}.md
 * For subagents (agentId provided), returns {planSlug}-agent-{agentId}.md
 */
export function getPlanFilePath(agentId?: AgentId): string {
  const planSlug = getPlanSlug(getSessionId())

  // Main conversation: simple filename with word slug
  if (!agentId) {
    return join(getPlansDirectory(), `${planSlug}.md`)
  }

  // Subagents: include agent ID
  return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`)
}

/**
 * Get the plan content for a session
 * @param agentId Optional agent ID for subagents. If not provided, returns main session plan.
 */
export function getPlan(agentId?: AgentId): string | null {
  const filePath = getPlanFilePath(agentId)
  try {
    return getFsImplementation().readFileSync(filePath, { encoding: 'utf-8' })
  } catch (error) {
    if (isENOENT(error)) return null
    logError(error)
    return null
  }
}

/**
 * Extract the plan slug from a log's message history.
 */
function getSlugFromLog(log: LogOption): string | undefined {
  return log.messages.find(m => m.slug)?.slug
}

/**
 * Restore plan slug from a resumed session.
 * Sets the slug in the session cache so getPlanSlug returns it.
 * If the plan file is missing, attempts to recover it from a file snapshot
 * (written incrementally during the session) or from message history.
 * Returns true if a plan file exists (or was recovered) for the slug.
 * @param log The log to restore from
 * @param targetSessionId The session ID to associate the plan slug with.
 *                        This should be the ORIGINAL session ID being resumed,
 *                        not the temporary session ID from before resume.
 */
export async function copyPlanForResume(
  log: LogOption,
  targetSessionId?: SessionId,
): Promise<boolean> {
  const slug = getSlugFromLog(log)
  if (!slug) {
    return false
  }

  // Set the slug for the target session ID (or current if not provided)
  const sessionId = targetSessionId ?? getSessionId()
  setPlanSlug(sessionId, slug)

  // Attempt to read the plan file directly — recovery triggers on ENOENT.
  const planPath = join(getPlansDirectory(), `${slug}.md`)
  try {
    await getFsImplementation().readFile(planPath, { encoding: 'utf-8' })
    return true
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      // Don't throw — called fire-and-forget (void copyPlanForResume(...)) with no .catch()
      logError(e)
      return false
    }
    // Only attempt recovery in remote sessions (CCR) where files don't persist
    if (getEnvironmentKind() === null) {
      return false
    }

    logForDebugging(
      `Plan file missing during resume: ${planPath}. Attempting recovery.`,
    )

    // Try file snapshot first (written incrementally during session)
    const snapshotPlan = findFileSnapshotEntry(log.messages, 'plan')
    let recovered: string | null = null
    if (snapshotPlan && snapshotPlan.content.length > 0) {
      recovered = snapshotPlan.content
      logForDebugging(
        `Plan recovered from file snapshot, ${recovered.length} chars`,
        { level: 'info' },
      )
    } else {
      // Fall back to searching message history
      recovered = recoverPlanFromMessages(log)
      if (recovered) {
        logForDebugging(
          `Plan recovered from message history, ${recovered.length} chars`,
          { level: 'info' },
        )
      }
    }

    if (recovered) {
      try {
        await writeFile(planPath, recovered, { encoding: 'utf-8' })
        return true
      } catch (writeError) {
        logError(writeError)
        return false
      }
    }
    logForDebugging(
      'Plan file recovery failed: no file snapshot or plan content found in message history',
    )
    return false
  }
}

/**
 * Copy a plan file for a forked session. Unlike copyPlanForResume (which reuses
 * the original slug), this generates a NEW slug for the forked session and
 * writes the original plan content to the new file. This prevents the original
 * and forked sessions from clobbering each other's plan files.
 */
export async function copyPlanForFork(
  log: LogOption,
  targetSessionId: SessionId,
): Promise<boolean> {
  const originalSlug = getSlugFromLog(log)
  if (!originalSlug) {
    return false
  }

  const plansDir = getPlansDirectory()
  const originalPlanPath = join(plansDir, `${originalSlug}.md`)

  // Generate a new slug for the forked session (do NOT reuse the original)
  const newSlug = getPlanSlug(targetSessionId)
  const newPlanPath = join(plansDir, `${newSlug}.md`)
  try {
    await copyFile(originalPlanPath, newPlanPath)
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    logError(error)
    return false
  }
}

/**
 * Recover plan content from the message history. Plan content can appear in
 * three forms depending on what happened during the session:
 *
 * 1. ExitPlanMode tool_use input — normalizeToolInput injects the plan content
 *    into the tool_use input, which persists in the transcript.
 *
 * 2. planContent field on user messages — set during the "clear context and
 *    implement" flow when ExitPlanMode is approved.
 *
 * 3. plan_file_reference attachment — created by auto-compact to preserve the
 *    plan across compaction boundaries.
 */
function recoverPlanFromMessages(log: LogOption): string | null {
  for (let i = log.messages.length - 1; i >= 0; i--) {
    const msg = log.messages[i]
    if (!msg) {
      continue
    }

    if (msg.type === 'assistant') {
      const { content } = (msg as AssistantMessage).message
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === 'tool_use' &&
            block.name === EXIT_PLAN_MODE_V2_TOOL_NAME
          ) {
            const input = block.input as Record<string, unknown> | undefined
            const plan = input?.plan
            if (typeof plan === 'string' && plan.length > 0) {
              return plan
            }
          }
        }
      }
    }

    if (msg.type === 'user') {
      const userMsg = msg as UserMessage
      if (
        typeof userMsg.planContent === 'string' &&
        userMsg.planContent.length > 0
      ) {
        return userMsg.planContent
      }
    }

    if (msg.type === 'attachment') {
      const attachmentMsg = msg as AttachmentMessage
      if (attachmentMsg.attachment?.type === 'plan_file_reference') {
        const plan = (attachmentMsg.attachment as { planContent?: string })
          .planContent
        if (typeof plan === 'string' && plan.length > 0) {
          return plan
        }
      }
    }
  }
  return null
}

/**
 * Find a file entry in the most recent file-snapshot system message in the transcript.
 * Scans backwards to find the latest snapshot.
 */
function findFileSnapshotEntry(
  messages: LogOption['messages'],
  key: string,
): { key: string; path: string; content: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (
      msg?.type === 'system' &&
      'subtype' in msg &&
      msg.subtype === 'file_snapshot' &&
      'snapshotFiles' in msg
    ) {
      const files = msg.snapshotFiles as Array<{
        key: string
        path: string
        content: string
      }>
      return files.find(f => f.key === key)
    }
  }
  return undefined
}

/**
 * Persist a snapshot of session files (plan, todos) to the transcript.
 * Called incrementally whenever these files change. Only active in remote
 * sessions (CCR) where local files don't persist between sessions.
 */
export async function persistFileSnapshotIfRemote(): Promise<void> {
  if (getEnvironmentKind() === null) {
    return
  }
  try {
    const snapshotFiles: SystemFileSnapshotMessage['snapshotFiles'] = []

    // Snapshot plan file
    const plan = getPlan()
    if (plan) {
      snapshotFiles.push({
        key: 'plan',
        path: getPlanFilePath(),
        content: plan,
      })
    }

    if (snapshotFiles.length === 0) {
      return
    }

    const message: SystemFileSnapshotMessage = {
      type: 'system',
      subtype: 'file_snapshot',
      content: 'File snapshot',
      level: 'info',
      isMeta: true,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      snapshotFiles,
    }

    const { recordTranscript } = await import('./sessionStorage.js')
    await recordTranscript([message])
  } catch (error) {
    logError(error)
  }
}
