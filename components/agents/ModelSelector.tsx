/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { getAgentModelOptions } from '../../utils/model/agent.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { Select } from '../CustomSelect/select.js';
interface ModelSelectorProps {
  initialModel?: string;
  onComplete: (model?: string) => void;
  onCancel?: () => void;
}
export function ModelSelector(t0) {
  const $ = _c(11);
  const {
    initialModel,
    onComplete,
    onCancel
  } = t0;
  let t1;
  if ($[0] !== initialModel) {
    bb0: {
      const base = getAgentModelOptions();
      if (initialModel && !base.some(o => o.value === initialModel)) {
        t1 = [{
          value: initialModel,
          label: initialModel,
          description: getLocalizedText({
            en: 'Current model (custom ID)',
            zh: '当前模型（自定义 ID）'
          })
        }, ...base];
        break bb0;
      }
      t1 = base;
    }
    $[0] = initialModel;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const modelOptions = t1;
  const defaultModel = initialModel ?? "sonnet";
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box marginBottom={1}><Text dimColor={true}>{getLocalizedText({
      en: "Model determines the agent's reasoning capabilities and speed.",
      zh: '模型会决定这个 agent 的推理能力和响应速度。'
    })}</Text></Box>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== onCancel || $[4] !== onComplete) {
    t3 = () => onCancel ? onCancel() : onComplete(undefined);
    $[3] = onCancel;
    $[4] = onComplete;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== defaultModel || $[7] !== modelOptions || $[8] !== onComplete || $[9] !== t3) {
    t4 = <Box flexDirection="column">{t2}<Select options={modelOptions} defaultValue={defaultModel} onChange={onComplete} onCancel={t3} /></Box>;
    $[6] = defaultModel;
    $[7] = modelOptions;
    $[8] = onComplete;
    $[9] = t3;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  return t4;
}
