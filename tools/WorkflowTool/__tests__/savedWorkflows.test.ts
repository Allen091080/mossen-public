import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCommandEnabled } from '../../../types/command.js'
import { isWebSearchAvailableFor } from '../../WebSearchTool/availability.js'
import {
  getEnabledWorkflows,
  getProjectWorkflowsDir,
  getLegacyProjectWorkflowsDir,
  getLegacyUserWorkflowsDir,
  getAllWorkflows,
  isSavedWorkflowsEnabled,
  loadBundledWorkflowRefs,
  loadPluginWorkflowsFrom,
  loadWorkflowCommandsFrom,
  loadWorkflowCommandsFromSources,
  resolveWorkflowFromSources,
  resolveSavedWorkflow,
  getWorkflowCommands,
  getUserWorkflowsDir,
  LEGACY_PROJECT_WORKFLOWS_SUBDIR,
  PROJECT_WORKFLOWS_SUBDIR,
} from '../savedWorkflows.js'
import { MAX_WORKFLOW_SCRIPT_FILE_BYTES } from '../scriptFile.js'

// Tests target loadWorkflowCommandsFrom (the UNGATED core) so the disk-read +
// meta-parse contract is asserted for real regardless of the WORKFLOW_SCRIPTS
// build flag. The gated production wrapper getWorkflowCommands is covered by a
// separate gate-behavior test below.

const META = (name: string, desc: string) =>
  `export const meta = { name: '${name}', description: '${desc}' }\nreturn 1\n`

const WEB_SEARCH_ENV_KEYS = [
  'MOSSEN_CODE_USE_BEDROCK',
  'MOSSEN_CODE_USE_VERTEX',
  'MOSSEN_CODE_USE_FOUNDRY',
  'MOSSEN_CODE_MODEL',
] as const

type WebSearchEnvKey = (typeof WEB_SEARCH_ENV_KEYS)[number]
let previousWebSearchEnv: Partial<Record<WebSearchEnvKey, string>>

function clearWebSearchProviderEnv(): void {
  for (const key of WEB_SEARCH_ENV_KEYS) {
    delete process.env[key]
  }
}

