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
  inferWorkflowArgsValue,
  LEGACY_PROJECT_WORKFLOWS_SUBDIR,
  PROJECT_WORKFLOWS_SUBDIR,
  WORKFLOW_HOME_ENV,
} from '../savedWorkflows.js'
import { MAX_WORKFLOW_SCRIPT_FILE_BYTES } from '../scriptFile.js'
import { extractMeta } from '../engine/meta.js'
import { runSandbox, checkWorkflowScriptSyntax } from '../engine/sandbox.js'
import { createLimiter } from '../engine/concurrency.js'
import { createBudget } from '../engine/budget.js'
import { createJournal } from '../engine/journal.js'
import {
  createWorkflowRuntime,
  type RunOneAgent,
} from '../engine/runtime.js'
import { WORKFLOW_TOOL_NAME } from '../constants.js'
import type { WorkflowProgressEvent } from '../engine/types.js'

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

async function runBundledWorkflowForTest(
  source: string,
  args: unknown,
  runOneAgent: RunOneAgent,
): Promise<{ result: unknown; events: WorkflowProgressEvent[] }> {
  const events: WorkflowProgressEvent[] = []
  const runtime = createWorkflowRuntime({
    limiter: createLimiter(8),
    budget: createBudget(null),
    progress: event => events.push(event),
    args,
    runOneAgent,
    journal: createJournal('bundled-test-run'),
  })
  const { scriptBody } = extractMeta(source)
  const result = await runSandbox({
    source: scriptBody,
    scope: runtime.scope,
    timeoutMs: 5000,
  })
  return { result, events }
}

