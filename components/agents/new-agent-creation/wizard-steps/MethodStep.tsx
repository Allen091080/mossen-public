/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { getLocalizedText } from '../../../../utils/uiLanguage.js';
import type { AgentWizardData } from '../types.js';
export function MethodStep() {
  const $ = _c(11);
  const {
    goNext,
    goBack,
    updateWizardData,
    goToStep
  } = useWizard();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = [{
      label: getLocalizedText({
        en: 'Generate with Mossen (recommended)',
        zh: '使用 Mossen 自动生成（推荐）'
      }),
      value: "generate"
    }, {
      label: getLocalizedText({
        en: 'Manual configuration',
        zh: '手动配置'
      }),
      value: "manual"
    }];
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const methodOptions = t0;
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action={getLocalizedText({
      en: 'navigate',
      zh: '导航'
    })} /><KeyboardShortcutHint shortcut="Enter" action={getLocalizedText({
      en: 'select',
      zh: '选择'
    })} /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
      en: 'go back',
      zh: '返回'
    })} /></Byline>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== goNext || $[3] !== goToStep || $[4] !== updateWizardData) {
    t2 = value => {
      const method = value as 'generate' | 'manual';
      updateWizardData({
        method,
        wasGenerated: method === "generate"
      });
      if (method === "generate") {
        goNext();
      } else {
        goToStep(3);
      }
    };
    $[2] = goNext;
    $[3] = goToStep;
    $[4] = updateWizardData;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== goBack) {
    t3 = () => goBack();
    $[6] = goBack;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  let t4;
  if ($[8] !== t2 || $[9] !== t3) {
    t4 = <WizardDialogLayout subtitle={getLocalizedText({
      en: 'Creation method',
      zh: '创建方式'
    })} footerText={t1}><Box><Select key="method-select" options={methodOptions} onChange={t2} onCancel={t3} /></Box></WizardDialogLayout>;
    $[8] = t2;
    $[9] = t3;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  return t4;
}
