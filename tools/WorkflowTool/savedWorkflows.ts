/**
 * Saved-workflow loader (S3).
 *
 * A workflow saved via `/workflows` (Save as) lands as a `.js` file under the
 * project workflow directory, or under the user workflow directory when
 * explicitly requested. Legacy workflow directories are also read for migration
 * compatibility. Each saved file becomes a slash command: typing
 * `/<name>` runs that workflow through the Workflow tool. This mirrors how
 * skills under `.mossen/skills` become commands.
 *
 * Saved workflow commands are direct local commands: typing `/<name>` launches
 * the workflow runtime itself instead of sending the model a prompt that asks
 * it to call the Workflow tool. Permissions are still checked explicitly
 * before launch.
 */

import {
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { feature } from 'bun:bundle'
import stripAnsi from 'strip-ansi'
import type {
  Command,
  LocalCommandResult,
  LocalJSXCommandContext,
} from '../../commands.js'
import { getInlinePlugins } from '../../bootstrap/state.js'
import type { LoadedPlugin, PluginManifest } from '../../types/plugin.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { isWorkflowRuntimeEnabled } from '../../utils/workflowAvailability.js'
import { loadBundledWorkflows } from './bundled/index.js'
import { loadRunMeta, type WorkflowRunMeta } from './engine/journalStore.js'
import { extractMeta } from './engine/meta.js'
import { readWorkflowScriptFile } from './scriptFile.js'

const COMPAT_WORKFLOW_CONFIG_DIR = `.${'cla' + 'ude'}`
const JSON_LIKE_RE = /^(?:\{[\s\S]*\}|\[[\s\S]*\]|"(?:[^"\\]|\\.)*")$/
const NUMBER_RE = /^[+-]?(?:\d+|\d*\.\d+)$/
const KEY_VALUE_RE = /^([A-Za-z_][A-Za-z0-9_-]*)=(.+)$/
const NUMBER_TOKEN_RE = /(?:^|[^\w.-])#?(\d+)(?=$|[^\w.-])/g
const LIST_MARKER_RE =
  /\b(?:issues?|tickets?|prs?|pull requests?|items?|ids?|numbers?)\b/i
// eslint-disable-next-line no-control-regex
const UNSAFE_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g
export const WORKFLOW_HOME_ENV = 'MOSSEN_CODE_WORKFLOW_HOME'
const DIRECT_COMMAND_WAIT_ENV = 'MOSSEN_CODE_WORKFLOW_DIRECT_COMMAND_WAIT_MS'
const DIRECT_COMMAND_POLL_MS = 50
const DIRECT_COMMAND_DEFAULT_WAIT_MS = 30 * 60 * 1000
const DIRECT_COMMAND_MAX_WAIT_MS = 30 * 60 * 1000
const TERMINAL_WORKFLOW_STATUSES = new Set([
  'paused',
  'completed',
  'failed',
  'killed',
])

function workflowHomeDir(): string {
  const configured = process.env[WORKFLOW_HOME_ENV]?.trim()
  return configured || homedir()
}

/** Project-scoped saved workflows live here (relative to the project root). */
export const PROJECT_WORKFLOWS_SUBDIR = join(
  COMPAT_WORKFLOW_CONFIG_DIR,
  'workflows',
)
/** Legacy project-scoped saved workflows are still read for migration compatibility. */
export const LEGACY_PROJECT_WORKFLOWS_SUBDIR = join('.mossen', 'workflows')
/** User-scoped saved workflows live here. */
export function getUserWorkflowsDir(): string {
  return join(workflowHomeDir(), COMPAT_WORKFLOW_CONFIG_DIR, 'workflows')
}
/** Legacy user-scoped saved workflows are still read for migration compatibility. */
export function getLegacyUserWorkflowsDir(): string {
  return join(workflowHomeDir(), '.mossen', 'workflows')
}
export function getProjectWorkflowsDir(projectRoot: string): string {
  return join(projectRoot, PROJECT_WORKFLOWS_SUBDIR)
}
export function getLegacyProjectWorkflowsDir(projectRoot: string): string {
  return join(projectRoot, LEGACY_PROJECT_WORKFLOWS_SUBDIR)
}

export function isSavedWorkflowsEnabled(): boolean {
  return feature('WORKFLOW_SCRIPTS') ? isWorkflowRuntimeEnabled() : false
}

