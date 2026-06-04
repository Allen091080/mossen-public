import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { getProductDisplayName } from '../constants/product.js';
import { Text } from '../ink.js';
import { t } from '../utils/i18n/index.js';
import { getInteractiveLanguageTag } from '../utils/uiLanguage.js';
export function InterruptedByUser() {
  // UX-Wave1 S4B: cache slot 加 langTag deps，让 lang 切换 invalidate cache。
  // 原 sentinel 模式只在首次渲染计算，i18n 切换不会触发重算。
  const $ = _c(2);
  const langTag = getInteractiveLanguageTag();
  let t0;
  if ($[0] !== langTag) {
    t0 = <><Text dimColor={true}>{t('ui.interrupted.label')}</Text>{false ? <Text dimColor={true}>· [Internal] /issue to report a model issue</Text> : <Text dimColor={true}>· {t('ui.interrupted.hint', { product: getProductDisplayName() })}</Text>}</>;
    $[0] = langTag;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  return t0;
}
