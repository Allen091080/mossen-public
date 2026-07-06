import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getSessionGoalState } from '../../bootstrap/state.js'
import {
  buildLoopBoard,
  renderLoopBoard,
  renderLoopBoardJson,
} from './loopBoard.js'

function getCommandTasks(
  context: LocalJSXCommandContext,
): Record<string, unknown> | undefined {
  if (typeof context.getAppState !== 'function') return undefined
  try {
    return context.getAppState().tasks
  } catch {
    return undefined
  }
}

function wantsJson(args: string): boolean {
  return args.trim().split(/\s+/).includes('--json')
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<null> {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const command = tokens[0] ?? 'status'
  if (command !== 'status' && command !== '--json') {
    onDone('Usage: /loop [status] [--json]', { display: 'system' })
    return null
  }
  const board = buildLoopBoard({
    goal: getSessionGoalState(),
    tasks: getCommandTasks(context),
  })
  onDone(wantsJson(args) ? renderLoopBoardJson(board) : renderLoopBoard(board), {
    display: 'system',
  })
  return null
}
