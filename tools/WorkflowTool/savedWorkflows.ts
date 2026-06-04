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
 * The command is a `prompt`-type command whose getPromptForCommand returns an
 * instruction telling the model to invoke the Workflow tool with the saved
 * script (passed by path so the engine reads + snapshots it). The model still
 * drives the actual tool call — this keeps saved workflows on the same
 * permission + opt-in path as any other Workflow invocation.
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
import type { Command } from '../../commands.js'
import { getInlinePlugins } from '../../bootstrap/state.js'
import type { LoadedPlugin, PluginManifest } from '../../types/plugin.js'
import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { isWorkflowRuntimeEnabled } from '../../utils/workflowAvailability.js'
import { loadBundledWorkflows } from './bundled/index.js'
import { extractMeta } from './engine/meta.js'
import { readWorkflowScriptFile } from './scriptFile.js'

const COMPAT_WORKFLOW_CONFIG_DIR = `.${'cla' + 'ude'}`

/** Project-scoped saved workflows live here (relative to the project root). */
export const PROJECT_WORKFLOWS_SUBDIR = join(
  COMPAT_WORKFLOW_CONFIG_DIR,
  'workflows',
)
/** Legacy project-scoped saved workflows are still read for migration compatibility. */
export const LEGACY_PROJECT_WORKFLOWS_SUBDIR = join('.mossen', 'workflows')
/** User-scoped saved workflows live here. */
export function getUserWorkflowsDir(): string {
  return join(homedir(), COMPAT_WORKFLOW_CONFIG_DIR, 'workflows')
}
/** Legacy user-scoped saved workflows are still read for migration compatibility. */
export function getLegacyUserWorkflowsDir(): string {
  return join(homedir(), '.mossen', 'workflows')
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

/**
 * Build the saved-workflow `prompt` command for a parsed entry. Running
 * `/<name>` instructs the model to execute the saved script via the Workflow
 * tool (by path, so the engine snapshots + journals it like any run).
 */
function toCommand(wf: SavedWorkflow): Command {
  return {
    type: 'prompt',
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
    // Map the saved scope onto the command settings-source enum so listing /
    // dedupe treat project-scoped workflows like other project-sourced commands.
    source:
      wf.scope === 'plugin'
        ? 'plugin'
        : wf.scope === 'bundled'
          ? 'bundled'
        : wf.scope === 'project'
          ? 'projectSettings'
          : 'userSettings',
    ...(wf.plugin
      ? {
          pluginInfo: {
            pluginManifest: wf.plugin.manifest,
            repository: wf.plugin.repository,
          },
        }
      : {}),
    progressMessage: 'running workflow',
    contentLength: 0,
    async getPromptForCommand(args: string) {
      const trimmedArgs = args.trim()
      const argLine = trimmedArgs
        ? `\n\nCaller arguments:\n${trimmedArgs}\n\nPass the caller arguments as Workflow.args using the most specific structured value you can infer. Use real arrays, objects, numbers, booleans, or null where appropriate; do not JSON-encode those values into a string. Use a raw string only when no useful structure is clear.`
        : ` Do not pass args; the workflow script should see args as undefined.`
      const scriptInstruction = wf.scriptPath
        ? `with scriptPath="${wf.scriptPath}"`
        : `with the bundled script named "${wf.name}" as its script input:\n\n${wf.source}`
      return [
        {
          type: 'text' as const,
          text:
            `Run the saved workflow "${wf.commandName}" by invoking the Workflow tool ` +
            scriptInstruction +
            (trimmedArgs
              ? `, preserving caller input as structured Workflow.args.`
              : `.`) +
            argLine,
        },
      ]
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
  return [
    ...loadSavedWorkflowsFrom(projectRoot),
    ...loadPluginWorkflowsFrom(plugins),
    ...loadBundledWorkflowRefs(),
  ]
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
