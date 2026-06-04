/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Text } from '../../../ink.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import type { PermissionRuleValue } from '../../../utils/permissions/PermissionRule.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
type RuleSubtitleProps = {
  ruleValue: PermissionRuleValue;
};
export function PermissionRuleDescription(t0) {
  const $ = _c(9);
  const {
    ruleValue
  } = t0;
  switch (ruleValue.toolName) {
    case BashTool.name:
      {
        if (ruleValue.ruleContent) {
          if (ruleValue.ruleContent.endsWith(":*")) {
            let t1;
            if ($[0] !== ruleValue.ruleContent) {
              t1 = ruleValue.ruleContent.slice(0, -2);
              $[0] = ruleValue.ruleContent;
              $[1] = t1;
            } else {
              t1 = $[1];
            }
            let t2;
            if ($[2] !== t1) {
              t2 = <Text dimColor={true}>{getLocalizedText({
                en: 'Any Bash command starting with ',
                zh: '任意以 ',
              })}<Text bold={true}>{t1}</Text>{getLocalizedText({
                en: '',
                zh: ' 开头的 Bash 命令',
              })}</Text>;
              $[2] = t1;
              $[3] = t2;
            } else {
              t2 = $[3];
            }
            return t2;
          } else {
            let t1;
            if ($[4] !== ruleValue.ruleContent) {
              t1 = <Text dimColor={true}>{getLocalizedText({
                en: 'The Bash command ',
                zh: 'Bash 命令 ',
              })}<Text bold={true}>{ruleValue.ruleContent}</Text></Text>;
              $[4] = ruleValue.ruleContent;
              $[5] = t1;
            } else {
              t1 = $[5];
            }
            return t1;
          }
        } else {
          let t1;
          if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
            t1 = <Text dimColor={true}>{getLocalizedText({
              en: 'Any Bash command',
              zh: '任意 Bash 命令',
            })}</Text>;
            $[6] = t1;
          } else {
            t1 = $[6];
          }
          return t1;
        }
      }
    default:
      {
        if (!ruleValue.ruleContent) {
          let t1;
          if ($[7] !== ruleValue.toolName) {
            t1 = <Text dimColor={true}>{getLocalizedText({
              en: 'Any use of the ',
              zh: '任意使用 ',
            })}<Text bold={true}>{ruleValue.toolName}</Text>{getLocalizedText({
              en: ' tool',
              zh: ' 工具',
            })}</Text>;
            $[7] = ruleValue.toolName;
            $[8] = t1;
          } else {
            t1 = $[8];
          }
          return t1;
        } else {
          return null;
        }
      }
  }
}
