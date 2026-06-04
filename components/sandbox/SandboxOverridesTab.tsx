/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, color, Link, Text, useTheme } from '../../ink.js';
import type { CommandResultDisplay } from '../../types/command.js';
import {
  getHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { Select } from '../CustomSelect/select.js';
import { useTabHeaderFocus } from '../design-system/Tabs.js';
type Props = {
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type OverrideMode = 'open' | 'closed';
export function getSandboxOverrideDocsUrl(): string {
  return `${getHostedPlatformUrls().remoteBaseUrl}/docs/sandboxing#configure-sandboxing`;
}
export function getUnsandboxedFallbackCopy(): string {
  return getLocalizedText({
    en: 'When a command fails due to sandbox restrictions, Mossen can retry with dangerouslyDisableSandbox to run outside the sandbox (falling back to default permissions).',
    zh: '当命令因沙箱限制失败时，Mossen 可以使用 dangerouslyDisableSandbox 在沙箱外重试运行（回退到默认权限）。',
  });
}
export function SandboxOverridesTab(t0) {
  const $ = _c(5);
  const {
    onComplete
  } = t0;
  const isEnabled = SandboxManager.isSandboxingEnabled();
  const isLocked = SandboxManager.areSandboxSettingsLockedByPolicy();
  const currentAllowUnsandboxed = SandboxManager.areUnsandboxedCommandsAllowed();
  if (!isEnabled) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Box flexDirection="column" paddingY={1}><Text color="subtle">{getLocalizedText({
        en: 'Sandbox is not enabled. Enable sandbox to configure override settings.',
        zh: '沙箱尚未启用。请先启用沙箱，再配置覆盖设置。',
      })}</Text></Box>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  if (isLocked) {
    let t1;
    if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text color="subtle">{getLocalizedText({
        en: 'Override settings are managed by a higher-priority configuration and cannot be changed locally.',
        zh: '覆盖设置由更高优先级的配置统一管理，无法在本地修改。',
      })}</Text>;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    let t2;
    if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Box flexDirection="column" paddingY={1}>{t1}<Box marginTop={1}><Text dimColor={true}>{getLocalizedText({
        en: 'Current setting:',
        zh: '当前设置：',
      })}{" "}{currentAllowUnsandboxed ? getLocalizedText({
        en: 'Allow unsandboxed fallback',
        zh: '允许非沙箱回退',
      }) : getLocalizedText({
        en: 'Strict sandbox mode',
        zh: '严格沙箱模式',
      })}</Text></Box></Box>;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    return t2;
  }
  let t1;
  if ($[3] !== onComplete) {
    t1 = <OverridesSelect onComplete={onComplete} currentMode={currentAllowUnsandboxed ? "open" : "closed"} />;
    $[3] = onComplete;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  return t1;
}

// Split so useTabHeaderFocus() only runs when the Select renders. Calling it
// above the early returns registers a down-arrow opt-in even when we return
// static text — pressing ↓ then blurs the header with no way back.
function OverridesSelect(t0) {
  const $ = _c(25);
  const {
    onComplete,
    currentMode
  } = t0;
  const [theme] = useTheme();
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
  let t1;
  if ($[0] !== theme) {
    t1 = color("success", theme)("(current)");
    $[0] = theme;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const currentIndicator = t1;
  const t2 = currentMode === "open" ? `${getLocalizedText({
    en: 'Allow unsandboxed fallback',
    zh: '允许非沙箱回退',
  })} ${currentIndicator}` : getLocalizedText({
    en: 'Allow unsandboxed fallback',
    zh: '允许非沙箱回退',
  });
  let t3;
  if ($[2] !== t2) {
    t3 = {
      label: t2,
      value: "open"
    };
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const t4 = currentMode === "closed" ? `${getLocalizedText({
    en: 'Strict sandbox mode',
    zh: '严格沙箱模式',
  })} ${currentIndicator}` : getLocalizedText({
    en: 'Strict sandbox mode',
    zh: '严格沙箱模式',
  });
  let t5;
  if ($[4] !== t4) {
    t5 = {
      label: t4,
      value: "closed"
    };
    $[4] = t4;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] !== t3 || $[7] !== t5) {
    t6 = [t3, t5];
    $[6] = t3;
    $[7] = t5;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  const options = t6;
  let t7;
  if ($[9] !== onComplete) {
    t7 = async function handleSelect(value) {
      const mode = value as OverrideMode;
      await SandboxManager.setSandboxSettings({
        allowUnsandboxedCommands: mode === "open"
      });
      const message = mode === "open" ? getLocalizedText({
        en: '✓ Unsandboxed fallback allowed - commands can run outside sandbox when necessary',
        zh: '✓ 已允许非沙箱回退：必要时命令可在沙箱外运行',
      }) : getLocalizedText({
        en: '✓ Strict sandbox mode - all commands must run in sandbox or be excluded via the `excludedCommands` option',
        zh: '✓ 严格沙箱模式：所有命令都必须在沙箱中运行，或通过 `excludedCommands` 选项显式排除',
      });
      onComplete(message);
    };
    $[9] = onComplete;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  const handleSelect = t7;
  let t8;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box marginBottom={1}><Text bold={true}>{getLocalizedText({
      en: 'Configure Overrides:',
      zh: '配置覆盖：',
    })}</Text></Box>;
    $[11] = t8;
  } else {
    t8 = $[11];
  }
  let t9;
  if ($[12] !== onComplete) {
    t9 = () => onComplete(undefined, {
      display: "skip"
    });
    $[12] = onComplete;
    $[13] = t9;
  } else {
    t9 = $[13];
  }
  let t10;
  if ($[14] !== focusHeader || $[15] !== handleSelect || $[16] !== headerFocused || $[17] !== options || $[18] !== t9) {
    t10 = <Select options={options} onChange={handleSelect} onCancel={t9} onUpFromFirstItem={focusHeader} isDisabled={headerFocused} />;
    $[14] = focusHeader;
    $[15] = handleSelect;
    $[16] = headerFocused;
    $[17] = options;
    $[18] = t9;
    $[19] = t10;
  } else {
    t10 = $[19];
  }
  let t11;
  if ($[20] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text dimColor={true}><Text bold={true} dimColor={true}>{getLocalizedText({
      en: 'Allow unsandboxed fallback:',
      zh: '允许非沙箱回退：',
    })}</Text>{" "}{getUnsandboxedFallbackCopy()}</Text>;
    $[20] = t11;
  } else {
    t11 = $[20];
  }
  let t12;
  if ($[21] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = <Text dimColor={true}><Text bold={true} dimColor={true}>{getLocalizedText({
      en: 'Strict sandbox mode:',
      zh: '严格沙箱模式：',
    })}</Text>{" "}{getLocalizedText({
      en: 'All bash commands invoked by the model must run in the sandbox unless they are explicitly listed in excludedCommands.',
      zh: '模型调用的所有 Bash 命令都必须在沙箱中运行，除非它们已在 excludedCommands 中被显式列出。',
    })}</Text>;
    $[21] = t12;
  } else {
    t12 = $[21];
  }
  let t13;
  if ($[22] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Box flexDirection="column" marginTop={1} gap={1}>{t11}{t12}<Text dimColor={true}>{getLocalizedText({
      en: 'Learn more:',
      zh: '了解更多：',
    })}{" "}<Link url={getSandboxOverrideDocsUrl()}>{getSandboxOverrideDocsUrl()}</Link></Text></Box>;
    $[22] = t13;
  } else {
    t13 = $[22];
  }
  let t14;
  if ($[23] !== t10) {
    t14 = <Box flexDirection="column" paddingY={1}>{t8}{t10}{t13}</Box>;
    $[23] = t10;
    $[24] = t14;
  } else {
    t14 = $[24];
  }
  return t14;
}
