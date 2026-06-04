import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useState } from 'react';
import TextInput from '../../../components/TextInput.js';
import { useExitOnCtrlCDWithKeybindings } from '../../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { Box, Newline, Text } from '../../../ink.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import { WebFetchTool } from '../../../tools/WebFetchTool/WebFetchTool.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
import type { PermissionBehavior, PermissionRuleValue } from '../../../utils/permissions/PermissionRule.js';
import { permissionRuleValueFromString, permissionRuleValueToString } from '../../../utils/permissions/permissionRuleParser.js';
export type PermissionRuleInputProps = {
  onCancel: () => void;
  onSubmit: (ruleValue: PermissionRuleValue, ruleBehavior: PermissionBehavior) => void;
  ruleBehavior: PermissionBehavior;
};
export function PermissionRuleInput(t0) {
  const $ = _c(29);
  const {
    onCancel,
    onSubmit,
    ruleBehavior
  } = t0;
  const [inputValue, setInputValue] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const exitState = useExitOnCtrlCDWithKeybindings();
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      context: "Settings"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:no", onCancel, t1);
  const {
    columns
  } = useTerminalSize();
  const textInputColumns = columns - 6;
  let t2;
  if ($[1] !== onSubmit || $[2] !== ruleBehavior) {
    t2 = value => {
      const trimmedValue = value.trim();
      if (trimmedValue.length === 0) {
        return;
      }
      const ruleValue = permissionRuleValueFromString(trimmedValue);
      onSubmit(ruleValue, ruleBehavior);
    };
    $[1] = onSubmit;
    $[2] = ruleBehavior;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleSubmit = t2;
  const ruleTitle = getLocalizedText({
    en: `Add ${ruleBehavior} permission rule`,
    zh: `添加${ruleBehavior}权限规则`,
  });
  const ruleDescription = getLocalizedText({
    en: 'Permission rules are a tool name, optionally followed by a specifier in parentheses.',
    zh: '权限规则由工具名称组成，也可选择在括号中附带限定条件。',
  });
  const orLabel = getLocalizedText({
    en: ' or ',
    zh: ' 或 ',
  });
  const placeholder = `${getLocalizedText({
    en: 'Enter permission rule',
    zh: '输入权限规则',
  })}${figures.ellipsis}`;
  let t3;
  if ($[4] !== ruleBehavior) {
    t3 = <Text bold={true} color="permission">{ruleTitle}</Text>;
    $[4] = ruleBehavior;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Newline />;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  let t6;
  if ($[7] !== orLabel) {
    t5 = <Text bold={true}>{permissionRuleValueToString({
        toolName: WebFetchTool.name
      })}</Text>;
    t6 = <Text bold={false}>{orLabel}</Text>;
    $[7] = orLabel;
    $[8] = t5;
    $[9] = t6;
  } else {
    t5 = $[8];
    t6 = $[9];
  }
  let t7;
  if ($[10] !== ruleDescription || $[11] !== t5 || $[12] !== t6) {
    t7 = <Text>{ruleDescription}{t4}e.g.,{" "}{t5}{t6}<Text bold={true}>{permissionRuleValueToString({
          toolName: BashTool.name,
          ruleContent: "ls:*"
        })}</Text></Text>;
    $[10] = ruleDescription;
    $[11] = t5;
    $[12] = t6;
    $[13] = t7;
  } else {
    t7 = $[13];
  }
  let t8;
  if ($[14] !== cursorOffset || $[15] !== handleSubmit || $[16] !== inputValue || $[17] !== placeholder || $[18] !== textInputColumns) {
    t8 = <Box flexDirection="column">{t7}<Box borderDimColor={true} borderStyle="round" marginY={1} paddingLeft={1}><TextInput showCursor={true} value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} placeholder={placeholder} columns={textInputColumns} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} /></Box></Box>;
    $[14] = cursorOffset;
    $[15] = handleSubmit;
    $[16] = inputValue;
    $[17] = placeholder;
    $[18] = textInputColumns;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  let t9;
  if ($[20] !== t3 || $[21] !== t8) {
    t9 = <Box flexDirection="column" gap={1} borderStyle="round" paddingLeft={1} paddingRight={1} borderColor="permission">{t3}{t8}</Box>;
    $[20] = t3;
    $[21] = t8;
    $[22] = t9;
  } else {
    t9 = $[22];
  }
  let t10;
  if ($[23] !== exitState.keyName || $[24] !== exitState.pending) {
    t10 = <Box marginLeft={3}>{exitState.pending ? <Text dimColor={true}>{getLocalizedText({
          en: `Press ${exitState.keyName} again to exit`,
          zh: `再按一次 ${exitState.keyName} 退出`,
        })}</Text> : <Text dimColor={true}>{getLocalizedText({
          en: 'Enter to submit · Esc to cancel',
          zh: 'Enter 提交 · Esc 取消',
        })}</Text>}</Box>;
    $[23] = exitState.keyName;
    $[24] = exitState.pending;
    $[25] = t10;
  } else {
    t10 = $[25];
  }
  let t11;
  if ($[26] !== t10 || $[27] !== t9) {
    t11 = <>{t9}{t10}</>;
    $[26] = t10;
    $[27] = t9;
    $[28] = t11;
  } else {
    t11 = $[28];
  }
  return t11;
}
