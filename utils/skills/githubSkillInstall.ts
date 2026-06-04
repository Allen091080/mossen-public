import { Buffer } from 'buffer'
import { mkdir, rename, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, normalize, relative, sep } from 'path'
import { randomBytes } from 'crypto'
import { clearCommandsCache } from '../../commands.js'
import { parseFrontmatter } from '../frontmatterParser.js'
import { getMossenConfigHomeDir } from '../envUtils.js'
import {
  parseSkillFrontmatterFields,
} from '../../skills/loadSkillsDir.js'
import { skillChangeDetector } from './skillChangeDetector.js'

export const GITHUB_SKILL_INSTALL_TOKEN_TTL_MS = 10 * 60 * 1000
const MAX_FILES = 100
const MAX_TOTAL_BYTES = 2 * 1024 * 1024
const MAX_FILE_BYTES = 512 * 1024

export type GitHubSkillInstallTarget = {
  owner: string
  repo: string
  ref?: string
  path: string
  original: string
}

export type GitHubSkillInstallFile = {
  path: string
  sizeBytes: number
  downloadUrl: string
  content?: Buffer
}

export type GitHubSkillInstallPlan = {
  token: string
  expiresAt: number
  target: GitHubSkillInstallTarget
  skillName: string
  description: string
  installDir: string
  files: GitHubSkillInstallFile[]
  totalBytes: number
  warnings: string[]
}

export type GitHubSkillInstallResult =
  | {
      status: 'installed'
      skillName: string
      installDir: string
      filesWritten: number
      totalBytes: number
      warnings: string[]
    }
  | { status: 'unknown_token' }
  | { status: 'expired_token' }
  | { status: 'already_exists'; installDir: string }
  | { status: 'invalid_target'; reason: string }

type GitHubContentsItem = {
  type: string
  name: string
  path: string
  size?: number
  download_url?: string | null
}

type StoredPlan = {
  target: GitHubSkillInstallTarget
  includeFilesHash: string
  expiresAt: number
}

const installPlans = new Map<string, StoredPlan>()

export function _resetGitHubSkillInstallPlanStoreForTesting(): void {
  installPlans.clear()
}

export async function getGitHubSkillInstallPlan(
  input: string,
): Promise<GitHubSkillInstallPlan | { status: 'invalid_target'; reason: string }> {
  const parsed = parseGitHubSkillTarget(input)
  if (!parsed) {
    return {
      status: 'invalid_target',
      reason:
        'Expected a GitHub URL such as https://github.com/owner/repo or https://github.com/owner/repo/tree/main/path/to/skill',
    }
  }

  const target = await resolveDefaultRef(parsed)
  const plan = await buildPlanSafe(target, false)
  if ('status' in plan) return plan

  installPlans.set(plan.token, {
    target,
    includeFilesHash: filesHash(plan.files),
    expiresAt: plan.expiresAt,
  })
  return plan
}

export async function executeGitHubSkillInstallPlan(
  token: string,
): Promise<GitHubSkillInstallResult> {
  const stored = installPlans.get(token)
  if (!stored) return { status: 'unknown_token' }
  installPlans.delete(token)
  if (Date.now() > stored.expiresAt) return { status: 'expired_token' }

  const plan = await buildPlanSafe(stored.target, true)
  if ('status' in plan) return plan
  if (filesHash(plan.files) !== stored.includeFilesHash) {
    return {
      status: 'invalid_target',
      reason:
        'GitHub skill contents changed between dry-run and confirm. Run /skills install again.',
    }
  }

  try {
    await stat(plan.installDir)
    return { status: 'already_exists', installDir: plan.installDir }
  } catch {
    // Expected when installing a new skill.
  }

  const tmpDir = `${plan.installDir}.installing-${token}`
  await rm(tmpDir, { recursive: true, force: true })
  try {
    for (const file of plan.files) {
      const content = file.content
      if (!content) {
        throw new Error(`Missing downloaded content for ${file.path}`)
      }
      const targetPath = safeJoin(tmpDir, file.path)
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, content)
    }
    await mkdir(dirname(plan.installDir), { recursive: true })
    await rename(tmpDir, plan.installDir)
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true })
    throw error
  }

  clearCommandsCache()
  skillChangeDetector.notifyChange(plan.installDir)

  return {
    status: 'installed',
    skillName: plan.skillName,
    installDir: plan.installDir,
    filesWritten: plan.files.length,
    totalBytes: plan.totalBytes,
    warnings: plan.warnings,
  }
}

