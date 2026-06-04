/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import type { MossenToolUseBlock } from '../api/mossenSdk.js'
import {
  createUserMessage,
  REJECT_MESSAGE,
  withMemoryCorrectionHint,
} from 'src/utils/messages.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type Tools, type ToolUseContext } from '../../Tool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { createChildAbortController } from '../../utils/abortController.js'
import {
  registerInFlightTool,
  unregisterInFlightTool,
} from './toolCancelRegistry.js'
import { runToolUse } from './toolExecution.js'

type MessageUpdate = {
  message?: Message
  newContext?: ToolUseContext
}

type AppStateUpdater = Parameters<ToolUseContext['setAppState']>[0]
type DeferredSideEffect = (context: ToolUseContext) => void

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

type TrackedTool = {
  id: string
  block: MossenToolUseBlock
  assistantMessage: AssistantMessage
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: Message[]
  // Progress messages are stored separately and yielded immediately
  pendingProgress: Message[]
  contextModifiers?: Array<(context: ToolUseContext) => ToolUseContext>
  deferredSideEffects?: DeferredSideEffect[]
  hasVisibleToolJSX?: boolean
}

/**
 * Executes tools as they stream in with concurrency control.
 * - Concurrent-safe tools can execute in parallel with other concurrent-safe tools
 * - Non-concurrent tools must execute alone (exclusive access)
 * - Results are buffered and emitted in the order tools were received
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private hasErrored = false
  private erroredToolDescription = ''
  // Child of toolUseContext.abortController. Fires when a Bash tool errors
  // so sibling subprocesses die immediately instead of running to completion.
  // Aborting this does NOT abort the parent — query.ts won't end the turn.
  private siblingAbortController: AbortController
  private discarded = false
  // Signal to wake up getRemainingResults when progress is available
  private progressAvailableResolve?: () => void

  constructor(
    private readonly toolDefinitions: Tools,
    private readonly canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(
      toolUseContext.abortController,
    )
  }

  /**
   * Discards all pending and in-progress tools. Called when streaming fallback
   * occurs and results from the failed attempt should be abandoned.
   * Queued tools won't start, and in-progress tools will receive synthetic errors.
   */
  discard(): void {
    if (this.discarded) {
      return
    }
    this.discarded = true
    let shouldClearToolJSX = false
    for (const tool of this.tools) {
      tool.pendingProgress.length = 0
      shouldClearToolJSX = shouldClearToolJSX || tool.hasVisibleToolJSX === true
      tool.hasVisibleToolJSX = false
      if (tool.status !== 'yielded') {
        markToolUseAsComplete(this.toolUseContext, tool.id)
        tool.status = 'yielded'
        tool.results = []
        tool.contextModifiers = []
        tool.deferredSideEffects = []
      }
    }
    if (shouldClearToolJSX) {
      this.toolUseContext.setToolJSX?.(null)
    }
    this.updateInterruptibleState()
    if (!this.siblingAbortController.signal.aborted) {
      this.siblingAbortController.abort('streaming_fallback')
    }
    if (this.progressAvailableResolve) {
      this.progressAvailableResolve()
      this.progressAvailableResolve = undefined
    }
  }

  /**
   * Add a tool to the execution queue. Will start executing immediately if conditions allow.
   */
  addTool(block: MossenToolUseBlock, assistantMessage: AssistantMessage): void {
    const toolDefinition = findToolByName(this.toolDefinitions, block.name)
    if (!toolDefinition) {
      this.tools.push({
        id: block.id,
        block,
        assistantMessage,
        status: 'completed',
        isConcurrencySafe: true,
        pendingProgress: [],
        results: [
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>`,
                is_error: true,
                tool_use_id: block.id,
              },
            ],
            toolUseResult: `Error: No such tool available: ${block.name}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        ],
      })
      return
    }

    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
      : false
    this.tools.push({
      id: block.id,
      block,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
    })

    void this.processQueue()
  }

  /**
   * Check if a tool can execute based on current concurrency state
   */
  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    return (
      executingTools.length === 0 ||
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
    )
  }

  /**
   * Process the queue, starting tools when concurrency conditions allow
   */
  private async processQueue(): Promise<void> {
    if (this.discarded) {
      return
    }
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)
      } else {
        // Can't execute this tool yet, and since we need to maintain order for non-concurrent tools, stop here
        if (!tool.isConcurrencySafe) break
      }
    }
  }

  private createSyntheticErrorMessage(
    toolUseId: string,
    reason:
      | 'sibling_error'
      | 'user_interrupted'
      | 'streaming_fallback'
      | 'tool_cancel',
    assistantMessage: AssistantMessage,
  ): Message {
    // For user interruptions (ESC to reject), use REJECT_MESSAGE so the UI shows
    // "User rejected edit" instead of "Error editing file"
    if (reason === 'user_interrupted') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: withMemoryCorrectionHint(REJECT_MESSAGE),
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'User rejected tool use',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    if (reason === 'tool_cancel') {
      // Distinct from user_interrupted: this is a programmatic single-tool
      // cancel via control_request, not a user-driven ESC. Sibling tools in
      // the same turn keep running; only this tool's slot needs a closing
      // tool_result so the API turn balances.
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content:
              '<tool_use_error>Tool cancelled by SDK client (control_request: tool_cancel)</tool_use_error>',
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Tool cancelled by SDK client',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    if (reason === 'streaming_fallback') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content:
              '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>',
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Streaming fallback - tool execution discarded',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    const desc = this.erroredToolDescription
    const msg = desc
      ? `Cancelled: parallel tool call ${desc} errored`
      : 'Cancelled: parallel tool call errored'
    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: `<tool_use_error>${msg}</tool_use_error>`,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: msg,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
  }

  /**
   * Determine why a tool should be cancelled.
   */
  private getAbortReason(
    tool: TrackedTool,
    perToolController?: AbortController,
  ): 'sibling_error' | 'user_interrupted' | 'streaming_fallback' | 'tool_cancel' | null {
    if (this.discarded) {
      return 'streaming_fallback'
    }
    if (this.hasErrored) {
      return 'sibling_error'
    }
    // tool_cancel checks the leaf controller (not turn-level) — it's a
    // per-tool abort initiated by an SDK consumer that must NOT cascade to
    // siblings or the turn. Take precedence over the turn-level check so a
    // simultaneously-fired interrupt doesn't reclassify the reason.
    if (
      perToolController?.signal.aborted &&
      perToolController.signal.reason === 'tool_cancel'
    ) {
      return 'tool_cancel'
    }
    if (this.toolUseContext.abortController.signal.aborted) {
      // 'interrupt' means the user typed a new message while tools were
      // running. Only cancel tools whose interruptBehavior is 'cancel';
      // 'block' tools shouldn't reach here (abort isn't fired).
      if (this.toolUseContext.abortController.signal.reason === 'interrupt') {
        return this.getToolInterruptBehavior(tool) === 'cancel'
          ? 'user_interrupted'
          : null
      }
      return 'user_interrupted'
    }
    return null
  }

  private getToolInterruptBehavior(tool: TrackedTool): 'cancel' | 'block' {
    const definition = findToolByName(this.toolDefinitions, tool.block.name)
    if (!definition?.interruptBehavior) return 'block'
    try {
      return definition.interruptBehavior()
    } catch {
      return 'block'
    }
  }

  private getToolDescription(tool: TrackedTool): string {
    const input = tool.block.input as Record<string, unknown> | undefined
    const summary = input?.command ?? input?.file_path ?? input?.pattern ?? ''
    if (typeof summary === 'string' && summary.length > 0) {
      const truncated =
        summary.length > 40 ? summary.slice(0, 40) + '\u2026' : summary
      return `${tool.block.name}(${truncated})`
    }
    return tool.block.name
  }

  private updateInterruptibleState(): void {
    const executing = this.tools.filter(t => t.status === 'executing')
    this.toolUseContext.setHasInterruptibleToolInProgress?.(
      executing.length > 0 &&
        executing.every(t => this.getToolInterruptBehavior(t) === 'cancel'),
    )
  }

  /**
   * Execute a tool and collect its results
   */
  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(tool.id),
    )
    this.updateInterruptibleState()

    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> =
      []
    const deferredSideEffects: DeferredSideEffect[] = []
    let bufferedAppState = this.toolUseContext.getAppState()

    const collectResults = async () => {
      // If already aborted (by error or user), generate synthetic error block instead of running the tool
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason) {
        messages.push(
          this.createSyntheticErrorMessage(
            tool.id,
            initialAbortReason,
            tool.assistantMessage,
          ),
        )
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.updateInterruptibleState()
        return
      }

      // Per-tool child controller. Lets siblingAbortController kill running
      // subprocesses (Bash spawns listen to this signal) when a Bash error
      // cascades. Permission-dialog rejection also aborts this controller
      // (PermissionContext.ts cancelAndAbort) — that abort must bubble up to
      // the query controller so the query loop's post-tool abort check ends
      // the turn. Without bubble-up, ExitPlanMode "clear context + auto"
      // sends REJECT_MESSAGE to the model instead of aborting (#21056 regression).
      const toolAbortController = createChildAbortController(
        this.siblingAbortController,
      )
      // Expose this controller via the in-flight registry so SDK consumers
      // can target it with control_request { subtype: 'tool_cancel' }.
      // Unregister in promise.finally below so every completion path —
      // success, error, sibling-cascade, discard — releases the entry.
      registerInFlightTool(tool.id, toolAbortController)
      toolAbortController.signal.addEventListener(
        'abort',
        () => {
          // 'tool_cancel' is a per-tool abort initiated by an SDK consumer:
          // sibling tools must keep running, so it does NOT bubble up to the
          // turn controller. 'sibling_error' historically suppresses bubble
          // for the same reason.
          if (
            toolAbortController.signal.reason !== 'sibling_error' &&
            toolAbortController.signal.reason !== 'tool_cancel' &&
            !this.toolUseContext.abortController.signal.aborted &&
            !this.discarded
          ) {
            this.toolUseContext.abortController.abort(
              toolAbortController.signal.reason,
            )
          }
        },
        { once: true },
      )

      const generator = runToolUse(
        tool.block,
        tool.assistantMessage,
        this.canUseTool,
        {
          ...this.toolUseContext,
          abortController: toolAbortController,
          getAppState: () => bufferedAppState,
          setAppState: updater => {
            bufferedAppState = updater(bufferedAppState)
            deferredSideEffects.push(context => {
              context.setAppState(updater)
            })
          },
          setAppStateForTasks: updater => {
            // Task-scoped state must remain immediate: background shells and
            // subagents rely on root registration even if the current streaming
            // attempt later falls back.
            bufferedAppState = updater(bufferedAppState)
            ;(
              this.toolUseContext.setAppStateForTasks ?? this.toolUseContext.setAppState
            )(updater)
          },
          setToolJSX: value => {
            tool.hasVisibleToolJSX = value !== null
            this.toolUseContext.setToolJSX?.(value)
          },
          addNotification: notification => {
            deferredSideEffects.push(context => {
              context.addNotification?.(notification)
            })
          },
          appendSystemMessage: message => {
            deferredSideEffects.push(context => {
              context.appendSystemMessage?.(message)
            })
          },
          sendOSNotification: options => {
            deferredSideEffects.push(context => {
              context.sendOSNotification?.(options)
            })
          },
        },
      )

      // Track if this specific tool has produced an error result.
      // This prevents the tool from receiving a duplicate "sibling error"
      // message when it is the one that caused the error.
      let thisToolErrored = false

      for await (const update of generator) {
        if (this.discarded) {
          break
        }
        // Check if we were aborted by a sibling tool error or user interruption.
        // Only add the synthetic error if THIS tool didn't produce the error.
        // Pass the per-tool controller so tool_cancel — a leaf-level abort
        // from the SDK consumer — can produce a closing tool_result.
        const abortReason = this.getAbortReason(tool, toolAbortController)
        if (abortReason && !thisToolErrored) {
          messages.push(
            this.createSyntheticErrorMessage(
              tool.id,
              abortReason,
              tool.assistantMessage,
            ),
          )
          break
        }

        const isErrorResult =
          update.message.type === 'user' &&
          Array.isArray(update.message.message.content) &&
          update.message.message.content.some(
            _ => _.type === 'tool_result' && _.is_error === true,
          )

        if (isErrorResult) {
          thisToolErrored = true
          // Only Bash errors cancel siblings. Bash commands often have implicit
          // dependency chains (e.g. mkdir fails → subsequent commands pointless).
          // Read/WebFetch/etc are independent — one failure shouldn't nuke the rest.
          if (tool.block.name === BASH_TOOL_NAME) {
            this.hasErrored = true
            this.erroredToolDescription = this.getToolDescription(tool)
            this.siblingAbortController.abort('sibling_error')
          }
        }

        if (update.message) {
          // Progress messages go to pendingProgress for immediate yielding
          if (update.message.type === 'progress') {
            tool.pendingProgress.push(update.message)
            // Signal that progress is available
            if (this.progressAvailableResolve) {
              this.progressAvailableResolve()
              this.progressAvailableResolve = undefined
            }
          } else {
            messages.push(update.message)
          }
        }
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)
        }
      }
      if (this.discarded) {
        return
      }
      // Safety net: a tool_cancel may abort the leaf controller after a tool
      // has already yielded partial content. If the tool body honored the
      // signal and produced its own error block (thisToolErrored), keep it
      // as-is. Otherwise, ensure the assistant turn still sees a closing
      // tool_result for this tool_use_id so the API stays balanced — empty
      // results would leave the tool_use orphaned and break the next turn.
      if (
        toolAbortController.signal.aborted &&
        toolAbortController.signal.reason === 'tool_cancel' &&
        !thisToolErrored &&
        !messages.some(
          m =>
            m.type === 'user' &&
            Array.isArray(m.message.content) &&
            m.message.content.some(c => c.type === 'tool_result'),
        )
      ) {
        messages.push(
          this.createSyntheticErrorMessage(
            tool.id,
            'tool_cancel',
            tool.assistantMessage,
          ),
        )
      }
      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.deferredSideEffects = deferredSideEffects
      tool.hasVisibleToolJSX = false
      tool.status = 'completed'
      this.updateInterruptibleState()
    }

    const promise = collectResults()
    tool.promise = promise

    // Process more queue when done. Also release the in-flight registry
    // entry — collectResults's early-return path doesn't allocate a
    // controller (synthetic error before execution), so the registry is
    // permissive about unknown ids.
    void promise.finally(() => {
      unregisterInFlightTool(tool.id)
      void this.processQueue()
    })
  }

  /**
   * Get any completed results that haven't been yielded yet (non-blocking)
   * Maintains order where necessary
   * Also yields any pending progress messages immediately
   */
  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {
      // Always yield pending progress messages immediately, regardless of tool status
      while (tool.pendingProgress.length > 0) {
        const progressMessage = tool.pendingProgress.shift()!
        yield { message: progressMessage, newContext: this.toolUseContext }
      }

      if (tool.status === 'yielded') {
        continue
      }

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'

        // Apply context modifiers only when the tool's results are actually
        // accepted for emission. This keeps streaming fallback/discard from
        // mutating context with side effects from an abandoned attempt.
        if (!tool.isConcurrencySafe && tool.contextModifiers?.length) {
          for (const modifier of tool.contextModifiers) {
            this.toolUseContext = modifier(this.toolUseContext)
          }
        }
        if (tool.deferredSideEffects?.length) {
          for (const applySideEffect of tool.deferredSideEffects) {
            applySideEffect(this.toolUseContext)
          }
        }

        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }

        markToolUseAsComplete(this.toolUseContext, tool.id)
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  /**
   * Check if any tool has pending progress messages
   */
  private hasPendingProgress(): boolean {
    return this.tools.some(t => t.pendingProgress.length > 0)
  }

  /**
   * Wait for remaining tools and yield their results as they complete
   * Also yields progress messages as they become available
   */
  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const result of this.getCompletedResults()) {
        yield result
      }

      // If we still have executing tools but nothing completed, wait for any to complete
      // OR for progress to become available
      if (
        this.hasExecutingTools() &&
        !this.hasCompletedResults() &&
        !this.hasPendingProgress()
      ) {
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        // Also wait for progress to become available
        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })

        if (executingPromises.length > 0) {
          await Promise.race([...executingPromises, progressPromise])
        }
      }
    }

    for (const result of this.getCompletedResults()) {
      yield result
    }
  }

  /**
   * Check if there are any completed results ready to yield
   */
  private hasCompletedResults(): boolean {
    return this.tools.some(t => t.status === 'completed')
  }

  /**
   * Check if there are any tools still executing
   */
  private hasExecutingTools(): boolean {
    return this.tools.some(t => t.status === 'executing')
  }

  /**
   * Check if there are any unfinished tools
   */
  private hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== 'yielded')
  }

  /**
   * Get the current tool use context (may have been modified by context modifiers)
   */
  getUpdatedContext(): ToolUseContext {
    return this.toolUseContext
  }
}

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
) {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
