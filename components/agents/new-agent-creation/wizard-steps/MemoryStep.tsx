/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { Box } from '../../../../ink.js';
import { useKeybinding } from '../../../../keybindings/useKeybinding.js';
import { isAutoMemoryEnabled } from '../../../../memdir/paths.js';
import { type AgentMemoryScope, loadAgentMemoryPrompt } from '../../../../tools/AgentTool/agentMemory.js';
import { ConfigurableShortcutHint } from '../../../ConfigurableShortcutHint.js';
import { Select } from '../../../CustomSelect/select.js';
import { Byline } from '../../../design-system/Byline.js';
import { KeyboardShortcutHint } from '../../../design-system/KeyboardShortcutHint.js';
import { useWizard } from '../../../wizard/index.js';
import { WizardDialogLayout } from '../../../wizard/WizardDialogLayout.js';
import { getLocalizedText } from '../../../../utils/uiLanguage.js';
import type { AgentWizardData } from '../types.js';
type MemoryOption = {
  label: string;
  value: AgentMemoryScope | 'none';
};
export function MemoryStep() {
  const $ = _c(13);
  const {
    goNext,
    goBack,
    updateWizardData,
    wizardData
  } = useWizard();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = {
      context: "Confirmation"
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  useKeybinding("confirm:no", goBack, t0);
  const isUserScope = wizardData.location === "userSettings";
  let t1;
  if ($[1] !== isUserScope) {
    t1 = isUserScope ? [{
      label: getLocalizedText({
        en: 'User scope (~/.mossen/agent-memory/) (Recommended)',
        zh: '用户级作用域（~/.mossen/agent-memory/）（推荐）'
      }),
      value: "user"
    }, {
      label: getLocalizedText({
        en: 'None (no persistent memory)',
        zh: '无（不保留持久记忆）'
      }),
      value: "none"
    }, {
      label: getLocalizedText({
        en: 'Project scope (.mossen/agent-memory/)',
        zh: '项目级作用域（.mossen/agent-memory/）'
      }),
      value: "project"
    }, {
      label: getLocalizedText({
        en: 'Local scope (.mossen/agent-memory-local/)',
        zh: '本地作用域（.mossen/agent-memory-local/）'
      }),
      value: "local"
    }] : [{
      label: getLocalizedText({
        en: 'Project scope (.mossen/agent-memory/) (Recommended)',
        zh: '项目级作用域（.mossen/agent-memory/）（推荐）'
      }),
      value: "project"
    }, {
      label: getLocalizedText({
        en: 'None (no persistent memory)',
        zh: '无（不保留持久记忆）'
      }),
      value: "none"
    }, {
      label: getLocalizedText({
        en: 'User scope (~/.mossen/agent-memory/)',
        zh: '用户级作用域（~/.mossen/agent-memory/）'
      }),
      value: "user"
    }, {
      label: getLocalizedText({
        en: 'Local scope (.mossen/agent-memory-local/)',
        zh: '本地作用域（.mossen/agent-memory-local/）'
      }),
      value: "local"
    }];
    $[1] = isUserScope;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const memoryOptions = t1;
  let t2;
  if ($[3] !== goNext || $[4] !== updateWizardData || $[5] !== wizardData.finalAgent || $[6] !== wizardData.systemPrompt) {
    t2 = value => {
      const memory = value === "none" ? undefined : value as AgentMemoryScope;
      const agentType = wizardData.finalAgent?.agentType;
      updateWizardData({
        selectedMemory: memory,
        finalAgent: wizardData.finalAgent ? {
          ...wizardData.finalAgent,
          memory,
          getSystemPrompt: isAutoMemoryEnabled() && memory && agentType ? () => wizardData.systemPrompt + "\n\n" + loadAgentMemoryPrompt(agentType, memory) : () => wizardData.systemPrompt
        } : undefined
      });
      goNext();
    };
    $[3] = goNext;
    $[4] = updateWizardData;
    $[5] = wizardData.finalAgent;
    $[6] = wizardData.systemPrompt;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  const handleSelect = t2;
  let t3;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Byline><KeyboardShortcutHint shortcut={"\u2191\u2193"} action={getLocalizedText({
      en: 'navigate',
      zh: '导航'
    })} /><KeyboardShortcutHint shortcut="Enter" action={getLocalizedText({
      en: 'select',
      zh: '选择'
    })} /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
      en: 'go back',
      zh: '返回上一步'
    })} /></Byline>;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  let t4;
  if ($[9] !== goBack || $[10] !== handleSelect || $[11] !== memoryOptions) {
    t4 = <WizardDialogLayout subtitle={getLocalizedText({
      en: 'Configure agent memory',
      zh: '配置 agent 记忆'
    })} footerText={t3}><Box><Select key="memory-select" options={memoryOptions} onChange={handleSelect} onCancel={goBack} /></Box></WizardDialogLayout>;
    $[9] = goBack;
    $[10] = handleSelect;
    $[11] = memoryOptions;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  return t4;
}
