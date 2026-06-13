import { dirname } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  loadRunLog,
  loadRunMeta,
  workflowReportPath,
} from '../../tools/WorkflowTool/engine/journalStore.js'
import {
  workflowRunToJson,
  type WorkflowJsonRun,
  type WorkflowJsonTreeNode,
} from './workflowProgressTree.js'

export type WorkflowReportExportResult = {
  ok: boolean
  runId: string
  path: string | null
  message: string
}

function line(value = ''): string {
  return `${value}\n`
}

function formatMetric(value: number | null | undefined): string {
  return value == null ? 'n/a' : String(value)
}

function renderTreeNode(node: WorkflowJsonTreeNode, depth = 0): string {
  const indent = '  '.repeat(depth)
  const metrics = [
    node.agentNumber == null ? null : `agent #${node.agentNumber}`,
    node.agentId ? `agentId=${node.agentId}` : null,
    node.phase ? `phase=${node.phase}` : null,
    node.model ? `model=${node.model}` : null,
    node.agentType ? `agent=${node.agentType}` : null,
    node.isolation ? `isolation=${node.isolation}` : null,
    node.remoteSessionId ? `remote=${node.remoteSessionId}` : null,
    node.tokenUsage.totalTokens == null
      ? null
      : `${node.tokenUsage.totalTokens} tok`,
    node.toolCalls ? `${node.toolCalls} tools` : null,
  ].filter(Boolean)
  let rendered = `${indent}- [${node.state}] ${node.kind}: ${node.label}`
  if (metrics.length > 0) rendered += ` (${metrics.join(', ')})`
  if (node.statusContext) rendered += `\n${indent}  - status: ${node.statusContext}`
  if (node.promptPreview) rendered += `\n${indent}  - prompt: ${node.promptPreview}`
  if (node.transcriptPath) rendered += `\n${indent}  - transcript: ${node.transcriptPath}`
  if (node.lastToolName || node.lastToolSummary) {
    rendered += `\n${indent}  - last tool: ${[
      node.lastToolName,
      node.lastToolSummary,
    ].filter(Boolean).join(' ')}`
  }
  if (node.error) rendered += `\n${indent}  - error: ${node.error}`
  if (node.resultSummary) rendered += `\n${indent}  - result: ${node.resultSummary}`
  for (const child of node.children) {
    rendered += `\n${renderTreeNode(child, depth + 1)}`
  }
  return rendered
}

export function renderWorkflowReport(
  run: WorkflowJsonRun,
  options: { log?: string[] } = {},
): string {
  const title = run.title ?? run.workflowName
  let body = ''
  body += line(`# Workflow Report: ${title}`)
  body += line()
  body += line('## Summary')
  body += line(`- Run ID: ${run.runId}`)
  body += line(`- State: ${run.state}`)
  body += line(`- Status: ${run.status}`)
  body += line(`- Parent goal: ${run.parentGoalId ?? 'n/a'}`)
  body += line(`- Created: ${run.createdAt}`)
  body += line(`- Duration ms: ${formatMetric(run.durationMs)}`)
  body += line(`- Agents: ${run.agentCount}`)
  body += line(`- Tool calls: ${run.totalToolCalls}`)
  body += line(`- Tokens: ${formatMetric(run.tokenUsage.totalTokens)}`)
  body += line(`- Default model: ${run.defaultModel ?? 'n/a'}`)
  body += line(`- Script: ${run.scriptPath ?? 'n/a'}`)
  body += line(`- Transcript dir: ${run.transcriptDir ?? 'n/a'}`)
  body += line()
  body += line('## Description')
  body += line(run.description || 'n/a')
  body += line()
  body += line('## Progress Tree')
  body += line(renderTreeNode(run.tree))
  body += line()
  body += line('## Verification Evidence')
  body += line(`- State: ${run.verification.state}`)
  body += line(`- Summary: ${run.verification.summary ?? 'n/a'}`)
  if (run.verification.evidence.length > 0) {
    body += line('- Evidence:')
    for (const item of run.verification.evidence) body += line(`  - ${item}`)
  }
  if (run.verification.commands.length > 0) {
    body += line('- Validation commands:')
    for (const command of run.verification.commands) body += line(`  - ${command}`)
  }
  if (run.verification.artifacts.length > 0) {
    body += line('- Artifacts:')
    for (const artifact of run.verification.artifacts) body += line(`  - ${artifact}`)
  }
  if (run.verification.failures.length > 0) {
    body += line('- Verification failures:')
    for (const failure of run.verification.failures) body += line(`  - ${failure}`)
  }
  body += line()
  if (run.resultSummary) {
    body += line('## Result')
    body += line(run.result ?? run.resultSummary)
    body += line()
  }
  if (run.failures.length > 0) {
    body += line('## Failures')
    for (const failure of run.failures) body += line(`- ${failure}`)
    body += line()
  }
  const log = options.log ?? []
  if (log.length > 0) {
    body += line('## Recent Log')
    body += line('```text')
    body += line(log.slice(-120).join('\n'))
    body += line('```')
    body += line()
  }
  return body
}

export function exportWorkflowRunReport(
  runId: string | undefined,
): WorkflowReportExportResult {
  const trimmedRunId = runId?.trim() ?? ''
  if (!trimmedRunId) {
    return {
      ok: false,
      runId: '',
      path: null,
      message: 'Usage: /workflows export <runId>',
    }
  }
  const meta = loadRunMeta(trimmedRunId)
  if (!meta) {
    return {
      ok: false,
      runId: trimmedRunId,
      path: null,
      message: `Workflow run not found: ${trimmedRunId}`,
    }
  }
  const run = workflowRunToJson(meta)
  const reportPath = workflowReportPath(trimmedRunId)
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, renderWorkflowReport(run, { log: loadRunLog(trimmedRunId) }), 'utf8')
  return {
    ok: true,
    runId: trimmedRunId,
    path: reportPath,
    message: `Workflow report exported: ${reportPath}`,
  }
}
