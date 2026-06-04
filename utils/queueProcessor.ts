import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
} from '../constants/xml.js'
import {
  dequeue,
  dequeueAllMatching,
  hasCommandsInQueue,
  peek,
} from './messageQueueManager.js'

type ProcessQueueParams = {
  executeInput: (commands: QueuedCommand[]) => Promise<void>
}

type ProcessQueueResult = {
  processed: boolean
}

/**
 * Check if a queued command is a slash command (value starts with '/').
 */
function isSlashCommand(cmd: QueuedCommand): boolean {
  if (typeof cmd.value === 'string') {
    return cmd.value.trim().startsWith('/')
  }
  // For ContentBlockParam[], check the first text block
  for (const block of cmd.value) {
    if (block.type === 'text') {
      return block.text.trim().startsWith('/')
    }
  }
  return false
}

function extractSimpleTag(value: string, tagName: string): string | null {
  const match = new RegExp(
    `<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'i',
  ).exec(value)
  return match?.[1] ?? null
}

/**
 * Successful background Bash completions are UI notifications, not user input.
 * If they are drained during an active query, query.ts can still attach them to
 * that turn. Once the turn is idle, they must not start a fresh model turn or
 * the assistant may repeat the just-finished background command.
 */
export function isPassiveCompletedBackgroundBashNotification(
  cmd: QueuedCommand,
): boolean {
  if (cmd.mode !== 'task-notification' || typeof cmd.value !== 'string') {
    return false
  }
  if (!cmd.value.includes(`<${TASK_NOTIFICATION_TAG}`)) {
    return false
  }
  if (extractSimpleTag(cmd.value, STATUS_TAG) !== 'completed') {
    return false
  }
  return (
    extractSimpleTag(cmd.value, SUMMARY_TAG)?.startsWith(
      'Background command ',
    ) ?? false
  )
}

/**
 * Processes commands from the queue.
 *
 * Slash commands (starting with '/') and bash-mode commands are processed
 * one at a time so each goes through the executeInput path individually.
 * Bash commands need individual processing to preserve per-command error
 * isolation, exit codes, and progress UI. Other non-slash commands are
 * batched: all items **with the same mode** as the highest-priority item
 * are drained at once and passed as a single array to executeInput — each
 * becomes its own user message with its own UUID. Different modes
 * (e.g. prompt vs task-notification) are never mixed because they are
 * treated differently downstream.
 *
 * The caller is responsible for ensuring no query is currently running
 * and for calling this function again after each command completes
 * until the queue is empty.
 *
 * @returns result with processed status
 */
export function processQueueIfReady({
  executeInput,
}: ProcessQueueParams): ProcessQueueResult {
  // This processor runs on the REPL main thread between turns. Skip anything
  // addressed to a subagent — an unfiltered peek() returning a subagent
  // notification would set targetMode, dequeueAllMatching would find nothing
  // matching that mode with agentId===undefined, and we'd return processed:
  // false with the queue unchanged → the React effect never re-fires and any
  // queued user prompt stalls permanently.
  const isMainThread = (cmd: QueuedCommand) => cmd.agentId === undefined

  const next = peek(isMainThread)
  if (!next) {
    return { processed: false }
  }

  // Slash commands and bash-mode commands are processed individually.
  // Bash commands need per-command error isolation, exit codes, and progress UI.
  if (isSlashCommand(next) || next.mode === 'bash') {
    const cmd = dequeue(isMainThread)!
    void executeInput([cmd])
    return { processed: true }
  }

  if (isPassiveCompletedBackgroundBashNotification(next)) {
    const commands = dequeueAllMatching(
      cmd =>
        isMainThread(cmd) &&
        !isSlashCommand(cmd) &&
        isPassiveCompletedBackgroundBashNotification(cmd),
    )
    return { processed: commands.length > 0 }
  }

  // Drain all non-slash-command items with the same mode at once.
  const targetMode = next.mode
  const commands = dequeueAllMatching(
    cmd =>
      isMainThread(cmd) &&
      !isSlashCommand(cmd) &&
      cmd.mode === targetMode &&
      !isPassiveCompletedBackgroundBashNotification(cmd),
  )
  if (commands.length === 0) {
    return { processed: false }
  }

  void executeInput(commands)
  return { processed: true }
}

/**
 * Checks if the queue has pending commands.
 * Use this to determine if queue processing should be triggered.
 */
export function hasQueuedCommands(): boolean {
  return hasCommandsInQueue()
}
