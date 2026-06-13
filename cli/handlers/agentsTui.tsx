/**
 * Shell-side Agent View entrypoint.
 *
 * `mossen agents` opens the supervisor TUI only when both stdin and stdout
 * are interactive. Scripts, pipes, CI, and --doctor keep the stable printer
 * path.
 *
 * Architecture note (post-W408):
 *
 *   The shell handler owns a loop that alternates between two modes:
 *
 *     1. **Dashboard mode** — render(<BackgroundTasksDialog />) and let Ink
 *        own stdio. The user picks a job, presses Enter.
 *     2. **Attached mode** — instance.unmount() so Ink fully releases stdio,
 *        then a tmux-style bridge wires process.stdin/stdout to the worker's
 *        PTY over a Unix socket. Bridge runs synchronously; nothing else is
 *        contending for stdin/stdout.
 *
 *   This is the only place that holds the Ink `instance`. Trying to bridge
 *   stdio while Ink is still mounted causes raw-mode / readable-listener
 *   races (the symptom: detach goes back to a cooked-mode shell that echoes
 *   keystrokes instead of a working dashboard). Unmounting Ink completely is
 *   what makes detach round-tripping stable.
 */

import React from 'react'
import {
  BackgroundTasksDialog,
  type AgentViewDispatchDefaults,
} from '../../components/tasks/BackgroundTasksDialog.js'
import { render } from '../../ink.js'
import { AlternateScreen } from '../../ink/components/AlternateScreen.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import {
  waitForAgentViewSessionEvent,
} from '../../services/agentSupervisor/agentViewSession.js'
import {
  attachToWorker,
  type AttachResult,
} from '../../services/agentSupervisor/attachClient.js'
import { reconcileDeadSupervisorJobs } from '../../services/agentSupervisor/recovery.js'
import { AppStateProvider } from '../../state/AppState.js'
import { t } from '../../utils/i18n/index.js'
import type { ToolUseContext } from '../../Tool.js'
import { getCommands } from '../../commands.js'
import type { Command } from '../../types/command.js'
import { isMouseTrackingEnabled } from '../../utils/fullscreen.js'
import { getBaseRenderOptions } from '../../utils/renderOptions.js'
import {
  agentsHandler,
  resolveAgentsCwdOverride,
  type AgentsHandlerOptions,
} from './agents.js'

function canUseAgentViewTui(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI)
}

function createShellAgentViewContext(commands: Command[]): ToolUseContext {
  // BackgroundTasksDialog only needs AppState for Agent View rendering. Keep
  // a narrow shell context rather than pretending this CLI subcommand has a
  // full REPL tool runtime.
  return {
    abortController: new AbortController(),
    options: { commands },
    getAppState: () => {
      throw new Error('Agent View shell context reads AppState via provider.')
    },
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
  } as unknown as ToolUseContext
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => normalizeStringArray(item))
  }
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  return trimmed ? [trimmed] : []
}

function normalizeAgentViewDispatchDefaults(
  options: AgentsHandlerOptions,
): AgentViewDispatchDefaults {
  return {
    model: options.model ?? null,
    permissionMode: options.permissionMode ?? null,
    effort: options.effort ?? null,
    agent: options.agent ?? null,
    settings: options.settings ?? null,
    addDirs: normalizeStringArray(options.addDir),
    mcpConfig: normalizeStringArray(options.mcpConfig),
    pluginDirs: normalizeStringArray(options.pluginDir),
    strictMcpConfig: options.strictMcpConfig === true,
    fallbackModel: options.fallbackModel ?? null,
    allowDangerouslySkipPermissions:
      options.allowDangerouslySkipPermissions === true,
    dangerouslySkipPermissions: options.dangerouslySkipPermissions === true,
  }
}

let shellAgentViewDispatchDefaults: AgentViewDispatchDefaults | null = null

type DashboardResolution =
  | { kind: 'done' }
  | { kind: 'session_event'; event: Awaited<ReturnType<typeof waitForAgentViewSessionEvent>> }

