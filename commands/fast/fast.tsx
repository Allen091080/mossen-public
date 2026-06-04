/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { FastIcon, getFastIconString } from '../../components/FastIcon.js';
import { Box, Link, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js';
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import { type AppState, useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { clearFastModeCooldown, FAST_MODE_MODEL_DISPLAY, getFastModeModel, getFastModeRuntimeState, getFastModeUnavailableReason, isFastModeEnabled, isFastModeSupportedByModel, prefetchFastModeStatus } from '../../utils/fastMode.js';
import { formatDuration } from '../../utils/format.js';
import { formatModelPricing, getOpus46CostTier } from '../../utils/modelCost.js';
import {
  getHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
export function getFastModeDocsUrl(): string {
  return `${getHostedPlatformUrls().remoteBaseUrl}/docs/fast-mode`;
}
function applyFastMode(enable: boolean, setAppState: (f: (prev: AppState) => AppState) => void): void {
  clearFastModeCooldown();
  updateSettingsForSource('userSettings', {
    fastMode: enable ? true : undefined
  });
  if (enable) {
    setAppState(prev => {
      // Only switch model if current model doesn't support fast mode
      const needsModelSwitch = !isFastModeSupportedByModel(prev.mainLoopModel);
      return {
        ...prev,
        ...(needsModelSwitch ? {
          mainLoopModel: getFastModeModel(),
          mainLoopModelForSession: null
        } : {}),
        fastMode: true
      };
    });
  } else {
    setAppState(prev => ({
      ...prev,
      fastMode: false
    }));
  }
}
export function FastModePicker(t0) {
  const $ = _c(30);
  const {
    onDone,
    unavailableReason
  } = t0;
  const model = useAppState(_temp);
  const initialFastMode = useAppState(_temp2);
  const setAppState = useSetAppState();
  const [enableFastMode, setEnableFastMode] = useState(initialFastMode ?? false);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getFastModeRuntimeState();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const runtimeState = t1;
  const isCooldown = runtimeState.status === "cooldown";
  const isUnavailable = unavailableReason !== null;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = formatModelPricing(getOpus46CostTier(true));
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const pricing = t2;
  let t3;
  if ($[2] !== enableFastMode || $[3] !== isUnavailable || $[4] !== model || $[5] !== onDone || $[6] !== setAppState) {
    t3 = function handleConfirm() {
      if (isUnavailable) {
        return;
      }
      applyFastMode(enableFastMode, setAppState);
      logMossenEvent("mossen.model.fastModeToggled", {
        enabled: enableFastMode,
        source: "picker" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      if (enableFastMode) {
        const fastIcon = getFastIconString(enableFastMode);
        const modelUpdated = !isFastModeSupportedByModel(model) ? getLocalizedText({
          en: ` · model set to ${FAST_MODE_MODEL_DISPLAY}`,
          zh: ` · 模型已切换为 ${FAST_MODE_MODEL_DISPLAY}`
        }) : "";
        onDone(getLocalizedText({
          en: `${fastIcon} Fast mode ON${modelUpdated} · ${pricing}`,
          zh: `${fastIcon} 高速模式已开启${modelUpdated} · ${pricing}`
        }));
      } else {
        setAppState(_temp3);
        onDone(getLocalizedText({
          en: 'Fast mode OFF',
          zh: '高速模式已关闭'
        }));
      }
    };
    $[2] = enableFastMode;
    $[3] = isUnavailable;
    $[4] = model;
    $[5] = onDone;
    $[6] = setAppState;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const handleConfirm = t3;
  let t4;
  if ($[8] !== initialFastMode || $[9] !== isUnavailable || $[10] !== onDone || $[11] !== setAppState) {
    t4 = function handleCancel() {
      if (isUnavailable) {
        if (initialFastMode) {
          applyFastMode(false, setAppState);
        }
        onDone(getLocalizedText({
          en: 'Fast mode OFF',
          zh: '高速模式已关闭'
        }), {
          display: "system"
        });
        return;
      }
      const message = initialFastMode ? getLocalizedText({
        en: `${getFastIconString()} Kept Fast mode ON`,
        zh: `${getFastIconString()} 保持高速模式开启`
      }) : getLocalizedText({
        en: 'Kept Fast mode OFF',
        zh: '保持高速模式关闭'
      });
      onDone(message, {
        display: "system"
      });
    };
    $[8] = initialFastMode;
    $[9] = isUnavailable;
    $[10] = onDone;
    $[11] = setAppState;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  const handleCancel = t4;
  let t5;
  if ($[13] !== isUnavailable) {
    t5 = function handleToggle() {
      if (isUnavailable) {
        return;
      }
      setEnableFastMode(_temp4);
    };
    $[13] = isUnavailable;
    $[14] = t5;
  } else {
    t5 = $[14];
  }
  const handleToggle = t5;
  let t6;
  if ($[15] !== handleConfirm || $[16] !== handleToggle) {
    t6 = {
      "confirm:yes": handleConfirm,
      "confirm:nextField": handleToggle,
      "confirm:next": handleToggle,
      "confirm:previous": handleToggle,
      "confirm:cycleMode": handleToggle,
      "confirm:toggle": handleToggle
    };
    $[15] = handleConfirm;
    $[16] = handleToggle;
    $[17] = t6;
  } else {
    t6 = $[17];
  }
  let t7;
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = {
      context: "Confirmation"
    };
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  useKeybindings(t6, t7);
  let t8;
  if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text><FastIcon cooldown={isCooldown} /> {getLocalizedText({
      en: 'Fast mode (research preview)',
      zh: '高速模式（研究预览）'
    })}</Text>;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  const title = t8;
  let t9;
  if ($[20] !== isUnavailable) {
    t9 = exitState => exitState.pending ? <Text>{getLocalizedText({
      en: `Press ${exitState.keyName} again to exit`,
      zh: `再按一次 ${exitState.keyName} 即可退出`
    })}</Text> : isUnavailable ? <Text>{getLocalizedText({
      en: 'Esc to cancel',
      zh: '按 Esc 取消'
    })}</Text> : <Text>{getLocalizedText({
      en: 'Tab to toggle · Enter to confirm · Esc to cancel',
      zh: '按 Tab 切换 · Enter 确认 · Esc 取消'
    })}</Text>;
    $[20] = isUnavailable;
    $[21] = t9;
  } else {
    t9 = $[21];
  }
  let t10;
  if ($[22] !== enableFastMode || $[23] !== unavailableReason) {
    t10 = unavailableReason ? <Box marginLeft={2}><Text color="error">{unavailableReason}</Text></Box> : <><Box flexDirection="column" gap={0} marginLeft={2}><Box flexDirection="row" gap={2}><Text bold={true}>{getLocalizedText({
      en: 'Fast mode',
      zh: '高速模式'
    })}</Text><Text color={enableFastMode ? "fastMode" : undefined} bold={enableFastMode}>{enableFastMode ? getLocalizedText({
      en: 'ON ',
      zh: '开启'
    }) : getLocalizedText({
      en: 'OFF',
      zh: '关闭'
    })}</Text><Text dimColor={true}>{pricing}</Text></Box></Box>{isCooldown && runtimeState.status === "cooldown" && <Box marginLeft={2}><Text color="warning">{runtimeState.reason === "overloaded" ? getLocalizedText({
      en: 'Fast mode overloaded and is temporarily unavailable',
      zh: '高速模式负载过高，暂时不可用'
    }) : getLocalizedText({
      en: "You've hit your fast limit",
      zh: '你已达到高速模式限额'
    })}{" "}{getLocalizedText({
      en: '· resets in ',
      zh: '· 将在 '
    })}{formatDuration(runtimeState.resetAt - Date.now(), {
            hideTrailingZeros: true
          })}</Text></Box>}</>;
    $[22] = enableFastMode;
    $[23] = unavailableReason;
    $[24] = t10;
  } else {
    t10 = $[24];
  }
  let t11;
  if ($[25] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text dimColor={true}>{getLocalizedText({
      en: 'Learn more:',
      zh: '了解更多：'
    })}{" "}<Link url={getFastModeDocsUrl()}>{getFastModeDocsUrl()}</Link></Text>;
    $[25] = t11;
  } else {
    t11 = $[25];
  }
  let t12;
  if ($[26] !== handleCancel || $[27] !== t10 || $[28] !== t9) {
    t12 = <Dialog title={title} subtitle={getLocalizedText({
      en: `High-speed mode for ${FAST_MODE_MODEL_DISPLAY}. Billed as extra usage at a premium rate. Separate rate limits apply.`,
      zh: `${FAST_MODE_MODEL_DISPLAY} 的高速模式。会按更高费率计为额外用量，并采用独立速率限制。`
    })} onCancel={handleCancel} color="fastMode" inputGuide={t9}>{t10}{t11}</Dialog>;
    $[26] = handleCancel;
    $[27] = t10;
    $[28] = t9;
    $[29] = t12;
  } else {
    t12 = $[29];
  }
  return t12;
}
function _temp4(prev_0) {
  return !prev_0;
}
function _temp3(prev) {
  return {
    ...prev,
    fastMode: false
  };
}
function _temp2(s_0) {
  return s_0.fastMode;
}
function _temp(s) {
  return s.mainLoopModel;
}
async function handleFastModeShortcut(enable: boolean, getAppState: () => AppState, setAppState: (f: (prev: AppState) => AppState) => void): Promise<string> {
  const unavailableReason = getFastModeUnavailableReason();
  if (unavailableReason) {
    return getLocalizedText({
      en: `Fast mode unavailable: ${unavailableReason}`,
      zh: `高速模式不可用：${unavailableReason}`
    });
  }
  const {
    mainLoopModel
  } = getAppState();
  applyFastMode(enable, setAppState);
  logMossenEvent('mossen.model.fastModeToggled', {
    enabled: enable,
    source: 'shortcut' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  if (enable) {
    const fastIcon = getFastIconString(true);
    const modelUpdated = !isFastModeSupportedByModel(mainLoopModel) ? getLocalizedText({
      en: ` · model set to ${FAST_MODE_MODEL_DISPLAY}`,
      zh: ` · 模型已切换为 ${FAST_MODE_MODEL_DISPLAY}`
    }) : '';
    const pricing = formatModelPricing(getOpus46CostTier(true));
    return getLocalizedText({
      en: `${fastIcon} Fast mode ON${modelUpdated} · ${pricing}`,
      zh: `${fastIcon} 高速模式已开启${modelUpdated} · ${pricing}`
    });
  } else {
    return getLocalizedText({
      en: 'Fast mode OFF',
      zh: '高速模式已关闭'
    });
  }
}
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args?: string): Promise<React.ReactNode | null> {
  if (!isFastModeEnabled()) {
    return null;
  }

  // Fetch org fast mode status before showing the picker. We must know
  // whether the org has disabled fast mode before allowing any toggle.
  // If a startup prefetch is already in flight, this awaits it.
  await prefetchFastModeStatus();
  const arg = args?.trim().toLowerCase();
  if (arg === 'on' || arg === 'off') {
    const result = await handleFastModeShortcut(arg === 'on', context.getAppState, context.setAppState);
    onDone(result);
    return null;
  }
  const unavailableReason = getFastModeUnavailableReason();
  logMossenEvent('mossen.model.fastModePickerShown', {
    unavailable_reason: (unavailableReason ?? '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  return <FastModePicker onDone={onDone} unavailableReason={unavailableReason} />;
}
