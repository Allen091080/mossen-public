import { feature } from 'bun:bundle';
import * as React from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js';
import { useAppState, useSetAppState } from 'src/state/AppState.js';
import type { PermissionMode } from 'src/utils/permissions/PermissionMode.js';
import { getIsRemoteMode, getKairosActive, getMainThreadAgentType, getOriginalCwd, getSdkBetas, getSessionId } from '../bootstrap/state.js';
import { DEFAULT_OUTPUT_STYLE_NAME } from '../constants/outputStyles.js';
import { useNotifications } from '../context/notifications.js';
import { getTotalAPIDuration, getTotalCost, getTotalDuration, getTotalInputTokens, getTotalLinesAdded, getTotalLinesRemoved, getTotalOutputTokens } from '../cost-tracker.js';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { type ReadonlySettings, useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, Text } from '../ink.js';
import { getRawUtilization } from '../services/hostedLimits.js';
import type { Message } from '../types/message.js';
import type { StatusLineCommandInput } from '../types/statusLine.js';
import type { VimMode } from '../types/textInputTypes.js';
import { checkHasTrustDialogAccepted } from '../utils/config.js';
import { calculateContextPercentages, getContextWindowForModel } from '../utils/context.js';
import { getCwd } from '../utils/cwd.js';
import { logForDebugging } from '../utils/debug.js';
import { getInteractiveLanguageTag, getLocalizedText } from '../utils/uiLanguage.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { createBaseHookInput, executeStatusLineCommand } from '../utils/hooks.js';
import { getLastAssistantMessage } from '../utils/messages.js';
import { getRuntimeMainLoopModel, type ModelName, renderModelName } from '../utils/model/model.js';
import { getCurrentSessionTitle } from '../utils/sessionStorage.js';
import { buildStatusLineObservabilityInput } from '../utils/statusLineObservability.js';
import { doesMostRecentAssistantMessageExceed200k, getAssistantMessageContentLength, getCurrentUsage } from '../utils/tokens.js';
import { isVimModeEnabled } from './PromptInput/utils.js';

const STATUS_LINE_USAGE_OPTIONS = { ignoreEmptyUsage: true } as const;

export function statusLineShouldDisplay(settings: ReadonlySettings): boolean {
  // Assistant mode: statusline fields (model, permission mode, cwd) reflect the
  // REPL/daemon process, not what the agent child is actually running. Hide it.
  if (feature('KAIROS') && getKairosActive()) return false;
  return settings?.statusLine !== undefined;
}
function buildStatusLineCommandInput(permissionMode: PermissionMode, exceeds200kTokens: boolean, settings: ReadonlySettings, messages: Message[], addedDirs: string[], mainLoopModel: ModelName, vimMode?: VimMode): StatusLineCommandInput {
  const agentType = getMainThreadAgentType();
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel,
    exceeds200kTokens
  });
  const outputStyleName = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME;
  const currentUsage = getCurrentUsage(messages, STATUS_LINE_USAGE_OPTIONS);
  const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas());
  const contextPercentages = calculateContextPercentages(currentUsage, contextWindowSize);
  const observabilityInput = buildStatusLineObservabilityInput(messages, runtimeModel, settings?.effortLevel, settings);
  const estimatedContextPercentage = observabilityInput.context_observability.pressure_percent;
  const usedPercentage = Math.min(100, Math.max(0, Math.max(contextPercentages.used ?? 0, estimatedContextPercentage)));
  const contextObservability = {
    ...observabilityInput.context_observability,
    pressure_percent: usedPercentage
  };
  const sessionId = getSessionId();
  const sessionName = getCurrentSessionTitle(sessionId);
  const rawUtil = getRawUtilization();
  const rateLimits: StatusLineCommandInput['rate_limits'] = {
    ...(rawUtil.five_hour && {
      five_hour: {
        used_percentage: rawUtil.five_hour.utilization * 100,
        resets_at: rawUtil.five_hour.resets_at
      }
    }),
    ...(rawUtil.seven_day && {
      seven_day: {
        used_percentage: rawUtil.seven_day.utilization * 100,
        resets_at: rawUtil.seven_day.resets_at
      }
    })
  };
  return {
    ...createBaseHookInput(),
    ...observabilityInput,
    context_observability: contextObservability,
    ...(sessionName && {
      session_name: sessionName
    }),
    model: {
      id: runtimeModel,
      display_name: renderModelName(runtimeModel)
    },
    workspace: {
      current_dir: getCwd(),
      project_dir: getOriginalCwd(),
      added_dirs: addedDirs
    },
    version: MACRO.VERSION,
    output_style: {
      name: outputStyleName
    },
    cost: {
      total_cost_usd: getTotalCost(),
      total_duration_ms: getTotalDuration(),
      total_api_duration_ms: getTotalAPIDuration(),
      total_lines_added: getTotalLinesAdded(),
      total_lines_removed: getTotalLinesRemoved()
    },
    context_window: {
      total_input_tokens: getTotalInputTokens(),
      total_output_tokens: getTotalOutputTokens(),
      context_window_size: contextWindowSize,
      current_usage: currentUsage,
      used_percentage: usedPercentage,
      remaining_percentage: Math.max(0, 100 - usedPercentage)
    },
    exceeds_200k_tokens: exceeds200kTokens,
    ...((rateLimits.five_hour || rateLimits.seven_day) && {
      rate_limits: rateLimits
    }),
    ...(isVimModeEnabled() && {
      vim: {
        mode: vimMode ?? 'INSERT'
      }
    }),
    ...(agentType && {
      agent: {
        name: agentType
      }
    }),
    ...(getIsRemoteMode() && {
      remote: {
        session_id: getSessionId()
      }
    }),
    // UX-Wave1 S6 (W1-D2=A): expose effective UI language tag to user-defined
    // statusline hook commands so they can render localized statusline text.
    // Add-only field; legacy hooks ignoring it are unaffected.
    interactive_language: getInteractiveLanguageTag()
  };
}
type Props = {
  // messages stays behind a ref (read only in the debounced callback);
  // statusLineUpdateKey is the actual re-render trigger.
  messagesRef: React.RefObject<Message[]>;
  lastAssistantMessageId: string | null;
  statusLineUpdateKey: string;
  vimMode?: VimMode;
};
export function getLastAssistantMessageId(messages: Message[]): string | null {
  return getLastAssistantMessage(messages)?.uuid ?? null;
}
function getMessageContentLength(message: Message | undefined): number {
  if (!message) return 0;
  if (message.type === 'assistant') {
    return getAssistantMessageContentLength(message);
  }

  const content = (message as {
    message?: { content?: unknown };
    content?: unknown;
  }).message?.content ?? (message as { content?: unknown }).content;

  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;

  return content.reduce((total, block) => {
    if (typeof block === 'string') return total + block.length;
    if (!block || typeof block !== 'object') return total;
    const maybeText = (block as { text?: unknown; content?: unknown }).text ?? (block as { content?: unknown }).content;
    return total + (typeof maybeText === 'string' ? maybeText.length : 0);
  }, 0);
}
export function getStatusLineUpdateKey(messages: Message[]): string {
  const lastMessage = messages.at(-1);
  const usage = getCurrentUsage(messages, STATUS_LINE_USAGE_OPTIONS);
  const usageKey = usage ? [usage.input_tokens, usage.output_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].join(':') : '0';
  return [messages.length, lastMessage?.uuid ?? 'none', getMessageContentLength(lastMessage), usageKey].join('|');
}

