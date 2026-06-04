import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { UP_ARROW } from '../../constants/figures.js';
import { Box, Text } from '../../ink.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { isCustomBackendEnabled } from '../../utils/customBackend.js';
import { isOpus1mMergeEnabled } from '../../utils/model/model.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { AnimatedAsterisk } from './AnimatedAsterisk.js';
const MAX_SHOW_COUNT = 6;
export function shouldShowOpus1mMergeNotice(): boolean {
  return !isCustomBackendEnabled() && isOpus1mMergeEnabled() && (getGlobalConfig().opus1mMergeNoticeSeenCount ?? 0) < MAX_SHOW_COUNT;
}
export function Opus1mMergeNotice() {
  const $ = _c(5);
  const [show] = useState(shouldShowOpus1mMergeNotice);
  let t0;
  let t1;
  if ($[0] !== show) {
    t0 = () => {
      if (!show) {
        return;
      }
      const newCount = (getGlobalConfig().opus1mMergeNoticeSeenCount ?? 0) + 1;
      saveGlobalConfig(prev => {
        if ((prev.opus1mMergeNoticeSeenCount ?? 0) >= newCount) {
          return prev;
        }
        return {
          ...prev,
          opus1mMergeNoticeSeenCount: newCount
        };
      });
    };
    t1 = [show];
    $[0] = show;
    $[1] = t0;
    $[2] = t1;
  } else {
    t0 = $[1];
    t1 = $[2];
  }
  useEffect(t0, t1);
  if (!show) {
    return null;
  }
  const notice = getLocalizedText({
    en: 'Expanded 1M context is available on supported models.',
    zh: '支持的模型现已提供扩展的 1M 上下文。',
  });
  let t2;
  if ($[3] !== notice) {
    t2 = <Box paddingLeft={2}><AnimatedAsterisk char={UP_ARROW} /><Text dimColor={true}>{" "}{notice}</Text></Box>;
    $[3] = notice;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  return t2;
}
