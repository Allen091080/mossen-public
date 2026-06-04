// W123 — LSP init plan: two-phase write surface for project/user lspServers.
//
// Mirrors the W122-B repairPlan.ts contract:
//   1. getLspInitPlan(input)        — pure read; mints a one-shot 8-hex token (10 min TTL).
//   2. executeLspInitPlan({token})  — single-use; recomputes plan, writes only if
//      conflictsWith and preview match the snapshot. Token deleted from store
//      BEFORE any disk write so a thrown write cannot be retried with it.
//
// Hard constraints (RED LINES):
//   - Writes ONLY to one of two paths, enforced by exact-equality assertWritePathSafe:
//       project: <cwd>/.mossen/lsp.json
//       user:    <getMossenConfigHomeDir()>/lsp/servers.json
//   - LSP_TEMPLATES is the single source of truth — imported from ./status.js.
//   - DRY-RUN performs ZERO disk writes (no fs.mkdir, no fs.writeFile).
//   - Tokens are in-memory only (Map<string, Entry>); never serialised.
//   - This file deliberately duplicates the W122-B token pattern; do NOT extract
//     a shared utils/confirmToken.ts (Allen Q3 confirmation).

import { randomBytes } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'

import { getOriginalCwd } from '../../bootstrap/state.js'
import { getMossenConfigHomeDir } from '../../utils/envUtils.js'
import { LSP_TEMPLATES } from './status.js'
import type { LspServerConfig, ScopedLspServerConfig } from './types.js'

export const LSP_INIT_TOKEN_TTL_MS = 10 * 60 * 1000
const TOKEN_REGEX = /^[0-9a-f]{8}$/

export type LspInitTemplateId = 'typescript' | 'rust'
export type LspInitScope = 'project' | 'user'

export type LspInitPlan = {
  template: LspInitTemplateId
  scope: LspInitScope
  targetPath: string
  willCreate: boolean
  willMerge: boolean
  serverName: string
  conflictsWith: string[]
  preview: Record<string, LspServerConfig>
  token: string | null
  tokenExpiresAt: number | null
  blocked:
    | null
    | 'unknown-template'
    | 'unknown-scope'
    | 'parent-mkdir-failed'
    | 'existing-malformed'
    | 'path-unsafe'
  blockedDetail?: string
}

export type LspInitConfirmResult =
  | { ok: true; targetPath: string; serverName: string; bytesWritten: number }
  | {
      ok: false
      reason:
        | 'token-not-found'
        | 'token-expired'
        | 'plan-changed'
        | 'path-unsafe'
        | 'write-failed'
        | 'existing-malformed'
      detail?: string
    }

// --- Token store ------------------------------------------------------------

type StoredEntry = {
  scope: LspInitScope
  template: LspInitTemplateId
  targetPath: string
  planSnapshot: {
    conflictsWith: string[]
    preview: Record<string, LspServerConfig>
  }
  expiresAt: number
}

const lspInitTokenStore = new Map<string, StoredEntry>()

function sweepExpired(now: number): void {
  for (const [token, entry] of lspInitTokenStore.entries()) {
    if (now > entry.expiresAt) {
      lspInitTokenStore.delete(token)
    }
  }
}

export function _clearLspInitTokensForTesting(): void {
  lspInitTokenStore.clear()
}

export function _lspInitTokenCountForTesting(): number {
  return lspInitTokenStore.size
}

// --- Path safety ------------------------------------------------------------

function assertWritePathSafe(
  scope: LspInitScope,
  candidate: string,
  cwd: string,
): void {
  const norm = path.resolve(candidate)
  if (scope === 'project') {
    const allowed = path.resolve(cwd, '.mossen', 'lsp.json')
    if (norm !== allowed) {
      throw new Error(
        'path-unsafe: project scope must write to <cwd>/.mossen/lsp.json',
      )
    }
    return
  }
  if (scope === 'user') {
    const allowed = path.resolve(getMossenConfigHomeDir(), 'lsp', 'servers.json')
    if (norm !== allowed) {
      throw new Error(
        'path-unsafe: user scope must write to ~/.mossen/lsp/servers.json',
      )
    }
    return
  }
  throw new Error(`path-unsafe: unknown scope ${String(scope)}`)
}