async function buildPlan(
  target: GitHubSkillInstallTarget,
  includeContent: boolean,
): Promise<GitHubSkillInstallPlan | { status: 'invalid_target'; reason: string }> {
  const files = await listSkillFiles(target)
  const skillFile = files.find(f => f.path === 'SKILL.md')
  if (!skillFile) {
    return {
      status: 'invalid_target',
      reason: 'No SKILL.md found at the GitHub target path.',
    }
  }

  if (files.length > MAX_FILES) {
    return {
      status: 'invalid_target',
      reason: `Skill contains ${files.length} files; limit is ${MAX_FILES}.`,
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    return {
      status: 'invalid_target',
      reason: `Skill is too large (${totalBytes} bytes); limit is ${MAX_TOTAL_BYTES} bytes.`,
    }
  }
  const tooLarge = files.find(f => f.sizeBytes > MAX_FILE_BYTES)
  if (tooLarge) {
    return {
      status: 'invalid_target',
      reason: `${tooLarge.path} is too large (${tooLarge.sizeBytes} bytes); limit is ${MAX_FILE_BYTES} bytes.`,
    }
  }

  const skillMarkdown = await fetchText(skillFile.downloadUrl)
  const { frontmatter, content } = parseFrontmatter(skillMarkdown, 'SKILL.md')
  const fallbackName = target.path ? basenameNoExt(target.path) : target.repo
  const requestedName =
    typeof frontmatter.name === 'string' && frontmatter.name.trim()
      ? frontmatter.name.trim()
      : fallbackName
  const skillName = toSkillSlug(requestedName)
  if (!skillName) {
    return {
      status: 'invalid_target',
      reason: `Could not derive a safe skill name from "${requestedName}".`,
    }
  }

  const parsed = parseSkillFrontmatterFields(frontmatter, content, skillName)
  const warnings = buildWarnings(frontmatter)
  const token = randomBytes(4).toString('hex')
  const expiresAt = Date.now() + GITHUB_SKILL_INSTALL_TOKEN_TTL_MS

  const hydratedFiles = includeContent
    ? await Promise.all(files.map(async file => ({
        ...file,
        content: await fetchBuffer(file.downloadUrl),
      })))
    : files

  return {
    token,
    expiresAt,
    target,
    skillName,
    description: parsed.description,
    installDir: join(getMossenConfigHomeDir(), 'skills', skillName),
    files: hydratedFiles,
    totalBytes,
    warnings,
  }
}

async function buildPlanSafe(
  target: GitHubSkillInstallTarget,
  includeContent: boolean,
): Promise<GitHubSkillInstallPlan | { status: 'invalid_target'; reason: string }> {
  try {
    return await buildPlan(target, includeContent)
  } catch (error) {
    return {
      status: 'invalid_target',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function buildWarnings(frontmatter: Record<string, unknown>): string[] {
  const warnings: string[] = []
  if (frontmatter.hooks) {
    warnings.push('Skill declares hooks; review side effects before invoking it.')
  }
  const tools = frontmatter['allowed-tools']
  const text = Array.isArray(tools) ? tools.join(',') : String(tools ?? '')
  if (/\bBash\s*\(\s*\*\s*\)|\bEdit\b|\bWrite\b/i.test(text)) {
    warnings.push('Skill declares broad allowed-tools; Mossen permissions still apply.')
  }
  if (frontmatter['disable-model-invocation'] === false) {
    warnings.push('Skill allows model invocation; confirm the trigger is narrow.')
  }
  return warnings
}

async function listSkillFiles(
  target: GitHubSkillInstallTarget,
): Promise<GitHubSkillInstallFile[]> {
  const rootPath = normalizeGithubPath(target.path)
  const item = await getContents(target, rootPath)
  const entries = Array.isArray(item) ? item : [item]
  const rootIsSkillFile =
    entries.length === 1 &&
    entries[0]?.type === 'file' &&
    entries[0].name.toLowerCase() === 'skill.md'
  const rootPrefix = rootIsSkillFile ? dirname(rootPath) : rootPath
  const files: GitHubSkillInstallFile[] = []

  async function walk(path: string): Promise<void> {
    const content = await getContents(target, path)
    const items = Array.isArray(content) ? content : [content]
    for (const item of items) {
      if (item.type === 'dir') {
        await walk(item.path)
        continue
      }
      if (item.type !== 'file') continue
      if (!item.download_url) continue
      const relativePath = rootIsSkillFile
        ? 'SKILL.md'
        : normalizeGithubPath(relative(rootPrefix, item.path))
      if (!isSafeRelativePath(relativePath)) continue
      files.push({
        path: relativePath,
        sizeBytes: item.size ?? 0,
        downloadUrl: item.download_url,
      })
    }
  }

  await walk(rootPath)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function getContents(
  target: GitHubSkillInstallTarget,
  path: string,
): Promise<GitHubContentsItem | GitHubContentsItem[]> {
  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const url = new URL(
    `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodedPath}`,
  )
  url.searchParams.set('ref', target.ref ?? 'main')
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mossen-skill-installer',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub contents request failed (${response.status})`)
  }
  return (await response.json()) as GitHubContentsItem | GitHubContentsItem[]
}

async function resolveDefaultRef(
  target: GitHubSkillInstallTarget,
): Promise<GitHubSkillInstallTarget> {
  if (target.ref) return target
  const response = await fetch(
    `https://api.github.com/repos/${target.owner}/${target.repo}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mossen-skill-installer',
      },
    },
  )
  if (!response.ok) return { ...target, ref: 'main' }
  const json = (await response.json()) as { default_branch?: string }
  return { ...target, ref: json.default_branch || 'main' }
}

function parseGitHubSkillTarget(input: string): GitHubSkillInstallTarget | null {
  const trimmed = input.trim()
  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (shorthand) {
    return {
      owner: shorthand[1]!,
      repo: stripGitSuffix(shorthand[2]!),
      path: '',
      original: trimmed,
    }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  const owner = parts[0]
  const repo = parts[1] ? stripGitSuffix(parts[1]) : undefined
  if (!owner || !repo) return null
  if (!parts[2]) return { owner, repo, path: '', original: trimmed }
  if (parts[2] !== 'tree' && parts[2] !== 'blob') return null
  const ref = parts[3]
  const path = parts.slice(4).join('/')
  if (!ref) return null
  return { owner, repo, ref, path, original: trimmed }
}

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'mossen-skill-installer' } })
  if (!response.ok) throw new Error(`Failed to fetch ${url} (${response.status})`)
  return response.text()
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { 'User-Agent': 'mossen-skill-installer' } })
  if (!response.ok) throw new Error(`Failed to fetch ${url} (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

function toSkillSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

function basenameNoExt(value: string): string {
  const normalized = normalizeGithubPath(value)
  const last = normalized.split('/').filter(Boolean).at(-1) ?? 'skill'
  return last.replace(/\.md$/i, '')
}

function normalizeGithubPath(path: string): string {
  if (!path.trim()) return ''
  const normalized = normalize(path).split(sep).join('/').replace(/^\.\//, '')
  return normalized === '.' ? '' : normalized
}

function isSafeRelativePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.includes('..')
}

function safeJoin(root: string, child: string): string {
  if (!isSafeRelativePath(child)) {
    throw new Error(`Unsafe skill file path: ${child}`)
  }
  return join(root, child)
}

function filesHash(files: GitHubSkillInstallFile[]): string {
  return files.map(f => `${f.path}:${f.sizeBytes}`).join('|')
}