type SavedWorkflow = {
  name: string
  commandName: string
  description: string
  scriptPath?: string
  source?: string
  isEnabled?: () => boolean
  scope: 'project' | 'user' | 'plugin' | 'bundled'
  plugin?: {
    name: string
    source: string
    repository: string
    manifest: PluginManifest
  }
}

export type SavedWorkflowRef = SavedWorkflow

export type WorkflowPluginRef = Pick<
  LoadedPlugin,
  | 'name'
  | 'source'
  | 'repository'
  | 'manifest'
  | 'workflowsPath'
  | 'workflowsPaths'
>

/** Read + meta-parse every `*.js` in a dir. Bad files are skipped, not fatal. */
function readWorkflowDir(
  dir: string,
  scope: 'project' | 'user',
): SavedWorkflow[] {
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir).filter(f => f.endsWith('.js'))
  } catch {
    return []
  }
  const out: SavedWorkflow[] = []
  for (const file of entries) {
    const scriptPath = join(dir, file)
    try {
      const source = readWorkflowScriptFile(scriptPath)
      const { meta } = extractMeta(source)
      out.push({
        name: meta.name,
        commandName: meta.name,
        description: meta.description,
        scriptPath,
        scope,
      })
    } catch {
      // A malformed saved workflow (bad meta / unreadable) is silently skipped
      // so one broken file never breaks command loading.
    }
  }
  return out
}

function dedupeWorkflows(workflows: SavedWorkflow[]): SavedWorkflow[] {
  const seen = new Set<string>()
  const out: SavedWorkflow[] = []
  for (const workflow of workflows) {
    const key = workflow.commandName || workflow.name
    if (seen.has(key)) continue
    seen.add(key)
    out.push(workflow)
  }
  return out
}

