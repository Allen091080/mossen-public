import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement } from 'react'
import {
  getProjectRoot,
  getSessionId,
  getSessionProjectDir,
  setProjectRoot,
  switchSession,
} from '../../../bootstrap/state.js'
import { getTaskOutputPath } from '../../../utils/task/diskOutput.js'
import { buildWorkflowResumeNextInput, call } from '../workflows.js'
import {
  buildWorkflowTemplate,
  createWorkflowCommand,
} from '../createWorkflow.js'
import {
  buildWorkflowDraft,
  draftWorkflowCommand,
} from '../draftWorkflow.js'
import { explainWorkflowCommand } from '../explainWorkflow.js'
import { registryWorkflowCommand } from '../registryWorkflow.js'
import { testWorkflowCommand } from '../testWorkflow.js'
import { deriveWorkflowSaveName, saveRun } from '../saveWorkflow.js'
import {
  validateWorkflowTargetsForCommand,
  validateWorkflowsCommand,
} from '../validateWorkflow.js'
import { validateWorkflowAssetSource } from '../../../tools/WorkflowTool/workflowAsset.js'
import {
  canRestartWorkflowAgentStatus,
  canStopWorkflowAgentStatus,
  recentToolCallLines,
  shouldRouteWorkflowAgentControl,
  shouldShowRunLevelAgents,
  sumAgentElapsedMs,
  toggleWorkflowSaveScope,
  workflowAgentBackTarget,
  workflowLiveRunListMetricSummary,
  workflowRunOpenTarget,
  workflowSaveOpenTarget,
  workflowSaveRunArgs,
  workflowInputGuideText,
  workflowSelectedActionHint,
} from '../WorkflowRunsDialog.js'
import {
  appendJournalEntry,
  appendJournalStartedEntry,
  clearActiveWorkflowRunsForTests,
  initRunArtifacts,
  loadRunMeta,
  runScriptPath,
  STALE_RUNNING_WORKFLOW_MESSAGE,
  workflowReportPath,
} from '../../../tools/WorkflowTool/engine/journalStore.js'
import {
  clearAgentTranscriptSubdir,
  flushSessionStorage,
  getAgentTranscriptPath,
  getProjectDir,
  loadTranscriptFile,
  recordSidechainTranscript,
  resetProjectForTesting,
  setAgentTranscriptSubdir,
} from '../../../utils/sessionStorage.js'
import { asAgentId } from '../../../types/ids.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import { exportWorkflowRunReport } from '../exportWorkflowReport.js'
import { buildWorkbenchWorkflowSnapshot } from '../workbenchSnapshot.js'
import { workbenchActionReceiptsPath } from '../workbenchActionReceipts.js'
import {
  getProjectWorkflowsDir,
  getUserWorkflowsDir,
  loadWorkflowCommandsFrom,
  WORKFLOW_HOME_ENV,
} from '../../../tools/WorkflowTool/savedWorkflows.js'
import type { LocalWorkflowTaskState } from '../../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

function workflowCommandContext(state: { tasks: Record<string, unknown> }) {
  const setAppState = (updater: (prev: typeof state) => typeof state) => {
    Object.assign(state, updater(state))
  }
  return {
    getAppState: () => state,
    setAppState,
    setAppStateForTasks: setAppState,
  }
}

function runningWorkflowTask(params: {
  taskId: string
  runId: string
  abortController?: AbortController
}): LocalWorkflowTaskState {
  const { taskId, runId, abortController = new AbortController() } = params
  return {
    id: taskId,
    type: 'local_workflow',
    status: 'running',
    description: 'demo workflow',
    startTime: Date.now(),
    outputFile: getTaskOutputPath(taskId),
    outputOffset: 0,
    notified: false,
    runId,
    workflowRunId: runId,
    workflowName: 'demo',
    scriptPath: `/tmp/workflows/${runId}/script.js`,
    summary: 'demo',
    currentPhase: 'Scan',
    abortController,
    agentCount: 2,
    totalToolCalls: 3,
    tokensSpent: 55,
    phases: ['Scan', 'Write'],
    phaseDefinitions: [
      { title: 'Scan', detail: 'Map the repo' },
      { title: 'Write', detail: 'Prepare changes' },
    ],
    workflowProgress: [],
    progressVersion: 0,
    agents: [
      {
        agentNumber: 1,
        label: 'Scan routes',
        phase: 'Scan',
        status: 'running',
        tokens: 25,
        toolCalls: 1,
        startedAt: Date.now() - 2000,
        promptPreview: 'Inspect workflow routing and report the important files.',
        lastToolName: 'Read',
        lastToolSummary: 'commands/workflows/workflows.tsx',
        recentToolCalls: [
          { name: 'Glob', summary: 'commands/workflows/*.tsx' },
          { name: 'Read', summary: 'commands/workflows/workflows.tsx' },
        ],
        resultPreview: 'Found the command detail renderer.',
      },
      {
        agentNumber: 2,
        label: 'Review findings',
        phase: 'Write',
        status: 'completed',
        tokens: 30,
        toolCalls: 2,
        durationMs: 5000,
      },
    ],
    log: ['phase: Scan', 'agent #1 progress: Scan routes (Read workflows.tsx)'],
    logs: ['phase: Scan', 'agent #1 progress: Scan routes (Read workflows.tsx)'],
    isBackgrounded: true,
    paused: false,
  }
}

