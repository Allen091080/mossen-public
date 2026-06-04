/**
 * Saved-workflow loader (S3).
 *
 * A workflow saved via `/workflows` (Save as) lands as a `.js` file under either
 * the project scope (`<project>/.mossen/workflows/`) or the user scope
 * (`~/.mossen/workflows/`). Each saved file becomes a slash command: typing
 * `/<name>` runs that workflow through the Workflow tool. This mirrors how
 * skills under `.mossen/skills` become commands.
 *
 * The command is a `prompt`-type command whose getPromptForCommand returns an
 * instruction telling the model to invoke the Workflow tool with the saved
 * script (passed by path so the engine reads + snapshots it). The model still
 * drives the actual tool call — this keeps saved workflows on the same
 * permission + opt-in path as any other Workflow invocation.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'
import { extractMeta } from './engine/meta.js'

/** Project-scoped saved workflows live here (relative to the project root). */
export const PROJECT_WORKFLOWS_SUBDIR = join('.mossen', 'workflows')
/** User-scoped saved workflows live here. */
export function getUserWorkflowsDir(): string {
  return join(homedir(), '.mossen', 'workflows')
}
export function getProjectWorkflowsDir(projectRoot: string): string {
  return join(projectRoot, PROJECT_WORKFLOWS_SUBDIR)
}

export function isSavedWorkflowsEnabled(): boolean {
  return feature('WORKFLOW_SCRIPTS') ? true : false
}

type SavedWorkflow = {
  name: string
  description: string
  scriptPath: string
  scope: 'project' | 'user'
}

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
      const source = readFileSync(scriptPath, 'utf8')
      const { meta } = extractMeta(source)
      out.push({
        name: meta.name,
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

/**
 * Build the saved-workflow `prompt` command for a parsed entry. Running
 * `/<name>` instructs the model to execute the saved script via the Workflow
 * tool (by path, so the engine snapshots + journals it like any run).
 */
function toCommand(wf: SavedWorkflow): Command {
  return {
    type: 'prompt',
    name: wf.name,
    description: wf.description,
    hasUserSpecifiedDescription: true,
    // 'managed' = a non-skill, non-plugin command loaded from disk; `kind:
    // 'workflow'` badges it as workflow-backed in autocomplete.
    loadedFrom: 'managed',
    kind: 'workflow',
    // Map the saved scope onto the command settings-source enum so listing /
    // dedupe treat project-scoped workflows like other project-sourced commands.
    source: wf.scope === 'project' ? 'projectSettings' : 'userSettings',
    progressMessage: 'running workflow',
    contentLength: 0,
    async getPromptForCommand(args: string) {
      const argLine = args.trim()
        ? `\n\nCaller arguments: ${args.trim()}`
        : ''
      return [
        {
          type: 'text' as const,
          text:
            `Run the saved workflow "${wf.name}" by invoking the Workflow tool ` +
            `with scriptPath="${wf.scriptPath}"` +
            (argLine
              ? `, passing the caller arguments as the workflow's args.`
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
  const project = readWorkflowDir(
    getProjectWorkflowsDir(projectRoot),
    'project',
  )
  const user = readWorkflowDir(getUserWorkflowsDir(), 'user')
  return [...project, ...user].map(toCommand)
}

/**
 * Load saved workflows from project + user scope as slash commands. Returns []
 * when the WORKFLOW_SCRIPTS feature is off (no orchestration → no saved
 * workflows). Production entry point used by the command registry.
 */
export function getWorkflowCommands(projectRoot: string): Command[] {
  if (!isSavedWorkflowsEnabled()) return []
  return loadWorkflowCommandsFrom(projectRoot)
}