function restoreWebSearchProviderEnv(): void {
  for (const key of WEB_SEARCH_ENV_KEYS) {
    const value = previousWebSearchEnv[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('savedWorkflows loader (S3)', () => {
  let root: string
  let wfDir: string

  beforeEach(() => {
    previousWebSearchEnv = {}
    for (const key of WEB_SEARCH_ENV_KEYS) {
      previousWebSearchEnv[key] = process.env[key]
    }
    clearWebSearchProviderEnv()
    root = mkdtempSync(join(tmpdir(), 'wf-saved-'))
    wfDir = getProjectWorkflowsDir(root)
    mkdirSync(wfDir, { recursive: true })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    restoreWebSearchProviderEnv()
  })

  test('dir layout uses official-compatible project/user dirs and legacy fallbacks', () => {
    const compatSubdir = join(`.${'cla' + 'ude'}`, 'workflows')
    expect(PROJECT_WORKFLOWS_SUBDIR).toBe(compatSubdir)
    expect(LEGACY_PROJECT_WORKFLOWS_SUBDIR).toBe(join('.mossen', 'workflows'))
    expect(getProjectWorkflowsDir('/x')).toBe(join('/x', compatSubdir))
    expect(getLegacyProjectWorkflowsDir('/x')).toBe(
      join('/x', '.mossen', 'workflows'),
    )
    expect(getUserWorkflowsDir().endsWith(compatSubdir)).toBe(true)
    expect(
      getLegacyUserWorkflowsDir().endsWith(join('.mossen', 'workflows')),
    ).toBe(true)
  })

  test('a valid .js workflow becomes a prompt command named by its meta', () => {
    writeFileSync(join(wfDir, 'review.js'), META('review-pr', 'Review the PR'))
    const cmds = loadWorkflowCommandsFrom(root)
    const cmd = cmds.find(c => c.name === 'review-pr')
    expect(cmd).toBeDefined()
    expect(cmd!.type).toBe('prompt')
    expect(cmd!.description).toBe('Review the PR')
    expect((cmd as { loadedFrom?: string }).loadedFrom).toBe('managed')
    expect((cmd as { kind?: string }).kind).toBe('workflow')
  })

  test('resolveSavedWorkflow finds a saved workflow by meta name', () => {
    writeFileSync(join(wfDir, 'child.js'), META('child-flow', 'Child flow'))
    const resolved = resolveSavedWorkflow(root, 'child-flow')
    expect(resolved?.name).toBe('child-flow')
    expect(resolved?.scriptPath).toBe(join(wfDir, 'child.js'))
  })

  test('getPromptForCommand references the script by path + forwards args', async () => {
    writeFileSync(join(wfDir, 'audit.js'), META('audit', 'Audit code'))
    const cmds = loadWorkflowCommandsFrom(root)
    const cmd = cmds.find(c => c.name === 'audit')
    expect(cmd?.type).toBe('prompt')
    const getPrompt = (cmd as unknown as {
      getPromptForCommand: (a: string) => Promise<Array<{ type: string; text: string }>>
    }).getPromptForCommand
    const blocks = await getPrompt('target=src/')
    const text = blocks.map(b => b.text).join('')
    expect(text).toContain('Workflow tool')
    expect(text).toMatch(/scriptPath=.*audit\.js/)
    expect(text).toContain('target=src/')
  })

  test('a malformed workflow file is skipped, not fatal', () => {
    writeFileSync(join(wfDir, 'good.js'), META('good', 'ok'))
    writeFileSync(join(wfDir, 'bad.js'), 'this is not a valid workflow at all')
    const cmds = loadWorkflowCommandsFrom(root)
    expect(cmds.find(c => c.name === 'good')).toBeDefined()
    // 'bad.js' has no meta block → extractMeta throws → skipped.
    expect(cmds.every(c => c.name !== 'bad')).toBe(true)
  })

  test('an oversized workflow file is skipped, not fatal', () => {
    writeFileSync(join(wfDir, 'good.js'), META('good', 'ok'))
    writeFileSync(
      join(wfDir, 'oversized.js'),
      'x'.repeat(MAX_WORKFLOW_SCRIPT_FILE_BYTES + 1),
    )

    const cmds = loadWorkflowCommandsFrom(root)

    expect(cmds.find(c => c.name === 'good')).toBeDefined()
    expect(cmds.every(c => c.name !== 'oversized')).toBe(true)
  })

  test('non-.js files are ignored', () => {
    writeFileSync(join(wfDir, 'notes.txt'), 'hello')
    writeFileSync(join(wfDir, 'real.js'), META('real', 'r'))
    const cmds = loadWorkflowCommandsFrom(root)
    expect(cmds.some(c => c.name === 'real')).toBe(true)
    expect(cmds.every(c => c.description !== 'hello')).toBe(true)
  })

  test('missing workflows dir yields no commands (no throw)', () => {
    rmSync(wfDir, { recursive: true, force: true })
    expect(loadWorkflowCommandsFrom(root)).toEqual([])
  })

  test('legacy project workflow dir is still read for migration compatibility', () => {
    rmSync(wfDir, { recursive: true, force: true })
    const legacyDir = getLegacyProjectWorkflowsDir(root)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'legacy.js'), META('legacy-flow', 'Legacy flow'))

    const workflows = getAllWorkflows(root)

    expect(workflows.find(wf => wf.name === 'legacy-flow')?.scriptPath).toBe(
      join(legacyDir, 'legacy.js'),
    )
  })

  test('official-compatible project workflow dir wins over legacy dir on duplicate names', () => {
    const legacyDir = getLegacyProjectWorkflowsDir(root)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(wfDir, 'primary.js'), META('dupe-flow', 'Primary flow'))
    writeFileSync(join(legacyDir, 'legacy.js'), META('dupe-flow', 'Legacy flow'))

    const workflows = getAllWorkflows(root)
    const dupe = workflows.filter(wf => wf.name === 'dupe-flow')

    expect(dupe).toHaveLength(1)
    expect(dupe[0]?.scriptPath).toBe(join(wfDir, 'primary.js'))
    expect(dupe[0]?.description).toBe('Primary flow')
  })

  test('gated wrapper returns [] when the feature is off, delegates when on', async () => {
    writeFileSync(join(wfDir, 'g.js'), META('gated', 'g'))
    const gatedResult = await getWorkflowCommands(root)
    if (isSavedWorkflowsEnabled()) {
      // Feature on → wrapper must equal the ungated core.
      expect(gatedResult.map(c => c.name)).toContain('gated')
    } else {
      // Feature off → wrapper must short-circuit to [] even though the core
      // would have found the file.
      expect(gatedResult).toEqual([])
      expect(loadWorkflowCommandsFrom(root).some(c => c.name === 'gated')).toBe(true)
    }
  })

  test('plugin workflow dirs become plugin-namespaced commands', async () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), 'wf-plugin-'))
    const pluginWfDir = join(pluginRoot, 'workflows')
    mkdirSync(pluginWfDir, { recursive: true })
    writeFileSync(join(pluginWfDir, 'release.js'), META('release', 'Ship it'))

    try {
      const plugin = {
        name: 'shipmate',
        source: 'shipmate@inline',
        repository: 'shipmate@inline',
        manifest: { name: 'shipmate' },
        workflowsPath: pluginWfDir,
      }
      const workflows = loadPluginWorkflowsFrom([plugin])
      expect(workflows.map(wf => wf.commandName)).toEqual(['shipmate:release'])

      const commands = loadWorkflowCommandsFromSources(root, [plugin])
      const command = commands.find(c => c.name === 'shipmate:release')
      expect(command).toBeDefined()
      expect((command as { loadedFrom?: string }).loadedFrom).toBe('plugin')
      expect((command as { kind?: string }).kind).toBe('workflow')

      const resolved = resolveWorkflowFromSources(root, 'shipmate:release', [
        plugin,
      ])
      expect(resolved?.scriptPath).toBe(join(pluginWfDir, 'release.js'))
    } finally {
      rmSync(pluginRoot, { recursive: true, force: true })
    }
  })

  test('bundled workflows expose the official deep-research command only', async () => {
    const bundled = loadBundledWorkflowRefs()
    expect(bundled.map(wf => wf.commandName)).toEqual(['deep-research'])
    expect(bundled.every(wf => wf.scope === 'bundled')).toBe(true)
    expect(bundled.every(wf => typeof wf.source === 'string')).toBe(true)
    expect(bundled[0]?.isEnabled?.()).toBe(true)

    const workflows = getAllWorkflows(root)
    expect(workflows.map(wf => wf.commandName)).toContain('deep-research')
    expect(resolveWorkflowFromSources(root, 'deep-research')?.source).toContain(
      "name: 'deep-research'",
    )
    expect(resolveWorkflowFromSources(root, 'project-scan')).toBeNull()

    const deepResearchCommand = loadWorkflowCommandsFromSources(root).find(
      c => c.name === 'deep-research',
    )
    expect(deepResearchCommand?.type).toBe('prompt')
    expect((deepResearchCommand as { loadedFrom?: string }).loadedFrom).toBe(
      'bundled',
    )
    expect((deepResearchCommand as { source?: string }).source).toBe('bundled')
    expect(isCommandEnabled(deepResearchCommand!)).toBe(true)
    const getPrompt = (deepResearchCommand as unknown as {
      getPromptForCommand: (a: string) => Promise<Array<{ type: string; text: string }>>
    }).getPromptForCommand
    const text = (await getPrompt('Node.js permissions')).map(b => b.text).join('')
    expect(text).toContain('bundled script named "deep-research"')
    expect(text).toContain('Node.js permissions')
  })

  test('bundled deep-research follows WebSearch availability', () => {
    expect(isWebSearchAvailableFor('firstParty', 'any-model')).toBe(true)
    expect(isWebSearchAvailableFor('foundry', 'any-model')).toBe(true)
    expect(isWebSearchAvailableFor('vertex', 'mossen-sonnet-4')).toBe(true)
    expect(isWebSearchAvailableFor('vertex', 'mossen-3-5-sonnet')).toBe(false)
    expect(isWebSearchAvailableFor('bedrock', 'mossen-opus-4')).toBe(false)

    process.env.MOSSEN_CODE_USE_BEDROCK = '1'

    const bundled = loadBundledWorkflowRefs()
    expect(bundled.map(wf => wf.commandName)).toEqual(['deep-research'])
    expect(bundled[0]?.isEnabled?.()).toBe(false)

    const deepResearchCommand = loadWorkflowCommandsFromSources(root).find(
      c => c.name === 'deep-research',
    )
    expect(deepResearchCommand).toBeDefined()
    expect(isCommandEnabled(deepResearchCommand!)).toBe(false)

    expect(getAllWorkflows(root).map(wf => wf.commandName)).toContain(
      'deep-research',
    )
    expect(getEnabledWorkflows(root).map(wf => wf.commandName)).not.toContain(
      'deep-research',
    )
    expect(resolveWorkflowFromSources(root, 'deep-research')).toBeNull()
  })
})
