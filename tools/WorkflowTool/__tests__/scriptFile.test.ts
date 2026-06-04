import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_WORKFLOW_SCRIPT_FILE_BYTES,
  readWorkflowScriptFile,
} from '../scriptFile.js'

describe('readWorkflowScriptFile', () => {
  test('reads a workflow script file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-script-file-'))
    const scriptPath = join(dir, 'workflow.js')
    try {
      writeFileSync(scriptPath, 'export const meta = {}\nreturn 1\n')

      expect(readWorkflowScriptFile(scriptPath)).toContain('return 1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('resolves relative scriptPath from the current working directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-script-file-relative-'))
    const priorCwd = process.cwd()
    try {
      writeFileSync(join(dir, 'workflow.js'), 'return 2\n')
      process.chdir(dir)

      expect(readWorkflowScriptFile('workflow.js')).toBe('return 2\n')
    } finally {
      process.chdir(priorCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects UNC scriptPath before touching the filesystem', () => {
    expect(() => readWorkflowScriptFile('//server/share/workflow.js')).toThrow(
      'UNC paths are not allowed for workflow scriptPath: //server/share/workflow.js',
    )
    expect(() =>
      readWorkflowScriptFile('\\\\server\\share\\workflow.js'),
    ).toThrow(
      'UNC paths are not allowed for workflow scriptPath: \\\\server\\share\\workflow.js',
    )
  })

  test('reports a missing workflow script file with the official message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-script-file-missing-'))
    const scriptPath = join(dir, 'missing.js')
    try {
      expect(() => readWorkflowScriptFile(scriptPath)).toThrow(
        `Workflow script file not found: ${scriptPath}`,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects workflow script files larger than the official byte ceiling', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-script-file-large-'))
    const scriptPath = join(dir, 'large.js')
    try {
      writeFileSync(scriptPath, 'x'.repeat(MAX_WORKFLOW_SCRIPT_FILE_BYTES + 1))

      expect(() => readWorkflowScriptFile(scriptPath)).toThrow(
        `Workflow script file ${scriptPath} exceeds ${MAX_WORKFLOW_SCRIPT_FILE_BYTES} bytes`,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