describe('savedWorkflows loader (S3)', () => {
  let root: string
  let wfDir: string
  let previousWorkflowHome: string | undefined

  beforeEach(() => {
    previousWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    previousWebSearchEnv = {}
    for (const key of WEB_SEARCH_ENV_KEYS) {
      previousWebSearchEnv[key] = process.env[key]
    }
    clearWebSearchProviderEnv()
    root = mkdtempSync(join(tmpdir(), 'wf-saved-'))
    process.env[WORKFLOW_HOME_ENV] = join(root, 'home')
    wfDir = getProjectWorkflowsDir(root)
    mkdirSync(wfDir, { recursive: true })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    restoreWebSearchProviderEnv()
    if (previousWorkflowHome === undefined) {
      delete process.env[WORKFLOW_HOME_ENV]
    } else {
      process.env[WORKFLOW_HOME_ENV] = previousWorkflowHome
    }
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

  test('getPromptForCommand builds exact Workflow input by name with structured args', async () => {
    writeFileSync(join(wfDir, 'audit.js'), META('audit', 'Audit code'))
    const cmds = loadWorkflowCommandsFrom(root)
    const cmd = cmds.find(c => c.name === 'audit')
    expect(cmd?.type).toBe('prompt')
    expect((cmd as { allowedTools?: string[] }).allowedTools).toEqual([
      WORKFLOW_TOOL_NAME,
    ])
    const getPrompt = (cmd as unknown as {
      getPromptForCommand: (a: string) => Promise<Array<{ type: string; text: string }>>
    }).getPromptForCommand
    const blocks = await getPrompt('issues 1024, 1025, and 1030')
    const text = blocks.map(b => b.text).join('')
    expect(text).toContain('Workflow tool exactly once')
    expect(text).toContain('"name": "audit"')
    expect(text).toContain('"args": [\n    1024,\n    1025,\n    1030\n  ]')
    expect(text).toContain('Inferred structured Workflow.args literal:')
    expect(text).toContain('[1024,1025,1030]')
    expect(text).toContain('real arrays, objects, numbers, booleans, or null')
    expect(text).toContain('do not JSON-encode')
    expect(text).toContain('issues 1024, 1025, and 1030')
    expect(text).not.toContain('scriptPath=')
  })

  test('inferWorkflowArgsValue preserves common structured saved-workflow inputs', () => {
    expect(inferWorkflowArgsValue('issues 1024, 1025, and 1030')).toEqual([
      1024,
      1025,
      1030,
    ])
    expect(inferWorkflowArgsValue('target=src/routes includeTests=true')).toEqual({
      target: 'src/routes',
      includeTests: true,
    })
    expect(inferWorkflowArgsValue('["src/routes","src/api"]')).toEqual([
      'src/routes',
      'src/api',
    ])
    expect(inferWorkflowArgsValue('src/routes,src/api')).toEqual([
      'src/routes',
      'src/api',
    ])
    expect(inferWorkflowArgsValue('42')).toBe(42)
    expect(inferWorkflowArgsValue('research Node.js permissions')).toBe(
      'research Node.js permissions',
    )
    expect(inferWorkflowArgsValue('   ')).toBeUndefined()
  })

  test('getPromptForCommand omits args when caller provided no input', async () => {
    writeFileSync(join(wfDir, 'noargs.js'), META('noargs', 'No args flow'))
    const cmd = loadWorkflowCommandsFrom(root).find(c => c.name === 'noargs')
    expect(cmd?.type).toBe('prompt')
    const getPrompt = (cmd as unknown as {
      getPromptForCommand: (a: string) => Promise<Array<{ type: string; text: string }>>
    }).getPromptForCommand
    const text = (await getPrompt('   ')).map(b => b.text).join('')

    expect(text).toContain('"name": "noargs"')
    expect(text).not.toContain('"args"')
    expect(text).toContain('omit the args field')
    expect(text).toContain('args as undefined')
    expect(text).not.toContain('Caller arguments:')
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

  test('project workflows win over user workflows with the same command name', () => {
    const userDir = getUserWorkflowsDir()
    mkdirSync(userDir, { recursive: true })

    const projectPath = join(wfDir, 'project-shared.js')
    const userPath = join(userDir, 'user-shared.js')
    writeFileSync(projectPath, META('shared-flow', 'Project flow'))
    writeFileSync(userPath, META('shared-flow', 'User flow'))

    const workflows = getAllWorkflows(root).filter(
      wf => wf.commandName === 'shared-flow',
    )
    expect(workflows).toHaveLength(1)
    expect(workflows[0]?.scope).toBe('project')
    expect(workflows[0]?.scriptPath).toBe(projectPath)
    expect(workflows[0]?.description).toBe('Project flow')

    const commands = loadWorkflowCommandsFromSources(root).filter(
      c => c.name === 'shared-flow',
    )
    expect(commands).toHaveLength(1)
    expect((commands[0] as { source?: string }).source).toBe(
      'projectSettings',
    )

    expect(resolveWorkflowFromSources(root, 'shared-flow')?.scriptPath).toBe(
      projectPath,
    )
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
	    const deepResearchSource =
	      resolveWorkflowFromSources(root, 'deep-research')?.source ?? ''
	    expect(deepResearchSource).toContain("name: 'deep-research'")
	    expect(deepResearchSource).toContain('CLAIM_VOTE_SCHEMA')
	    expect(deepResearchSource).toContain('Vote claim ')
	    expect(deepResearchSource).toContain('supportedVotes.length >= 2')
	    expect(deepResearchSource).toContain(
	      'exclude claims that did not pass majority support',
	    )
	    const parsed = extractMeta(deepResearchSource)
	    expect(parsed.meta.phases?.map(phase => phase.title)).toContain(
	      'Cross-check claims',
	    )
	    expect(checkWorkflowScriptSyntax(parsed.scriptBody)).toEqual({ ok: true })
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
    expect(text).toContain('"name": "deep-research"')
    expect(text).toContain('"args": "Node.js permissions"')
    expect(text).toContain('Node.js permissions')
  })

  test('bundled deep-research executes claim voting and filters weak claims', async () => {
    const deepResearchSource =
      loadBundledWorkflowRefs().find(wf => wf.name === 'deep-research')?.source ??
      ''
    const synthPrompts: string[] = []
    const runOneAgent: RunOneAgent = async (prompt, opts) => {
      const label = opts.label ?? ''
      if (label === 'Plan research angles') {
        return {
          value: {
            angles: [
              {
                name: 'Official docs',
                query: 'workflow official docs',
                purpose: 'Find the canonical behavior.',
              },
              {
                name: 'Release notes',
                query: 'workflow release notes',
                purpose: 'Check recent behavior.',
              },
              {
                name: 'Implementation notes',
                query: 'workflow implementation notes',
                purpose: 'Check runtime details.',
              },
            ],
          },
          tokens: 10,
          ok: true,
        }
      }
      if (label.startsWith('Search: ')) {
        const suffix = label.replace(/^Search: /, '').toLowerCase().replace(/\s+/g, '-')
        return {
          value: {
            results: [
              {
                title: `${label} source`,
                url: `https://example.test/${suffix}`,
                snippet: `Snippet for ${label}`,
                whyUseful: 'Authoritative source for this angle.',
              },
            ],
          },
          tokens: 8,
          ok: true,
        }
      }
      if (label.startsWith('Read: ')) {
        return {
          value: {
            sources: [
              {
                title: label.replace(/^Read: /, ''),
                url: prompt.match(/URL: (\S+)/)?.[1] ?? 'https://example.test/source',
                summary: 'Source summary',
                claims: [
                  'Supported claim: workflows cache completed agents on resume.',
                  'Weak claim: workflows require manual JSON parsing for args.',
                ],
              },
            ],
          },
          tokens: 8,
          ok: true,
        }
      }
      if (label.startsWith('Vote claim ')) {
        const claim = prompt.match(/\nClaim: ([^\n]+)/)?.[1] ?? ''
        const weak = claim.startsWith('Weak claim:')
        return {
          value: {
            supported: !weak,
            citations: weak ? [] : ['https://example.test/official-docs'],
            reason: weak ? 'Not supported by the notes.' : 'Directly supported.',
          },
          tokens: 3,
          ok: true,
        }
      }
      if (label === 'Find claim conflicts') {
        return {
          value: { conflicts: [] },
          tokens: 3,
          ok: true,
        }
      }
      if (label === 'Synthesize cited report') {
        synthPrompts.push(prompt)
        return {
          value:
            'Supported claim: workflows cache completed agents on resume. https://example.test/official-docs',
          tokens: 7,
          ok: true,
        }
      }
      throw new Error(`unexpected bundled agent label: ${label}`)
    }

    const { result, events } = await runBundledWorkflowForTest(
      deepResearchSource,
      'How do workflow resumes behave?',
      runOneAgent,
    )
    const out = result as {
      verification: {
        supportedClaims: Array<{ claim: string; citations: string[] }>
        weakClaims: Array<{ claim: string }>
      }
      report: string
    }

    expect(
      events
        .filter(
          (event): event is Extract<WorkflowProgressEvent, { kind: 'phase' }> =>
            event.kind === 'phase',
        )
        .map(event => event.title),
    ).toEqual([
      'Plan searches',
      'Search web',
      'Read sources',
      'Cross-check claims',
      'Synthesize report',
    ])
    expect(out.verification.supportedClaims.map(item => item.claim)).toEqual([
      'Supported claim: workflows cache completed agents on resume.',
    ])
    expect(out.verification.supportedClaims[0]?.citations).toEqual([
      'https://example.test/official-docs',
    ])
    expect(out.verification.weakClaims.map(item => item.claim)).toEqual([
      'Weak claim: workflows require manual JSON parsing for args.',
    ])
    expect(out.report).toContain('https://example.test/official-docs')
    expect(synthPrompts[0]).toContain(
      'exclude claims that did not pass majority support',
    )
  })

  test('project workflows win over bundled workflows with the same command name', () => {
    const projectPath = join(wfDir, 'project-deep-research.js')
    writeFileSync(
      projectPath,
      META('deep-research', 'Project-specific research flow'),
    )

    const workflows = getAllWorkflows(root).filter(
      wf => wf.commandName === 'deep-research',
    )
    expect(workflows).toHaveLength(1)
    expect(workflows[0]?.scope).toBe('project')
    expect(workflows[0]?.description).toBe('Project-specific research flow')
    expect(workflows[0]?.scriptPath).toBe(projectPath)

    const commands = loadWorkflowCommandsFromSources(root).filter(
      c => c.name === 'deep-research',
    )
    expect(commands).toHaveLength(1)
    expect((commands[0] as { source?: string }).source).toBe('projectSettings')

    expect(resolveWorkflowFromSources(root, 'deep-research')?.scriptPath).toBe(
      projectPath,
    )
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
