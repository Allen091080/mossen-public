import { extractMeta } from './engine/meta.js'
import {
  checkWorkflowScriptDeterminism,
  checkWorkflowScriptSyntax,
} from './engine/sandbox.js'

export const MAX_DYNAMIC_WORKFLOW_TASK_CHARS = 12_000

const MAX_DYNAMIC_WORKFLOW_TITLE_CHARS = 96

function compact(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 3)}...`
}

function slugFromTask(task: string): string {
  const ascii = task
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return ascii || 'task'
}

function js(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function buildDynamicWorkflowScript(task: string): string {
  const normalizedTask = task.replace(/\s+/g, ' ').trim()
  if (!normalizedTask) {
    throw new Error('Workflow task must be a non-empty string.')
  }
  if (normalizedTask.length > MAX_DYNAMIC_WORKFLOW_TASK_CHARS) {
    throw new Error(
      `Workflow task exceeds ${MAX_DYNAMIC_WORKFLOW_TASK_CHARS} characters.`,
    )
  }

  const shortTitle = compact(normalizedTask, MAX_DYNAMIC_WORKFLOW_TITLE_CHARS)
  const meta = {
    name: `dynamic-${slugFromTask(normalizedTask)}`,
    title: `Dynamic workflow: ${shortTitle}`,
    description: `Auto-plan, execute, verify, and synthesize: ${shortTitle}`,
    whenToUse:
      'Use when the user asks Mossen to handle a broad task through multi-agent workflow orchestration.',
    phases: [
      {
        title: 'Plan',
        detail: 'Convert the user task into work items, success criteria, and verification strategy',
      },
      {
        title: 'Execute',
        detail: 'Run specialist subagents in parallel against the planned work items',
      },
      {
        title: 'Verify',
        detail: 'Cross-check agent outputs and identify gaps, failures, or missing evidence',
      },
      {
        title: 'Synthesize',
        detail: 'Return final answer, evidence, validation commands, artifacts, and residual risks',
      },
    ],
  }

  return `export const meta = ${js(meta)}

const TASK = ${js(normalizedTask)}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'successCriteria', 'workItems', 'verificationPlan'],
  properties: {
    summary: { type: 'string' },
    successCriteria: { type: 'array', items: { type: 'string' } },
    verificationPlan: { type: 'array', items: { type: 'string' } },
    workItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'prompt'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          prompt: { type: 'string' },
          agentType: { type: 'string' },
          model: { type: 'string' },
          isolation: { type: 'string', enum: ['worktree', 'remote'] },
        },
      },
    },
  },
}

const WORK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'summary', 'evidence', 'artifacts', 'risks', 'nextActions'],
  properties: {
    key: { type: 'string' },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    artifacts: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    nextActions: { type: 'array', items: { type: 'string' } },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'accepted', 'summary', 'evidence', 'gaps'],
  properties: {
    key: { type: 'string' },
    accepted: { type: 'boolean' },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'evidence', 'validationCommands', 'artifacts', 'residualRisks', 'openQuestions'],
  properties: {
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    validationCommands: { type: 'array', items: { type: 'string' } },
    artifacts: { type: 'array', items: { type: 'string' } },
    residualRisks: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function stableKey(value, index) {
  const raw = String(value && value.key ? value.key : value && value.title ? value.title : 'item-' + index)
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item-' + index
}

phase('Plan')
const plan = await agent(\`
You are the workflow planner. Convert this user task into a concrete multi-agent execution plan.

User task:
\${TASK}

Return success criteria, a verification plan, and 3-8 independent work items.
Each work item must be suitable for one specialist subagent and include a prompt with enough context to run independently.
Prefer worktree isolation for local code edits, remote isolation only when the task should run away from this checkout.
\`, { label: 'planner', phase: 'Plan', schema: PLAN_SCHEMA })

const plannedItems = asArray(plan && plan.workItems)
const fallbackItems = [
  {
    key: 'understand',
    title: 'Understand task and current state',
    prompt: 'Inspect the current project state relevant to the task and summarize constraints, risks, and required files.',
  },
  {
    key: 'execute',
    title: 'Execute primary work',
    prompt: 'Perform the primary implementation or analysis needed for the task. Return concrete evidence and changed or relevant artifacts.',
  },
  {
    key: 'verify',
    title: 'Verify result',
    prompt: 'Verify the task outcome independently. Run or identify validation commands, check for missing work, and report residual risks.',
  },
]
const workItems = (plannedItems.length ? plannedItems : fallbackItems).slice(0, 8).map((item, index) => ({
  key: stableKey(item, index + 1),
  title: item && item.title ? String(item.title) : 'Work item ' + (index + 1),
  prompt: item && item.prompt ? String(item.prompt) : String(item && item.title ? item.title : TASK),
  agentType: item && item.agentType ? String(item.agentType) : undefined,
  model: item && item.model ? String(item.model) : undefined,
  isolation: item && item.isolation === 'remote' ? 'remote' : item && item.isolation === 'worktree' ? 'worktree' : undefined,
}))
log('planned ' + workItems.length + ' work item(s)')

phase('Execute')
const results = await parallel(workItems.map(item => () => agent(\`
You are executing one work item in a larger Mossen dynamic workflow.

Overall task:
\${TASK}

Work item:
\${item.title}

Instructions:
\${item.prompt}

Return concise findings, concrete evidence, artifact paths if any, risks, and next actions.
\`, {
  label: 'execute:' + item.key,
  phase: 'Execute',
  schema: WORK_SCHEMA,
  agentType: item.agentType,
  model: item.model,
  isolation: item.isolation,
})))

phase('Verify')
const completed = results.filter(Boolean)
const verifications = await parallel(completed.map((result, index) => () => agent(\`
You are verifying one work item result from a Mossen dynamic workflow.

Overall task:
\${TASK}

Planned success criteria:
\${asArray(plan && plan.successCriteria).map((item, i) => (i + 1) + '. ' + item).join('\\n')}

Work item result:
\${asText(result)}

Try to falsify the result. Mark accepted=false when evidence is weak, validation is missing, or the result does not satisfy the task.
\`, {
  label: 'verify:' + (result && result.key ? result.key : 'result-' + (index + 1)),
  phase: 'Verify',
  schema: VERIFY_SCHEMA,
})))

phase('Synthesize')
const final = await agent(\`
Synthesize the full dynamic workflow outcome for the user.

Overall task:
\${TASK}

Plan:
\${asText(plan)}

Work item results:
\${asText(completed)}

Verification results:
\${asText(verifications.filter(Boolean))}

Return a direct final summary, evidence, validation commands already run or still required, artifacts, residual risks, and open questions.
\`, { label: 'synthesis', phase: 'Synthesize', schema: FINAL_SCHEMA })

return {
  summary: final.summary,
  plan,
  workItems,
  results: completed,
  verifications: verifications.filter(Boolean),
  verification: {
    summary: final.summary,
    commands: asArray(final.validationCommands),
    evidence: asArray(final.evidence),
    artifacts: asArray(final.artifacts),
    failures: asArray(final.residualRisks),
  },
  openQuestions: asArray(final.openQuestions),
}
`
}

export function assertDynamicWorkflowScriptValid(source: string): void {
  const { scriptBody } = extractMeta(source)
  const determinismError = checkWorkflowScriptDeterminism(scriptBody)
  if (determinismError) throw new Error(determinismError)
  const syntax = checkWorkflowScriptSyntax(scriptBody)
  if ('error' in syntax) throw new Error(syntax.error)
}