describe('/workflows resume', () => {
  test('derives a command-safe name for save dialog and save command', () => {
    expect(
      deriveWorkflowSaveName({
        runId: 'wf_fallback',
        metaName: 'Audit routes + handlers',
      }),
    ).toBe('Audit-routes-handlers')
    expect(
      deriveWorkflowSaveName({
        runId: 'wf_fallback',
        explicit: '  release/checklist  ',
      }),
    ).toBe('release-checklist')
  })

  test('save writes the selected slash command name into workflow meta', () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-save-command-name-'))
    const sessionId =
      '33333333-3333-4333-8333-333333333333' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'home')
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_save_command'
      initRunArtifacts(
        runId,
        `
export const meta = { name: 'generated-flow', description: 'Generated flow' }
return 'ok'
`,
        {
          runId,
          workflowName: 'generated-flow',
          description: 'Generated flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )

      const message = saveRun([runId, 'explicit-flow'])
      const savedPath = join(getProjectWorkflowsDir(root), 'explicit-flow.js')

      expect(message).toContain('/explicit-flow')
      expect(readFileSync(savedPath, 'utf8')).toContain('name: "explicit-flow"')
      expect(loadWorkflowCommandsFrom(root).map(command => command.name)).toContain(
        'explicit-flow',
      )
      expect(loadWorkflowCommandsFrom(root).map(command => command.name)).not.toContain(
        'generated-flow',
      )
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('save dialog maps project/user scopes and user save uses run metadata name', () => {
    const saveView = workflowSaveOpenTarget('wf_scope_save', {
      mode: 'run',
      runId: 'wf_active',
    })
    expect(saveView).toEqual({
      mode: 'save',
      runId: 'wf_scope_save',
      scope: 'project',
      previous: { mode: 'run', runId: 'wf_active' },
    })
    expect(
      workflowSaveOpenTarget('wf_scope_save_again', {
        ...saveView,
        scope: 'user',
      }),
    ).toEqual({
      mode: 'save',
      runId: 'wf_scope_save_again',
      scope: 'project',
      previous: { mode: 'run', runId: 'wf_active' },
    })
    expect(toggleWorkflowSaveScope('project')).toBe('user')
    expect(toggleWorkflowSaveScope('user')).toBe('project')
    expect(workflowSaveRunArgs('wf_scope_save', 'project')).toEqual([
      'wf_scope_save',
    ])
    expect(workflowSaveRunArgs('wf_scope_save', 'user')).toEqual([
      'wf_scope_save',
      '--user',
    ])

    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-save-user-scope-'))
    const sessionId =
      '66666666-6666-4666-8666-666666666666' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'home')
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_user_scope_save'
      initRunArtifacts(
        runId,
        `
export const meta = { name: 'draft-name', description: 'Generated flow' }
return 'ok'
`,
        {
          runId,
          workflowName: 'Team audit flow',
          description: 'Generated flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )

      const message = saveRun(workflowSaveRunArgs(runId, 'user'))
      const savedPath = join(getUserWorkflowsDir(), 'Team-audit-flow.js')

      expect(message).toContain('/Team-audit-flow')
      expect(message).toContain('user')
      expect(readFileSync(savedPath, 'utf8')).toContain(
        'name: "Team-audit-flow"',
      )
      expect(loadWorkflowCommandsFrom(root).map(command => command.name)).toContain(
        'Team-audit-flow',
      )
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('validate reports strict contract failures for a workflow script path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wf-validate-path-'))
    try {
      const scriptPath = join(root, 'legacy.js')
      writeFileSync(
        scriptPath,
        "export const meta = { name: 'legacy-flow', description: 'Legacy flow' }\nreturn 1\n",
        'utf8',
      )

      const message = await validateWorkflowsCommand([scriptPath, '--strict'])

      expect(message).toContain('Workflow validation failed: 1 checked')
      expect(message).toContain('[FAIL] legacy-flow')
      expect(message).toContain('missing-phases')
      expect(message).toContain('missing-bounded-budgets')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('validate scans project workflow files including malformed assets', () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-validate-project-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      const workflowsDir = getProjectWorkflowsDir(root)
      mkdirSync(workflowsDir, { recursive: true })
      writeFileSync(
        join(workflowsDir, 'bounded.js'),
        `export const meta = {
          name: 'bounded-flow',
          description: 'Bounded flow',
          budgets: {
            timeoutMs: 1000,
            phaseTimeoutMs: 500,
            maxAgents: 1,
            maxParallel: 1,
            maxNestedWorkflows: 0,
          },
          phases: [{ title: 'Check' }],
        }
        return 1
        `,
        'utf8',
      )
      writeFileSync(
        join(workflowsDir, 'broken.js'),
        "const meta = { name: 'broken-flow', description: 'Broken flow' }\nreturn 1\n",
        'utf8',
      )

      const results = validateWorkflowTargetsForCommand(['project', '--strict'])
      const message = results.length
        ? results.map(result => result.issues.map(issue => issue.code).join(',')).join('\n')
        : ''

      expect(results).toHaveLength(2)
      expect(results.some(result => result.ok)).toBe(true)
      expect(results.some(result => !result.ok)).toBe(true)
      expect(message).toContain('invalid-meta')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('/workflows validate routes through the command entry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wf-validate-command-'))
    try {
      const scriptPath = join(root, 'simple.js')
      writeFileSync(
        scriptPath,
        "export const meta = { name: 'simple-flow', description: 'Simple flow' }\nreturn 1\n",
        'utf8',
      )
      let message = ''

      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        `validate ${scriptPath}`,
      )

      expect(message).toContain('Workflow validation passed: 1 checked')
      expect(message).toContain('[WARN] simple-flow')
      expect(message).toContain('legacy-missing-phases')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('create builds a strict workflow asset template', () => {
    const source = buildWorkflowTemplate('created-flow')
    const validation = validateWorkflowAssetSource(source, {
      scope: 'project',
      requireBoundedBudgets: true,
      requirePhases: true,
    })

    expect(validation.ok).toBe(true)
    expect(validation.asset).toMatchObject({
      name: 'created-flow',
      budgets: {
        timeoutMs: 600000,
        phaseTimeoutMs: 120000,
        maxAgents: 3,
        maxParallel: 2,
        maxNestedWorkflows: 0,
      },
      allowedTools: ['Read', 'Grep', 'Glob'],
      allowedRoots: ['.'],
      evidence: {
        finalReport: true,
        processClean: true,
      },
      lifecycle: {
        version: '0.1.0',
        owner: 'project',
        status: 'draft',
      },
    })
    expect(source).toContain('evaluationPrompt')
    expect(source).toContain('workflow-template-completed')
  })

  test('create writes a project workflow and refuses accidental overwrite', () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-create-project-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)

      const created = createWorkflowCommand(['Release checklist'])
      const duplicate = createWorkflowCommand(['Release-checklist'])
      const forced = createWorkflowCommand(['Release-checklist', '--force'])
      const savedPath = join(
        getProjectWorkflowsDir(root),
        'Release-checklist.js',
      )

      expect(created.ok).toBe(true)
      expect(created.name).toBe('Release-checklist')
      expect(created.path).toBe(savedPath)
      expect(readFileSync(savedPath, 'utf8')).toContain(
        'name: "Release-checklist"',
      )
      expect(duplicate.ok).toBe(false)
      expect(duplicate.message).toContain('already exists')
      expect(forced.ok).toBe(true)
      expect(
        validateWorkflowTargetsForCommand(['Release-checklist', '--strict']),
      ).toHaveLength(1)
      expect(
        validateWorkflowTargetsForCommand(['Release-checklist', '--strict'])[0]?.ok,
      ).toBe(true)
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('/workflows create routes through the command entry', async () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-create-command-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      let message = ''

      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        'create route created flow',
      )

      expect(message).toContain('Created workflow "route-created-flow"')
      expect(message).toContain('/route-created-flow task=...')
      expect(
        readFileSync(
          join(getProjectWorkflowsDir(root), 'route-created-flow.js'),
          'utf8',
        ),
      ).toContain('workflow-template-completed')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('draft previews a strict goal workflow without writing it', () => {
    const priorRoot = getProjectRoot()
    const root = mkdtempSync(join(tmpdir(), 'wf-draft-preview-'))
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    try {
      setProjectRoot(root)
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')

      const result = draftWorkflowCommand([
        'Audit',
        'release',
        'readiness',
        '--name',
        'release-readiness-draft',
      ])

      expect(result.ok).toBe(true)
      expect(result.written).toBe(false)
      expect(result.name).toBe('release-readiness-draft')
      expect(result.path).toBe(
        join(getProjectWorkflowsDir(root), 'release-readiness-draft.js'),
      )
      expect(result.source).toContain('const PLAN_SCHEMA')
      expect(result.message).toContain('Workflow draft ready for review')
      expect(result.message).toContain('no file was written and no run was queued')
      expect(result.message).toContain('/workflows validate release-readiness-draft --strict')
      expect(existsSync(result.path!)).toBe(false)

      const validation = validateWorkflowAssetSource(result.source!, {
        scope: 'project',
        requireBoundedBudgets: true,
        requirePhases: true,
      })
      expect(validation.ok).toBe(true)
      expect(validation.asset?.lifecycle?.status).toBe('draft')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('draft writes only after explicit review approval', () => {
    const priorRoot = getProjectRoot()
    const root = mkdtempSync(join(tmpdir(), 'wf-draft-write-'))
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    try {
      setProjectRoot(root)
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')

      const preview = draftWorkflowCommand([
        'Prepare',
        'migration',
        'plan',
        '--name',
        'migration-plan-draft',
      ])
      const written = draftWorkflowCommand([
        'Prepare',
        'migration',
        'plan',
        '--name',
        'migration-plan-draft',
        '--write',
      ])
      const duplicate = draftWorkflowCommand([
        'Prepare',
        'migration',
        'plan',
        '--name',
        'migration-plan-draft',
        '--write',
      ])

      expect(preview.written).toBe(false)
      expect(written.ok).toBe(true)
      expect(written.written).toBe(true)
      expect(written.path).toBe(
        join(getProjectWorkflowsDir(root), 'migration-plan-draft.js'),
      )
      const writtenSource = readFileSync(written.path!, 'utf8')
      expect(writtenSource).toContain('"name": "migration-plan-draft"')
      expect(writtenSource).toContain('/workflows validate migration-plan-draft --strict')
      expect(written.message).toContain('No run was queued by draft generation')
      expect(duplicate.ok).toBe(false)
      expect(duplicate.message).toContain('Use --force to overwrite')

      const results = validateWorkflowTargetsForCommand([
        'migration-plan-draft',
        '--strict',
      ])
      expect(results).toHaveLength(1)
      expect(results[0]?.ok).toBe(true)
      expect(testWorkflowCommand(['migration-plan-draft']).ok).toBe(true)
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('draft blocks invalid generated workflow before write or run', () => {
    const priorRoot = getProjectRoot()
    const root = mkdtempSync(join(tmpdir(), 'wf-draft-invalid-'))
    try {
      setProjectRoot(root)
      const result = buildWorkflowDraft(
        ['Invalid', 'goal', '--name', 'invalid-draft', '--write'],
        {
          buildScript: () =>
            "export const meta = { name: 'invalid-draft', description: 'Invalid draft' }\nreturn 1\n",
        },
      )

      expect(result.ok).toBe(false)
      expect(result.message).toContain('Workflow draft blocked before write')
      expect(result.message).toContain('missing-phases')
      expect(result.message).toContain('No file was written and no run was queued')
      expect(
        existsSync(join(getProjectWorkflowsDir(root), 'invalid-draft.js')),
      ).toBe(false)
    } finally {
      setProjectRoot(priorRoot)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('/workflows draft routes through the command entry', async () => {
    const priorRoot = getProjectRoot()
    const root = mkdtempSync(join(tmpdir(), 'wf-draft-route-'))
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    try {
      setProjectRoot(root)
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      const done: Array<{ message: string; options?: unknown }> = []
      const node = await call(
        (message, options) => done.push({ message, options }),
        workflowCommandContext({ tasks: {} }) as never,
        'draft Verify release evidence --name route-draft --write',
      )

      expect(node).toBeNull()
      expect(done[0]?.message).toContain('Workflow draft written: route-draft')
      expect(done[0]?.message).not.toContain('queuing')
      expect(done[0]?.options).toEqual({ display: 'system' })
      expect(
        existsSync(join(getProjectWorkflowsDir(root), 'route-draft.js')),
      ).toBe(true)
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('explain renders asset contract summary for a generated workflow', () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-explain-created-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      createWorkflowCommand(['explain-created-flow'])

      const message = explainWorkflowCommand(['explain-created-flow', '--strict'])

      expect(message).toContain('Workflow: explain-created-flow')
      expect(message).toContain('Arguments:')
      expect(message).toContain('Budgets:')
      expect(message).toContain('allowedTools: Read, Grep, Glob')
      expect(message).toContain('Lifecycle:')
      expect(message).toContain('status: draft')
      expect(message).toContain('Phases:')
      expect(message).toContain('Evidence expectations:')
      expect(message).toContain('Validation: PASS')
      expect(message).toContain('Run: /explain-created-flow task=...')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('explain surfaces strict validation issues for legacy assets', () => {
    const root = mkdtempSync(join(tmpdir(), 'wf-explain-legacy-'))
    try {
      const scriptPath = join(root, 'legacy.js')
      writeFileSync(
        scriptPath,
        "export const meta = { name: 'legacy-explain', description: 'Legacy explain' }\nreturn 1\n",
        'utf8',
      )

      const message = explainWorkflowCommand([scriptPath, '--strict'])

      expect(message).toContain('Workflow: legacy-explain')
      expect(message).toContain('Validation: FAIL')
      expect(message).toContain('missing-phases')
      expect(message).toContain('missing-bounded-budgets')
      expect(message).toContain(`Source: scriptPath ${scriptPath}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('/workflows explain routes through the command entry', async () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-explain-command-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      createWorkflowCommand(['route-explain-flow'])
      let message = ''

      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        'explain route-explain-flow --strict',
      )

      expect(message).toContain('Workflow: route-explain-flow')
      expect(message).toContain('Validate: /workflows validate route-explain-flow --strict')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('registry lists lifecycle state for project workflow assets', () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-registry-command-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      createWorkflowCommand(['registry-draft-flow'])
      const workflowsDir = getProjectWorkflowsDir(root)
      writeFileSync(
        join(workflowsDir, 'registry-tested-flow.js'),
        `export const meta = {
          name: 'registry-tested-flow',
          description: 'Registry tested flow',
          budgets: {
            timeoutMs: 1000,
            phaseTimeoutMs: 500,
            maxAgents: 1,
            maxParallel: 1,
            maxNestedWorkflows: 0,
          },
          lifecycle: {
            version: '1.0.0',
            owner: 'qa',
            status: 'tested',
            lastTestedAt: '2026-07-06T00:00:00.000Z',
            lastTestArtifact: '/tmp/mossen-harness/registry/artifacts/assertions.json',
          },
          phases: [{ title: 'Check' }],
        }
        return 1
        `,
        'utf8',
      )

      const message = registryWorkflowCommand(['--strict'])

      expect(message).toContain('Workflow registry:')
      expect(message).toContain('[PASS] registry-draft-flow')
      expect(message).toContain('status=draft')
      expect(message).toContain('[PASS] registry-tested-flow')
      expect(message).toContain('status=tested')
      expect(message).toContain(
        'lastTestArtifact=/tmp/mossen-harness/registry/artifacts/assertions.json',
      )
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('/workflows registry routes through the command entry', async () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-registry-route-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      createWorkflowCommand(['route-registry-flow'])
      let message = ''

      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        'registry --strict',
      )

      expect(message).toContain('Workflow registry:')
      expect(message).toContain('route-registry-flow')
      expect(message).toContain('status=draft')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('test validates a generated workflow and prints a runnable dry-run command', () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-test-created-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      createWorkflowCommand(['test-created-flow'])

      const result = testWorkflowCommand(['test-created-flow', 'task=check'])

      expect(result.ok).toBe(true)
      expect(result.nextInput).toBeUndefined()
      expect(result.message).toContain('Workflow test ready: test-created-flow')
      expect(result.message).toContain('Validation: PASS (strict')
      expect(result.message).toContain(
        '/test-created-flow {"task":"check"}',
      )
      expect(result.message).toContain('Mode: dry-run')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('test blocks strict legacy assets instead of queueing placebo runs', () => {
    const root = mkdtempSync(join(tmpdir(), 'wf-test-legacy-'))
    try {
      const scriptPath = join(root, 'legacy.js')
      writeFileSync(
        scriptPath,
        "export const meta = { name: 'legacy-test', description: 'Legacy test' }\nreturn 1\n",
        'utf8',
      )

      const result = testWorkflowCommand([scriptPath, '--run'])

      expect(result.ok).toBe(false)
      expect(result.nextInput).toBeUndefined()
      expect(result.message).toContain('Workflow test blocked: legacy-test')
      expect(result.message).toContain('Validation: FAIL (strict')
      expect(result.message).toContain('missing-phases')
      expect(result.message).toContain('No test command was queued')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('test can queue a scriptPath workflow in legacy-compatible mode', () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-test-script-path-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      const created = createWorkflowCommand(['script-path-test-flow'])
      expect(created.path).toBeTruthy()

      const result = testWorkflowCommand([
        created.path!,
        'ticket=42',
        '--legacy-compatible',
        '--run',
      ])

      expect(result.ok).toBe(true)
      expect(result.submitNextInput).toBe(true)
      expect(result.nextInput).toContain('Workflow({scriptPath:')
      expect(result.nextInput).toContain(created.path)
      expect(result.nextInput).toContain('args: {"ticket":42}')
      expect(result.message).toContain('Validation: PASS (legacy-compatible')
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('/workflows test --run routes and queues the generated direct command', async () => {
    const priorRoot = getProjectRoot()
    const priorWorkflowHome = process.env[WORKFLOW_HOME_ENV]
    const root = mkdtempSync(join(tmpdir(), 'wf-test-command-'))
    try {
      process.env[WORKFLOW_HOME_ENV] = join(root, 'workflow-home')
      setProjectRoot(root)
      createWorkflowCommand(['route-test-flow'])
      let message = ''
      let nextInput = ''
      let submitNextInput = false

      await call(
        (nextMessage, options) => {
          message = nextMessage
          nextInput = options?.nextInput ?? ''
          submitNextInput = options?.submitNextInput ?? false
        },
        workflowCommandContext({ tasks: {} }) as never,
        'test route-test-flow task=route --run',
      )

      expect(message).toContain('Workflow test ready: route-test-flow')
      expect(nextInput).toBe('/route-test-flow {"task":"route"}')
      expect(submitNextInput).toBe(true)
    } finally {
      setProjectRoot(priorRoot)
      if (priorWorkflowHome === undefined) {
        delete process.env[WORKFLOW_HOME_ENV]
      } else {
        process.env[WORKFLOW_HOME_ENV] = priorWorkflowHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('export writes a Markdown workflow report for a recorded run', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'wf-export-report-'))
    const sessionId =
      '88888888-8888-4888-8888-888888888888' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'home')
      getProjectDir.cache.clear()
      resetProjectForTesting()
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_export_report'
      initRunArtifacts(
        runId,
        'return "report"',
        {
          runId,
          workflowName: 'report-flow',
          description: 'Report flow',
          phases: [{ title: 'Verify', detail: 'Run checks' }],
          parentGoalId: 'goal_export_report',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
          agentCount: 1,
          tokensSpent: 10,
          totalToolCalls: 2,
          result: 'All checks passed.',
        },
      )

      const direct = exportWorkflowRunReport(runId)
      let commandMessage = ''
      await call(
        nextMessage => {
          commandMessage = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        `export ${runId}`,
      )

      expect(direct.ok).toBe(true)
      expect(direct.path).toContain('report.md')
      expect(commandMessage).toContain('Workflow report exported:')
      const report = readFileSync(direct.path!, 'utf8')
      expect(report).toContain('# Workflow Report: report-flow')
      expect(report).toContain('- Parent goal: goal_export_report')
      expect(report).toContain('## Progress Tree')
      expect(report).toContain('- [completed] phase: Verify')
      expect(report).toContain('- [ready] verification: Verification evidence')
      expect(report).toContain('## Verification Evidence')
      expect(report).toContain('- State: ready')
      expect(report).toContain('No explicit verification evidence captured')
      expect(report).toContain('All checks passed.')
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('opens the interactive workflow progress view with no args', async () => {
    const state = { tasks: {} }
    let message = ''

    const result = await call(
      nextMessage => {
        message = nextMessage ?? ''
      },
      workflowCommandContext(state) as never,
      '',
    )

    expect(isValidElement(result)).toBe(true)
    expect(message).toBe('')
  })

  test('interactive live workflow list summarizes in-progress agent usage', () => {
    const task = {
      ...runningWorkflowTask({
        taskId: 'task_live_usage',
        runId: 'wf_live_usage',
      }),
      tokensSpent: 0,
      totalToolCalls: 0,
    }

    expect(workflowLiveRunListMetricSummary(task)).toMatchObject({
      agentCount: 2,
      tokens: 55,
      toolCalls: 3,
    })
  })

  test('interactive controls target agents only when an agent is selected', () => {
    expect(shouldRouteWorkflowAgentControl('phase')).toBe(true)
    expect(shouldRouteWorkflowAgentControl('agent')).toBe(true)
    expect(shouldRouteWorkflowAgentControl('run')).toBe(false)
    expect(shouldRouteWorkflowAgentControl('run', true)).toBe(true)
    expect(shouldRouteWorkflowAgentControl('list')).toBe(false)
    expect(shouldRouteWorkflowAgentControl('save')).toBe(false)
  })

  test('interactive action hints only advertise valid selected-agent controls', () => {
    expect(workflowInputGuideText('run')).toContain('up/down:select | enter/right:open')
    expect(workflowInputGuideText('run')).toContain('e:export-report')
    expect(workflowInputGuideText('agent')).toContain('j/k:scroll')
    expect(workflowInputGuideText('save')).toBe('tab:switch-scope | enter:save | esc:back')

    expect(canStopWorkflowAgentStatus('queued')).toBe(true)
    expect(canStopWorkflowAgentStatus('running')).toBe(true)
    expect(canStopWorkflowAgentStatus('completed')).toBe(false)
    expect(canRestartWorkflowAgentStatus('running')).toBe(true)
    expect(canRestartWorkflowAgentStatus('queued')).toBe(false)

    const runningHint = workflowSelectedActionHint({
      mode: 'phase',
      hasSelectedRun: true,
      selectedRunKind: 'live',
      selectedRunStatus: 'running',
      selectedAgent: { agentNumber: 1, status: 'running' },
    })
    expect(runningHint).toContain('Enter peek agent #1')
    expect(runningHint).toContain('x stop agent')
    expect(runningHint).toContain('r restart agent')

    const completedHint = workflowSelectedActionHint({
      mode: 'phase',
      hasSelectedRun: true,
      selectedRunKind: 'live',
      selectedRunStatus: 'running',
      selectedAgent: { agentNumber: 2, status: 'completed' },
    })
    expect(completedHint).toContain('Enter peek agent #2')
    expect(completedHint).not.toContain('x stop agent')
    expect(completedHint).not.toContain('r restart agent')
  })

  test('unphased run view treats the selected run-level row as an agent target', () => {
    const agent = runningWorkflowTask({
      taskId: 'wtaskcmd_run_level_control',
      runId: 'wf_cmd_run_level_control',
    }).agents[0]!

    expect(shouldShowRunLevelAgents(0, 1)).toBe(true)
    expect(workflowRunOpenTarget('wf_cmd_run_level_control', [], 0, agent)).toEqual({
      mode: 'agent',
      runId: 'wf_cmd_run_level_control',
      agentNumber: 1,
    })
    expect(shouldRouteWorkflowAgentControl('run', true)).toBe(true)
    expect(shouldRouteWorkflowAgentControl('run', false)).toBe(false)
  })

  test('interactive run view can drill into agents when a workflow has no phases', () => {
    const agent = runningWorkflowTask({
      taskId: 'wtaskcmd_unphased',
      runId: 'wf_cmd_unphased',
    }).agents[0]!

    expect(shouldShowRunLevelAgents(0, 1)).toBe(true)
    expect(workflowRunOpenTarget('wf_cmd_unphased', [], 0, agent)).toEqual({
      mode: 'agent',
      runId: 'wf_cmd_unphased',
      agentNumber: 1,
    })
    expect(workflowAgentBackTarget('wf_cmd_unphased', null)).toEqual({
      mode: 'run',
      runId: 'wf_cmd_unphased',
    })
  })

  test('interactive run view keeps phase drilldown when phases exist', () => {
    const agent = runningWorkflowTask({
      taskId: 'wtaskcmd_phased',
      runId: 'wf_cmd_phased',
    }).agents[0]!

    expect(shouldShowRunLevelAgents(1, 2)).toBe(false)
    expect(
      workflowRunOpenTarget('wf_cmd_phased', ['Scan'], 0, agent),
    ).toEqual({
      mode: 'phase',
      runId: 'wf_cmd_phased',
      phase: 'Scan',
    })
    expect(workflowAgentBackTarget('wf_cmd_phased', 'Scan')).toEqual({
      mode: 'phase',
      runId: 'wf_cmd_phased',
      phase: 'Scan',
    })
  })

  test('interactive progress view totals elapsed time across phase agents', () => {
    const agents: LocalWorkflowTaskState['agents'] = [
      {
        agentNumber: 1,
        label: 'Scan routes',
        phase: 'Scan',
        status: 'completed',
        tokens: 10,
        toolCalls: 1,
        durationMs: 1200,
      },
      {
        agentNumber: 2,
        label: 'Review findings',
        phase: 'Scan',
        status: 'completed',
        tokens: 20,
        toolCalls: 2,
        durationMs: 3400,
      },
      {
        agentNumber: 3,
        label: 'Queued follow-up',
        phase: 'Scan',
        status: 'queued',
        tokens: 0,
        toolCalls: 0,
      },
    ]

    expect(sumAgentElapsedMs(agents)).toBe(4600)
  })

  test('interactive agent detail renders recent tool calls in order', () => {
    const agent = runningWorkflowTask({
      taskId: 'wtaskcmd_recent_tools',
      runId: 'wf_cmd_recent_tools',
    }).agents[0]!

    expect(recentToolCallLines(agent)).toEqual([
      'Tool 1: Glob commands/workflows/*.tsx',
      'Tool 2: Read commands/workflows/workflows.tsx',
    ])
  })

  test('queues an official-shaped Workflow tool call with scriptPath, resumeFromRunId, and args', () => {
    const nextInput = buildWorkflowResumeNextInput(
      'wf_resume1',
      '/tmp/workflows/wf_resume1/script.js',
      { ticket: 42 },
    )

    expect(nextInput).toContain(
      "Workflow({scriptPath: '/tmp/workflows/wf_resume1/script.js'",
    )
    expect(nextInput).toContain("resumeFromRunId: 'wf_resume1'")
    expect(nextInput).toContain('args: {"ticket":42}')
    expect(nextInput).not.toContain('no new script')
  })

  test('resume queues stopped journal runs but not completed history', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'wf-resume-status-'))
    const sessionId =
      '44444444-4444-4444-8444-444444444444' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      initRunArtifacts(
        'wf_stopped-resume',
        'return "stopped"',
        {
          runId: 'wf_stopped-resume',
          workflowName: 'stopped-flow',
          description: 'Stopped flow',
          createdAt: new Date(0).toISOString(),
          status: 'killed',
          args: { ticket: 42 },
        },
      )
      initRunArtifacts(
        'wf_completed-history',
        'return "completed"',
        {
          runId: 'wf_completed-history',
          workflowName: 'completed-flow',
          description: 'Completed flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )
      initRunArtifacts(
        'wf_stale-running',
        'return "stale"',
        {
          runId: 'wf_stale-running',
          workflowName: 'stale-flow',
          description: 'Stale flow',
          createdAt: new Date(0).toISOString(),
          status: 'running',
        },
      )
      clearActiveWorkflowRunsForTests()

      let stoppedMessage = ''
      let stoppedNextInput = ''
      await call(
        (nextMessage, options) => {
          stoppedMessage = nextMessage
          stoppedNextInput = options?.nextInput ?? ''
        },
        workflowCommandContext({ tasks: {} }) as never,
        'resume wf_stopped-resume',
      )

      expect(stoppedMessage).toContain('wf_stopped-resume')
      expect(stoppedMessage).toContain('checkpoint:')
      expect(stoppedMessage).toContain('completed=0')
      expect(stoppedNextInput).toContain(
        "Workflow({scriptPath: '",
      )
      expect(stoppedNextInput).toContain("resumeFromRunId: 'wf_stopped-resume'")
      expect(stoppedNextInput).toContain('args: {"ticket":42}')

      let completedMessage = ''
      let completedNextInput = ''
      await call(
        (nextMessage, options) => {
          completedMessage = nextMessage
          completedNextInput = options?.nextInput ?? ''
        },
        workflowCommandContext({ tasks: {} }) as never,
        'resume wf_completed-history',
      )

      expect(completedMessage).toContain('wf_completed-history')
      expect(completedNextInput).toBe('')

      let staleMessage = ''
      let staleNextInput = ''
      await call(
        (nextMessage, options) => {
          staleMessage = nextMessage
          staleNextInput = options?.nextInput ?? ''
        },
        workflowCommandContext({ tasks: {} }) as never,
        'resume wf_stale-running',
      )

      expect(staleMessage).toContain('wf_stale-running')
      expect(staleNextInput).toBe('')
      expect(loadRunMeta('wf_stale-running')?.status).toBe('failed')
      expect(loadRunMeta('wf_stale-running')?.failures).toContain(
        STALE_RUNNING_WORKFLOW_MESSAGE,
      )
    } finally {
      clearActiveWorkflowRunsForTests()
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('pause resolves a workflow run id to the separated background task id', async () => {
    const taskId = 'wtaskcmd1'
    const runId = 'wf_cmd_lookup'
    const abortController = new AbortController()
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId, abortController }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `pause ${runId}`,
    )

    expect(message).toContain(runId)
    expect(state.tasks[taskId]?.status).toBe('paused')
    expect(abortController.signal.aborted).toBe(true)
  })

  test('control commands record Workbench action receipts for the next snapshot', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'wf-action-receipt-'))
    const taskId = 'wtaskcmd_receipt'
    const runId = 'wf_cmd_receipt'
    const abortController = new AbortController()
    const sessionId =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ReturnType<typeof getSessionId>

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      const state = {
        tasks: {
          [taskId]: runningWorkflowTask({ taskId, runId, abortController }),
        },
      }
      let message = ''

      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext(state) as never,
        `pause ${runId}`,
      )

      const snapshot = buildWorkbenchWorkflowSnapshot({
        runs: [],
        registryResults: [],
        generatedAt: '2026-07-07T00:00:00.000Z',
      })

      expect(existsSync(workbenchActionReceiptsPath())).toBe(true)
      expect(message).toContain(runId)
      expect(snapshot.summary.actionReceipts).toBe(1)
      expect(snapshot.actionReceipts.emptyState).toBeNull()
      expect(snapshot.actionReceipts.items[0]).toMatchObject({
        actionId: 'workflow.run.pause',
        status: 'received',
        input: `/workflows pause ${runId}`,
        runId,
        workflowName: 'demo',
        message,
        source: 'cli',
      })
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('run detail prefers live task progress with phase and agent summaries', async () => {
    const taskId = 'wtaskcmd_detail'
    const runId = 'wf_cmd_detail'
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      runId,
    )

    expect(message).toContain(`demo (${runId})`)
    expect(message).toContain('verification: queued')
    expect(message).toContain(`report: ${workflowReportPath(runId)}`)
    expect(message).toContain('Scan · 1 agent(s) · 1 running · 25 tok · 1 tools')
    expect(message).toContain('Write · 1 agent(s) · 1 completed · 30 tok · 2 tools')
    expect(message).toContain('#1 [Scan] Scan routes · running · 25 tok · 1 tools')
    expect(message).toContain('Read commands/workflows/workflows.tsx')
    expect(message).toContain(`/workflows pause ${runId}`)
  })

  test('run detail reconstructs completed history progress from the journal', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'wf-history-detail-'))
    const sessionId =
      '55555555-5555-4555-8555-555555555555' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_history_detail'
      initRunArtifacts(
        runId,
        'return "history"',
        {
          runId,
          workflowName: 'history-flow',
          description: 'History flow',
          phases: [{ title: 'Scan' }, { title: 'Review' }],
          createdAt: new Date(0).toISOString(),
          status: 'completed',
          agentCount: 2,
          tokensSpent: 55,
          totalToolCalls: 3,
          durationMs: 4600,
          result: 'Final historical report\n- Found routes and reviews.',
        },
      )
      appendJournalStartedEntry(runId, {
        kind: 'started',
        index: 0,
        hash: 'h0',
        label: 'Scan routes',
        phase: 'Scan',
        agentNumber: 1,
        opts: { model: 'fast', agentType: 'Explore' },
        promptPreview: 'Inspect the historical workflow routes.',
        queuedAt: 1_800_000_000_000,
        startedAt: 1_800_000_001_000,
        lastProgressAt: 1_800_000_002_000,
        lastToolName: 'Read',
        lastToolSummary: 'commands/workflows/workflows.tsx',
        recentToolCalls: [
          { name: 'Read', summary: 'commands/workflows/workflows.tsx' },
        ],
      })
      appendJournalEntry(runId, {
        index: 0,
        hash: 'h0',
        value: 'Found historical routes.',
        tokens: 25,
        toolCalls: 1,
        ok: true,
        durationMs: 1200,
        agentId: 'agent_history_scan',
        transcriptPath:
          '/tmp/workflows/wf_history_detail/transcripts/agent-agent_history_scan.jsonl',
        remoteSessionId: 'session_history_scan',
      })
      appendJournalStartedEntry(runId, {
        kind: 'started',
        index: 1,
        hash: 'h1',
        label: 'Review findings',
        phase: 'Review',
        agentNumber: 2,
        opts: {},
      })
      appendJournalEntry(runId, {
        index: 1,
        hash: 'h1',
        value: { ok: true },
        tokens: 30,
        toolCalls: 2,
        ok: true,
      })

      let message = ''
      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        runId,
      )

      expect(message).toContain(`history-flow (${runId})`)
      expect(message).toContain('verification: ready')
      expect(message).toContain('No explicit verification evidence captured')
      expect(message).toContain(`report: ${workflowReportPath(runId)}`)
      expect(message).toContain('Scan · 1 agent(s) · 1 completed · 25 tok · 1 tools')
      expect(message).toContain('Review · 1 agent(s) · 1 completed · 30 tok · 2 tools')
      expect(message).toMatch(/(?:Result|结果):/)
      expect(message).toContain('Final historical report')
      expect(message).toContain('- Found routes and reviews.')
      expect(message).toContain('#1 [Scan] Scan routes · completed · 25 tok · 1 tools')
      expect(message).toContain('agentId: agent_history_scan')
      expect(message).toContain(
        'transcript: /tmp/workflows/wf_history_detail/transcripts/agent-agent_history_scan.jsonl',
      )
      expect(message).toContain('Prompt: Inspect the historical workflow routes.')
      expect(message).toContain('Read commands/workflows/workflows.tsx')
      expect(message).toContain('Found historical routes.')
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('run detail shows completed final result even when there are no agent journal entries', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const root = mkdtempSync(join(tmpdir(), 'wf-history-result-only-'))
    const sessionId =
      '77777777-7777-4777-8777-777777777777' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'home')
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_history_result_only'
      initRunArtifacts(
        runId,
        'return "final"',
        {
          runId,
          workflowName: 'result-only-flow',
          description: 'Result only flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
          result: 'Top-level report\n- answer: 42',
        },
      )

      let message = ''
      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        runId,
      )

      expect(message).toContain(`result-only-flow (${runId})`)
      expect(message).toContain('verification: ready')
      expect(message).toContain(`report: ${workflowReportPath(runId)}`)
      expect(message).toMatch(/(?:Result|结果):/)
      expect(message).toContain('Top-level report')
      expect(message).toContain('- answer: 42')
      expect(message).toMatch(/(?:No progress recorded for this run|没有记录执行过程)/)
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('agent detail drills into prompt, latest tool, and result preview', async () => {
    const taskId = 'wtaskcmd_agent_detail'
    const runId = 'wf_cmd_agent_detail'
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `agent ${runId} 1`,
    )

    expect(message).toContain('#1 Scan routes')
    expect(message).toContain('running')
    expect(message).toContain('Scan')
    expect(message).toContain(
      'Prompt: Inspect workflow routing and report the important files.',
    )
    expect(message).toContain('Glob commands/workflows/*.tsx')
    expect(message).toContain('Read commands/workflows/workflows.tsx')
    expect(message).toContain('Found the command detail renderer.')
    expect(message).toContain(`/workflows restart-agent ${runId} 1`)
  })

  test('agent detail reconstructs completed history agents from the journal', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const priorConfigDir = process.env.MOSSEN_CONFIG_DIR
    const priorTestPersistence = process.env.TEST_ENABLE_SESSION_PERSISTENCE
    const root = mkdtempSync(join(tmpdir(), 'wf-history-agent-detail-'))
    const sessionId =
      '66666666-6666-4666-8666-666666666666' as ReturnType<typeof getSessionId>
    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      process.env.MOSSEN_CONFIG_DIR = join(root, 'home')
      process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
      resetProjectForTesting()
      getProjectDir.cache.clear()
      setProjectRoot(root)
      switchSession(sessionId)
      const runId = 'wf_history_agent_detail'
      initRunArtifacts(
        runId,
        'return "history"',
        {
          runId,
          workflowName: 'history-agent-flow',
          description: 'History agent flow',
          createdAt: new Date(0).toISOString(),
          status: 'completed',
        },
      )
      appendJournalStartedEntry(runId, {
        kind: 'started',
        index: 0,
        hash: 'h0',
        label: 'Scan routes',
        phase: 'Scan',
        agentNumber: 1,
        opts: { isolation: 'remote' },
        promptPreview: 'Inspect routes from a completed historical agent.',
        lastToolName: 'Read',
        lastToolSummary: 'commands/workflows/workflows.tsx',
      })
      setAgentTranscriptSubdir('agent_history_agent', `workflows/${runId}`)
      const transcriptPath = getAgentTranscriptPath(
        asAgentId('agent_history_agent'),
      )
      appendJournalEntry(runId, {
        index: 0,
        hash: 'h0',
        value: 'Historical agent result.',
        tokens: 25,
        toolCalls: 1,
        ok: true,
        durationMs: 1500,
        agentId: 'agent_history_agent',
        transcriptPath,
        remoteSessionId: 'session_history_agent',
      })
      await recordSidechainTranscript(
        [
          createUserMessage({
            content: 'Inspect routes from a completed historical agent.',
          }),
          createAssistantMessage({
            content: 'Read commands/workflows/workflows.tsx and found the route.',
          }),
        ],
        'agent_history_agent',
      )
      await flushSessionStorage()
      const transcript = await loadTranscriptFile(transcriptPath, {
        keepAllLeaves: true,
      })
      expect(transcript.messages.size).toBe(2)
      clearAgentTranscriptSubdir('agent_history_agent')

      let message = ''
      await call(
        nextMessage => {
          message = nextMessage
        },
        workflowCommandContext({ tasks: {} }) as never,
        `agent ${runId} 1`,
      )

      expect(message).toContain('#1 Scan routes')
      expect(message).toContain('completed')
      expect(message).toContain('Scan')
      expect(message).toContain('isolation: remote')
      expect(message).toContain('agentId: agent_history_agent')
      expect(message).toContain(`transcript: ${transcriptPath}`)
      expect(message).toContain('remote: session_history_agent')
      expect(message).toContain('Prompt: Inspect routes from a completed historical agent.')
      expect(message).toContain('Read commands/workflows/workflows.tsx')
      expect(message).toContain('Historical agent result.')
      expect(message).toContain('Transcript tail:')
      expect(message).toContain(
        'User: Inspect routes from a completed historical agent.',
      )
      expect(message).toContain(
        'Assistant: Read commands/workflows/workflows.tsx and found the route.',
      )
    } finally {
      clearAgentTranscriptSubdir('agent_history_agent')
      resetProjectForTesting()
      getProjectDir.cache.clear()
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      if (priorConfigDir === undefined) {
        delete process.env.MOSSEN_CONFIG_DIR
      } else {
        process.env.MOSSEN_CONFIG_DIR = priorConfigDir
      }
      if (priorTestPersistence === undefined) {
        delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
      } else {
        process.env.TEST_ENABLE_SESSION_PERSISTENCE = priorTestPersistence
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('stop resolves a workflow run id and kills the backing task', async () => {
    const taskId = 'wtaskcmd_stop'
    const runId = 'wf_cmd_stop'
    const abortController = new AbortController()
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId, abortController }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `stop ${runId}`,
    )

    expect(message).toContain(runId)
    expect(state.tasks[taskId]?.status).toBe('killed')
    expect(abortController.signal.aborted).toBe(true)
  })

  test('stop-agent requests a skip for the selected workflow agent', async () => {
    const taskId = 'wtaskcmd_stop_agent'
    const runId = 'wf_cmd_stop_agent'
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `stop-agent ${runId} 1`,
    )

    expect(message).toContain(runId)
    expect(message).toContain('#1')
    expect(state.tasks[taskId]?.agents?.[0]?.status).toBe('skipped')
    expect(state.tasks[taskId]?.summary).toBe('skip requested for agent #1')
  })

  test('stop-agent marks a queued selected workflow agent as skipped immediately', async () => {
    const taskId = 'wtaskcmd_stop_queued_agent'
    const runId = 'wf_cmd_stop_queued_agent'
    const task = runningWorkflowTask({ taskId, runId })
    task.agents[0] = {
      ...task.agents[0]!,
      status: 'queued',
    }
    const state = {
      tasks: {
        [taskId]: task,
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `stop-agent ${runId} 1`,
    )

    expect(message).toContain(runId)
    expect(message).toContain('#1')
    expect(state.tasks[taskId]?.agents?.[0]?.status).toBe('skipped')
  })

  test('restart-agent requests a restart for the selected workflow agent', async () => {
    const taskId = 'wtaskcmd_retry_agent'
    const runId = 'wf_cmd_retry_agent'
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `restart-agent ${runId} 1`,
    )

    expect(message).toContain(runId)
    expect(message).toContain('#1')
    expect(state.tasks[taskId]?.agents?.[0]?.status).toBe('retry_requested')
    expect(state.tasks[taskId]?.summary).toBe('retry requested for agent #1')
  })

  test('restart-agent only restarts a running agent', async () => {
    const taskId = 'wtaskcmd_retry_completed_agent'
    const runId = 'wf_cmd_retry_completed_agent'
    const state = {
      tasks: {
        [taskId]: runningWorkflowTask({ taskId, runId }),
      },
    }
    let message = ''

    await call(
      nextMessage => {
        message = nextMessage
      },
      workflowCommandContext(state) as never,
      `restart-agent ${runId} 2`,
    )

    expect(message).toContain(runId)
    expect(message).toContain('#2')
    expect(state.tasks[taskId]?.agents?.[1]?.status).toBe('completed')
    expect(state.tasks[taskId]?.summary).toBe('demo')
  })

  test('resume-task queues Workflow input with the workflow run id, not the task id', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const taskId = 'wtaskcmd2'
    const runId = 'wf_cmd_resume'
    const root = mkdtempSync(join(tmpdir(), 'wf-cmd-resume-checkpoint-'))
    let nextInput = ''
    let message = ''

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      setProjectRoot(root)
      switchSession(
        '88888888-8888-4888-8888-888888888888' as ReturnType<typeof getSessionId>,
      )
      initRunArtifacts(runId, 'return "resume"', {
        runId,
        workflowName: 'resume-task-flow',
        description: 'Resume task flow',
        createdAt: new Date(0).toISOString(),
        status: 'paused',
        args: { ticket: 42 },
      })
      const state = {
        tasks: {
          [taskId]: {
            id: taskId,
            type: 'local_workflow',
            status: 'paused',
            runId,
            workflowRunId: runId,
            scriptPath: runScriptPath(runId),
            args: { ticket: 42 },
          },
        },
      }

      await call(
        (nextMessage, options) => {
          message = nextMessage
          nextInput = options?.nextInput ?? ''
        },
        workflowCommandContext(state) as never,
        `resume-task ${runId}`,
      )

      expect(message).toContain('checkpoint:')
      expect(nextInput).toContain("Workflow({scriptPath: '")
      expect(nextInput).toContain("resumeFromRunId: 'wf_cmd_resume'")
      expect(nextInput).toContain('args: {"ticket":42}')
      expect(nextInput).not.toContain(taskId)
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('resume-task blocks compatibility fallback when checkpoint is missing', async () => {
    const taskId = 'wtaskcmd_missing_checkpoint'
    const runId = 'wf_cmd_missing_checkpoint'
    const state = {
      tasks: {
        [taskId]: {
          id: taskId,
          type: 'local_workflow',
          status: 'paused',
          runId,
          workflowRunId: runId,
          scriptPath: '/tmp/workflows/wf_cmd_missing_checkpoint/script.js',
        },
      },
    }
    let message = ''
    let nextInput = ''

    await call(
      (nextMessage, options) => {
        message = nextMessage
        nextInput = options?.nextInput ?? ''
      },
      workflowCommandContext(state) as never,
      `resume-task ${runId}`,
    )

    expect(message).toContain('has no recovery checkpoint')
    expect(nextInput).toBe('')
  })

  test('resume-task queues stopped workflow runs like the interactive view', async () => {
    const priorRoot = getProjectRoot()
    const priorSession = getSessionId()
    const priorProjectDir = getSessionProjectDir()
    const priorHome = process.env.MOSSEN_HOME
    const taskId = 'wtaskcmd_stopped_resume'
    const runId = 'wf_cmd_stopped_resume'
    const root = mkdtempSync(join(tmpdir(), 'wf-cmd-stopped-checkpoint-'))
    let nextInput = ''
    let message = ''

    try {
      process.env.MOSSEN_HOME = join(root, 'home')
      setProjectRoot(root)
      switchSession(
        '99999999-9999-4999-8999-999999999999' as ReturnType<typeof getSessionId>,
      )
      initRunArtifacts(runId, 'return "stopped"', {
        runId,
        workflowName: 'stopped-resume-flow',
        description: 'Stopped resume flow',
        createdAt: new Date(0).toISOString(),
        status: 'killed',
      })
      const state = {
        tasks: {
          [taskId]: {
            ...runningWorkflowTask({ taskId, runId }),
            status: 'killed',
            scriptPath: runScriptPath(runId),
            abortController: undefined,
            endTime: Date.now(),
          },
        },
      }

      await call(
        (nextMessage, options) => {
          message = nextMessage
          nextInput = options?.nextInput ?? ''
        },
        workflowCommandContext(state) as never,
        `resume-task ${runId}`,
      )

      expect(message).toContain('checkpoint:')
      expect(nextInput).toContain("Workflow({scriptPath: '")
      expect(nextInput).toContain("resumeFromRunId: 'wf_cmd_stopped_resume'")
      expect(nextInput).not.toContain(taskId)
    } finally {
      switchSession(priorSession, priorProjectDir)
      setProjectRoot(priorRoot)
      if (priorHome === undefined) {
        delete process.env.MOSSEN_HOME
      } else {
        process.env.MOSSEN_HOME = priorHome
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})
