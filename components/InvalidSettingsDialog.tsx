/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Text } from '../ink.js';
import type { ValidationError } from '../utils/settings/validation.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { ValidationErrorsList } from './ValidationErrorsList.js';
type Props = {
  settingsErrors: ValidationError[];
  onContinue: () => void;
  onExit: () => void;
};

/**
 * Dialog shown when settings files have validation errors.
 * User must choose to continue (skipping invalid files) or exit to fix them.
 */
export function InvalidSettingsDialog(t0) {
  const $ = _c(13);
  const {
    settingsErrors,
    onContinue,
    onExit
  } = t0;
  let t1;
  if ($[0] !== onContinue || $[1] !== onExit) {
    t1 = function handleSelect(value) {
      if (value === "exit") {
        onExit();
      } else {
        onContinue();
      }
    };
    $[0] = onContinue;
    $[1] = onExit;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleSelect = t1;
  let t2;
  if ($[3] !== settingsErrors) {
    t2 = <ValidationErrorsList errors={settingsErrors} />;
    $[3] = settingsErrors;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text dimColor={true}>{getLocalizedText({
      en: 'Files with errors are skipped entirely, not just the invalid settings.',
      zh: '包含错误的文件会被整体跳过，而不只是跳过其中无效的设置项。',
    })}</Text>;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = [{
      label: getLocalizedText({ en: 'Exit and fix manually', zh: '退出并手动修复' }),
      value: "exit"
    }, {
      label: getLocalizedText({ en: 'Continue without these settings', zh: '忽略这些设置并继续' }),
      value: "continue"
    }];
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== handleSelect) {
    t5 = <Select options={t4} onChange={handleSelect} />;
    $[7] = handleSelect;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== onExit || $[10] !== t2 || $[11] !== t5) {
    t6 = <Dialog title={getLocalizedText({ en: 'Settings Error', zh: '设置错误' })} onCancel={onExit} color="warning">{t2}{t3}{t5}</Dialog>;
    $[9] = onExit;
    $[10] = t2;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  return t6;
}
