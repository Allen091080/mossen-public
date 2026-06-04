/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
type Props = {
  instructions?: string;
};
export function AgentNavigationFooter(t0) {
  const $ = _c(2);
  const {
    instructions: t1
  } = t0;
  const instructions = t1 === undefined ? getLocalizedText({
    en: 'Press ↑↓ to navigate · Enter to select · Esc to go back',
    zh: '按 ↑↓ 导航 · Enter 选择 · Esc 返回上一步'
  }) : t1;
  const exitState = useExitOnCtrlCDWithKeybindings();
  const t2 = exitState.pending ? getLocalizedText({
    en: `Press ${exitState.keyName} again to exit`,
    zh: `再次按 ${exitState.keyName} 退出`
  }) : instructions;
  let t3;
  if ($[0] !== t2) {
    t3 = <Box marginLeft={2}><Text dimColor={true}>{t2}</Text></Box>;
    $[0] = t2;
    $[1] = t3;
  } else {
    t3 = $[1];
  }
  return t3;
}
