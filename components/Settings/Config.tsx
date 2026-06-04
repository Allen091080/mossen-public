/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
// biome-ignore-all assist/source/organizeImports: internal-only import markers must not be reordered
import { feature } from 'bun:bundle';
import { Box, Text, useTheme, useThemeSetting, useTerminalFocus } from '../../ink.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import * as React from 'react';
import { useState, useCallback } from 'react';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import figures from 'figures';
import { type GlobalConfig, saveGlobalConfig, getCurrentProjectConfig, type OutputStyle } from '../../utils/config.js';
import { normalizeApiKeyForConfig } from '../../utils/authPortable.js';
import { getGlobalConfig, getAutoUpdaterDisabledReason, formatAutoUpdaterDisabledReason, getRemoteControlAtStartup } from '../../utils/config.js';
import chalk from 'chalk';
import { permissionModeTitle, permissionModeFromString, toExternalPermissionMode, isExternalPermissionMode, EXTERNAL_PERMISSION_MODES, PERMISSION_MODES, type ExternalPermissionMode, type PermissionMode } from '../../utils/permissions/PermissionMode.js';
import { getAutoModeEnabledState, hasAutoModeOptInAnySource, transitionPlanAutoMode } from '../../utils/permissions/permissionSetup.js';
import { logError } from '../../utils/log.js';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js';
import { ThemePicker } from '../ThemePicker.js';
import { useAppState, useSetAppState, useAppStateStore } from '../../state/AppState.js';
import { ModelPicker } from '../ModelPicker.js';
import { modelDisplayString, isOpus1mMergeEnabled } from '../../utils/model/model.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import { MossenMdExternalIncludesDialog } from '../MossenMdExternalIncludesDialog.js';
import { ChannelDowngradeDialog, type ChannelDowngradeChoice } from '../ChannelDowngradeDialog.js';
import { Dialog } from '../design-system/Dialog.js';
import { Select } from '../CustomSelect/index.js';
import { OutputStylePicker } from '../OutputStylePicker.js';
import { LanguagePicker } from '../LanguagePicker.js';
import { getExternalMossenMdIncludes, getMemoryFiles, hasExternalMossenMdIncludes } from 'src/utils/mossenmd.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from '../design-system/Byline.js';
import { useTabHeaderFocus } from '../design-system/Tabs.js';
import { useIsInsideModal } from '../../context/modalContext.js';
import { SearchBox } from '../SearchBox.js';
import { isSupportedTerminal, hasAccessToIDEExtensionDiffFeature } from '../../utils/ide.js';
import { getInitialSettings, getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { getUserMsgOptIn, setUltracodeActive, setUserMsgOptIn } from '../../bootstrap/state.js';
import { DEFAULT_OUTPUT_STYLE_NAME } from 'src/constants/outputStyles.js';
import { isEnvTruthy, isRunningOnHomespace } from 'src/utils/envUtils.js';
import type { LocalJSXCommandContext, CommandResultDisplay } from '../../commands.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/config/dynamicConfig.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { getCliTeammateModeOverride, clearCliTeammateModeOverride } from '../../utils/swarm/backends/teammateModeSnapshot.js';
import { getHardcodedTeammateModelFallback } from '../../utils/swarm/teammateModel.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { clearFastModeCooldown, FAST_MODE_MODEL_DISPLAY, isFastModeAvailable, isFastModeEnabled, getFastModeModel, isFastModeSupportedByModel } from '../../utils/fastMode.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { canUseChromeIntegration } from '../../utils/hostedFeatureGates.js';
type Props = {
  onClose: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  context: LocalJSXCommandContext;
  setTabsHidden: (hidden: boolean) => void;
  onIsSearchModeChange?: (inSearchMode: boolean) => void;
  contentHeight?: number;
};
type SettingBase = {
  id: string;
  label: string;
} | {
  id: string;
  label: React.ReactNode;
  searchText: string;
};
type Setting = (SettingBase & {
  value: boolean;
  onChange(value: boolean): void;
  type: 'boolean';
}) | (SettingBase & {
  value: string;
  options: string[];
  onChange(value: string): void;
  type: 'enum';
}) | (SettingBase & {
  // For enums that are set by a custom component, we don't need to pass options,
  // but we still need a value to display in the top-level config menu
  value: string;
  onChange(value: string): void;
  type: 'managedEnum';
});
type SubMenu = 'Theme' | 'Model' | 'TeammateModel' | 'ExternalIncludes' | 'OutputStyle' | 'ChannelDowngrade' | 'Language' | 'EnableAutoUpdates';
function ConfigImpl({
  onClose,
  context,
  setTabsHidden,
  onIsSearchModeChange,
  contentHeight
}: Props): React.ReactNode {
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
  const insideModal = useIsInsideModal();
  const [, setTheme] = useTheme();
  const themeSetting = useThemeSetting();
  const [globalConfig, setGlobalConfig] = useState(getGlobalConfig());
  const initialConfig = React.useRef(getGlobalConfig());
  const [settingsData, setSettingsData] = useState(getInitialSettings());
  const initialSettingsData = React.useRef(getInitialSettings());
  const [currentOutputStyle, setCurrentOutputStyle] = useState<OutputStyle>(settingsData?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME);
  const initialOutputStyle = React.useRef(currentOutputStyle);
  const [currentLanguage, setCurrentLanguage] = useState<string | undefined>(settingsData?.language);
  const initialLanguage = React.useRef(currentLanguage);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isSearchMode, setIsSearchMode] = useState(true);
  const isTerminalFocused = useTerminalFocus();
  const {
    rows
  } = useTerminalSize();
  // contentHeight is set by Settings.tsx (same value passed to Tabs to fix
  // pane height across all tabs — prevents layout jank when switching).
  // Reserve ~10 rows for chrome (search box, gaps, footer, scroll hints).
  // Fallback calc for standalone rendering (tests).
  const paneCap = contentHeight ?? Math.min(Math.floor(rows * 0.8), 30);
  const maxVisible = Math.max(5, paneCap - 10);
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const verbose = useAppState(s_0 => s_0.verbose);
  const thinkingEnabled = useAppState(s_1 => s_1.thinkingEnabled);
  const isFastMode = useAppState(s_2 => isFastModeEnabled() ? s_2.fastMode : false);
  const promptSuggestionEnabled = useAppState(s_3 => s_3.promptSuggestionEnabled);
  // Show auto in the default-mode dropdown when the user has opted in OR the
  // config is fully 'enabled' — even if currently circuit-broken ('disabled'),
  // an opted-in user should still see it in settings (it's a temporary state).
  const showAutoInDefaultModePicker = feature('TRANSCRIPT_CLASSIFIER') ? hasAutoModeOptInAnySource() || getAutoModeEnabledState() === 'enabled' : false;
  // Chat/Transcript view picker is visible to entitled users (pass the GB
  // gate) even if they haven't opted in this session — it IS the persistent
  // opt-in. 'chat' written here is read at next startup by main.tsx which
  // sets userMsgOptIn if still entitled.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const showDefaultViewPicker = feature('KAIROS') || feature('KAIROS_BRIEF') ? (require('../../tools/BriefTool/BriefTool.js') as typeof import('../../tools/BriefTool/BriefTool.js')).isBriefEntitled() : false;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const setAppState = useSetAppState();
  const [changes, setChanges] = useState<{
    [key: string]: unknown;
  }>({});
  const initialThinkingEnabled = React.useRef(thinkingEnabled);
  // Per-source settings snapshots for revert-on-escape. getInitialSettings()
  // returns merged-across-sources which can't tell us what to delete vs
  // restore; per-source snapshots + updateSettingsForSource's
  // undefined-deletes-key semantics can. Lazy-init via useState (no setter) to
  // avoid reading settings files on every render — useRef evaluates its arg
  // eagerly even though only the first result is kept.
  const [initialLocalSettings] = useState(() => getSettingsForSource('localSettings'));
  const [initialUserSettings] = useState(() => getSettingsForSource('userSettings'));
  const initialThemeSetting = React.useRef(themeSetting);
  // AppState fields Config may modify — snapshot once at mount.
  const store = useAppStateStore();
  const [initialAppState] = useState(() => {
    const s_4 = store.getState();
    return {
      mainLoopModel: s_4.mainLoopModel,
      mainLoopModelForSession: s_4.mainLoopModelForSession,
      verbose: s_4.verbose,
      thinkingEnabled: s_4.thinkingEnabled,
      fastMode: s_4.fastMode,
      promptSuggestionEnabled: s_4.promptSuggestionEnabled,
      isBriefOnly: s_4.isBriefOnly,
      settings: s_4.settings
    };
  });
  // Bootstrap state snapshot — userMsgOptIn is outside AppState, so
  // revertChanges needs to restore it separately. Without this, cycling
  // defaultView to 'chat' then Escape leaves the tool active while the
  // display filter reverts — the exact ambient-activation behavior this
  // PR's entitlement/opt-in split is meant to prevent.
  const [initialUserMsgOptIn] = useState(() => getUserMsgOptIn());
  // Set on first user-visible change; gates revertChanges() on Escape so
  // opening-then-closing doesn't trigger redundant disk writes.
  const isDirty = React.useRef(false);
  const [showThinkingWarning, setShowThinkingWarning] = useState(false);
  const [showSubmenu, setShowSubmenu] = useState<SubMenu | null>(null);
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset
  } = useSearchInput({
    isActive: isSearchMode && showSubmenu === null && !headerFocused,
    onExit: () => setIsSearchMode(false),
    onExitUp: focusHeader,
    // Ctrl+C/D must reach Settings' useExitOnCtrlCD; 'd' also avoids
    // double-action (delete-char + exit-pending).
    passthroughCtrlKeys: ['c', 'd']
  });

  // Tell the parent when Config's own Esc handler is active so Settings cedes
  // confirm:no. Only true when search mode owns the keyboard — not when the
  // tab header is focused (then Settings must handle Esc-to-close).
  const ownsEsc = isSearchMode && !headerFocused;
  React.useEffect(() => {
    onIsSearchModeChange?.(ownsEsc);
  }, [ownsEsc, onIsSearchModeChange]);
  const isConnectedToIde = hasAccessToIDEExtensionDiffFeature(context.options.mcpClients);
  const isFileCheckpointingAvailable = !isEnvTruthy(process.env.MOSSEN_CODE_DISABLE_FILE_CHECKPOINTING);
  const memoryFiles = React.use(getMemoryFiles(true));
  const shouldShowExternalIncludesToggle = hasExternalMossenMdIncludes(memoryFiles);
  const autoUpdaterDisabledReason = getAutoUpdaterDisabledReason();
  function onChangeMainModelConfig(value: string | null): void {
    const previousModel = mainLoopModel;
    logMossenEvent('mossen.config.modelChanged', {
      from_model: previousModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_model: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setAppState(prev => ({
      ...prev,
      mainLoopModel: value,
      mainLoopModelForSession: null
    }));
    setChanges(prev_0 => {
      const valStr = modelDisplayString(value) + (isBilledAsExtraUsage(value, false, isOpus1mMergeEnabled()) ? ' · Billed as extra usage' : '');
      if ('model' in prev_0) {
        const {
          model,
          ...rest
        } = prev_0;
        return {
          ...rest,
          model: valStr
        };
      }
      return {
        ...prev_0,
        model: valStr
      };
    });
  }
  function onChangeVerbose(value_0: boolean): void {
    // Update the global config to persist the setting
    saveGlobalConfig(current => ({
      ...current,
      verbose: value_0
    }));
    setGlobalConfig({
      ...getGlobalConfig(),
      verbose: value_0
    });

    // Update the app state for immediate UI feedback
    setAppState(prev_1 => ({
      ...prev_1,
      verbose: value_0
    }));
    setChanges(prev_2 => {
      if ('verbose' in prev_2) {
        const {
          verbose: verbose_0,
          ...rest_0
        } = prev_2;
        return rest_0;
      }
      return {
        ...prev_2,
        verbose: value_0
      };
    });
  }

  // TODO: Add MCP servers
  const settingsItems: Setting[] = [
  // Global settings
  {
    id: 'autoCompactEnabled',
    label: getLocalizedText({ en: 'Auto-compact', zh: '自动压缩' }),
    value: globalConfig.autoCompactEnabled,
    type: 'boolean' as const,
    onChange(autoCompactEnabled: boolean) {
      saveGlobalConfig(current_0 => ({
        ...current_0,
        autoCompactEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        autoCompactEnabled
      });
      logMossenEvent('mossen.config.autoCompactSettingChanged', {
        enabled: autoCompactEnabled
      });
    }
  }, {
    id: 'spinnerTipsEnabled',
    label: getLocalizedText({ en: 'Show tips', zh: '显示提示' }),
    value: settingsData?.spinnerTipsEnabled ?? true,
    type: 'boolean' as const,
    onChange(spinnerTipsEnabled: boolean) {
      updateSettingsForSource('localSettings', {
        spinnerTipsEnabled
      });
      // Update local state to reflect the change immediately
      setSettingsData(prev_3 => ({
        ...prev_3,
        spinnerTipsEnabled
      }));
      logMossenEvent('mossen.config.tipsSettingChanged', {
        enabled: spinnerTipsEnabled
      });
    }
  }, {
    id: 'prefersReducedMotion',
    label: getLocalizedText({ en: 'Reduce motion', zh: '减少动画' }),
    value: settingsData?.prefersReducedMotion ?? false,
    type: 'boolean' as const,
    onChange(prefersReducedMotion: boolean) {
      updateSettingsForSource('localSettings', {
        prefersReducedMotion
      });
      setSettingsData(prev_4 => ({
        ...prev_4,
        prefersReducedMotion
      }));
      // Sync to AppState so components react immediately
      setAppState(prev_5 => ({
        ...prev_5,
        settings: {
          ...prev_5.settings,
          prefersReducedMotion
        }
      }));
      logMossenEvent('mossen.config.reduceMotionSettingChanged', {
        enabled: prefersReducedMotion
      });
    }
  }, {
    id: 'thinkingEnabled',
    label: getLocalizedText({ en: 'Thinking mode', zh: '思考模式' }),
    value: thinkingEnabled ?? true,
    type: 'boolean' as const,
    onChange(enabled: boolean) {
      setAppState(prev_6 => ({
        ...prev_6,
        thinkingEnabled: enabled
      }));
      updateSettingsForSource('userSettings', {
        alwaysThinkingEnabled: enabled ? undefined : false
      });
      logMossenEvent('mossen.config.thinkingToggled', {
        enabled
      });
    }
  }, {
    id: 'dynamicWorkflows',
    label: getLocalizedText({ en: 'Dynamic workflows', zh: '动态工作流' }),
    searchText: getLocalizedText({
      en: 'Dynamic workflows workflow orchestration ultracode',
      zh: '动态工作流 工作流 编排 ultracode',
    }),
    value: settingsData?.disableWorkflows === true || settingsData?.enableWorkflows === false ? false : true,
    type: 'boolean' as const,
    onChange(enabled: boolean) {
      updateSettingsForSource('userSettings', {
        disableWorkflows: enabled ? undefined : true,
        enableWorkflows: undefined
      });
      setSettingsData(prev_6 => ({
        ...prev_6,
        disableWorkflows: enabled ? undefined : true,
        enableWorkflows: undefined
      }));
      if (!enabled) {
        setUltracodeActive(false);
      }
      setChanges(prev_7 => ({
        ...prev_7,
        [getLocalizedText({ en: 'Dynamic workflows', zh: '动态工作流' })]: enabled ? 'enabled' : 'disabled'
      }));
    }
  }, {
    id: 'workflowKeywordTriggerEnabled',
    label: getLocalizedText({ en: 'Workflow keyword trigger', zh: '工作流关键词触发' }),
    searchText: getLocalizedText({
      en: 'Workflow keyword trigger ultracode workflow',
      zh: '工作流关键词触发 ultracode workflow',
    }),
    value: settingsData?.workflowKeywordTriggerEnabled !== false,
    type: 'boolean' as const,
    onChange(enabled_0: boolean) {
      updateSettingsForSource('userSettings', {
        workflowKeywordTriggerEnabled: enabled_0 ? undefined : false
      });
      setSettingsData(prev_8 => ({
        ...prev_8,
        workflowKeywordTriggerEnabled: enabled_0 ? undefined : false
      }));
      setChanges(prev_9 => ({
        ...prev_9,
        [getLocalizedText({ en: 'Workflow keyword trigger', zh: '工作流关键词触发' })]: enabled_0 ? 'enabled' : 'disabled'
      }));
    }
  },
  // Fast mode toggle (internal-only, eliminated from external builds)
  ...(isFastModeEnabled() && isFastModeAvailable() ? [{
    id: 'fastMode',
    label: `Fast mode (${FAST_MODE_MODEL_DISPLAY} only)`,
    value: !!isFastMode,
    type: 'boolean' as const,
    onChange(enabled_0: boolean) {
      clearFastModeCooldown();
      updateSettingsForSource('userSettings', {
        fastMode: enabled_0 ? true : undefined
      });
      if (enabled_0) {
        setAppState(prev_7 => ({
          ...prev_7,
          mainLoopModel: getFastModeModel(),
          mainLoopModelForSession: null,
          fastMode: true
        }));
        setChanges(prev_8 => ({
          ...prev_8,
          model: getFastModeModel(),
          'Fast mode': 'ON'
        }));
      } else {
        setAppState(prev_9 => ({
          ...prev_9,
          fastMode: false
        }));
        setChanges(prev_10 => ({
          ...prev_10,
          'Fast mode': 'OFF'
        }));
      }
    }
  }] : []), ...(getFeatureValue_CACHED_MAY_BE_STALE('mossen.suggestion.promptEnabled', false) ? [{
    id: 'promptSuggestionEnabled',
    label: getLocalizedText({ en: 'Prompt suggestions', zh: '提示词建议' }),
    value: promptSuggestionEnabled,
    type: 'boolean' as const,
    onChange(enabled_1: boolean) {
      setAppState(prev_11 => ({
        ...prev_11,
        promptSuggestionEnabled: enabled_1
      }));
      updateSettingsForSource('userSettings', {
        promptSuggestionEnabled: enabled_1 ? undefined : false
      });
    }
  }] : []),
  // Speculation toggle (internal-only)
  ...(("external" as string) === 'internal' ? [{
    id: 'speculationEnabled',
    label: getLocalizedText({ en: 'Speculative execution', zh: '推测执行' }),
    value: globalConfig.speculationEnabled ?? true,
    type: 'boolean' as const,
    onChange(enabled_2: boolean) {
      saveGlobalConfig(current_1 => {
        if (current_1.speculationEnabled === enabled_2) return current_1;
        return {
          ...current_1,
          speculationEnabled: enabled_2
        };
      });
      setGlobalConfig({
        ...getGlobalConfig(),
        speculationEnabled: enabled_2
      });
      logMossenEvent('mossen.config.speculationSettingChanged', {
        enabled: enabled_2
      });
    }
  }] : []), ...(isFileCheckpointingAvailable ? [{
    id: 'fileCheckpointingEnabled',
    label: getLocalizedText({ en: 'Rewind code (checkpoints)', zh: '回退代码（检查点）' }),
    value: globalConfig.fileCheckpointingEnabled,
    type: 'boolean' as const,
    onChange(enabled_3: boolean) {
      saveGlobalConfig(current_2 => ({
        ...current_2,
        fileCheckpointingEnabled: enabled_3
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        fileCheckpointingEnabled: enabled_3
      });
      logMossenEvent('mossen.config.fileHistorySnapshotsSettingChanged', {
        enabled: enabled_3
      });
    }
  }] : []), {
    id: 'verbose',
    label: getLocalizedText({ en: 'Verbose output', zh: '详细输出' }),
    value: verbose,
    type: 'boolean',
    onChange: onChangeVerbose
  }, {
    id: 'terminalProgressBarEnabled',
    label: getLocalizedText({ en: 'Terminal progress bar', zh: '终端进度条' }),
    value: globalConfig.terminalProgressBarEnabled,
    type: 'boolean' as const,
    onChange(terminalProgressBarEnabled: boolean) {
      saveGlobalConfig(current_3 => ({
        ...current_3,
        terminalProgressBarEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        terminalProgressBarEnabled
      });
      logMossenEvent('mossen.config.terminalProgressBarSettingChanged', {
        enabled: terminalProgressBarEnabled
      });
    }
  }, ...(getFeatureValue_CACHED_MAY_BE_STALE('mossen.ui.terminalSidebarEnabled', false) ? [{
    id: 'showStatusInTerminalTab',
    label: getLocalizedText({ en: 'Show status in terminal tab', zh: '在终端标签页显示状态' }),
    value: globalConfig.showStatusInTerminalTab ?? false,
    type: 'boolean' as const,
    onChange(showStatusInTerminalTab: boolean) {
      saveGlobalConfig(current_4 => ({
        ...current_4,
        showStatusInTerminalTab
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        showStatusInTerminalTab
      });
      logMossenEvent('mossen.config.terminalTabStatusSettingChanged', {
        enabled: showStatusInTerminalTab
      });
    }
  }] : []), {
    id: 'showTurnDuration',
    label: getLocalizedText({ en: 'Show turn duration', zh: '显示回合耗时' }),
    value: globalConfig.showTurnDuration,
    type: 'boolean' as const,
    onChange(showTurnDuration: boolean) {
      saveGlobalConfig(current_5 => ({
        ...current_5,
        showTurnDuration
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        showTurnDuration
      });
      logMossenEvent('mossen.config.showTurnDurationSettingChanged', {
        enabled: showTurnDuration
      });
    }
  }, {
    id: 'defaultPermissionMode',
    label: getLocalizedText({ en: 'Default permission mode', zh: '默认权限模式' }),
    value: settingsData?.permissions?.defaultMode || 'default',
    options: (() => {
      const priorityOrder: PermissionMode[] = ['default', 'plan'];
      const allModes: readonly PermissionMode[] = feature('TRANSCRIPT_CLASSIFIER') ? PERMISSION_MODES : EXTERNAL_PERMISSION_MODES;
      const excluded: PermissionMode[] = ['bypassPermissions'];
      if (feature('TRANSCRIPT_CLASSIFIER') && !showAutoInDefaultModePicker) {
        excluded.push('auto');
      }
      return [...priorityOrder, ...allModes.filter(m => !priorityOrder.includes(m) && !excluded.includes(m))];
    })(),
    type: 'enum' as const,
    onChange(mode: string) {
      const parsedMode = permissionModeFromString(mode);
      // Internal modes (e.g. auto) are stored directly
      const validatedMode = isExternalPermissionMode(parsedMode) ? toExternalPermissionMode(parsedMode) : parsedMode;
      const result = updateSettingsForSource('userSettings', {
        permissions: {
          ...settingsData?.permissions,
          defaultMode: validatedMode as ExternalPermissionMode
        }
      });
      if (result.error) {
        logError(result.error);
        return;
      }

      // Update local state to reflect the change immediately.
      // validatedMode is typed as the wide PermissionMode union but at
      // runtime is always a PERMISSION_MODES member (the options dropdown
      // is built from that array above), so this narrowing is sound.
      setSettingsData(prev_12 => ({
        ...prev_12,
        permissions: {
          ...prev_12?.permissions,
          defaultMode: validatedMode as (typeof PERMISSION_MODES)[number]
        }
      }));
      // Track changes
      setChanges(prev_13 => ({
        ...prev_13,
        defaultPermissionMode: mode
      }));
      logMossenEvent('mossen.config.changed', {
        setting: 'defaultPermissionMode' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }, ...(feature('TRANSCRIPT_CLASSIFIER') && showAutoInDefaultModePicker ? [{
    id: 'useAutoModeDuringPlan',
    label: getLocalizedText({ en: 'Use auto mode during plan', zh: '计划期间使用自动模式' }),
    value: (settingsData as {
      useAutoModeDuringPlan?: boolean;
    } | undefined)?.useAutoModeDuringPlan ?? true,
    type: 'boolean' as const,
    onChange(useAutoModeDuringPlan: boolean) {
      updateSettingsForSource('userSettings', {
        useAutoModeDuringPlan
      });
      setSettingsData(prev_14 => ({
        ...prev_14,
        useAutoModeDuringPlan
      }));
      // Internal writes suppress the file watcher, so
      // applySettingsChange won't fire. Reconcile directly so
      // mid-plan toggles take effect immediately.
      setAppState(prev_15 => {
        const next = transitionPlanAutoMode(prev_15.toolPermissionContext);
        if (next === prev_15.toolPermissionContext) return prev_15;
        return {
          ...prev_15,
          toolPermissionContext: next
        };
      });
      setChanges(prev_16 => ({
        ...prev_16,
        'Use auto mode during plan': useAutoModeDuringPlan
      }));
    }
  }] : []), {
    id: 'respectGitignore',
    label: getLocalizedText({ en: 'Respect .gitignore in file picker', zh: '文件选择器遵循 .gitignore' }),
    value: globalConfig.respectGitignore,
    type: 'boolean' as const,
    onChange(respectGitignore: boolean) {
      saveGlobalConfig(current_6 => ({
        ...current_6,
        respectGitignore
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        respectGitignore
      });
      logMossenEvent('mossen.config.respectGitignoreSettingChanged', {
        enabled: respectGitignore
      });
    }
  }, {
    id: 'copyFullResponse',
    label: getLocalizedText({ en: 'Always copy full response (skip /copy picker)', zh: '始终复制完整回复（跳过 /copy 选择器）' }),
    value: globalConfig.copyFullResponse,
    type: 'boolean' as const,
    onChange(copyFullResponse: boolean) {
      saveGlobalConfig(current_7 => ({
        ...current_7,
        copyFullResponse
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        copyFullResponse
      });
      logMossenEvent('mossen.config.changed', {
        setting: 'copyFullResponse' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: String(copyFullResponse) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  },
  // Copy-on-select is only meaningful with in-app selection (fullscreen
  // alt-screen mode). In inline mode the terminal emulator owns selection.
  ...(isFullscreenEnvEnabled() ? [{
    id: 'copyOnSelect',
    label: getLocalizedText({ en: 'Copy on select', zh: '选中时复制' }),
    value: globalConfig.copyOnSelect ?? true,
    type: 'boolean' as const,
    onChange(copyOnSelect: boolean) {
      saveGlobalConfig(current_8 => ({
        ...current_8,
        copyOnSelect
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        copyOnSelect
      });
      logMossenEvent('mossen.config.changed', {
        setting: 'copyOnSelect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: String(copyOnSelect) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []),
  // autoUpdates setting is hidden - use DISABLE_AUTOUPDATER env var to control
  autoUpdaterDisabledReason ? {
    id: 'autoUpdatesChannel',
    label: getLocalizedText({ en: 'Auto-update channel', zh: '自动更新通道' }),
    value: getLocalizedText({ en: 'disabled', zh: '已禁用' }),
    type: 'managedEnum' as const,
    onChange() {}
  } : {
    id: 'autoUpdatesChannel',
    label: getLocalizedText({ en: 'Auto-update channel', zh: '自动更新通道' }),
    value: settingsData?.autoUpdatesChannel ?? 'latest',
    type: 'managedEnum' as const,
    onChange() {
      // Handled via toggleSetting -> 'ChannelDowngrade'
    }
  }, {
    id: 'theme',
    label: getLocalizedText({ en: 'Theme', zh: '主题' }),
    value: themeSetting,
    type: 'managedEnum',
    onChange: setTheme
  }, {
    id: 'notifChannel',
    label: feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION') ? getLocalizedText({ en: 'Local notifications', zh: '本地通知' }) : getLocalizedText({ en: 'Notifications', zh: '通知' }),
    value: globalConfig.preferredNotifChannel,
    options: ['auto', 'iterm2', 'terminal_bell', 'iterm2_with_bell', 'kitty', 'ghostty', 'notifications_disabled'],
    type: 'enum',
    onChange(notifChannel: GlobalConfig['preferredNotifChannel']) {
      saveGlobalConfig(current_9 => ({
        ...current_9,
        preferredNotifChannel: notifChannel
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        preferredNotifChannel: notifChannel
      });
    }
  }, ...(feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION') ? [{
    id: 'taskCompleteNotifEnabled',
    label: getLocalizedText({ en: 'Push when idle', zh: '空闲时推送' }),
    value: globalConfig.taskCompleteNotifEnabled ?? false,
    type: 'boolean' as const,
    onChange(taskCompleteNotifEnabled: boolean) {
      saveGlobalConfig(current_10 => ({
        ...current_10,
        taskCompleteNotifEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        taskCompleteNotifEnabled
      });
    }
  }, {
    id: 'inputNeededNotifEnabled',
    label: getLocalizedText({ en: 'Push when input needed', zh: '需要输入时推送' }),
    value: globalConfig.inputNeededNotifEnabled ?? false,
    type: 'boolean' as const,
    onChange(inputNeededNotifEnabled: boolean) {
      saveGlobalConfig(current_11 => ({
        ...current_11,
        inputNeededNotifEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        inputNeededNotifEnabled
      });
    }
  }, {
    id: 'agentPushNotifEnabled',
    label: getLocalizedText({ en: 'Push when the assistant decides', zh: '由助手决定时推送' }),
    value: globalConfig.agentPushNotifEnabled ?? false,
    type: 'boolean' as const,
    onChange(agentPushNotifEnabled: boolean) {
      saveGlobalConfig(current_12 => ({
        ...current_12,
        agentPushNotifEnabled
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        agentPushNotifEnabled
      });
    }
  }] : []), {
    id: 'outputStyle',
    label: getLocalizedText({ en: 'Output style', zh: '输出风格' }),
    value: currentOutputStyle,
    type: 'managedEnum' as const,
    onChange: () => {} // handled by OutputStylePicker submenu
  }, ...(showDefaultViewPicker ? [{
    id: 'defaultView',
    label: getLocalizedText({ en: 'What you see by default', zh: '默认显示内容' }),
    // 'default' means the setting is unset — currently resolves to
    // transcript (main.tsx falls through when defaultView !== 'chat').
    // String() narrows the conditional-schema-spread union to string.
    value: settingsData?.defaultView === undefined ? 'default' : String(settingsData.defaultView),
    options: ['transcript', 'chat', 'default'],
    type: 'enum' as const,
    onChange(selected: string) {
      const defaultView = selected === 'default' ? undefined : selected as 'chat' | 'transcript';
      updateSettingsForSource('localSettings', {
        defaultView
      });
      setSettingsData(prev_17 => ({
        ...prev_17,
        defaultView
      }));
      const nextBrief = defaultView === 'chat';
      setAppState(prev_18 => {
        if (prev_18.isBriefOnly === nextBrief) return prev_18;
        return {
          ...prev_18,
          isBriefOnly: nextBrief
        };
      });
      // Keep userMsgOptIn in sync so the tool list follows the view.
      // Two-way now (same as /brief) — accepting a cache invalidation
      // is better than leaving the tool on after switching away.
      // Reverted on Escape via initialUserMsgOptIn snapshot.
      setUserMsgOptIn(nextBrief);
      setChanges(prev_19 => ({
        ...prev_19,
        [getLocalizedText({ en: 'Default view', zh: '默认视图' })]: selected
      }));
      logMossenEvent('mossen.config.defaultViewSettingChanged', {
        value: (defaultView ?? 'unset') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []), {
    id: 'language',
    label: getLocalizedText({ en: 'Language', zh: '语言' }),
    value: currentLanguage ?? getLocalizedText({ en: 'Default (English)', zh: '默认（英语）' }),
    type: 'managedEnum' as const,
    onChange: () => {} // handled by LanguagePicker submenu
  }, {
    id: 'editorMode',
    label: getLocalizedText({ en: 'Editor mode', zh: '编辑器模式' }),
    // Convert 'emacs' to 'normal' for backward compatibility
    value: globalConfig.editorMode === 'emacs' ? 'normal' : globalConfig.editorMode || 'normal',
    options: ['normal', 'vim'],
    type: 'enum',
    onChange(value_1: string) {
      saveGlobalConfig(current_13 => ({
        ...current_13,
        editorMode: value_1 as GlobalConfig['editorMode']
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        editorMode: value_1 as GlobalConfig['editorMode']
      });
      logMossenEvent('mossen.config.editorModeChanged', {
        mode: value_1 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }, {
    id: 'prStatusFooterEnabled',
    label: getLocalizedText({ en: 'Show PR status footer', zh: '显示 PR 状态页脚' }),
    value: globalConfig.prStatusFooterEnabled ?? true,
    type: 'boolean' as const,
    onChange(enabled_4: boolean) {
      saveGlobalConfig(current_14 => {
        if (current_14.prStatusFooterEnabled === enabled_4) return current_14;
        return {
          ...current_14,
          prStatusFooterEnabled: enabled_4
        };
      });
      setGlobalConfig({
        ...getGlobalConfig(),
        prStatusFooterEnabled: enabled_4
      });
      logMossenEvent('mossen.config.prStatusFooterSettingChanged', {
        enabled: enabled_4
      });
    }
  }, {
    id: 'model',
    label: getLocalizedText({ en: 'Model', zh: '模型' }),
    value: mainLoopModel === null ? getLocalizedText({ en: 'Default (recommended)', zh: '默认（推荐）' }) : mainLoopModel,
    type: 'managedEnum' as const,
    onChange: onChangeMainModelConfig
  }, ...(isConnectedToIde ? [{
    id: 'diffTool',
    label: getLocalizedText({ en: 'Diff tool', zh: 'Diff 工具' }),
    value: globalConfig.diffTool ?? 'auto',
    options: ['terminal', 'auto'],
    type: 'enum' as const,
    onChange(diffTool: string) {
      saveGlobalConfig(current_15 => ({
        ...current_15,
        diffTool: diffTool as GlobalConfig['diffTool']
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        diffTool: diffTool as GlobalConfig['diffTool']
      });
      logMossenEvent('mossen.config.diffToolChanged', {
        tool: diffTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []), ...(!isSupportedTerminal() ? [{
    id: 'autoConnectIde',
    label: getLocalizedText({ en: 'Auto-connect to IDE (external terminal)', zh: '自动连接到 IDE（外部终端）' }),
    value: globalConfig.autoConnectIde ?? false,
    type: 'boolean' as const,
    onChange(autoConnectIde: boolean) {
      saveGlobalConfig(current_16 => ({
        ...current_16,
        autoConnectIde
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        autoConnectIde
      });
      logMossenEvent('mossen.config.autoConnectIdeChanged', {
        enabled: autoConnectIde,
        source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []), ...(isSupportedTerminal() ? [{
    id: 'autoInstallIdeExtension',
    label: getLocalizedText({ en: 'Auto-install IDE extension', zh: '自动安装 IDE 扩展' }),
    value: globalConfig.autoInstallIdeExtension ?? true,
    type: 'boolean' as const,
    onChange(autoInstallIdeExtension: boolean) {
      saveGlobalConfig(current_17 => ({
        ...current_17,
        autoInstallIdeExtension
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        autoInstallIdeExtension
      });
      logMossenEvent('mossen.config.autoInstallIdeExtensionChanged', {
        enabled: autoInstallIdeExtension,
        source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }] : []), ...(canUseChromeIntegration() ? [{
    id: 'mossenInChromeDefaultEnabled',
    label: getLocalizedText({ en: 'Chrome browser integration enabled by default', zh: '默认启用 Chrome 浏览器集成' }),
    value: globalConfig.mossenInChromeDefaultEnabled ?? false,
    type: 'boolean' as const,
    onChange(enabled_5: boolean) {
      saveGlobalConfig(current_18 => ({
        ...current_18,
        mossenInChromeDefaultEnabled: enabled_5
      }));
      setGlobalConfig({
        ...getGlobalConfig(),
        mossenInChromeDefaultEnabled: enabled_5
      });
      logMossenEvent('mossen.config.mossenInChromeSettingChanged', {
        enabled: enabled_5
      });
    }
  }] : []),
  // Teammate mode (only shown when agent swarms are enabled)
  ...(isAgentSwarmsEnabled() ? (() => {
    const cliOverride = getCliTeammateModeOverride();
    const label = cliOverride ? `Teammate mode [overridden: ${cliOverride}]` : 'Teammate mode';
    return [{
      id: 'teammateMode',
      label,
      value: globalConfig.teammateMode ?? 'auto',
      options: ['auto', 'tmux', 'in-process'],
      type: 'enum' as const,
      onChange(mode_0: string) {
        if (mode_0 !== 'auto' && mode_0 !== 'tmux' && mode_0 !== 'in-process') {
          return;
        }
        // Clear CLI override and set new mode (pass mode to avoid race condition)
        clearCliTeammateModeOverride(mode_0);
        saveGlobalConfig(current_19 => ({
          ...current_19,
          teammateMode: mode_0
        }));
        setGlobalConfig({
          ...getGlobalConfig(),
          teammateMode: mode_0
        });
        logMossenEvent('mossen.config.teammateModeChanged', {
          mode: mode_0 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
    }, {
      id: 'teammateDefaultModel',
      label: getLocalizedText({ en: 'Default teammate model', zh: '默认队友模型' }),
      value: teammateModelDisplayString(globalConfig.teammateDefaultModel),
      type: 'managedEnum' as const,
      onChange() {}
    }];
  })() : []),
  ...(shouldShowExternalIncludesToggle ? [{
    id: 'showExternalIncludesDialog',
    label: getLocalizedText({ en: 'External MOSSEN.md includes', zh: '外部 MOSSEN.md 引用' }),
    value: (() => {
      const projectConfig = getCurrentProjectConfig();
      if (projectConfig.hasMossenMdExternalIncludesApproved) {
        return 'true';
      } else {
        return 'false';
      }
    })(),
    type: 'managedEnum' as const,
    onChange() {
      // Will be handled by toggleSetting function
    }
  }] : []), ...(process.env.MOSSEN_CODE_API_KEY && !isRunningOnHomespace() ? [{
    id: 'apiKey',
    label: <Text>
                Use custom API key:{' '}
                <Text bold>
                  {normalizeApiKeyForConfig(process.env.MOSSEN_CODE_API_KEY)}
                </Text>
              </Text>,
    searchText: 'Use custom API key',
    value: Boolean(process.env.MOSSEN_CODE_API_KEY && globalConfig.customApiKeyResponses?.approved?.includes(normalizeApiKeyForConfig(process.env.MOSSEN_CODE_API_KEY))),
    type: 'boolean' as const,
    onChange(useCustomKey: boolean) {
      saveGlobalConfig(current_22 => {
        const updated = {
          ...current_22
        };
        if (!updated.customApiKeyResponses) {
          updated.customApiKeyResponses = {
            approved: [],
            rejected: []
          };
        }
        if (!updated.customApiKeyResponses.approved) {
          updated.customApiKeyResponses = {
            ...updated.customApiKeyResponses,
            approved: []
          };
        }
        if (!updated.customApiKeyResponses.rejected) {
          updated.customApiKeyResponses = {
            ...updated.customApiKeyResponses,
            rejected: []
          };
        }
        if (process.env.MOSSEN_CODE_API_KEY) {
          const truncatedKey = normalizeApiKeyForConfig(process.env.MOSSEN_CODE_API_KEY);
          if (useCustomKey) {
            updated.customApiKeyResponses = {
              ...updated.customApiKeyResponses,
              approved: [...(updated.customApiKeyResponses.approved ?? []).filter(k => k !== truncatedKey), truncatedKey],
              rejected: (updated.customApiKeyResponses.rejected ?? []).filter(k_0 => k_0 !== truncatedKey)
            };
          } else {
            updated.customApiKeyResponses = {
              ...updated.customApiKeyResponses,
              approved: (updated.customApiKeyResponses.approved ?? []).filter(k_1 => k_1 !== truncatedKey),
              rejected: [...(updated.customApiKeyResponses.rejected ?? []).filter(k_2 => k_2 !== truncatedKey), truncatedKey]
            };
          }
        }
        return updated;
      });
      setGlobalConfig(getGlobalConfig());
    }
  }] : [])];

  // Filter settings based on search query
  const filteredSettingsItems = React.useMemo(() => {
    if (!searchQuery) return settingsItems;
    const lowerQuery = searchQuery.toLowerCase();
    return settingsItems.filter(setting => {
      if (setting.id.toLowerCase().includes(lowerQuery)) return true;
      const searchableText = 'searchText' in setting ? setting.searchText : setting.label;
      return searchableText.toLowerCase().includes(lowerQuery);
    });
  }, [settingsItems, searchQuery]);

  // Adjust selected index when filtered list shrinks, and keep the selected
  // item visible when maxVisible changes (e.g., terminal resize).
  React.useEffect(() => {
    if (selectedIndex >= filteredSettingsItems.length) {
      const newIndex = Math.max(0, filteredSettingsItems.length - 1);
      setSelectedIndex(newIndex);
      setScrollOffset(Math.max(0, newIndex - maxVisible + 1));
      return;
    }
    setScrollOffset(prev_21 => {
      if (selectedIndex < prev_21) return selectedIndex;
      if (selectedIndex >= prev_21 + maxVisible) return selectedIndex - maxVisible + 1;
      return prev_21;
    });
  }, [filteredSettingsItems.length, selectedIndex, maxVisible]);

  // Keep the selected item visible within the scroll window.
  // Called synchronously from navigation handlers to avoid a render frame
  // where the selected item falls outside the visible window.
  const adjustScrollOffset = useCallback((newIndex_0: number) => {
    setScrollOffset(prev_22 => {
      if (newIndex_0 < prev_22) return newIndex_0;
      if (newIndex_0 >= prev_22 + maxVisible) return newIndex_0 - maxVisible + 1;
      return prev_22;
    });
  }, [maxVisible]);

  // Enter: keep all changes (already persisted by onChange handlers), close
  // with a summary of what changed.
  const handleSaveAndClose = useCallback(() => {
    // Submenu handling: each submenu has its own Enter/Esc — don't close
    // the whole panel while one is open.
    if (showSubmenu !== null) {
      return;
    }
    // Log any changes that were made
    // TODO: Make these proper messages
    const formattedChanges: string[] = Object.entries(changes).map(([key, value_2]) => {
      logMossenEvent('mossen.config.changed', {
        key: key as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: value_2 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      return `Set ${key} to ${chalk.bold(value_2)}`;
    });
    // Check for API key changes
    // On homespace, MOSSEN_CODE_API_KEY is preserved in process.env for child
    // processes but ignored by Mossen itself (see auth.ts).
    const effectiveApiKey = isRunningOnHomespace() ? undefined : process.env.MOSSEN_CODE_API_KEY;
    const initialUsingCustomKey = Boolean(effectiveApiKey && initialConfig.current.customApiKeyResponses?.approved?.includes(normalizeApiKeyForConfig(effectiveApiKey)));
    const currentUsingCustomKey = Boolean(effectiveApiKey && globalConfig.customApiKeyResponses?.approved?.includes(normalizeApiKeyForConfig(effectiveApiKey)));
    if (initialUsingCustomKey !== currentUsingCustomKey) {
      formattedChanges.push(`${currentUsingCustomKey ? 'Enabled' : 'Disabled'} custom API key`);
      logMossenEvent('mossen.config.changed', {
        key: 'env.MOSSEN_CODE_API_KEY' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        value: currentUsingCustomKey as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
    if (globalConfig.theme !== initialConfig.current.theme) {
      formattedChanges.push(getLocalizedText({
        en: `Set theme to ${chalk.bold(globalConfig.theme)}`,
        zh: `将主题设置为 ${chalk.bold(globalConfig.theme)}`,
      }));
    }
    if (globalConfig.preferredNotifChannel !== initialConfig.current.preferredNotifChannel) {
      formattedChanges.push(getLocalizedText({
        en: `Set notifications to ${chalk.bold(globalConfig.preferredNotifChannel)}`,
        zh: `将通知设置为 ${chalk.bold(globalConfig.preferredNotifChannel)}`,
      }));
    }
    if (currentOutputStyle !== initialOutputStyle.current) {
      formattedChanges.push(getLocalizedText({
        en: `Set output style to ${chalk.bold(currentOutputStyle)}`,
        zh: `将输出风格设置为 ${chalk.bold(currentOutputStyle)}`,
      }));
    }
    if (currentLanguage !== initialLanguage.current) {
      formattedChanges.push(getLocalizedText({
        en: `Set response language to ${chalk.bold(currentLanguage ?? 'Default (English)')}`,
        zh: `将回复语言设置为 ${chalk.bold(currentLanguage ?? '默认（英语）')}`,
      }));
    }
    if (globalConfig.editorMode !== initialConfig.current.editorMode) {
      formattedChanges.push(getLocalizedText({
        en: `Set editor mode to ${chalk.bold(globalConfig.editorMode || 'emacs')}`,
        zh: `将编辑器模式设置为 ${chalk.bold(globalConfig.editorMode || 'emacs')}`,
      }));
    }
    if (globalConfig.diffTool !== initialConfig.current.diffTool) {
      formattedChanges.push(getLocalizedText({
        en: `Set diff tool to ${chalk.bold(globalConfig.diffTool)}`,
        zh: `将 Diff 工具设置为 ${chalk.bold(globalConfig.diffTool)}`,
      }));
    }
    if (globalConfig.autoConnectIde !== initialConfig.current.autoConnectIde) {
      formattedChanges.push(`${globalConfig.autoConnectIde ? 'Enabled' : 'Disabled'} auto-connect to IDE`);
    }
    if (globalConfig.autoInstallIdeExtension !== initialConfig.current.autoInstallIdeExtension) {
      formattedChanges.push(`${globalConfig.autoInstallIdeExtension ? 'Enabled' : 'Disabled'} auto-install IDE extension`);
    }
    if (globalConfig.autoCompactEnabled !== initialConfig.current.autoCompactEnabled) {
      formattedChanges.push(`${globalConfig.autoCompactEnabled ? 'Enabled' : 'Disabled'} auto-compact`);
    }
    if (globalConfig.respectGitignore !== initialConfig.current.respectGitignore) {
      formattedChanges.push(`${globalConfig.respectGitignore ? 'Enabled' : 'Disabled'} respect .gitignore in file picker`);
    }
    if (globalConfig.copyFullResponse !== initialConfig.current.copyFullResponse) {
      formattedChanges.push(`${globalConfig.copyFullResponse ? 'Enabled' : 'Disabled'} always copy full response`);
    }
    if (globalConfig.copyOnSelect !== initialConfig.current.copyOnSelect) {
      formattedChanges.push(`${globalConfig.copyOnSelect ? 'Enabled' : 'Disabled'} copy on select`);
    }
    if (globalConfig.terminalProgressBarEnabled !== initialConfig.current.terminalProgressBarEnabled) {
      formattedChanges.push(`${globalConfig.terminalProgressBarEnabled ? 'Enabled' : 'Disabled'} terminal progress bar`);
    }
    if (globalConfig.showStatusInTerminalTab !== initialConfig.current.showStatusInTerminalTab) {
      formattedChanges.push(`${globalConfig.showStatusInTerminalTab ? 'Enabled' : 'Disabled'} terminal tab status`);
    }
    if (globalConfig.showTurnDuration !== initialConfig.current.showTurnDuration) {
      formattedChanges.push(`${globalConfig.showTurnDuration ? 'Enabled' : 'Disabled'} turn duration`);
    }
    if (globalConfig.remoteControlAtStartup !== initialConfig.current.remoteControlAtStartup) {
      const remoteLabel = globalConfig.remoteControlAtStartup === undefined ? 'Reset Remote Control to default' : `${globalConfig.remoteControlAtStartup ? 'Enabled' : 'Disabled'} Remote Control for all sessions`;
      formattedChanges.push(remoteLabel);
    }
    if (settingsData?.autoUpdatesChannel !== initialSettingsData.current?.autoUpdatesChannel) {
      formattedChanges.push(`Set auto-update channel to ${chalk.bold(settingsData?.autoUpdatesChannel ?? 'latest')}`);
    }
    if (formattedChanges.length > 0) {
      onClose(formattedChanges.join('\n'));
    } else {
      onClose(getLocalizedText({
        en: 'Config dialog dismissed',
        zh: '已关闭配置面板',
      }), {
        display: 'system'
      });
    }
  }, [showSubmenu, changes, globalConfig, mainLoopModel, currentOutputStyle, currentLanguage, settingsData?.autoUpdatesChannel, isFastModeEnabled() ? (settingsData as Record<string, unknown> | undefined)?.fastMode : undefined, onClose]);

  // Restore all state stores to their mount-time snapshots. Changes are
  // applied to disk/AppState immediately on toggle, so "cancel" means
  // actively writing the old values back.
  const revertChanges = useCallback(() => {
    // Theme: restores ThemeProvider React state. Must run before the global
    // config overwrite since setTheme internally calls saveGlobalConfig with
    // a partial update — we want the full snapshot to be the last write.
    if (themeSetting !== initialThemeSetting.current) {
      setTheme(initialThemeSetting.current);
    }
    // Global config: full overwrite from snapshot. saveGlobalConfig skips if
    // the returned ref equals current (test mode checks ref; prod writes to
    // disk but content is identical).
    saveGlobalConfig(() => initialConfig.current);
    // Settings files: restore each key Config may have touched. undefined
    // deletes the key (updateSettingsForSource customizer at settings.ts:368).
    const il = initialLocalSettings;
    updateSettingsForSource('localSettings', {
      spinnerTipsEnabled: il?.spinnerTipsEnabled,
      prefersReducedMotion: il?.prefersReducedMotion,
      defaultView: il?.defaultView,
      outputStyle: il?.outputStyle
    });
    const iu = initialUserSettings;
    updateSettingsForSource('userSettings', {
      alwaysThinkingEnabled: iu?.alwaysThinkingEnabled,
      fastMode: iu?.fastMode,
      promptSuggestionEnabled: iu?.promptSuggestionEnabled,
      disableWorkflows: iu?.disableWorkflows,
      enableWorkflows: iu?.enableWorkflows,
      workflowKeywordTriggerEnabled: iu?.workflowKeywordTriggerEnabled,
      autoUpdatesChannel: iu?.autoUpdatesChannel,
      minimumVersion: iu?.minimumVersion,
      language: iu?.language,
      ...(feature('TRANSCRIPT_CLASSIFIER') ? {
        useAutoModeDuringPlan: (iu as {
          useAutoModeDuringPlan?: boolean;
        } | undefined)?.useAutoModeDuringPlan
      } : {}),
      // ThemePicker's Ctrl+T writes this key directly — include it so the
      // disk state reverts along with the in-memory AppState.settings restore.
      syntaxHighlightingDisabled: iu?.syntaxHighlightingDisabled,
      // permissions: the defaultMode onChange (above) spreads the MERGED
      // settingsData.permissions into userSettings — project/policy allow/deny
      // arrays can leak to disk. Spread the full initial snapshot so the
      // mergeWith array-customizer (settings.ts:375) replaces leaked arrays.
      // Explicitly include defaultMode so undefined triggers the customizer's
      // delete path even when iu.permissions lacks that key.
      permissions: iu?.permissions === undefined ? undefined : {
        ...iu.permissions,
        defaultMode: iu.permissions.defaultMode
      }
    });
    // AppState: batch-restore all possibly-touched fields.
    const ia = initialAppState;
    setAppState(prev_23 => ({
      ...prev_23,
      mainLoopModel: ia.mainLoopModel,
      mainLoopModelForSession: ia.mainLoopModelForSession,
      verbose: ia.verbose,
      thinkingEnabled: ia.thinkingEnabled,
      fastMode: ia.fastMode,
      promptSuggestionEnabled: ia.promptSuggestionEnabled,
      isBriefOnly: ia.isBriefOnly,
      settings: ia.settings,
      // Reconcile auto-mode state after useAutoModeDuringPlan revert above —
      // the onChange handler may have activated/deactivated auto mid-plan.
      toolPermissionContext: transitionPlanAutoMode(prev_23.toolPermissionContext)
    }));
    // Bootstrap state: restore userMsgOptIn. Only touched by the defaultView
    // onChange above, so no feature() guard needed here (that path only
    // exists when showDefaultViewPicker is true).
    if (getUserMsgOptIn() !== initialUserMsgOptIn) {
      setUserMsgOptIn(initialUserMsgOptIn);
    }
  }, [themeSetting, setTheme, initialLocalSettings, initialUserSettings, initialAppState, initialUserMsgOptIn, setAppState]);

  // Escape: revert all changes (if any) and close.
  const handleEscape = useCallback(() => {
    if (showSubmenu !== null) {
      return;
    }
    if (isDirty.current) {
      revertChanges();
    }
    onClose(getLocalizedText({ en: 'Config dialog dismissed', zh: '已关闭配置面板' }), {
      display: 'system'
    });
  }, [showSubmenu, revertChanges, onClose]);

  // Disable when submenu is open so the submenu's Dialog handles ESC, and in
  // search mode so the onKeyDown handler (which clears-then-exits search)
  // wins — otherwise Escape in search would jump straight to revert+close.
  useKeybinding('confirm:no', handleEscape, {
    context: 'Settings',
    isActive: showSubmenu === null && !isSearchMode && !headerFocused
  });
  // Save-and-close fires on Enter only when not in search mode (Enter there
  // exits search to the list — see the isSearchMode branch in handleKeyDown).
  useKeybinding('settings:close', handleSaveAndClose, {
    context: 'Settings',
    isActive: showSubmenu === null && !isSearchMode && !headerFocused
  });

  // Settings navigation and toggle actions via configurable keybindings.
  // Only active when not in search mode and no submenu is open.
  const toggleSetting = useCallback(() => {
    const setting_0 = filteredSettingsItems[selectedIndex];
    if (!setting_0 || !setting_0.onChange) {
      return;
    }
    if (setting_0.type === 'boolean') {
      isDirty.current = true;
      setting_0.onChange(!setting_0.value);
      if (setting_0.id === 'thinkingEnabled') {
        const newValue = !setting_0.value;
        const backToInitial = newValue === initialThinkingEnabled.current;
        if (backToInitial) {
          setShowThinkingWarning(false);
        } else if (context.messages.some(m_0 => m_0.type === 'assistant')) {
          setShowThinkingWarning(true);
        }
      }
      return;
    }
    if (setting_0.id === 'theme' || setting_0.id === 'model' || setting_0.id === 'teammateDefaultModel' || setting_0.id === 'showExternalIncludesDialog' || setting_0.id === 'outputStyle' || setting_0.id === 'language') {
      // managedEnum items open a submenu — isDirty is set by the submenu's
      // completion callback, not here (submenu may be cancelled).
      switch (setting_0.id) {
        case 'theme':
          setShowSubmenu('Theme');
          setTabsHidden(true);
          return;
        case 'model':
          setShowSubmenu('Model');
          setTabsHidden(true);
          return;
        case 'teammateDefaultModel':
          setShowSubmenu('TeammateModel');
          setTabsHidden(true);
          return;
        case 'showExternalIncludesDialog':
          setShowSubmenu('ExternalIncludes');
          setTabsHidden(true);
          return;
        case 'outputStyle':
          setShowSubmenu('OutputStyle');
          setTabsHidden(true);
          return;
        case 'language':
          setShowSubmenu('Language');
          setTabsHidden(true);
          return;
      }
    }
    if (setting_0.id === 'autoUpdatesChannel') {
      if (autoUpdaterDisabledReason) {
        // Auto-updates are disabled - show enable dialog instead
        setShowSubmenu('EnableAutoUpdates');
        setTabsHidden(true);
        return;
      }
      const currentChannel = settingsData?.autoUpdatesChannel ?? 'latest';
      if (currentChannel === 'latest') {
        // Switching to stable - show downgrade dialog
        setShowSubmenu('ChannelDowngrade');
        setTabsHidden(true);
      } else {
        // Switching to latest - just do it and clear minimumVersion
        isDirty.current = true;
        updateSettingsForSource('userSettings', {
          autoUpdatesChannel: 'latest',
          minimumVersion: undefined
        });
        setSettingsData(prev_24 => ({
          ...prev_24,
          autoUpdatesChannel: 'latest',
          minimumVersion: undefined
        }));
        logMossenEvent('mossen.config.autoUpdateChannelChanged', {
          channel: 'latest' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
      return;
    }
    if (setting_0.type === 'enum') {
      isDirty.current = true;
      const currentIndex = setting_0.options.indexOf(setting_0.value);
      const nextIndex = (currentIndex + 1) % setting_0.options.length;
      setting_0.onChange(setting_0.options[nextIndex]!);
      return;
    }
  }, [autoUpdaterDisabledReason, filteredSettingsItems, selectedIndex, settingsData?.autoUpdatesChannel, setTabsHidden]);
  const moveSelection = (delta: -1 | 1): void => {
    setShowThinkingWarning(false);
    const newIndex_1 = Math.max(0, Math.min(filteredSettingsItems.length - 1, selectedIndex + delta));
    setSelectedIndex(newIndex_1);
    adjustScrollOffset(newIndex_1);
  };
  useKeybindings({
    'select:previous': () => {
      if (selectedIndex === 0) {
        // ↑ at top enters search mode so users can type-to-filter after
        // reaching the list boundary. Wheel-up (scroll:lineUp) clamps
        // instead — overshoot shouldn't move focus away from the list.
        setShowThinkingWarning(false);
        setIsSearchMode(true);
        setScrollOffset(0);
      } else {
        moveSelection(-1);
      }
    },
    'select:next': () => moveSelection(1),
    // Wheel. ScrollKeybindingHandler's scroll:line* returns false (not
    // consumed) when the ScrollBox content fits — which it always does
    // here because the list is paginated (slice). The event falls through
    // to this handler which navigates the list, clamping at boundaries.
    'scroll:lineUp': () => moveSelection(-1),
    'scroll:lineDown': () => moveSelection(1),
    'select:accept': toggleSetting,
    'settings:search': () => {
      setIsSearchMode(true);
      setSearchQuery('');
    }
  }, {
    context: 'Settings',
    isActive: showSubmenu === null && !isSearchMode && !headerFocused
  });

  // Combined key handling across search/list modes. Branch order mirrors
  // the original useInput gate priority: submenu and header short-circuit
  // first (their own handlers own input), then search vs. list.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (showSubmenu !== null) return;
    if (headerFocused) return;
    // Search mode: Esc clears then exits, Enter/↓ moves to the list.
    if (isSearchMode) {
      if (e.key === 'escape') {
        e.preventDefault();
        if (searchQuery.length > 0) {
          setSearchQuery('');
        } else {
          setIsSearchMode(false);
        }
        return;
      }
      if (e.key === 'return' || e.key === 'down' || e.key === 'wheeldown') {
        e.preventDefault();
        setIsSearchMode(false);
        setSelectedIndex(0);
        setScrollOffset(0);
      }
      return;
    }
    // List mode: left/right/tab cycle the selected option's value. These
    // keys used to switch tabs; now they only do so when the tab row is
    // explicitly focused (see headerFocused in Settings.tsx).
    if (e.key === 'left' || e.key === 'right' || e.key === 'tab') {
      e.preventDefault();
      toggleSetting();
      return;
    }
    // Fallback: printable characters (other than those bound to actions)
    // enter search mode. Carve out j/k// — useKeybindings (still on the
    // useInput path) consumes these via stopImmediatePropagation, but
    // onKeyDown dispatches independently so we must skip them explicitly.
    if (e.ctrl || e.meta) return;
    if (e.key === 'j' || e.key === 'k' || e.key === '/') return;
    if (e.key.length === 1 && e.key !== ' ') {
      e.preventDefault();
      setIsSearchMode(true);
      setSearchQuery(e.key);
    }
  }, [showSubmenu, headerFocused, isSearchMode, searchQuery, setSearchQuery, toggleSetting]);
  return <Box flexDirection="column" width="100%" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      {showSubmenu === 'Theme' ? <>
          <ThemePicker onThemeSelect={setting_1 => {
        isDirty.current = true;
        setTheme(setting_1);
        setShowSubmenu(null);
        setTabsHidden(false);
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} hideEscToCancel skipExitHandling={true} // Skip exit handling as Config already handles it
      />
          <Box>
            <Text dimColor italic>
              <Byline>
                <KeyboardShortcutHint shortcut="Enter" action="select" />
                <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
              </Byline>
            </Text>
          </Box>
        </> : showSubmenu === 'Model' ? <>
          <ModelPicker initial={mainLoopModel} onSelect={(model_0, _effort) => {
        isDirty.current = true;
        onChangeMainModelConfig(model_0);
        setShowSubmenu(null);
        setTabsHidden(false);
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} showFastModeNotice={isFastModeEnabled() ? isFastMode && isFastModeSupportedByModel(mainLoopModel) && isFastModeAvailable() : false} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </> : showSubmenu === 'TeammateModel' ? <>
          <ModelPicker initial={globalConfig.teammateDefaultModel ?? null} skipSettingsWrite headerText="Default model for newly spawned teammates. The leader can override via the tool call's model parameter." onSelect={(model_1, _effort_0) => {
        setShowSubmenu(null);
        setTabsHidden(false);
        // First-open-then-Enter from unset: picker highlights "Default"
        // (initial=null) and confirming would write null, silently
        // switching Opus-fallback → follow-leader. Treat as no-op.
        if (globalConfig.teammateDefaultModel === undefined && model_1 === null) {
          return;
        }
        isDirty.current = true;
        saveGlobalConfig(current_23 => current_23.teammateDefaultModel === model_1 ? current_23 : {
          ...current_23,
          teammateDefaultModel: model_1
        });
        setGlobalConfig({
          ...getGlobalConfig(),
          teammateDefaultModel: model_1
        });
        setChanges(prev_25 => ({
          ...prev_25,
          teammateDefaultModel: teammateModelDisplayString(model_1)
        }));
        logMossenEvent('mossen.config.teammateDefaultModelChanged', {
          model: model_1 as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </> : showSubmenu === 'ExternalIncludes' ? <>
          <MossenMdExternalIncludesDialog onDone={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} externalIncludes={getExternalMossenMdIncludes(memoryFiles)} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="disable external includes" />
            </Byline>
          </Text>
        </> : showSubmenu === 'OutputStyle' ? <>
          <OutputStylePicker initialStyle={currentOutputStyle} onComplete={style => {
        isDirty.current = true;
        setCurrentOutputStyle(style ?? DEFAULT_OUTPUT_STYLE_NAME);
        setShowSubmenu(null);
        setTabsHidden(false);

        // Save to local settings
        updateSettingsForSource('localSettings', {
          outputStyle: style
        });
        void logMossenEvent('mossen.config.outputStyleChanged', {
          style: (style ?? DEFAULT_OUTPUT_STYLE_NAME) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          settings_source: 'localSettings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </> : showSubmenu === 'Language' ? <>
          <LanguagePicker initialLanguage={currentLanguage} onComplete={language => {
        isDirty.current = true;
        setCurrentLanguage(language);
        setShowSubmenu(null);
        setTabsHidden(false);

        // Save to user settings
        updateSettingsForSource('userSettings', {
          language
        });
        void logMossenEvent('mossen.config.languageChanged', {
          language: (language ?? 'default') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          source: 'config_panel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }} onCancel={() => {
        setShowSubmenu(null);
        setTabsHidden(false);
      }} />
          <Text dimColor>
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
            </Byline>
          </Text>
        </> : showSubmenu === 'EnableAutoUpdates' ? <Dialog title="Enable Auto-Updates" onCancel={() => {
      setShowSubmenu(null);
      setTabsHidden(false);
    }} hideBorder hideInputGuide>
          {autoUpdaterDisabledReason?.type !== 'config' ? <>
              <Text>
                {autoUpdaterDisabledReason?.type === 'env' ? 'Auto-updates are controlled by an environment variable and cannot be changed here.' : 'Auto-updates are disabled in development builds.'}
              </Text>
              {autoUpdaterDisabledReason?.type === 'env' && <Text dimColor>
                  Unset {autoUpdaterDisabledReason.envVar} to re-enable
                  auto-updates.
                </Text>}
            </> : <Select options={[{
        label: getLocalizedText({ en: 'Enable with latest channel', zh: '启用并使用 latest 通道' }),
        value: 'latest'
      }, {
        label: getLocalizedText({ en: 'Enable with stable channel', zh: '启用并使用 stable 通道' }),
        value: 'stable'
      }]} onChange={(channel: string) => {
        isDirty.current = true;
        setShowSubmenu(null);
        setTabsHidden(false);
        saveGlobalConfig(current_24 => ({
          ...current_24,
          autoUpdates: true
        }));
        setGlobalConfig({
          ...getGlobalConfig(),
          autoUpdates: true
        });
        updateSettingsForSource('userSettings', {
          autoUpdatesChannel: channel as 'latest' | 'stable',
          minimumVersion: undefined
        });
        setSettingsData(prev_26 => ({
          ...prev_26,
          autoUpdatesChannel: channel as 'latest' | 'stable',
          minimumVersion: undefined
        }));
        logMossenEvent('mossen.config.autoUpdateEnabled', {
          channel: channel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }} />}
        </Dialog> : showSubmenu === 'ChannelDowngrade' ? <ChannelDowngradeDialog currentVersion={MACRO.VERSION} onChoice={(choice: ChannelDowngradeChoice) => {
      setShowSubmenu(null);
      setTabsHidden(false);
      if (choice === 'cancel') {
        // User cancelled - don't change anything
        return;
      }
      isDirty.current = true;
      // Switch to stable channel
      const newSettings: {
        autoUpdatesChannel: 'stable';
        minimumVersion?: string;
      } = {
        autoUpdatesChannel: 'stable'
      };
      if (choice === 'stay') {
        // User wants to stay on current version until stable catches up
        newSettings.minimumVersion = MACRO.VERSION;
      }
      updateSettingsForSource('userSettings', newSettings);
      setSettingsData(prev_27 => ({
        ...prev_27,
        ...newSettings
      }));
      logMossenEvent('mossen.config.autoUpdateChannelChanged', {
        channel: 'stable' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        minimum_version_set: choice === 'stay'
      });
    }} /> : <Box flexDirection="column" gap={1} marginY={insideModal ? undefined : 1}>
          <SearchBox query={searchQuery} isFocused={isSearchMode && !headerFocused} isTerminalFocused={isTerminalFocused} cursorOffset={searchCursorOffset} placeholder={getLocalizedText({ en: 'Search settings…', zh: '搜索设置…' })} />
          <Box flexDirection="column">
            {filteredSettingsItems.length === 0 ? <Text dimColor italic>
                {getLocalizedText({ en: 'No settings match', zh: '没有匹配的设置项' })} &quot;{searchQuery}&quot;
              </Text> : <>
                {scrollOffset > 0 && <Text dimColor>
                    {figures.arrowUp} {scrollOffset} more above
                  </Text>}
                {filteredSettingsItems.slice(scrollOffset, scrollOffset + maxVisible).map((setting_2, i) => {
            const actualIndex = scrollOffset + i;
            const isSelected = actualIndex === selectedIndex && !headerFocused && !isSearchMode;
            return <React.Fragment key={setting_2.id}>
                        <Box>
                          <Box width={44}>
                            <Text color={isSelected ? 'suggestion' : undefined}>
                              {isSelected ? figures.pointer : ' '}{' '}
                              {setting_2.label}
                            </Text>
                          </Box>
                          <Box key={isSelected ? 'selected' : 'unselected'}>
                            {setting_2.type === 'boolean' ? <>
                                <Text color={isSelected ? 'suggestion' : undefined}>
                                  {setting_2.value.toString()}
                                </Text>
                                {showThinkingWarning && setting_2.id === 'thinkingEnabled' && <Text color="warning">
                                      {' '}
                                      Changing thinking mode mid-conversation
                                      will increase latency and may reduce
                                      quality.
                                    </Text>}
                              </> : setting_2.id === 'theme' ? <Text color={isSelected ? 'suggestion' : undefined}>
                                {THEME_LABELS[setting_2.value.toString()] ?? setting_2.value.toString()}
                              </Text> : setting_2.id === 'notifChannel' ? <Text color={isSelected ? 'suggestion' : undefined}>
                                <NotifChannelLabel value={setting_2.value.toString()} />
                              </Text> : setting_2.id === 'defaultPermissionMode' ? <Text color={isSelected ? 'suggestion' : undefined}>
                                {permissionModeTitle(setting_2.value as PermissionMode)}
                              </Text> : setting_2.id === 'autoUpdatesChannel' && autoUpdaterDisabledReason ? <Box flexDirection="column">
                                <Text color={isSelected ? 'suggestion' : undefined}>
                                  disabled
                                </Text>
                                <Text dimColor>
                                  (
                                  {formatAutoUpdaterDisabledReason(autoUpdaterDisabledReason)}
                                  )
                                </Text>
                              </Box> : <Text color={isSelected ? 'suggestion' : undefined}>
                                {setting_2.value.toString()}
                              </Text>}
                          </Box>
                        </Box>
                      </React.Fragment>;
          })}
                {scrollOffset + maxVisible < filteredSettingsItems.length && <Text dimColor>
                    {figures.arrowDown}{' '}
                    {filteredSettingsItems.length - scrollOffset - maxVisible}{' '}
                    more below
                  </Text>}
              </>}
          </Box>
          {headerFocused ? <Text dimColor>
              <Byline>
                <KeyboardShortcutHint shortcut="←/→ tab" action="switch" />
                <KeyboardShortcutHint shortcut="↓" action="return" />
                <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="close" />
              </Byline>
            </Text> : isSearchMode ? <Text dimColor>
              <Byline>
                <Text>Type to filter</Text>
                <KeyboardShortcutHint shortcut="Enter/↓" action="select" />
                <KeyboardShortcutHint shortcut="↑" action="tabs" />
                <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="clear" />
              </Byline>
            </Text> : <Text dimColor>
              <Byline>
                <ConfigurableShortcutHint action="select:accept" context="Settings" fallback="Space" description="change" />
                <ConfigurableShortcutHint action="settings:close" context="Settings" fallback="Enter" description="save" />
                <ConfigurableShortcutHint action="settings:search" context="Settings" fallback="/" description="search" />
                <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="cancel" />
              </Byline>
            </Text>}
        </Box>}
    </Box>;
}
function teammateModelDisplayString(value: string | null | undefined): string {
  if (value === undefined) {
    return modelDisplayString(getHardcodedTeammateModelFallback());
  }
  if (value === null) return "Default (leader's model)";
  return modelDisplayString(value);
}
const THEME_LABELS: Record<string, string> = {
  auto: 'Auto (match terminal)',
  dark: 'Dark mode',
  light: 'Light mode',
  'dark-daltonized': 'Dark mode (colorblind-friendly)',
  'light-daltonized': 'Light mode (colorblind-friendly)',
  'dark-ansi': 'Dark mode (ANSI colors only)',
  'light-ansi': 'Light mode (ANSI colors only)'
};
function NotifChannelLabel(t0) {
  const $ = _c(4);
  const {
    value
  } = t0;
  switch (value) {
    case "auto":
      {
        return "Auto";
      }
    case "iterm2":
      {
        let t1;
        if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text>iTerm2 <Text dimColor={true}>(OSC 9)</Text></Text>;
          $[0] = t1;
        } else {
          t1 = $[0];
        }
        return t1;
      }
    case "terminal_bell":
      {
        let t1;
        if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text>Terminal Bell <Text dimColor={true}>(\a)</Text></Text>;
          $[1] = t1;
        } else {
          t1 = $[1];
        }
        return t1;
      }
    case "kitty":
      {
        let t1;
        if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text>Kitty <Text dimColor={true}>(OSC 99)</Text></Text>;
          $[2] = t1;
        } else {
          t1 = $[2];
        }
        return t1;
      }
    case "ghostty":
      {
        let t1;
        if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text>Ghostty <Text dimColor={true}>(OSC 777)</Text></Text>;
          $[3] = t1;
        } else {
          t1 = $[3];
        }
        return t1;
      }
    case "iterm2_with_bell":
      {
        return "iTerm2 w/ Bell";
      }
    case "notifications_disabled":
      {
        return "Disabled";
      }
    default:
      {
        return value;
      }
  }
}

import { withErrorBoundary as _meb_settings } from '../MossenErrorBoundary.js';
export const Config = _meb_settings(ConfigImpl, 'Settings.Config');