async function waitForAgentViewAttachSplashKey(
  timeoutMs = 5000,
): Promise<void> {
  await new Promise<void>(resolveFn => {
    const stdinStream = process.stdin as NodeJS.ReadStream
    const onKey = (): void => {
      stdinStream.off('data', onKey)
      resolveFn()
    }
    stdinStream.once('data', onKey)
    setTimeout(() => {
      stdinStream.off('data', onKey)
      resolveFn()
    }, timeoutMs)
  })
}

async function showAgentViewAttachSplash(
  message: string,
  color = '33',
): Promise<void> {
  try {
    process.stdout.write(`\r\n\x1b[${color}m── ${message} ──\x1b[0m\r\n`)
  } catch {
    // best-effort splash
  }
  await waitForAgentViewAttachSplashKey()
}

function formatAgentViewAttachResult(
  result: AttachResult,
  options: { exitSplashShown: boolean },
): string | null {
  if (result.reason === 'detached' || result.reason === 'evicted') return null
  if (result.reason === 'job_exited') {
    if (options.exitSplashShown) return null
    return t('ui.agentView.attachExitedSplash', {
      code: result.exitCode === null ? 'unknown' : String(result.exitCode),
    })
  }
  if (result.reason === 'connect_failed') {
    return t('ui.agentView.attachConnectFailed', {
      message: result.error ?? t('ui.agentView.attachFailedGeneric'),
    })
  }
  if (result.reason === 'aborted') {
    return result.error?.includes('raw mode unsupported')
      ? t('ui.agentView.attachUnsupported')
      : t('ui.agentView.attachAborted', {
        message: result.error ?? t('ui.agentView.attachFailedGeneric'),
      })
  }
  return null
}

async function renderDashboardOnce(
  commands: Command[],
): Promise<DashboardResolution> {
  // Race two completion signals:
  //   - Ink's `onDone` from inside the dashboard (user typed /exit, etc.)
  //   - A session event from the React tree (attach request, exit request)
  // Whichever resolves first decides what the outer loop does next.
  return new Promise<DashboardResolution>(async (resolveOuter, rejectOuter) => {
    let settled = false
    const finish = (value: DashboardResolution): void => {
      if (settled) return
      settled = true
      try {
        instance?.unmount()
      } catch {
        // Ink may have already torn down.
      }
      resolveOuter(value)
    }

    let instance: Awaited<ReturnType<typeof render>> | null = null

    // Listen for session events in parallel with Ink mounting.
    void waitForAgentViewSessionEvent().then(event => {
      finish({ kind: 'session_event', event })
    })

    try {
      instance = await render(
        <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>
          <AppStateProvider>
            <KeybindingSetup>
              <BackgroundTasksDialog
                agentView
                agentViewDispatchDefaults={shellAgentViewDispatchDefaults ?? {}}
                toolUseContext={createShellAgentViewContext(commands)}
                onDone={() => {
                  finish({ kind: 'done' })
                }}
              />
            </KeybindingSetup>
          </AppStateProvider>
        </AlternateScreen>,
        getBaseRenderOptions(false),
      )
    } catch (error) {
      if (settled) return
      settled = true
      rejectOuter(error)
    }
  })
}

