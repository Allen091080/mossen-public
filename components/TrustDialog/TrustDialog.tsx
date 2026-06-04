/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import { homedir } from 'os';
import React from 'react';
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js';
import { setSessionTrustAccepted } from '../../bootstrap/state.js';
import type { Command } from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Link, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getMcpConfigsByScope } from '../../services/mcp/config.js';
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js';
import { checkHasTrustDialogAccepted, saveCurrentProjectConfig } from '../../utils/config.js';
import { getCwd } from '../../utils/cwd.js';
import { getHostedPlatformUrls } from '../../utils/customBackend.js';
import { getFsImplementation } from '../../utils/fsOperations.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { getProductAssistantName } from '../../constants/product.js';
import { Select } from '../CustomSelect/index.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import { getApiKeyHelperSources, getAwsCommandsSources, getBashPermissionSources, getCustomHeadersHelperSources, getDangerousEnvVarsSources, getGcpCommandsSources, getHooksSources } from './utils.js';
type Props = {
  onDone(): void;
  commands?: Command[];
};
export function TrustDialog(t0) {
  const $ = _c(33);
  const { securityDocsUrl } = getHostedPlatformUrls();
  const {
    onDone,
    commands
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getMcpConfigsByScope("project");
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const {
    servers: projectServers
  } = t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = Object.keys(projectServers);
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const hasMcpServers = t2.length > 0;
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = getHooksSources();
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  const hooksSettingSources = t3;
  const hasHooks = hooksSettingSources.length > 0;
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = getBashPermissionSources();
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const bashSettingSources = t4;
  let t5;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = getApiKeyHelperSources();
    $[4] = t5;
  } else {
    t5 = $[4];
  }
  const apiKeyHelperSources = t5;
  const hasApiKeyHelper = apiKeyHelperSources.length > 0;
  let t6;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = getAwsCommandsSources();
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  const awsCommandsSources = t6;
  const hasAwsCommands = awsCommandsSources.length > 0;
  let t7;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = getGcpCommandsSources();
    $[6] = t7;
  } else {
    t7 = $[6];
  }
  const gcpCommandsSources = t7;
  const hasGcpCommands = gcpCommandsSources.length > 0;
  let t8;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = getCustomHeadersHelperSources();
    $[7] = t8;
  } else {
    t8 = $[7];
  }
  const customHeadersHelperSources = t8;
  const hasCustomHeadersHelper = customHeadersHelperSources.length > 0;
  let t9;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = getDangerousEnvVarsSources();
    $[8] = t9;
  } else {
    t9 = $[8];
  }
  const dangerousEnvVarsSources = t9;
  const hasDangerousEnvVars = dangerousEnvVarsSources.length > 0;
  let t10;
  if ($[9] !== commands) {
    t10 = commands?.some(_temp2) ?? false;
    $[9] = commands;
    $[10] = t10;
  } else {
    t10 = $[10];
  }
  const hasSlashCommandBash = t10;
  let t11;
  if ($[11] !== commands) {
    t11 = commands?.some(_temp4) ?? false;
    $[11] = commands;
    $[12] = t11;
  } else {
    t11 = $[12];
  }
  const hasSkillsBash = t11;
  const hasAnyBashExecution = bashSettingSources.length > 0 || hasSlashCommandBash || hasSkillsBash;
  const hasTrustDialogAccepted = checkHasTrustDialogAccepted();
  let t12;
  let t13;
  if ($[13] !== hasAnyBashExecution) {
    t12 = () => {
      const isHomeDir = homedir() === getCwd();
      logMossenEvent("mossen.trustDialog.shown", {
        isHomeDir,
        hasMcpServers,
        hasHooks,
        hasBashExecution: hasAnyBashExecution,
        hasApiKeyHelper,
        hasAwsCommands,
        hasGcpCommands,
        // Analytics field name kept as `hasOtelHeadersHelper` to avoid breaking
        // 1P consumer schema; internally tracks customHeadersHelper.
        hasOtelHeadersHelper: hasCustomHeadersHelper,
        hasDangerousEnvVars
      });
    };
    t13 = [hasMcpServers, hasHooks, hasAnyBashExecution, hasApiKeyHelper, hasAwsCommands, hasGcpCommands, hasCustomHeadersHelper, hasDangerousEnvVars];
    $[13] = hasAnyBashExecution;
    $[14] = t12;
    $[15] = t13;
  } else {
    t12 = $[14];
    t13 = $[15];
  }
  React.useEffect(t12, t13);
  let t14;
  if ($[16] !== hasAnyBashExecution || $[17] !== onDone) {
    t14 = function onChange(value) {
      if (value === "exit") {
        gracefulShutdownSync(1);
        return;
      }
      const isHomeDir_0 = homedir() === getCwd();
      logMossenEvent("mossen.trustDialog.accept", {
        isHomeDir: isHomeDir_0,
        hasMcpServers,
        hasHooks,
        hasBashExecution: hasAnyBashExecution,
        hasApiKeyHelper,
        hasAwsCommands,
        hasGcpCommands,
        // See comment above on the shown event.
        hasOtelHeadersHelper: hasCustomHeadersHelper,
        hasDangerousEnvVars
      });
      if (isHomeDir_0) {
        setSessionTrustAccepted(true);
      } else {
        saveCurrentProjectConfig(_temp5);
      }
      onDone();
    };
    $[16] = hasAnyBashExecution;
    $[17] = onDone;
    $[18] = t14;
  } else {
    t14 = $[18];
  }
  const onChange = t14;
  const exitState = useExitOnCtrlCDWithKeybindings(_temp6);
  let t15;
  if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = {
      context: "Confirmation"
    };
    $[19] = t15;
  } else {
    t15 = $[19];
  }
  useKeybinding("confirm:no", _temp7, t15);
  if (hasTrustDialogAccepted) {
    setTimeout(onDone);
    return null;
  }
  const workspacePath = <Text bold={true}>{getFsImplementation().cwd()}</Text>;
  const quickSafetyCheck = <Text>{getLocalizedText({
    en: "Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.",
    zh: "快速安全检查：这是你创建的项目，或是你信任的项目吗？（比如你自己的代码、知名开源项目，或团队提供的工作内容。）如果不是，请先花一点时间看看这个文件夹里有什么。"
  })}</Text>;
  const workspaceCapabilities = <Text>{getLocalizedText({
    en: `${getProductAssistantName()} will be able to read, edit, and execute files here.`,
    zh: `${getProductAssistantName()} 将能够在这里读取、编辑并执行文件。`
  })}</Text>;
  const securityGuide = <Text dimColor={true}><Link url={securityDocsUrl}>{getLocalizedText({
    en: "Security guide",
    zh: "安全指南"
  })}</Link></Text>;
  const options = [{
    label: getLocalizedText({
      en: "Yes, I trust this folder",
      zh: "是，我信任这个文件夹"
    }),
    value: "enable_all"
  }, {
    label: getLocalizedText({
      en: "No, exit",
      zh: "否，退出"
    }),
    value: "exit"
  }];
  const select = <Select options={options} onChange={value_0 => onChange(value_0 as 'enable_all' | 'exit')} onCancel={() => onChange("exit")} />;
  const footer = <Text dimColor={true}>{exitState.pending ? <>{getLocalizedText({
    en: `Press ${exitState.keyName} again to exit`,
    zh: `再按 ${exitState.keyName} 退出`
  })}</> : <>{getLocalizedText({
    en: "Enter to confirm · Esc to cancel",
    zh: "Enter 确认 · Esc 取消"
  })}</>}</Text>;
  return <PermissionDialog color="warning" titleColor="warning" title={getLocalizedText({
    en: "Accessing workspace:",
    zh: "正在访问工作区："
  })}><Box flexDirection="column" gap={1} paddingTop={1}>{workspacePath}{quickSafetyCheck}{workspaceCapabilities}{securityGuide}{select}{footer}</Box></PermissionDialog>;
}
function _temp7() {
  gracefulShutdownSync(0);
}
function _temp6() {
  return gracefulShutdownSync(1);
}
function _temp5(current) {
  return {
    ...current,
    hasTrustDialogAccepted: true
  };
}
function _temp4(command_0) {
  return command_0.type === "prompt" && (command_0.loadedFrom === "skills" || command_0.loadedFrom === "plugin") && (command_0.source === "projectSettings" || command_0.source === "localSettings" || command_0.source === "plugin") && command_0.allowedTools?.some(_temp3);
}
function _temp3(tool_0) {
  return tool_0 === BASH_TOOL_NAME || tool_0.startsWith(BASH_TOOL_NAME + "(");
}
function _temp2(command) {
  return command.type === "prompt" && command.loadedFrom === "commands_DEPRECATED" && (command.source === "projectSettings" || command.source === "localSettings") && command.allowedTools?.some(_temp);
}
function _temp(tool) {
  return tool === BASH_TOOL_NAME || tool.startsWith(BASH_TOOL_NAME + "(");
}