// --- Helpers ----------------------------------------------------------------

function findTemplate(
  id: string,
): { id: LspInitTemplateId; lspServers: Record<string, ScopedLspServerConfig> } | null {
  const t = LSP_TEMPLATES.find(tt => tt.id === id)
  if (!t) return null
  return { id: t.id, lspServers: t.lspServers }
}

function computeTargetPath(scope: LspInitScope, cwd: string): string {
  if (scope === 'project') {
    return path.join(cwd, '.mossen', 'lsp.json')
  }
  return path.join(getMossenConfigHomeDir(), 'lsp', 'servers.json')
}

function structuralEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!structuralEqual(a[i], b[i])) return false
    }
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao).sort()
  const bk = Object.keys(bo).sort()
  if (ak.length !== bk.length) return false
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false
    if (!structuralEqual(ao[ak[i]!], bo[bk[i]!])) return false
  }
  return true
}

function previewEqual(
  a: Record<string, LspServerConfig>,
  b: Record<string, LspServerConfig>,
): boolean {
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  if (ak.length !== bk.length) return false
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false
    if (!structuralEqual(a[ak[i]!], b[bk[i]!])) return false
  }
  return true
}

function conflictsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false
  }
  return true
}

type ExistingResult =
  | { ok: true; existed: boolean; lspServers: Record<string, LspServerConfig> }
  | { ok: false; detail: string }

