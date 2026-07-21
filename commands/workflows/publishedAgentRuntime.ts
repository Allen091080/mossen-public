import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { getMossenHome } from '../../utils/mossenHome.js'
import { getCanonicalConfigDirName } from '../../utils/naming.js'
import { validateUuid } from '../../utils/uuid.js'
import {
  getAgentDefinitionsWithOverrides,
  isBuiltInAgent,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { stableWorkflowPublicationJson } from './publicationProtocol.js'
import type {
  PublishedAgentRuntimeOutcome,
  PublishedAgentRuntimeRequest,
  PublishedAgentRuntimeToolExecution,
  PublishedWorkflowExecutionCheckpoint,
} from './publishedRunProtocol.js'

const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const MAX_SKILL_TREE_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 180_000

type AgentSession = PublishedWorkflowExecutionCheckpoint['agentSessions'][string]

type RuntimeCapture = {
  sessionId: string | null
  runtimeVersion: string | null
  toolInventory: string[] | null
  requestedSkillIds: string[]
  resolvedSkillIds: string[]
  preloadedSkillIds: string[]
  failedSkillIds: string[]
  pendingTool: AgentSession['pendingTool']
  result: unknown
  resultError: string | null
  toolUses: Map<string, { toolId: string; inputDigest: string }>
  toolExecutions: PublishedAgentRuntimeToolExecution[]
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(stableWorkflowPublicationJson(value) ?? 'null', 'utf8')
    .digest('hex')
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(item => right.includes(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  )
}

function frozenAgentName(request: PublishedAgentRuntimeRequest): string {
  return `published-${fingerprint({
    runId: request.runId,
    nodeId: request.nodeId,
    grantDigest: request.projection.grantDigest,
  }).slice(0, 24)}`
}

function frozenAgentWorkspace(
  request: PublishedAgentRuntimeRequest,
  sessionId: string,
): string {
  const nodeWorkspaceId = fingerprint(request.nodeId).slice(0, 32)
  return join(
    getMossenHome(),
    'workflow-publication',
    'executions',
    request.runId,
    `node-${nodeWorkspaceId}`,
    sessionId,
  )
}

function copySkillTree(source: string, destination: string): void {
  let totalBytes = 0
  const copyDirectory = (from: string, to: string): void => {
    const sourceStat = lstatSync(from)
    if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
      throw new Error(`Published Skill source is not a regular directory: ${from}`)
    }
    mkdirSync(to, { recursive: true, mode: 0o700 })
    chmodSync(to, 0o700)
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const childSource = join(from, entry.name)
      const childDestination = join(to, entry.name)
      const childStat = lstatSync(childSource)
      if (childStat.isSymbolicLink()) {
        throw new Error(`Published Skill tree contains a symlink: ${childSource}`)
      }
      if (childStat.isDirectory()) {
        copyDirectory(childSource, childDestination)
        continue
      }
      if (!childStat.isFile()) continue
      totalBytes += childStat.size
      if (totalBytes > MAX_SKILL_TREE_BYTES) {
        throw new Error(
          `Published Skill snapshot exceeds ${MAX_SKILL_TREE_BYTES} bytes.`,
        )
      }
      writeFileSync(childDestination, readFileSync(childSource), { mode: 0o600 })
      chmodSync(childDestination, 0o600)
    }
  }
  copyDirectory(source, destination)
}

