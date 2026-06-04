/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Box, Text } from '../../ink.js';
import type { KeybindingAction } from '../../keybindings/types.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import { useSetAppState } from '../../state/AppState.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { type OptionWithDescription, Select } from '../CustomSelect/select.js';
export type FeedbackType = 'accept' | 'reject';
export type PermissionPromptOption<T extends string> = {
  value: T;
  label: ReactNode;
  feedbackConfig?: {
    type: FeedbackType;
    placeholder?: string;
  };
  keybinding?: KeybindingAction;
};
export type ToolAnalyticsContext = {
  toolName: string;
  isMcp: boolean;
};
export type PermissionPromptProps<T extends string> = {
  options: PermissionPromptOption<T>[];
  onSelect: (value: T, feedback?: string) => void;
  onCancel?: () => void;
  question?: string | ReactNode;
  toolAnalyticsContext?: ToolAnalyticsContext;
};
/**
 * Shared component for permission prompts with optional feedback input.
 *
 * Handles:
 * - Localized "Do you want to proceed?" question with optional Tab hint
 * - Feature flag check for feedback capability
 * - Input mode toggling (Tab to expand feedback input)
 * - Analytics events for feedback interactions
 * - Transforming options to Select-compatible format
 */
export function PermissionPrompt(t0) {
  const $ = _c(54);
  const {
    options,
    onSelect,
    onCancel,
    question: t1,
    toolAnalyticsContext
  } = t0;
  const question = t1 === undefined ? getLocalizedText({
    en: 'Do you want to proceed?',
    zh: '要继续执行吗？'
  }) : t1;
  const setAppState = useSetAppState();
  const [acceptFeedback, setAcceptFeedback] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [acceptInputMode, setAcceptInputMode] = useState(false);
  const [rejectInputMode, setRejectInputMode] = useState(false);
  const [focusedValue, setFocusedValue] = useState(null);
  const [acceptFeedbackModeEntered, setAcceptFeedbackModeEntered] = useState(false);
  const [rejectFeedbackModeEntered, setRejectFeedbackModeEntered] = useState(false);
  let t2;
  if ($[0] !== focusedValue || $[1] !== options) {
    let t3;
    if ($[3] !== focusedValue) {
      t3 = opt => opt.value === focusedValue;
      $[3] = focusedValue;
      $[4] = t3;
    } else {
      t3 = $[4];
    }
    t2 = options.find(t3);
    $[0] = focusedValue;
    $[1] = options;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const focusedOption = t2;
  const focusedFeedbackType = focusedOption?.feedbackConfig?.type;
  const showTabHint = focusedFeedbackType === "accept" && !acceptInputMode || focusedFeedbackType === "reject" && !rejectInputMode;
  let t3;
  if ($[5] !== acceptInputMode || $[6] !== options || $[7] !== rejectInputMode) {
    let t4;
    if ($[9] !== acceptInputMode || $[10] !== rejectInputMode) {
      t4 = opt_0 => {
        const {
          value,
          label,
          feedbackConfig
        } = opt_0;
        if (!feedbackConfig) {
          return {
            label,
            value
          };
        }
        const {
          type,
          placeholder
        } = feedbackConfig;
        const isInputMode = type === "accept" ? acceptInputMode : rejectInputMode;
        const onChange = type === "accept" ? setAcceptFeedback : setRejectFeedback;
        const defaultPlaceholder = type === "accept" ? getLocalizedText({
          en: 'tell Mossen what to do next',
          zh: '告诉 Mossen 接下来怎么做'
        }) : getLocalizedText({
          en: 'tell Mossen what to do differently',
          zh: '告诉 Mossen 需要如何调整'
        });
        if (isInputMode) {
          return {
            type: "input" as const,
            label,
            value,
            placeholder: placeholder ?? defaultPlaceholder,
            onChange,
            allowEmptySubmitToCancel: true
          };
        }
        return {
          label,
          value
        };
      };
      $[9] = acceptInputMode;
      $[10] = rejectInputMode;
      $[11] = t4;
    } else {
      t4 = $[11];
    }
    t3 = options.map(t4);
    $[5] = acceptInputMode;
    $[6] = options;
    $[7] = rejectInputMode;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  const selectOptions = t3;
  let t4;
  if ($[12] !== acceptInputMode || $[13] !== options || $[14] !== rejectInputMode || $[15] !== toolAnalyticsContext?.isMcp || $[16] !== toolAnalyticsContext?.toolName) {
    t4 = value_0 => {
      const option = options.find(opt_1 => opt_1.value === value_0);
      if (!option?.feedbackConfig) {
        return;
      }
      const {
        type: type_0
      } = option.feedbackConfig;
      const analyticsProps = {
        toolName: toolAnalyticsContext?.toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        isMcp: toolAnalyticsContext?.isMcp ?? false
      };
      if (type_0 === "accept") {
        if (acceptInputMode) {
          setAcceptInputMode(false);
          logMossenEvent("mossen.permission.acceptFeedbackModeCollapsed", analyticsProps);
        } else {
          setAcceptInputMode(true);
          setAcceptFeedbackModeEntered(true);
          logMossenEvent("mossen.permission.acceptFeedbackModeEntered", analyticsProps);
        }
      } else {
        if (type_0 === "reject") {
          if (rejectInputMode) {
            setRejectInputMode(false);
            logMossenEvent("mossen.permission.rejectFeedbackModeCollapsed", analyticsProps);
          } else {
            setRejectInputMode(true);
            setRejectFeedbackModeEntered(true);
            logMossenEvent("mossen.permission.rejectFeedbackModeEntered", analyticsProps);
          }
        }
      }
    };
    $[12] = acceptInputMode;
    $[13] = options;
    $[14] = rejectInputMode;
    $[15] = toolAnalyticsContext?.isMcp;
    $[16] = toolAnalyticsContext?.toolName;
    $[17] = t4;
  } else {
    t4 = $[17];
  }
  const handleInputModeToggle = t4;
  let t5;
  if ($[18] !== acceptFeedback || $[19] !== acceptFeedbackModeEntered || $[20] !== onSelect || $[21] !== options || $[22] !== rejectFeedback || $[23] !== rejectFeedbackModeEntered || $[24] !== toolAnalyticsContext?.isMcp || $[25] !== toolAnalyticsContext?.toolName) {
    t5 = value_1 => {
      const option_0 = options.find(opt_2 => opt_2.value === value_1);
      if (!option_0) {
        return;
      }
      let feedback;
      if (option_0.feedbackConfig) {
        const rawFeedback = option_0.feedbackConfig.type === "accept" ? acceptFeedback : rejectFeedback;
        const trimmedFeedback = rawFeedback.trim();
        if (trimmedFeedback) {
          feedback = trimmedFeedback;
        }
        const analyticsProps_0 = {
          toolName: toolAnalyticsContext?.toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          isMcp: toolAnalyticsContext?.isMcp ?? false,
          has_instructions: !!trimmedFeedback,
          instructions_length: trimmedFeedback?.length ?? 0,
          entered_feedback_mode: option_0.feedbackConfig.type === "accept" ? acceptFeedbackModeEntered : rejectFeedbackModeEntered
        };
        if (option_0.feedbackConfig.type === "accept") {
          logMossenEvent("mossen.permission.acceptSubmitted", analyticsProps_0);
        } else {
          if (option_0.feedbackConfig.type === "reject") {
            logMossenEvent("mossen.permission.rejectSubmitted", analyticsProps_0);
          }
        }
      }
      onSelect(value_1, feedback);
    };
    $[18] = acceptFeedback;
    $[19] = acceptFeedbackModeEntered;
    $[20] = onSelect;
    $[21] = options;
    $[22] = rejectFeedback;
    $[23] = rejectFeedbackModeEntered;
    $[24] = toolAnalyticsContext?.isMcp;
    $[25] = toolAnalyticsContext?.toolName;
    $[26] = t5;
  } else {
    t5 = $[26];
  }
  const handleSelect = t5;
  let handlers;
  if ($[27] !== handleSelect || $[28] !== options) {
    handlers = {};
    for (const opt_3 of options) {
      if (opt_3.keybinding) {
        handlers[opt_3.keybinding] = () => handleSelect(opt_3.value);
      }
    }
    $[27] = handleSelect;
    $[28] = options;
    $[29] = handlers;
  } else {
    handlers = $[29];
  }
  const keybindingHandlers = handlers;
  let t6;
  if ($[30] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {
      context: "Confirmation"
    };
    $[30] = t6;
  } else {
    t6 = $[30];
  }
  useKeybindings(keybindingHandlers, t6);
  let t7;
  if ($[31] !== onCancel || $[32] !== setAppState) {
    t7 = () => {
      logMossenEvent("mossen.permission.requestEscape", {});
      setAppState(_temp);
      onCancel?.();
    };
    $[31] = onCancel;
    $[32] = setAppState;
    $[33] = t7;
  } else {
    t7 = $[33];
  }
  const handleCancel = t7;
  let t8;
  if ($[34] !== question) {
    t8 = typeof question === "string" ? <Text>{question}</Text> : question;
    $[34] = question;
    $[35] = t8;
  } else {
    t8 = $[35];
  }
  let t9;
  if ($[36] !== acceptFeedback || $[37] !== acceptInputMode || $[38] !== options || $[39] !== rejectFeedback || $[40] !== rejectInputMode) {
    t9 = value_2 => {
      const newOption = options.find(opt_4 => opt_4.value === value_2);
      if (newOption?.feedbackConfig?.type !== "accept" && acceptInputMode && !acceptFeedback.trim()) {
        setAcceptInputMode(false);
      }
      if (newOption?.feedbackConfig?.type !== "reject" && rejectInputMode && !rejectFeedback.trim()) {
        setRejectInputMode(false);
      }
      setFocusedValue(value_2);
    };
    $[36] = acceptFeedback;
    $[37] = acceptInputMode;
    $[38] = options;
    $[39] = rejectFeedback;
    $[40] = rejectInputMode;
    $[41] = t9;
  } else {
    t9 = $[41];
  }
  let t10;
  if ($[42] !== handleCancel || $[43] !== handleInputModeToggle || $[44] !== handleSelect || $[45] !== selectOptions || $[46] !== t9) {
    t10 = <Select options={selectOptions} inlineDescriptions={true} onChange={handleSelect} onCancel={handleCancel} onFocus={t9} onInputModeToggle={handleInputModeToggle} />;
    $[42] = handleCancel;
    $[43] = handleInputModeToggle;
    $[44] = handleSelect;
    $[45] = selectOptions;
    $[46] = t9;
    $[47] = t10;
  } else {
    t10 = $[47];
  }
  const t11 = showTabHint && ` · ${getLocalizedText({
    en: 'Tab to amend',
    zh: 'Tab 补充说明'
  })}`;
  let t12;
  if ($[48] !== t11) {
    t12 = <Box marginTop={1}><Text dimColor={true}>{getLocalizedText({
      en: 'Esc to cancel',
      zh: 'Esc 取消'
    })}{t11}</Text></Box>;
    $[48] = t11;
    $[49] = t12;
  } else {
    t12 = $[49];
  }
  let t13;
  if ($[50] !== t10 || $[51] !== t12 || $[52] !== t8) {
    t13 = <Box flexDirection="column">{t8}{t10}{t12}</Box>;
    $[50] = t10;
    $[51] = t12;
    $[52] = t8;
    $[53] = t13;
  } else {
    t13 = $[53];
  }
  return t13;
}
function _temp(prev) {
  return {
    ...prev,
    attribution: {
      ...prev.attribution,
      escapeCount: prev.attribution.escapeCount + 1
    }
  };
}
