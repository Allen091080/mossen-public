/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode, useCallback, useState } from 'react';
import { Box, Text } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import { editPromptInEditor } from '../../../../utils/promptEditor.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import TextInput from '../../../TextInput.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { getLocalizedText } from '../../../../utils/uiLanguage.js';
import type { AgentWizardData } from '../types.js';
export function PromptStep() {
  const $ = _c(20);
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
  const [systemPrompt, setSystemPrompt] = useState(wizardData.systemPrompt || "");
  const [cursorOffset, setCursorOffset] = useState(systemPrompt.length);
  const [error, setError] = useState(null);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
      context: "Settings"
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  useKeybinding("confirm:no", goBack, t0);
  let t1;
  if ($[1] !== systemPrompt) {
    t1 = async () => {
      const result = await editPromptInEditor(systemPrompt);
      if (result.content !== null) {
        setSystemPrompt(result.content);
        setCursorOffset(result.content.length);
      }
    };
    $[1] = systemPrompt;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const handleExternalEditor = t1;
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      context: "Chat"
    };
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  useKeybinding("chat:externalEditor", handleExternalEditor, t2);
  let t3;
  if ($[4] !== goNext || $[5] !== systemPrompt || $[6] !== updateWizardData) {
    t3 = () => {
      const trimmedPrompt = systemPrompt.trim();
      if (!trimmedPrompt) {
        setError(getLocalizedText({
          en: 'System prompt is required',
          zh: '系统提示词不能为空'
        }));
        return;
      }
      setError(null);
      updateWizardData({
        systemPrompt: trimmedPrompt
      });
      goNext();
    };
    $[4] = goNext;
    $[5] = systemPrompt;
    $[6] = updateWizardData;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const handleSubmit = t3;
  let t4;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Byline><KeyboardShortcutHint shortcut={getLocalizedText({
      en: 'Type',
      zh: '输入'
    })} action={getLocalizedText({
      en: 'enter text',
      zh: '输入文本'
    })} /><KeyboardShortcutHint shortcut="Enter" action={getLocalizedText({
      en: 'continue',
      zh: '继续'
    })} /><ConfigurableShortcutHint action="chat:externalEditor" context="Chat" fallback="ctrl+x ctrl+e" description={getLocalizedText({
      en: 'open in editor',
      zh: '在编辑器中打开'
    })} /><ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description={getLocalizedText({
      en: 'go back',
      zh: '返回'
    })} /></Byline>;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text>{getLocalizedText({
      en: 'Enter the system prompt for your agent:',
      zh: '请输入这个 agent 的系统提示词：'
    })}</Text>;
    t6 = <Text dimColor={true}>{getLocalizedText({
      en: 'Be comprehensive for best results',
      zh: '内容尽量完整，生成和执行效果会更好'
    })}</Text>;
    $[9] = t5;
    $[10] = t6;
  } else {
    t5 = $[9];
    t6 = $[10];
  }
  let t7;
  if ($[11] !== cursorOffset || $[12] !== handleSubmit || $[13] !== systemPrompt) {
    t7 = <Box marginTop={1}><TextInput value={systemPrompt} onChange={setSystemPrompt} onSubmit={handleSubmit} placeholder={getLocalizedText({
      en: 'You are a helpful code reviewer who...',
      zh: '你是一个擅长代码审查和风险识别的工程 agent，会...'
    })} columns={80} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} focus={true} showCursor={true} /></Box>;
    $[11] = cursorOffset;
    $[12] = handleSubmit;
    $[13] = systemPrompt;
    $[14] = t7;
  } else {
    t7 = $[14];
  }
  let t8;
  if ($[15] !== error) {
    t8 = error && <Box marginTop={1}><Text color="error">{error}</Text></Box>;
    $[15] = error;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  let t9;
  if ($[17] !== t7 || $[18] !== t8) {
    t9 = <WizardDialogLayout subtitle={getLocalizedText({
      en: 'System prompt',
      zh: '系统提示词'
    })} footerText={t4}><Box flexDirection="column">{t5}{t6}{t7}{t8}</Box></WizardDialogLayout>;
    $[17] = t7;
    $[18] = t8;
    $[19] = t9;
  } else {
    t9 = $[19];
  }
  return t9;
}
