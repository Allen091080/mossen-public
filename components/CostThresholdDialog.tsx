/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Link, Text } from '../ink.js';
import { getHostedPlatformUrls } from '../utils/customBackend.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  onDone: () => void;
};
export function getCostThresholdDialogTitle(): string {
  return getLocalizedText({
    en: "You've spent $5 with the current backend this session.",
    zh: '你在本次会话中已在当前后端花费 $5。'
  });
}
export function getCostThresholdDocsUrl(): string {
  return getHostedPlatformUrls().usageUrl;
}
export function CostThresholdDialog(t0) {
  const $ = _c(7);
  const {
    onDone
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="column"><Text>{getLocalizedText({
      en: 'Learn more about how to monitor your usage and spending:',
      zh: '了解如何监控你的使用量和花费：'
    })}</Text><Link url={getCostThresholdDocsUrl()} /></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = [{
      value: "ok",
      label: getLocalizedText({
        en: 'Got it, thanks!',
        zh: '知道了，谢谢！'
      })
    }];
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== onDone) {
    t3 = <Select options={t2} onChange={onDone} />;
    $[2] = onDone;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] !== onDone || $[5] !== t3) {
    t4 = <Dialog title={getCostThresholdDialogTitle()} onCancel={onDone}>{t1}{t3}</Dialog>;
    $[4] = onDone;
    $[5] = t3;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  return t4;
}