async function freezeAgentSession(
  request: PublishedAgentRuntimeRequest,
): Promise<AgentSession> {
  const cwd = process.cwd()
  const definitions = await getAgentDefinitionsWithOverrides(cwd)
  const agent = definitions.allAgents.find(
    item =>
      item.agentType === request.projection.runtime.agentRef ||
      item.filename === request.projection.runtime.agentRef,
  )
  if (!agent || isBuiltInAgent(agent) || agent.source !== 'projectSettings') {
    throw new Error(
      `R12 requires a project-owned custom Agent '${request.projection.runtime.agentRef}'.`,
    )
  }
  const agentSkills = [...(agent.skills ?? [])]
  const agentTools = [...(agent.tools ?? [])]
  if (!sameStringSet(agentSkills, request.projection.skills.required)) {
    throw new Error('Resolved Agent Skills conflict with the frozen runtime projection.')
  }
  if (!sameStringSet(agentTools, request.projection.tools.inventory)) {
    throw new Error('Resolved Agent Tools conflict with the frozen runtime projection.')
  }
  const { getToolsForDefaultPreset } = await import('../../tools.js')
  const availableToolIds = new Set(getToolsForDefaultPreset())
  const unavailableToolIds = agentTools.filter(
    toolId => !availableToolIds.has(toolId),
  )
  if (unavailableToolIds.length > 0) {
    throw new Error(
      `R12 Agent Tools are unavailable in this Mossen runtime: ${unavailableToolIds.join(', ')}.`,
    )
  }

  const sessionId = randomUUID()
  const workspace = frozenAgentWorkspace(request, sessionId)
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  chmodSync(workspace, 0o700)
  const configDir = getCanonicalConfigDirName()
  for (const skillId of request.projection.skills.required) {
    if (!safeSegment(skillId)) {
      throw new Error(`R12 project Skill id is not an exact safe segment: ${skillId}`)
    }
    const source = join(cwd, configDir, 'skills', skillId)
    const skillFile = join(source, 'SKILL.md')
    if (!existsSync(skillFile) || !lstatSync(skillFile).isFile()) {
      throw new Error(`R12 project Skill is unavailable: ${skillId}`)
    }
    const destination = join(workspace, configDir, 'skills', skillId)
    copySkillTree(source, destination)
  }

  const agentName = frozenAgentName(request)
  const model =
    request.projection.runtime.modelRef ??
    (agent.model && agent.model !== 'inherit' ? agent.model : undefined)
  const agentDefinition = {
    description: agent.whenToUse,
    prompt: agent.getSystemPrompt(),
    tools: [...request.projection.tools.inventory],
    skills: [...request.projection.skills.required],
    permissionMode: 'default' as const,
    ...(model ? { model } : {}),
  }
  return {
    sessionId,
    workspace,
    agentName,
    definitionDigest: fingerprint(agentDefinition),
    agentDefinition,
    pendingTool: null,
  }
}

function validateFrozenAgentSession(
  request: PublishedAgentRuntimeRequest,
  session: AgentSession,
): void {
  if (!validateUuid(session.sessionId)) {
    throw new Error('Frozen Agent session has an invalid session identity.')
  }
  const expectedWorkspace = frozenAgentWorkspace(request, session.sessionId)
  const workspaceStat = existsSync(session.workspace)
    ? lstatSync(session.workspace)
    : null
  if (
    session.agentName !== frozenAgentName(request) ||
    resolve(session.workspace) !== resolve(expectedWorkspace) ||
    !workspaceStat ||
    workspaceStat.isSymbolicLink() ||
    !workspaceStat.isDirectory() ||
    session.definitionDigest !== fingerprint(session.agentDefinition) ||
    session.agentDefinition.permissionMode !== 'default' ||
    !sameStringSet(
      session.agentDefinition.skills,
      request.projection.skills.required,
    ) ||
    !sameStringSet(
      session.agentDefinition.tools,
      request.projection.tools.inventory,
    )
  ) {
    throw new Error('Frozen Agent session conflicts with its authoritative checkpoint.')
  }
  if (request.phase === 'start' && session.pendingTool) {
    throw new Error('New Agent execution unexpectedly contains a pending Tool.')
  }
  if (
    request.phase === 'resume_tool' &&
    (!session.pendingTool ||
      fingerprint(session.pendingTool.input) !== session.pendingTool.inputDigest)
  ) {
    throw new Error('Agent Tool resume checkpoint failed its input digest check.')
  }
}

export async function preparePublishedAgentRuntimeSession(
  request: PublishedAgentRuntimeRequest,
): Promise<AgentSession> {
  if (request.phase !== 'start' || request.session) {
    throw new Error('Published Agent preparation requires a new start request.')
  }
  return freezeAgentSession(request)
}

function runtimeExecutable(): { command: string; prefix: string[] } {
  const explicit = process.env.MOSSEN_PUBLISHED_RUNTIME_BINARY
  if (explicit) return { command: explicit, prefix: [] }
  const command = process.execPath
  if (/^bun(?:\.exe)?$/i.test(basename(command))) {
    return { command, prefix: [join(import.meta.dir, '..', '..', 'main.tsx')] }
  }
  return { command, prefix: [] }
}