export function formatStatusLineForRender(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean)
    .join(' · ')
    .replace(/\t/g, ' ')
    // Preserve ESC so user statusline ANSI color sequences keep working.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '')
}

function StatusLineInner({
  messagesRef,
  lastAssistantMessageId,
  statusLineUpdateKey,
  vimMode
}: Props): React.ReactNode {
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const additionalWorkingDirectories = useAppState(s => s.toolPermissionContext.additionalWorkingDirectories);
  const statusLineText = useAppState(s => s.statusLineText);
  const setAppState = useSetAppState();
  const settings = useSettings();
  const {
    addNotification
  } = useNotifications();
  // AppState-sourced model — same source as API requests. getMainLoopModel()
  // re-reads settings.json on every call, so another session's /model write
  // would leak into this session's statusline (mossen/mossen-code#37596).
  const mainLoopModel = useMainLoopModel();

  // Keep latest values in refs for stable callback access
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const vimModeRef = useRef(vimMode);
  vimModeRef.current = vimMode;
  const permissionModeRef = useRef(permissionMode);
  permissionModeRef.current = permissionMode;
  const addedDirsRef = useRef(additionalWorkingDirectories);
  addedDirsRef.current = additionalWorkingDirectories;
  const mainLoopModelRef = useRef(mainLoopModel);
  mainLoopModelRef.current = mainLoopModel;

  // Track previous state to detect changes and cache expensive calculations
  const previousStateRef = useRef<{
    messageId: string | null;
    updateKey: string;
    exceeds200kTokens: boolean;
    permissionMode: PermissionMode;
    vimMode: VimMode | undefined;
    mainLoopModel: ModelName;
  }>({
    messageId: null,
    updateKey: '',
    exceeds200kTokens: false,
    permissionMode,
    vimMode,
    mainLoopModel
  });

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // True when the next invocation should log its result (first run or after settings reload)
  const logNextResultRef = useRef(true);

  // Stable update function — reads latest values from refs
  const doUpdate = useCallback(async () => {
    // Cancel any in-flight requests
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const msgs = messagesRef.current;
    const logResult = logNextResultRef.current;
    logNextResultRef.current = false;
    try {
      let exceeds200kTokens = previousStateRef.current.exceeds200kTokens;

      // Only recalculate 200k check if messages changed
      const currentMessageId = getLastAssistantMessageId(msgs);
      const currentUpdateKey = getStatusLineUpdateKey(msgs);
      if (currentMessageId !== previousStateRef.current.messageId || currentUpdateKey !== previousStateRef.current.updateKey) {
        exceeds200kTokens = doesMostRecentAssistantMessageExceed200k(msgs);
        previousStateRef.current.messageId = currentMessageId;
        previousStateRef.current.updateKey = currentUpdateKey;
        previousStateRef.current.exceeds200kTokens = exceeds200kTokens;
      }
      const statusInput = buildStatusLineCommandInput(permissionModeRef.current, exceeds200kTokens, settingsRef.current, msgs, Array.from(addedDirsRef.current.keys()), mainLoopModelRef.current, vimModeRef.current);
      const text = await executeStatusLineCommand(statusInput, controller.signal, undefined, logResult);
      if (!controller.signal.aborted) {
        setAppState(prev => {
          if (prev.statusLineText === text) return prev;
          return {
            ...prev,
            statusLineText: text
          };
        });
      }
    } catch {
      // Silently ignore errors in status line updates
    }
  }, [messagesRef, setAppState]);

  // Stable debounced schedule function — no deps, uses refs
  const scheduleUpdate = useCallback(() => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout((ref, doUpdate) => {
      ref.current = undefined;
      void doUpdate();
    }, 300, debounceTimerRef, doUpdate);
  }, [doUpdate]);

  // Only trigger update when assistant message, permission mode, vim mode, or model actually changes
  useEffect(() => {
    if (lastAssistantMessageId !== previousStateRef.current.messageId || statusLineUpdateKey !== previousStateRef.current.updateKey || permissionMode !== previousStateRef.current.permissionMode || vimMode !== previousStateRef.current.vimMode || mainLoopModel !== previousStateRef.current.mainLoopModel) {
      // Don't update message/update keys here — let doUpdate handle them so
      // exceeds200kTokens is recalculated with the latest messages
      previousStateRef.current.permissionMode = permissionMode;
      previousStateRef.current.vimMode = vimMode;
      previousStateRef.current.mainLoopModel = mainLoopModel;
      scheduleUpdate();
    }
  }, [lastAssistantMessageId, statusLineUpdateKey, permissionMode, vimMode, mainLoopModel, scheduleUpdate]);

  // When the statusLine command changes (hot reload), log the next result
  const statusLineCommand = settings?.statusLine?.command;
  const isFirstSettingsRender = useRef(true);
  useEffect(() => {
    if (isFirstSettingsRender.current) {
      isFirstSettingsRender.current = false;
      return;
    }
    logNextResultRef.current = true;
    void doUpdate();
  }, [statusLineCommand, doUpdate]);

  // Separate effect for logging on mount
  useEffect(() => {
    const statusLine = settings?.statusLine;
    if (statusLine) {
      logMossenEvent('mossen.statusLine.mounted', {
        command_length: statusLine.command.length,
        padding: statusLine.padding
      });
      // Log if status line is configured but disabled by disableAllHooks
      if (settings.disableAllHooks === true) {
        logForDebugging('Status line is configured but disableAllHooks is true', {
          level: 'warn'
        });
      }
      // executeStatusLineCommand (hooks.ts) returns undefined when trust is
      // blocked — statusLineText stays undefined forever, user sees nothing,
      // and the mount event above still fires so telemetry looks fine.
      if (!checkHasTrustDialogAccepted()) {
        addNotification({
          key: 'statusline-trust-blocked',
          text: getLocalizedText({
            en: 'statusline skipped · restart to fix',
            zh: '状态栏已跳过 · 重启后可恢复',
          }),
          color: 'warning',
          priority: 'low'
        });
        logForDebugging('Status line command skipped: workspace trust not accepted', {
          level: 'warn'
        });
      }
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initial logging uses startup settings snapshot
  }, []); // Only run once on mount - settings stable for initial logging

  // Initial update on mount + cleanup on unmount
  useEffect(() => {
    void doUpdate();
    return () => {
      abortControllerRef.current?.abort();
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial status-line update intentionally runs once
  }, []); // Only run once on mount, not when doUpdate changes

  // Get padding from settings or default to 0
  const paddingX = settings?.statusLine?.padding ?? 0;
  const renderedStatusLineText = statusLineText
    ? formatStatusLineForRender(statusLineText)
    : undefined;

  // StatusLine must have stable height in fullscreen — the footer is
  // flexShrink:0 so a 0→1 row change when the command finishes steals
  // a row from ScrollBox and shifts content. Reserve the row while loading
  // (same trick as PromptInputFooterLeftSide).
  return <Box paddingX={paddingX} gap={2}>
      {renderedStatusLineText ? <Text dimColor wrap="truncate">
          <Ansi>{renderedStatusLineText}</Ansi>
        </Text> : isFullscreenEnvEnabled() ? <Text> </Text> : null}
    </Box>;
}

// Parent (PromptInputFooter) re-renders on every setMessages, but StatusLine's
// own props now only change when status-relevant message metadata changes —
// memo keeps it from being dragged along on unrelated footer updates.
import { withErrorBoundary as _meb_status } from './MossenErrorBoundary.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- memo + HOC composition
const StatusLineMemo = memo(StatusLineInner);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- memo wrapper type narrowing
export const StatusLine = _meb_status(StatusLineMemo as any, 'StatusLine');
