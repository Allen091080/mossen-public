import { parse } from 'acorn'

export type WorkflowStaticPhaseKind = 'sequential' | 'parallel' | 'loop'

export type WorkflowStaticAgent = {
  prompt: string
}

export type WorkflowStaticPhase = {
  kind: WorkflowStaticPhaseKind
  annotation?: string
  agents: WorkflowStaticAgent[]
}

export type WorkflowStaticSummary = {
  phases: WorkflowStaticPhase[]
  estimatedAgents: number
  hasReturn: boolean
}

type AstNode = {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

type WalkContext = {
  inParallel: boolean
  loopAnnotation?: string
}

const MAX_PROMPT_PREVIEW_CHARS = 100
const MAX_LOOP_ANNOTATION_CHARS = 40

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

function truncate(text: string, max = MAX_PROMPT_PREVIEW_CHARS): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}...`
}

function normalizePreview(text: string): string {
  return truncate(text.replace(/\s+/g, ' ').trim())
}

function sourceFor(source: string, node: AstNode | null | undefined): string {
  if (!node) return ''
  return source.slice(node.start, node.end)
}

function isIdentifier(node: unknown, name: string): boolean {
  return isAstNode(node) && node.type === 'Identifier' && node.name === name
}

function calleeIs(node: AstNode, name: string): boolean {
  return isIdentifier(node.callee, name)
}

function promptPreview(source: string, node: AstNode | null | undefined): string {
  if (!node) return ''
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return normalizePreview(node.value)
  }
  if (node.type === 'TemplateLiteral') {
    const quasis = Array.isArray(node.quasis) ? node.quasis : []
    const parts: string[] = []
    quasis.forEach((quasi, index) => {
      if (isAstNode(quasi)) {
        const value = quasi.value
        if (typeof value === 'object' && value !== null) {
          const cooked = (value as { cooked?: unknown }).cooked
          parts.push(typeof cooked === 'string' ? cooked : '')
        }
      }
      if (index < quasis.length - 1) parts.push('${...}')
    })
    return normalizePreview(parts.join(''))
  }
  return normalizePreview(sourceFor(source, node))
}

function loopAnnotation(source: string, node: AstNode): string | undefined {
  let text = ''
  if (node.type === 'WhileStatement' || node.type === 'DoWhileStatement') {
    text = sourceFor(source, node.test as AstNode | undefined)
  } else if (node.type === 'ForStatement') {
    const init = sourceFor(source, node.init as AstNode | undefined)
    const test = sourceFor(source, node.test as AstNode | undefined)
    const update = sourceFor(source, node.update as AstNode | undefined)
    text = [init, test, update].filter(Boolean).join('; ')
  } else if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
    const op = node.type === 'ForOfStatement' ? 'of' : 'in'
    text = `${sourceFor(source, node.left as AstNode | undefined)} ${op} ${sourceFor(
      source,
      node.right as AstNode | undefined,
    )}`
  }
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized ? truncate(normalized, MAX_LOOP_ANNOTATION_CHARS) : undefined
}

function walkChildren(source: string, node: AstNode, context: WalkContext, visit: (node: AstNode, context: WalkContext) => void): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue
    }
    if (isAstNode(value)) {
      visit(value, context)
      continue
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) visit(child, context)
      }
    }
  }
}

function appendPhase(
  phases: WorkflowStaticPhase[],
  kind: WorkflowStaticPhaseKind,
  annotation: string | undefined,
  prompt: string,
): void {
  const previous = phases.at(-1)
  if (previous && previous.kind === kind && previous.annotation === annotation) {
    previous.agents.push({ prompt })
    return
  }
  phases.push({
    kind,
    ...(annotation ? { annotation } : {}),
    agents: [{ prompt }],
  })
}

export function analyzeWorkflowStaticSummary(
  scriptBody: string,
): WorkflowStaticSummary | null {
  try {
    const program = parse(scriptBody, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown as AstNode
    const phases: WorkflowStaticPhase[] = []
    const visit = (node: AstNode, context: WalkContext): void => {
      if (node.type === 'CallExpression') {
        if (calleeIs(node, 'parallel')) {
          const args = Array.isArray(node.arguments) ? node.arguments : []
          for (const arg of args) {
            if (isAstNode(arg)) visit(arg, { ...context, inParallel: true })
          }
          return
        }
        if (calleeIs(node, 'agent')) {
          const args = Array.isArray(node.arguments) ? node.arguments : []
          const firstArg = args.find(isAstNode)
          const kind = context.inParallel
            ? 'parallel'
            : context.loopAnnotation
              ? 'loop'
              : 'sequential'
          appendPhase(
            phases,
            kind,
            kind === 'loop' ? context.loopAnnotation : undefined,
            promptPreview(scriptBody, firstArg),
          )
          return
        }
      }

      if (
        node.type === 'ForStatement' ||
        node.type === 'ForInStatement' ||
        node.type === 'ForOfStatement' ||
        node.type === 'WhileStatement' ||
        node.type === 'DoWhileStatement'
      ) {
        const body = node.body
        if (isAstNode(body)) {
          visit(body, {
            ...context,
            loopAnnotation: loopAnnotation(scriptBody, node),
          })
        }
        return
      }

      walkChildren(scriptBody, node, context, visit)
    }

    visit(program, { inParallel: false })
    if (phases.length === 0) return null
    return {
      phases,
      estimatedAgents: phases.reduce((total, phase) => {
        const count = phase.agents.length
        return total + (phase.kind === 'sequential' ? count : count * 3)
      }, 0),
      hasReturn: /\breturn\b/.test(scriptBody),
    }
  } catch {
    return null
  }
}