function permissionArgs(request: PublishedAgentRuntimeRequest): string[] {
  const args: string[] = []
  if (request.projection.tools.ask.length > 0) {
    args.push(
      '--settings',
      JSON.stringify({
        permissions: { ask: [...request.projection.tools.ask] },
      }),
    )
  }
  if (request.projection.tools.allow.length > 0) {
    args.push('--allowedTools', ...request.projection.tools.allow)
  }
  if (request.projection.tools.deny.length > 0) {
    args.push('--disallowedTools', ...request.projection.tools.deny)
  }
  return args
}

function runtimePrompt(request: PublishedAgentRuntimeRequest): string {
  if (typeof request.nodeConfig.prompt === 'string' && request.nodeConfig.prompt.trim()) {
    return request.nodeConfig.prompt.replaceAll(
      '{{input}}',
      stableWorkflowPublicationJson(request.input) ?? 'null',
    )
  }
  return [
    `Execute the published Workflow step '${request.nodeTitle}'.`,
    'Use only the offered Tools and return the completed step output.',
    `Input: ${stableWorkflowPublicationJson(request.input) ?? 'null'}`,
  ].join('\n')
}

function extractPreloadEvidence(
  value: unknown,
  capture: RuntimeCapture,
): void {
  if (!isRecord(value)) return
  capture.requestedSkillIds = stringList(value.requestedSkillIds)
  capture.resolvedSkillIds = stringList(value.resolvedSkillIds)
  capture.preloadedSkillIds = stringList(value.preloadedSkillIds)
  capture.failedSkillIds = stringList(value.failedSkillIds)
}

function inspectMessage(value: unknown, capture: RuntimeCapture): void {
  if (!isRecord(value)) return
  if (value.type === 'system' && value.subtype === 'init') {
    capture.sessionId =
      typeof value.session_id === 'string'
        ? value.session_id
        : typeof value.sessionId === 'string'
          ? value.sessionId
          : capture.sessionId
    capture.runtimeVersion =
      typeof value.mossenVersion === 'string'
        ? value.mossenVersion
        : typeof value.mossen_code_version === 'string'
          ? value.mossen_code_version
          : capture.runtimeVersion
    capture.toolInventory = Array.isArray(value.tools)
      ? stringList(value.tools)
      : capture.toolInventory
    extractPreloadEvidence(value.agentSkillPreload, capture)
  }
  if (value.type === 'result') {
    extractPreloadEvidence(value.agentSkillPreload, capture)
    if (value.subtype === 'success' && value.is_error !== true) {
      capture.result = value.result ?? null
    } else {
      capture.resultError = Array.isArray(value.errors)
        ? stringList(value.errors).join('; ')
        : typeof value.result === 'string'
          ? value.result
          : 'Mossen Agent runtime failed.'
    }
  }
  if (value.type === 'control_request') {
    const inner = isRecord(value.request) ? value.request : {}
    if (
      inner.subtype === 'can_use_tool' &&
      typeof value.request_id === 'string' &&
      typeof inner.tool_use_id === 'string' &&
      typeof inner.tool_name === 'string'
    ) {
      const input = inner.input ?? {}
      capture.pendingTool = {
        requestId: value.request_id,
        toolUseId: inner.tool_use_id,
        toolId: inner.tool_name,
        input,
        inputDigest: fingerprint(input),
      }
      capture.toolUses.set(inner.tool_use_id, {
        toolId: inner.tool_name,
        inputDigest: fingerprint(input),
      })
    }
  }
  const message = isRecord(value.message) ? value.message : {}
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (
        isRecord(block) &&
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        capture.toolUses.set(block.id, {
          toolId: block.name,
          inputDigest: fingerprint(block.input ?? {}),
        })
      }
      if (
        isRecord(block) &&
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        const toolUse = capture.toolUses.get(block.tool_use_id)
        if (!toolUse) continue
        const execution: PublishedAgentRuntimeToolExecution = {
          toolId: toolUse.toolId,
          toolUseId: block.tool_use_id,
          inputDigest: toolUse.inputDigest,
          resultDigest: fingerprint(block.content ?? null),
        }
        const priorIndex = capture.toolExecutions.findIndex(
          item => item.toolUseId === execution.toolUseId,
        )
        if (priorIndex >= 0) capture.toolExecutions[priorIndex] = execution
        else capture.toolExecutions.push(execution)
      }
    }
  }
}