async function readExistingLspServers(targetPath: string): Promise<ExistingResult> {
  let raw: string
  try {
    raw = await fs.readFile(targetPath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { ok: true, existed: false, lspServers: {} }
    }
    return { ok: false, detail: `read-failed: ${(error as Error).message}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, detail: `json-parse-failed: ${(error as Error).message}` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, detail: 'top-level value must be a JSON object' }
  }
  const obj = parsed as Record<string, unknown>
  if (!('lspServers' in obj)) {
    // Existing file with no lspServers key — treat as empty map for merging.
    return { ok: true, existed: true, lspServers: {} }
  }
  const lspServersRaw = obj.lspServers
  if (
    lspServersRaw === null ||
    typeof lspServersRaw !== 'object' ||
    Array.isArray(lspServersRaw)
  ) {
    return { ok: false, detail: 'lspServers must be a JSON object' }
  }
  const lspServers: Record<string, LspServerConfig> = {}
  for (const [key, value] of Object.entries(lspServersRaw)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        detail: `lspServers[${JSON.stringify(key)}] must be an object`,
      }
    }
    lspServers[key] = value as LspServerConfig
  }
  return { ok: true, existed: true, lspServers }
}

function makeBlockedPlan(args: {
  template: LspInitTemplateId
  scope: LspInitScope
  targetPath: string
  blocked: NonNullable<LspInitPlan['blocked']>
  blockedDetail?: string
}): LspInitPlan {
  return {
    template: args.template,
    scope: args.scope,
    targetPath: args.targetPath,
    willCreate: false,
    willMerge: false,
    serverName: '',
    conflictsWith: [],
    preview: {},
    token: null,
    tokenExpiresAt: null,
    blocked: args.blocked,
    blockedDetail: args.blockedDetail,
  }
}

// --- Internal builder + public: getLspInitPlan -----------------------------

// W146.2 P2-4: pre-W146.2 every call to `getLspInitPlan` minted a token,
// even when the caller was `executeLspInitPlan`'s confirm-time recompute,
// which then immediately deleted the throwaway token to keep the store
// clean. That double-write polluted the store with garbage entries on
// every confirm. The internal builder below performs the same recon and
// snapshot computation but does NOT mint or store a token; the public
// `getLspInitPlan` wrapper handles minting at the only call site that
// hands the token back to the operator.
async function buildLspInitPlan(input: {
  template: LspInitTemplateId
  scope?: LspInitScope
  cwd?: string
}): Promise<{
  plan: LspInitPlan
  conflictsWith: string[]
  preview: Record<string, LspServerConfig>
}> {
  const cwd = input.cwd ?? getOriginalCwd()
  const scope: LspInitScope = input.scope ?? 'project'

  // 1. Validate template.
  const tmpl = findTemplate(input.template)
  if (!tmpl) {
    // Still populate targetPath if scope is known.
    let targetPath = ''
    if (scope === 'project' || scope === 'user') {
      targetPath = computeTargetPath(scope, cwd)
    }
    return {
      plan: makeBlockedPlan({
        template: input.template,
        scope,
        targetPath,
        blocked: 'unknown-template',
        blockedDetail: `unknown template id: ${String(input.template)}`,
      }),
      conflictsWith: [],
      preview: {},
    }
  }

  // 2. Validate scope.
  if (scope !== 'project' && scope !== 'user') {
    return {
      plan: makeBlockedPlan({
        template: tmpl.id,
        scope: scope as LspInitScope,
        targetPath: '',
        blocked: 'unknown-scope',
        blockedDetail: `unknown scope: ${String(scope)}`,
      }),
      conflictsWith: [],
      preview: {},
    }
  }

  // 3. Compute target path.
  const targetPath = computeTargetPath(scope, cwd)

  // 4. Path safety (defense-in-depth).
  try {
    assertWritePathSafe(scope, targetPath, cwd)
  } catch (error) {
    return {
      plan: makeBlockedPlan({
        template: tmpl.id,
        scope,
        targetPath,
        blocked: 'path-unsafe',
        blockedDetail: (error as Error).message,
      }),
      conflictsWith: [],
      preview: {},
    }
  }

  // 5. Existence + parse.
  const existing = await readExistingLspServers(targetPath)
  if (existing.ok !== true) {
    return {
      plan: makeBlockedPlan({
        template: tmpl.id,
        scope,
        targetPath,
        blocked: 'existing-malformed',
        blockedDetail: (existing as { ok: false; detail: string }).detail,
      }),
      conflictsWith: [],
      preview: {},
    }
  }
  const okExisting = existing as {
    ok: true
    existed: boolean
    lspServers: Record<string, LspServerConfig>
  }

  const willCreate = !okExisting.existed
  const willMerge = okExisting.existed

  // 6. Build preview = existing merged with template (template wins).
  const preview: Record<string, LspServerConfig> = {}
  for (const [k, v] of Object.entries(okExisting.lspServers)) {
    preview[k] = v
  }
  const conflictsWith: string[] = []
  for (const [k, v] of Object.entries(tmpl.lspServers)) {
    if (Object.prototype.hasOwnProperty.call(okExisting.lspServers, k)) {
      conflictsWith.push(k)
    }
    preview[k] = v
  }

  // 7. Sole server name from template.
  const templateKeys = Object.keys(tmpl.lspServers)
  const serverName = templateKeys[0] ?? tmpl.id

  return {
    plan: {
      template: tmpl.id,
      scope,
      targetPath,
      willCreate,
      willMerge,
      serverName,
      conflictsWith,
      preview,
      // Caller decides whether to mint a token. Defaults to null here;
      // getLspInitPlan replaces these fields after store insertion.
      token: null,
      tokenExpiresAt: null,
      blocked: null,
    },
    conflictsWith,
    preview,
  }
}

export async function getLspInitPlan(input: {
  template: LspInitTemplateId
  scope?: LspInitScope
  cwd?: string
}): Promise<LspInitPlan> {
  const now = Date.now()
  sweepExpired(now)

  const built = await buildLspInitPlan(input)
  if (built.plan.blocked !== null) {
    return built.plan
  }

  // Mint the one-shot token at the public entry point only.
  const token = randomBytes(4).toString('hex')
  const expiresAt = now + LSP_INIT_TOKEN_TTL_MS
  lspInitTokenStore.set(token, {
    scope: built.plan.scope,
    template: built.plan.template,
    targetPath: built.plan.targetPath,
    planSnapshot: {
      conflictsWith: [...built.conflictsWith],
      preview: JSON.parse(JSON.stringify(built.preview)) as Record<
        string,
        LspServerConfig
      >,
    },
    expiresAt,
  })

  return {
    ...built.plan,
    token,
    tokenExpiresAt: expiresAt,
  }
}

// --- Public: executeLspInitPlan --------------------------------------------

export async function executeLspInitPlan(input: {
  token: string
  cwd?: string
}): Promise<LspInitConfirmResult> {
  const now = Date.now()
  sweepExpired(now)

  // 1. Validate token format.
  if (typeof input.token !== 'string' || !TOKEN_REGEX.test(input.token)) {
    return { ok: false, reason: 'token-not-found' }
  }

  // 2. Look up entry.
  const entry = lspInitTokenStore.get(input.token)
  if (!entry) {
    return { ok: false, reason: 'token-not-found' }
  }
  if (now > entry.expiresAt) {
    lspInitTokenStore.delete(input.token)
    return { ok: false, reason: 'token-expired' }
  }

  // 3. Delete entry BEFORE any disk write — single-use guarantee.
  lspInitTokenStore.delete(input.token)

  const cwd = input.cwd ?? getOriginalCwd()

  // 4. Recompute the plan via the internal builder so the recompute
  //    does NOT mint a throwaway token (W146.2 P2-4).
  const built = await buildLspInitPlan({
    template: entry.template,
    scope: entry.scope,
    cwd,
  })
  const fresh = built.plan

  if (fresh.blocked !== null) {
    if (fresh.blocked === 'existing-malformed') {
      return {
        ok: false,
        reason: 'existing-malformed',
        detail: fresh.blockedDetail,
      }
    }
    if (fresh.blocked === 'path-unsafe') {
      return { ok: false, reason: 'path-unsafe', detail: fresh.blockedDetail }
    }
    return { ok: false, reason: 'plan-changed', detail: fresh.blockedDetail }
  }

  // 5. Compare against snapshot.
  if (
    !conflictsEqual(built.conflictsWith, entry.planSnapshot.conflictsWith) ||
    !previewEqual(built.preview, entry.planSnapshot.preview)
  ) {
    return {
      ok: false,
      reason: 'plan-changed',
      detail: 'conflictsWith or preview diverged from token snapshot',
    }
  }

  // 6. Defense-in-depth path safety.
  try {
    assertWritePathSafe(entry.scope, fresh.targetPath, cwd)
  } catch (error) {
    return { ok: false, reason: 'path-unsafe', detail: (error as Error).message }
  }

  // 7. Build content.
  const content =
    JSON.stringify({ lspServers: built.preview }, null, 2) + '\n'

  // 8. Ensure parent dir.
  try {
    await fs.mkdir(path.dirname(fresh.targetPath), { recursive: true })
  } catch (error) {
    return {
      ok: false,
      reason: 'write-failed',
      detail: `mkdir-failed: ${(error as Error).message}`,
    }
  }

  // 9. Write file atomically (W146.2 P2-3): write to a sibling temp
  //    inside the SAME directory as the target (cross-device renames
  //    fail), then rename onto targetPath. A crash mid-write leaves the
  //    pre-existing file untouched. The temp suffix uses a freshly-
  //    minted random hex to avoid colliding with concurrent inits.
  //
  //    On rare write/rename failures we leave the temp file in place
  //    rather than calling unlink/rm — the W111 capture boundary forbids
  //    new destructive ops in non-memory code. Orphaned `.lsp-init-*`
  //    temp files are harmless (small JSON, same dir as target) and an
  //    operator can clean them up manually with
  //    `find <dir> -name '.lsp-init-*.tmp' -mtime +1 -delete` if needed.
  const tempName = `.lsp-init-${randomBytes(4).toString('hex')}.tmp`
  const tempPath = path.join(path.dirname(fresh.targetPath), tempName)
  if (path.dirname(tempPath) !== path.dirname(fresh.targetPath)) {
    // belt-and-braces: temp must live in the target's parent dir
    return {
      ok: false,
      reason: 'path-unsafe',
      detail: 'temp file escaped target directory',
    }
  }
  try {
    await fs.writeFile(tempPath, content, 'utf8')
  } catch (error) {
    return {
      ok: false,
      reason: 'write-failed',
      detail: `writeFile-failed: ${(error as Error).message}`,
    }
  }
  try {
    await fs.rename(tempPath, fresh.targetPath)
  } catch (error) {
    return {
      ok: false,
      reason: 'write-failed',
      detail: `rename-failed: ${(error as Error).message}`,
    }
  }

  // 10. Return success.
  return {
    ok: true,
    targetPath: fresh.targetPath,
    serverName: fresh.serverName,
    bytesWritten: Buffer.byteLength(content, 'utf8'),
  }
}