function normalizePathForDedupe(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function readPluginWorkflowFile(
  scriptPath: string,
  plugin: WorkflowPluginRef,
): SavedWorkflow | null {
  try {
    const source = readWorkflowScriptFile(scriptPath)
    const { meta } = extractMeta(source)
    return {
      name: meta.name,
      commandName: `${plugin.name}:${meta.name}`,
      description: meta.description,
      scriptPath,
      scope: 'plugin',
      plugin: {
        name: plugin.name,
        source: plugin.source,
        repository: plugin.repository,
        manifest: plugin.manifest,
      },
    }
  } catch {
    return null
  }
}

function readPluginWorkflowPath(
  workflowPath: string,
  plugin: WorkflowPluginRef,
  loadedPaths: Set<string>,
): SavedWorkflow[] {
  let stat
  try {
    stat = statSync(workflowPath)
  } catch {
    return []
  }

  if (stat.isFile()) {
    if (!workflowPath.endsWith('.js')) return []
    const dedupe = normalizePathForDedupe(workflowPath)
    if (loadedPaths.has(dedupe)) return []
    loadedPaths.add(dedupe)
    const wf = readPluginWorkflowFile(workflowPath, plugin)
    return wf ? [wf] : []
  }

  if (!stat.isDirectory()) return []
  let entries: string[]
  try {
    entries = readdirSync(workflowPath).filter(f => f.endsWith('.js'))
  } catch {
    return []
  }

  const out: SavedWorkflow[] = []
  for (const file of entries) {
    const scriptPath = join(workflowPath, file)
    const dedupe = normalizePathForDedupe(scriptPath)
    if (loadedPaths.has(dedupe)) continue
    loadedPaths.add(dedupe)
    const wf = readPluginWorkflowFile(scriptPath, plugin)
    if (wf) out.push(wf)
  }
  return out
}

export function loadBundledWorkflowRefs(): SavedWorkflowRef[] {
  return loadBundledWorkflows().map(wf => ({
    name: wf.name,
    commandName: wf.name,
    description: wf.description,
    source: wf.source,
    ...(wf.isEnabled ? { isEnabled: wf.isEnabled } : {}),
    scope: 'bundled',
  }))
}

export function isWorkflowRefEnabled(wf: SavedWorkflowRef): boolean {
  return wf.isEnabled?.() ?? true
}

function coerceWorkflowArgAtom(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (NUMBER_RE.test(trimmed)) return Number(trimmed)
  return trimmed
}

function tryParseWorkflowArgJson(value: string): unknown | null {
  if (!JSON_LIKE_RE.test(value)) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function normalizeWorkflowArgsInput(value: string): string {
  return stripAnsi(value).replace(UNSAFE_CONTROL_RE, '').trim()
}

function startsJsonLike(value: string): boolean {
  return /^[\[{"]/.test(value.trim())
}

function tryParseWorkflowArgKeyValues(value: string): Record<string, unknown> | null {
  const pairs = value
    .split(/\s+/)
    .map(part => part.match(KEY_VALUE_RE))
    .filter((match): match is RegExpMatchArray => match !== null)
  if (pairs.length === 0) return null
  const consumed = pairs.map(match => match[0]).join(' ')
  if (consumed !== value.trim()) return null
  const out: Record<string, unknown> = {}
  for (const match of pairs) {
    out[match[1]!] = coerceWorkflowArgAtom(match[2]!)
  }
  return out
}

function tryParseWorkflowArgNumberList(value: string): number[] | null {
  if (startsJsonLike(value)) return null
  const numbers = Array.from(value.matchAll(NUMBER_TOKEN_RE), match =>
    Number(match[1]),
  )
  if (numbers.length < 2) return null
  if (!LIST_MARKER_RE.test(value) && !/[,;]/.test(value)) return null
  return numbers
}

function tryParseWorkflowArgCommaList(value: string): unknown[] | null {
  if (!value.includes(',')) return null
  const parts = value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  if (parts.some(part => /\s/.test(part))) return null
  return parts.map(coerceWorkflowArgAtom)
}

export function inferWorkflowArgsValue(args: string): unknown | undefined {
  const trimmed = normalizeWorkflowArgsInput(args)
  if (!trimmed) return undefined

  return (
    tryParseWorkflowArgJson(trimmed) ??
    tryParseWorkflowArgKeyValues(trimmed) ??
    tryParseWorkflowArgNumberList(trimmed) ??
    tryParseWorkflowArgCommaList(trimmed) ??
    coerceWorkflowArgAtom(trimmed)
  )
}

type SavedWorkflowToolInput = {
  name: string
  args?: unknown
}

export function savedWorkflowToolInputForArgs(
  wf: SavedWorkflowRef,
  args: string,
): SavedWorkflowToolInput {
  const inferredArgs = inferWorkflowArgsValue(args.trim())
  return {
    name: wf.commandName,
    ...(inferredArgs !== undefined ? { args: inferredArgs } : {}),
  }
}

function directCommandWaitMs(input: { timeoutMs?: unknown }): number {
  const configured = Number(process.env[DIRECT_COMMAND_WAIT_ENV])
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(configured, DIRECT_COMMAND_MAX_WAIT_MS)
  }
  const workflowTimeout = Number(input.timeoutMs)
  if (Number.isFinite(workflowTimeout) && workflowTimeout >= 0) {
    return Math.min(workflowTimeout + 5000, DIRECT_COMMAND_MAX_WAIT_MS)
  }
  return DIRECT_COMMAND_DEFAULT_WAIT_MS
}

async function waitForWorkflowTerminal(
  runId: string,
  timeoutMs: number,
): Promise<{ meta: WorkflowRunMeta | null; timedOut: boolean }> {
  const deadline = Date.now() + timeoutMs
  let meta = loadRunMeta(runId)
  while (
    meta &&
    !TERMINAL_WORKFLOW_STATUSES.has(meta.status) &&
    Date.now() < deadline
  ) {
    await new Promise(resolve => setTimeout(resolve, DIRECT_COMMAND_POLL_MS))
    meta = loadRunMeta(runId)
  }
  return {
    meta,
    timedOut: Boolean(meta && !TERMINAL_WORKFLOW_STATUSES.has(meta.status)),
  }
}

function formatDirectWorkflowLaunch(data: {
  error?: string
  runId?: string
  scriptPath?: string
  summary?: string
  taskId?: string
  transcriptDir?: string
}): string {
  if (data.error) {
    return `Workflow script has a syntax error and was not launched:\n${data.error}`
  }
  return (
    `Workflow launched in background. Task ID: ${data.taskId ?? 'unknown'}` +
    `\nSummary: ${data.summary ?? ''}` +
    `${data.transcriptDir ? `\nTranscript dir: ${data.transcriptDir}` : ''}` +
    `${data.scriptPath ? `\nScript file: ${data.scriptPath}` : ''}` +
    `${data.runId ? `\nRun ID: ${data.runId}` : ''}` +
    '\nUse /workflows to watch live progress.'
  )
}

function formatDirectWorkflowTerminal(
  meta: WorkflowRunMeta | null,
  timedOut: boolean,
): string {
  if (!meta) return 'Workflow run artifact was not found.'
  if (timedOut) {
    return `Workflow is still running after the direct-command wait window. Run ID: ${meta.runId}`
  }
  const result = meta.result ? `\nResult: ${meta.result}` : ''
  const failures =
    meta.failures && meta.failures.length > 0
      ? `\nFailures: ${meta.failures.join('; ')}`
      : ''
  return (
    `Workflow ${meta.status}. Run ID: ${meta.runId}` +
    `\nWorkflow: ${meta.workflowName}` +
    result +
    failures
  )
}

async function runSavedWorkflowCommand(
  wf: SavedWorkflow,
  args: string,
  context: LocalJSXCommandContext,
): Promise<LocalCommandResult> {
  const { WorkflowTool } = await import('./WorkflowTool.js')
  const input = savedWorkflowToolInputForArgs(wf, args)
  const parsed = WorkflowTool.inputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      type: 'text',
      value: `Workflow input is invalid: ${parsed.error.message}`,
    }
  }
  const validation = await WorkflowTool.validateInput?.(parsed.data, context)
  if (validation?.result === false) {
    return {
      type: 'text',
      value: `Workflow input is invalid: ${validation.message}`,
    }
  }

  const canUseTool = context.canUseTool ?? hasPermissionsToUseTool
  const toolUseID = `workflow-command-${wf.commandName}`
  const assistantMessage = createAssistantMessage({
    content: `Direct workflow command /${wf.commandName}`,
  })
  const permission = await canUseTool(
    WorkflowTool,
    parsed.data,
    context,
    assistantMessage,
    toolUseID,
  )
  if (permission.behavior !== 'allow') {
    return {
      type: 'text',
      value: `Workflow launch denied: ${permission.message ?? permission.behavior}`,
    }
  }

  const allowedInput = permission.updatedInput ?? parsed.data
  const result = await WorkflowTool.call(
    allowedInput,
    context,
    canUseTool,
  )
  const output = result.data as {
    error?: string
    runId?: string
    scriptPath?: string
    summary?: string
    taskId?: string
    transcriptDir?: string
  }
  const launchText = formatDirectWorkflowLaunch(output)
  if (!context.options.isNonInteractiveSession || !output.runId || output.error) {
    return { type: 'text', value: launchText }
  }

  const terminal = await waitForWorkflowTerminal(
    output.runId,
    directCommandWaitMs(allowedInput),
  )
  return {
    type: 'text',
    value: `${launchText}\n\n${formatDirectWorkflowTerminal(
      terminal.meta,
      terminal.timedOut,
    )}`,
  }
}

/**
 * Build the saved-workflow command for a parsed entry. Running `/<name>`
 * directly calls the Workflow tool implementation by name. Name resolution
 * stays inside WorkflowTool so project scope keeps winning over user/plugin/
 * bundled scope at execution time.
 */
function toCommand(wf: SavedWorkflow): Command {
  return {
    type: 'local',
    name: wf.commandName,
    description: wf.description,
    hasUserSpecifiedDescription: true,
    // 'managed' = a non-skill, non-plugin command loaded from disk; `kind:
    // 'workflow'` badges it as workflow-backed in autocomplete.
    loadedFrom:
      wf.scope === 'plugin'
        ? 'plugin'
        : wf.scope === 'bundled'
          ? 'bundled'
          : 'managed',
    kind: 'workflow',
    ...(wf.isEnabled ? { isEnabled: wf.isEnabled } : {}),
    supportsNonInteractive: true,
    load: async () => {
      return {
        call: (args, context) => runSavedWorkflowCommand(wf, args, context),
      }
    },
  } satisfies Command
}

/**
 * Pure core: read project + user scope and build commands, WITHOUT the build
 * gate. Project scope wins on name conflict (appears first; downstream dedupe
 * keeps the earliest). Exported for unit tests that must exercise the real
 * disk-read + meta-parse path regardless of the build-time feature flag.
 */
export function loadWorkflowCommandsFrom(projectRoot: string): Command[] {
  return loadSavedWorkflowsFrom(projectRoot).map(toCommand)
}

export function loadSavedWorkflowsFrom(projectRoot: string): SavedWorkflowRef[] {
  const project = readWorkflowDir(
    getProjectWorkflowsDir(projectRoot),
    'project',
  )
  const legacyProject = readWorkflowDir(
    getLegacyProjectWorkflowsDir(projectRoot),
    'project',
  )
  const user = readWorkflowDir(getUserWorkflowsDir(), 'user')
  const legacyUser = readWorkflowDir(getLegacyUserWorkflowsDir(), 'user')
  return dedupeWorkflows([...project, ...legacyProject, ...user, ...legacyUser])
}

export function loadPluginWorkflowsFrom(
  plugins: readonly WorkflowPluginRef[],
): SavedWorkflowRef[] {
  const out: SavedWorkflowRef[] = []
  for (const plugin of plugins) {
    const loadedPaths = new Set<string>()
    if (plugin.workflowsPath) {
      out.push(
        ...readPluginWorkflowPath(plugin.workflowsPath, plugin, loadedPaths),
      )
    }
    for (const workflowPath of plugin.workflowsPaths ?? []) {
      out.push(...readPluginWorkflowPath(workflowPath, plugin, loadedPaths))
    }
  }
  return out
}

export function loadWorkflowCommandsFromSources(
  projectRoot: string,
  plugins: readonly WorkflowPluginRef[] = [],
): Command[] {
  return getAllWorkflows(projectRoot, plugins).map(toCommand)
}

export function getAllWorkflows(
  projectRoot: string,
  plugins: readonly WorkflowPluginRef[] = [],
): SavedWorkflowRef[] {
  return dedupeWorkflows([
    ...loadSavedWorkflowsFrom(projectRoot),
    ...loadPluginWorkflowsFrom(plugins),
    ...loadBundledWorkflowRefs(),
  ])
}

async function loadEnabledWorkflowPlugins(): Promise<WorkflowPluginRef[]> {
  if (isBareMode() && getInlinePlugins().length === 0) {
    return []
  }

  const { enabled, errors } = await loadAllPluginsCacheOnly()
  if (errors.length > 0) {
    logForDebugging(
      `Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`,
    )
  }
  return enabled.filter(p => p.workflowsPath || p.workflowsPaths?.length)
}

export async function loadWorkflowRefsFromAllSources(
  projectRoot: string,
): Promise<SavedWorkflowRef[]> {
  const plugins = await loadEnabledWorkflowPlugins()
  return getEnabledWorkflows(projectRoot, plugins)
}

export function getEnabledWorkflows(
  projectRoot: string,
  plugins: readonly WorkflowPluginRef[] = [],
): SavedWorkflowRef[] {
  return getAllWorkflows(projectRoot, plugins).filter(isWorkflowRefEnabled)
}

export function resolveSavedWorkflow(
  projectRoot: string,
  name: string,
): SavedWorkflowRef | null {
  const wanted = name.trim()
  if (!wanted) return null
  return loadSavedWorkflowsFrom(projectRoot).find(wf => wf.name === wanted) ?? null
}

export function resolveWorkflowFromSources(
  projectRoot: string,
  name: string,
  plugins: readonly WorkflowPluginRef[] = [],
): SavedWorkflowRef | null {
  const wanted = name.trim()
  if (!wanted) return null
  const workflows = getEnabledWorkflows(projectRoot, plugins)
  return (
    workflows.find(wf => wf.commandName === wanted) ??
    workflows.find(wf => wf.name === wanted) ??
    null
  )
}

export async function resolveWorkflowFromAllSources(
  projectRoot: string,
  name: string,
): Promise<SavedWorkflowRef | null> {
  const wanted = name.trim()
  if (!wanted) return null
  const plugins = await loadEnabledWorkflowPlugins()
  return resolveWorkflowFromSources(projectRoot, wanted, plugins)
}

/**
 * Load saved workflows from project + user scope as slash commands. Returns []
 * when the WORKFLOW_SCRIPTS feature is off (no orchestration → no saved
 * workflows). Production entry point used by the command registry.
 */
export async function getWorkflowCommands(projectRoot: string): Promise<Command[]> {
  if (!isSavedWorkflowsEnabled()) return []
  const plugins = await loadEnabledWorkflowPlugins()
  return loadWorkflowCommandsFromSources(projectRoot, plugins)
}