async function openAgentViewTui(): Promise<void> {
  const commands = await getCommands(process.cwd()).catch(() => [])

  // Sweep stale job state before the dashboard reads its roster: kill -9'd
  // workers leave alive=true + an orphaned worktree behind, which would
  // otherwise show up in the list as a permanently "working" row pointing
  // at a dead pid. The reconcile re-marks them failed and tries to remove
  // the owned worktree (dirty / ownership checks still apply). Errors are
  // swallowed — the dashboard must boot even if cleanup partially fails.
  try {
    await reconcileDeadSupervisorJobs()
  } catch (error) {
    process.stderr.write(
      `Agent View boot reconcile warning: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    )
  }

  // Outer loop: render dashboard → wait for attach/exit → on attach, run the
  // PTY bridge with stdio fully owned (Ink is unmounted) → loop back to
  // re-render the dashboard. Exits when the dashboard fires `onDone` or a
  // session event explicitly requests exit.
  while (true) {
    const outcome = await renderDashboardOnce(commands)
    if (outcome.kind === 'done') return
    const event = outcome.event
    if (event.kind === 'exit') return
    // event.kind === 'attach' — Ink is already unmounted inside
    // renderDashboardOnce.finish(). Run the bridge synchronously; stdio is
    // ours alone until the bridge resolves.
    try {
      let attachExitSplashShown = false
      const attachResult = await attachToWorker({
        socketPath: event.req.socketPath,
        stdin: process.stdin as NodeJS.ReadStream,
        stdout: process.stdout as NodeJS.WriteStream,
        cols: process.stdout.columns ?? 120,
        rows: process.stdout.rows ?? 36,
        // No Ink wrapper available now — pass a direct setRawMode for the
        // bridge's belt-and-suspenders fallback. The bridge prefers calling
        // stdin.setRawMode directly.
        setRawMode: (value: boolean) => {
          try {
            (process.stdin as NodeJS.ReadStream).setRawMode?.(value)
          } catch {
            // Headless test stdins may not support raw mode; nothing to
            // restore.
          }
        },
        // W411: when another dashboard took over the same job, render a
        // dedicated splash so the user understands the attach view didn't
        // close because the job ended. Wait for any keypress (or a short
        // timeout) before resolving, mirroring onJobExit semantics.
        onEvicted: async () => {
          await showAgentViewAttachSplash(t('ui.agentView.attachEvicted'))
        },
        onJobExit: async code => {
          attachExitSplashShown = true
          await showAgentViewAttachSplash(
            t('ui.agentView.attachExitedSplash', {
              code: String(code),
            }),
          )
        },
      })
      const attachMessage = formatAgentViewAttachResult(attachResult, {
        exitSplashShown: attachExitSplashShown,
      })
      if (attachMessage) {
        await showAgentViewAttachSplash(
          attachMessage,
          attachResult.reason === 'connect_failed' ||
            attachResult.reason === 'aborted'
            ? '31'
            : '33',
        )
      }
    } catch (bridgeError) {
      process.stderr.write(
        `Agent View attach failed: ${
          bridgeError instanceof Error
            ? bridgeError.message
            : String(bridgeError)
        }\n`,
      )
      // Pause briefly so the message is visible before the dashboard
      // re-mounts and repaints.
      await new Promise(r => setTimeout(r, 800))
    }
    // Loop back: next iteration re-renders the dashboard from scratch. It
    // reads roster.json on mount so state is restored without any in-memory
    // hand-off.
  }
}

async function withProcessCwd<T>(
  cwd: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.cwd()
  if (cwd === previous) return fn()
  process.chdir(cwd)
  try {
    return await fn()
  } finally {
    process.chdir(previous)
  }
}

export async function agentsTuiOrPrinterHandler(
  options: AgentsHandlerOptions = {},
): Promise<void> {
  const cwd = await resolveAgentsCwdOverride(options.cwd)
  if (cwd.warning) {
    process.stderr.write(`${cwd.warning}\n`)
  }
  const resolvedOptions = { ...options, cwd: cwd.cwd }
  const dispatchDefaults = normalizeAgentViewDispatchDefaults(resolvedOptions)

  if (options.json || options.doctor || options.gc || !canUseAgentViewTui()) {
    await agentsHandler(resolvedOptions)
    return
  }

  try {
    shellAgentViewDispatchDefaults = dispatchDefaults
    await withProcessCwd(cwd.cwd, async () => {
      await openAgentViewTui()
    })
  } catch (error) {
    process.stderr.write(
      `Agent View TUI unavailable, falling back to printer mode: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    )
    await agentsHandler(resolvedOptions)
  } finally {
    shellAgentViewDispatchDefaults = null
  }
}
