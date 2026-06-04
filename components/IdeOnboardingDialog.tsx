/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { envDynamic } from 'src/utils/envDynamic.js';
import { Box, Text } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { env } from '../utils/env.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { getTerminalIdeType, type IDEExtensionInstallationStatus, isJetBrainsIde, toIDEDisplayName } from '../utils/ide.js';
import { Dialog } from './design-system/Dialog.js';
import { getProductDisplayName } from '../constants/product.js';
interface Props {
  onDone: () => void;
  installationStatus: IDEExtensionInstallationStatus | null;
}
export function IdeOnboardingDialog(t0) {
  const $ = _c(23);
  const {
    onDone,
    installationStatus
  } = t0;
  markDialogAsShown();
  let t1;
  if ($[0] !== onDone) {
    t1 = {
      "confirm:yes": onDone,
      "confirm:no": onDone
    };
    $[0] = onDone;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      context: "Confirmation"
    };
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  useKeybindings(t1, t2);
  let t3;
  if ($[3] !== installationStatus?.ideType) {
    t3 = installationStatus?.ideType ?? getTerminalIdeType();
    $[3] = installationStatus?.ideType;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const ideType = t3;
  const isJetBrains = isJetBrainsIde(ideType);
  let t4;
  if ($[5] !== ideType) {
    t4 = toIDEDisplayName(ideType);
    $[5] = ideType;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  const ideName = t4;
  const installedVersion = installationStatus?.installedVersion;
  const pluginOrExtension = isJetBrains ? getLocalizedText({
    en: 'plugin',
    zh: '插件'
  }) : getLocalizedText({
    en: 'extension',
    zh: '扩展'
  });
  const mentionShortcut = env.platform === "darwin" ? "Cmd+Option+K" : "Ctrl+Alt+K";
  const productName = getProductDisplayName();
  let t5;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text color="mossen">✻ </Text>;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  const t6 = <>{t5}<Text>{getLocalizedText({
    en: `Welcome to ${productName} for ${ideName}`,
    zh: `欢迎使用适用于 ${ideName} 的 ${productName}`
  })}</Text></>;
  const t7 = installedVersion ? getLocalizedText({
    en: `installed ${pluginOrExtension} v${installedVersion}`,
    zh: `已安装${pluginOrExtension} v${installedVersion}`
  }) : undefined;
  let t8;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text color="suggestion">{getLocalizedText({
      en: '⧉ open files',
      zh: '⧉ 打开的文件'
    })}</Text>;
    $[10] = t8;
  } else {
    t8 = $[10];
  }
  let t9;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = <Text>• {getLocalizedText({
      en: 'The assistant has context of',
      zh: '助手可直接获取'
    })} {t8}{" "}{getLocalizedText({
      en: 'and',
      zh: '以及'
    })} <Text color="suggestion">{getLocalizedText({
      en: '⧉ selected lines',
      zh: '⧉ 已选中的代码行'
    })}</Text></Text>;
    $[11] = t9;
  } else {
    t9 = $[11];
  }
  let t10;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Text color="diffAddedWord">+11</Text>;
    $[12] = t10;
  } else {
    t10 = $[12];
  }
  let t11;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text>• {getLocalizedText({
      en: "Review the assistant's changes",
      zh: '可直接在你的 IDE 中审阅助手改动'
    })}{" "}{t10}{" "}<Text color="diffRemovedWord">-22</Text>{getLocalizedText({
      en: ' in the comfort of your IDE',
      zh: ''
    })}</Text>;
    $[13] = t11;
  } else {
    t11 = $[13];
  }
  let t12;
  if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = <Text>• Cmd+Esc<Text dimColor={true}>{getLocalizedText({
      en: ' for Quick Launch',
      zh: ' 打开快捷启动'
    })}</Text></Text>;
    $[14] = t12;
  } else {
    t12 = $[14];
  }
  let t13;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Box flexDirection="column" gap={1}>{t9}{t11}{t12}<Text>• {mentionShortcut}<Text dimColor={true}>{getLocalizedText({
      en: ' to reference files or lines in your input',
      zh: ' 可在输入里引用文件或代码行'
    })}</Text></Text></Box>;
    $[15] = t13;
  } else {
    t13 = $[15];
  }
  let t14;
  if ($[16] !== onDone || $[17] !== t6 || $[18] !== t7) {
    t14 = <Dialog title={t6} subtitle={t7} color="ide" onCancel={onDone} hideInputGuide={true}>{t13}</Dialog>;
    $[16] = onDone;
    $[17] = t6;
    $[18] = t7;
    $[19] = t14;
  } else {
    t14 = $[19];
  }
  let t15;
  if ($[20] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Box paddingX={1}><Text dimColor={true} italic={true}>{getLocalizedText({
      en: 'Press Enter to continue',
      zh: '按 Enter 继续'
    })}</Text></Box>;
    $[20] = t15;
  } else {
    t15 = $[20];
  }
  let t16;
  if ($[21] !== t14) {
    t16 = <>{t14}{t15}</>;
    $[21] = t14;
    $[22] = t16;
  } else {
    t16 = $[22];
  }
  return t16;
}
export function hasIdeOnboardingDialogBeenShown(): boolean {
  const config = getGlobalConfig();
  const terminal = envDynamic.terminal || 'unknown';
  return config.hasIdeOnboardingBeenShown?.[terminal] === true;
}
function markDialogAsShown(): void {
  if (hasIdeOnboardingDialogBeenShown()) {
    return;
  }
  const terminal = envDynamic.terminal || 'unknown';
  saveGlobalConfig(current => ({
    ...current,
    hasIdeOnboardingBeenShown: {
      ...current.hasIdeOnboardingBeenShown,
      [terminal]: true
    }
  }));
}
