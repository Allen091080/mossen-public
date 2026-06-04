import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getProjectWorkflowsDir,
  isSavedWorkflowsEnabled,
  loadWorkflowCommandsFrom,
  resolveSavedWorkflow,
  getWorkflowCommands,
  PROJECT_WORKFLOWS_SUBDIR,
} from '../savedWorkflows.js'

// Tests target loadWorkflowCommandsFrom (the UNGATED core) so the disk-read +
// meta-parse contract is asserted for real regardless of the WORKFLOW_SCRIPTS
// build flag. The gated production wrapper getWorkflowCommands is covered by a
// separate gate-behavior test below.

const META = (name: string, desc: string) =>
  `export const meta = { name: '${name}', description: '${desc}' }\nreturn 1\n`

describe('savedWorkflows loader (S3)', () => {
  let root: string
  let wfDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wf-saved-'))
    wfDir = getProjectWorkflowsDir(root)
    mkdirSync(wfDir, { recursive: true })
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('dir layout constant points at .mossen/workflows', () => {
    expect(PROJECT_WORKFLOWS_SUBDIR).toBe(join('.mossen', 'workflows'))
    expect(getProjectWorkflowsDir('/x')).toBe(join('/x', '.mossen', 'workflows'))
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

  test('gated wrapper returns [] when the feature is off, delegates when on', () => {
    writeFileSync(join(wfDir, 'g.js'), META('gated', 'g'))
    const gatedResult = getWorkflowCommands(root)
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
})