async function fileSha256(path: string): Promise<string> {
  const bytes = readFileSync(path)
  return createHash('sha256').update(bytes).digest('hex')
}

async function runChild(
  request: PublishedAgentRuntimeRequest,
  session: AgentSession,
  onExternalBoundary: () => void,
): Promise<{
  capture: RuntimeCapture
  runtimeBuild: string
}> {
  const executable = runtimeExecutable()
  if (!existsSync(executable.command)) {
    throw new Error(`Published runtime binary does not exist: ${executable.command}`)
  }
  const agentJson = JSON.stringify({
    [session.agentName]: session.agentDefinition,
  })
  const args = [
    ...executable.prefix,
    '-p',
    '--bare',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode',
    'default',
    '--permission-prompt-tool',
    'stdio',
    '--agents',
    agentJson,
    '--agent',
    session.agentName,
    '--tools',
    request.projection.tools.inventory.join(','),
    ...(request.phase === 'start'
      ? ['--session-id', session.sessionId]
      : ['--resume', session.sessionId]),
    ...permissionArgs(request),
  ]
  if (session.agentDefinition.model) {
    args.push('--model', session.agentDefinition.model)
  }

  const capture: RuntimeCapture = {
    sessionId: null,
    runtimeVersion: null,
    toolInventory: null,
    requestedSkillIds: [],
    resolvedSkillIds: [],
    preloadedSkillIds: [],
    failedSkillIds: [],
    pendingTool: null,
    result: undefined,
    resultError: null,
    toolUses: new Map(
      session.pendingTool
        ? [[
            session.pendingTool.toolUseId,
            {
              toolId: session.pendingTool.toolId,
              inputDigest: session.pendingTool.inputDigest,
            },
          ]]
        : [],
    ),
    toolExecutions: [],
  }
  const timeoutValue = Number(process.env.MOSSEN_PUBLISHED_RUNTIME_TIMEOUT_MS)
  const timeoutMs =
    Number.isFinite(timeoutValue) && timeoutValue >= 1_000 && timeoutValue <= 600_000
      ? timeoutValue
      : DEFAULT_TIMEOUT_MS
  const child = spawn(executable.command, args, {
    cwd: session.workspace,
    env: {
      ...process.env,
      MOSSEN_PUBLISHED_OPERATION_ID: request.operationId,
      MOSSEN_CODE_ENTRYPOINT: 'mossen-published-runtime',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })

  let stdoutBytes = 0
  let stderr = ''
  let lineBuffer = ''
  let stopScheduled = false
  let resultSeen = false
  let resolveExit: ((code: number | null) => void) | undefined
  let rejectExit: ((error: Error) => void) | undefined
  const exitPromise = new Promise<number | null>((resolve, reject) => {
    resolveExit = resolve
    rejectExit = reject
  })
  child.once('error', error => rejectExit?.(error))
  child.once('exit', code => resolveExit?.(code))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < MAX_STDERR_BYTES) {
      stderr += chunk.slice(0, MAX_STDERR_BYTES - stderr.length)
    }
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBytes += Buffer.byteLength(chunk, 'utf8')
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      if (!child.killed) child.kill('SIGTERM')
      rejectExit?.(new Error(`Published Agent stdout exceeded ${MAX_STDOUT_BYTES} bytes.`))
      return
    }
    lineBuffer += chunk
    for (;;) {
      const newline = lineBuffer.indexOf('\n')
      if (newline < 0) break
      const line = lineBuffer.slice(0, newline).trim()
      lineBuffer = lineBuffer.slice(newline + 1)
      if (!line) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      inspectMessage(parsed, capture)
      if (isRecord(parsed) && parsed.type === 'result') {
        resultSeen = true
        child.stdin.end()
      }
      if (capture.pendingTool && !stopScheduled) {
        stopScheduled = true
        setTimeout(() => {
          if (!child.killed) child.kill('SIGTERM')
        }, 250)
      }
    }
  })

  if (request.phase === 'start') {
    onExternalBoundary()
    child.stdin.write(
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: runtimePrompt(request) },
      })}\n`,
    )
  } else {
    const pending = session.pendingTool
    if (!pending || !request.toolDecision) {
      if (!child.killed) child.kill('SIGTERM')
      throw new Error('Published Agent resume is missing its Tool checkpoint.')
    }
    onExternalBoundary()
    setTimeout(() => {
      if (child.stdin.destroyed) return
      child.stdin.write(
        `${JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: pending.requestId,
            response: {
              behavior: 'allow',
              updatedInput: pending.input,
              toolUseID: pending.toolUseId,
            },
          },
        })}\n`,
      )
    }, 100)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const code = await Promise.race([
    exitPromise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM')
        reject(new Error(`Published Agent runtime timed out after ${timeoutMs}ms.`))
      }, timeoutMs)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })

  if (!capture.pendingTool && !resultSeen) {
    throw new Error(
      `Published Agent exited ${String(code)} without a wait or result.${
        stderr.trim() ? ` ${stderr.trim().slice(0, 1000)}` : ''
      }`,
    )
  }
  const runtimeBuild = executable.prefix.length
    ? `source:${fingerprint(executable.prefix)}`
    : `sha256:${await fileSha256(executable.command)}`
  return { capture, runtimeBuild }
}

export async function executePublishedAgentRuntime(
  request: PublishedAgentRuntimeRequest,
): Promise<PublishedAgentRuntimeOutcome> {
  let session = request.session
  let crossedExternalBoundary = false
  try {
    if (request.phase === 'start') {
      session ??= await freezeAgentSession(request)
    } else if (!session) {
      throw new Error('Agent Tool resume has no frozen session.')
    }
    validateFrozenAgentSession(request, session)
    const priorPending = session.pendingTool
    const { capture, runtimeBuild } = await runChild(
      request,
      session,
      () => {
        crossedExternalBoundary = true
      },
    )
    if (
      capture.toolInventory === null ||
      !sameStringSet(capture.toolInventory, request.projection.tools.inventory)
    ) {
      throw new Error('Mossen system_init Tool inventory differs from the frozen projection.')
    }
    const runtimeVersion = capture.runtimeVersion ?? 'unknown'
    const toolExecution = priorPending
      ? capture.toolExecutions.find(
          item => item.toolUseId === priorPending.toolUseId,
        ) ?? null
      : null
    if (request.phase === 'resume_tool' && !toolExecution) {
      throw new Error('Allowed Tool execution produced no matching Tool result evidence.')
    }
    if (capture.pendingTool) {
      return {
        status: 'waiting',
        session: { ...session, pendingTool: capture.pendingTool },
        runtimeVersion,
        runtimeBuild,
        requestedSkillIds: capture.requestedSkillIds,
        resolvedSkillIds: capture.resolvedSkillIds,
        preloadedSkillIds: capture.preloadedSkillIds,
        failedSkillIds: capture.failedSkillIds,
        toolExecution,
        toolExecutions: capture.toolExecutions,
      }
    }
    if (capture.resultError) {
      return {
        status: 'failed',
        session: { ...session, pendingTool: null },
        runtimeVersion,
        runtimeBuild,
        requestedSkillIds: capture.requestedSkillIds,
        resolvedSkillIds: capture.resolvedSkillIds,
        preloadedSkillIds: capture.preloadedSkillIds,
        failedSkillIds: capture.failedSkillIds,
        code: 'agent_runtime_failed',
        error: capture.resultError,
        toolExecutions: capture.toolExecutions,
      }
    }
    return {
      status: 'completed',
      session: { ...session, pendingTool: null },
      runtimeVersion,
      runtimeBuild,
      requestedSkillIds: capture.requestedSkillIds,
      resolvedSkillIds: capture.resolvedSkillIds,
      preloadedSkillIds: capture.preloadedSkillIds,
      failedSkillIds: capture.failedSkillIds,
      output: capture.result ?? null,
      toolExecution,
      toolExecutions: capture.toolExecutions,
    }
  } catch (error) {
    return {
      status: crossedExternalBoundary ? 'unknown' : 'failed',
      session,
      runtimeVersion: null,
      runtimeBuild: null,
      requestedSkillIds: [...request.projection.skills.required],
      resolvedSkillIds: [],
      preloadedSkillIds: [],
      failedSkillIds: [],
      code: crossedExternalBoundary
        ? 'execution_outcome_unknown'
        : 'agent_runtime_failed',
      error: error instanceof Error ? error.message : String(error),
    } as PublishedAgentRuntimeOutcome
  }
}
