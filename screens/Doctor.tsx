/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import { join } from 'path';
import React, { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
import { KeybindingWarnings } from 'src/components/KeybindingWarnings.js';
import { McpParsingWarnings } from 'src/components/mcp/McpParsingWarnings.js';
import { getModelMaxOutputTokens } from 'src/utils/context.js';
import { getMossenConfigHomeDir } from 'src/utils/envUtils.js';
import type { SettingSource } from 'src/utils/settings/constants.js';
import { getProductDisplayName } from '../constants/product.js';
import { getOriginalCwd } from '../bootstrap/state.js';
import type { CommandResultDisplay } from '../commands.js';
import { Pane } from '../components/design-system/Pane.js';
import { PressEnterToContinue } from '../components/PressEnterToContinue.js';
import { SandboxDoctorSection } from '../components/sandbox/SandboxDoctorSection.js';
import { ValidationErrorsList } from '../components/ValidationErrorsList.js';
import { useSettingsErrors } from '../hooks/notifs/useSettingsErrors.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState } from '../state/AppState.js';
import { getPluginErrorMessage } from '../types/plugin.js';
import { getGcsDistTags, getNpmDistTags, type NpmDistTags } from '../utils/autoUpdater.js';
import { type ContextWarnings, checkContextWarnings } from '../utils/doctorContextWarnings.js';
import { type DiagnosticInfo, getDoctorDiagnostic } from '../utils/doctorDiagnostic.js';
import { validateBoundedIntEnvVar } from '../utils/envValidation.js';
import { pathExists } from '../utils/file.js';
import { getDefaultMainLoopModel } from '../utils/model/model.js';
import { cleanupStaleLocks, getAllLockInfo, isPidBasedLockingEnabled, type LockInfo } from '../utils/nativeInstaller/pidLock.js';
import { getInitialSettings } from '../utils/settings/settings.js';
import { BASH_MAX_OUTPUT_DEFAULT, BASH_MAX_OUTPUT_UPPER_LIMIT } from '../utils/shell/outputLimits.js';
import { TASK_MAX_OUTPUT_DEFAULT, TASK_MAX_OUTPUT_UPPER_LIMIT } from '../utils/task/outputFormatting.js';
import { describePackageManagerAutoUpdateMode } from '../utils/terminalEnvControls.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { getXDGStateHome } from '../utils/xdg.js';
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type AgentInfo = {
  activeAgents: Array<{
    agentType: string;
    source: SettingSource | 'built-in' | 'plugin';
  }>;
  userAgentsDir: string;
  projectAgentsDir: string;
  userDirExists: boolean;
  projectDirExists: boolean;
  failedFiles?: Array<{
    path: string;
    error: string;
  }>;
};
type VersionLockInfo = {
  enabled: boolean;
  locks: LockInfo[];
  locksDir: string;
  staleLocksCleaned: number;
};
function DistTagsDisplay(t0) {
  const $ = _c(8);
  const {
    promise
  } = t0;
  const distTags = use(promise);
  if (!distTags.latest) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text dimColor={true}>└ {getLocalizedText({
        en: 'Failed to fetch versions',
        zh: '获取版本信息失败'
      })}</Text>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  let t1;
  if ($[1] !== distTags.stable) {
    t1 = distTags.stable && <Text>└ {getLocalizedText({
      en: 'Stable version',
      zh: '稳定版本'
    })}: {distTags.stable}</Text>;
    $[1] = distTags.stable;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  let t2;
  if ($[3] !== distTags.latest) {
    t2 = <Text>└ {getLocalizedText({
      en: 'Latest version',
      zh: '最新版本'
    })}: {distTags.latest}</Text>;
    $[3] = distTags.latest;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== t1 || $[6] !== t2) {
    t3 = <>{t1}{t2}</>;
    $[5] = t1;
    $[6] = t2;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  return t3;
}
export function Doctor(t0) {
  const $ = _c(84);
  const {
    onDone
  } = t0;
  const agentDefinitions = useAppState(_temp);
  const mcpTools = useAppState(_temp2);
  const toolPermissionContext = useAppState(_temp3);
  const pluginsErrors = useAppState(_temp4);
  const mcpClients = useAppState(s => s.mcp.clients);
  const pluginState = useAppState(s => s.plugins);
  const remoteConnectionStatus = useAppState(s => s.remoteConnectionStatus);
  const remoteSessionUrl = useAppState(s => s.remoteSessionUrl);
  const companionReaction = useAppState(s => s.companionReaction);
  useExitOnCtrlCDWithKeybindings();
  let t1;
  if ($[0] !== mcpTools) {
    t1 = mcpTools || [];
    $[0] = mcpTools;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const tools = t1;
  const [diagnostic, setDiagnostic] = useState(null);
  const [agentInfo, setAgentInfo] = useState(null);
  const [contextWarnings, setContextWarnings] = useState(null);
  const [versionLockInfo, setVersionLockInfo] = useState(null);
  const validationErrors = useSettingsErrors();
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getDoctorDiagnostic().then(_temp6);
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const distTagsPromise = t2;
  const autoUpdatesChannel = getInitialSettings()?.autoUpdatesChannel ?? "latest";
  let t3;
  if ($[3] !== validationErrors) {
    t3 = validationErrors.filter(_temp7);
    $[3] = validationErrors;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const errorsExcludingMcp = t3;
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    const envVars = [{
      name: "BASH_MAX_OUTPUT_LENGTH",
      default: BASH_MAX_OUTPUT_DEFAULT,
      upperLimit: BASH_MAX_OUTPUT_UPPER_LIMIT
    }, {
      name: "TASK_MAX_OUTPUT_LENGTH",
      default: TASK_MAX_OUTPUT_DEFAULT,
      upperLimit: TASK_MAX_OUTPUT_UPPER_LIMIT
    }, {
      name: "MOSSEN_CODE_MAX_OUTPUT_TOKENS",
      ...getModelMaxOutputTokens(getDefaultMainLoopModel())
    }];
    t4 = envVars.map(_temp8).filter(_temp9);
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const envValidationErrors = t4;
  let t5;
  let t6;
  if ($[6] !== agentDefinitions || $[7] !== toolPermissionContext || $[8] !== tools) {
    t5 = () => {
      getDoctorDiagnostic().then(setDiagnostic);
      (async () => {
        const userAgentsDir = join(getMossenConfigHomeDir(), "agents");
        const projectAgentsDir = join(getOriginalCwd(), ".mossen", "agents");
        const {
          activeAgents,
          allAgents,
          failedFiles
        } = agentDefinitions;
        const [userDirExists, projectDirExists] = await Promise.all([pathExists(userAgentsDir), pathExists(projectAgentsDir)]);
        const agentInfoData = {
          activeAgents: activeAgents.map(_temp0),
          userAgentsDir,
          projectAgentsDir,
          userDirExists,
          projectDirExists,
          failedFiles
        };
        setAgentInfo(agentInfoData);
        const warnings = await checkContextWarnings(tools, {
          activeAgents,
          allAgents,
          failedFiles
        }, async () => toolPermissionContext);
        setContextWarnings(warnings);
        if (isPidBasedLockingEnabled()) {
          const locksDir = join(getXDGStateHome(), "mossen", "locks");
          const staleLocksCleaned = cleanupStaleLocks(locksDir);
          const locks = getAllLockInfo(locksDir);
          setVersionLockInfo({
            enabled: true,
            locks,
            locksDir,
            staleLocksCleaned
          });
        } else {
          setVersionLockInfo({
            enabled: false,
            locks: [],
            locksDir: "",
            staleLocksCleaned: 0
          });
        }
      })();
    };
    t6 = [toolPermissionContext, tools, agentDefinitions];
    $[6] = agentDefinitions;
    $[7] = toolPermissionContext;
    $[8] = tools;
    $[9] = t5;
    $[10] = t6;
  } else {
    t5 = $[9];
    t6 = $[10];
  }
  useEffect(t5, t6);
  let t7;
  if ($[11] !== onDone) {
    t7 = () => {
      onDone(`${getProductDisplayName()} diagnostics dismissed`, {
        display: "system"
      });
    };
    $[11] = onDone;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  const handleDismiss = t7;
  let t8;
  if ($[13] !== handleDismiss) {
    t8 = {
      "confirm:yes": handleDismiss,
      "confirm:no": handleDismiss
    };
    $[13] = handleDismiss;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  let t9;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = {
      context: "Confirmation"
    };
    $[15] = t9;
  } else {
    t9 = $[15];
  }
  useKeybindings(t8, t9);
  if (!diagnostic) {
    let t10;
    if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
      t10 = <Pane><Text dimColor={true}>{getLocalizedText({
        en: 'Checking installation status…',
        zh: '正在检查安装状态…'
      })}</Text></Pane>;
      $[16] = t10;
    } else {
      t10 = $[16];
    }
    return t10;
  }
  const platformRuntime = diagnostic.platformRuntime;
  const mcpByState = {
    connected: mcpClients.filter(client => client.type === "connected").length,
    pending: mcpClients.filter(client => client.type === "pending").length,
    needsAuth: mcpClients.filter(client => client.type === "needs-auth").length,
    failed: mcpClients.filter(client => client.type === "failed").length,
    disabled: mcpClients.filter(client => client.type === "disabled").length
  };
  const platformCoreSection = <Box flexDirection="column">
    <Text bold={true}>{getLocalizedText({
      en: 'Platform Core',
      zh: '平台核心'
    })}</Text>
    <Text>└ Provider: {platformRuntime.provider.name}{platformRuntime.provider.protocol ? ` (${platformRuntime.provider.protocol})` : ""}</Text>
    {platformRuntime.provider.baseUrl && <Text>└ Backend URL: {platformRuntime.provider.baseUrl}</Text>}
    {platformRuntime.provider.model && <Text>└ Model: {platformRuntime.provider.model}</Text>}
    <Text>└ Direct connect: feature {platformRuntime.directConnect.featureEnabled ? "on" : "off"}, server {platformRuntime.directConnect.serverRuntimeAvailable ? "ready" : platformRuntime.directConnect.recoverableFromLocalCache ? "blocked" : "snapshot-missing"}, open {platformRuntime.directConnect.openRuntimeAvailable ? "ready" : platformRuntime.directConnect.recoverableFromLocalCache ? "blocked" : "snapshot-missing"}</Text>
    {platformRuntime.directConnect.statusReason ? <Text>  Direct-connect note: {platformRuntime.directConnect.statusReason}</Text> : null}
    <Text>└ SSH remote: feature {platformRuntime.sshRemote.featureEnabled ? "on" : "off"}, local-test {platformRuntime.sshRemote.localTestAvailable ? "ready" : platformRuntime.sshRemote.recoverableFromLocalCache ? "blocked" : "snapshot-missing"}, remote-session {platformRuntime.sshRemote.remoteSessionAvailable ? "ready" : platformRuntime.sshRemote.recoverableFromLocalCache ? "blocked" : "snapshot-missing"}</Text>
    {platformRuntime.sshRemote.statusReason ? <Text>  SSH note: {platformRuntime.sshRemote.statusReason}</Text> : null}
    <Text>└ Local git: git {platformRuntime.localGit.gitInstalled ? "ready" : "missing"}, gh {platformRuntime.localGit.ghInstalled ? platformRuntime.localGit.ghAuthenticated ? "authed" : "installed" : "missing"}, commit-push-pr {platformRuntime.localGit.commitPushPrCommandExposed ? "yes" : "no"}, local PR {platformRuntime.localGit.localPrReady ? "ready" : "gated"}</Text>
    {platformRuntime.localGit.statusReason ? <Text>  Local git note: {platformRuntime.localGit.statusReason}</Text> : null}
    <Text>└ System prompt: {platformRuntime.systemPrompt.defaultAssembly.length} layer(s), effective items {platformRuntime.systemPrompt.effectiveAssembly?.itemCount ?? 0}</Text>
    <Text>└ Memory: {platformRuntime.memory.enabled ? "enabled" : "disabled"}{platformRuntime.memory.promptLoaded ? ", prompt loaded" : ", prompt missing"}</Text>
    <Text>└ Compression: {platformRuntime.compression.available ? "available" : "disabled"} (budget {platformRuntime.compression.postCompactTokenBudget})</Text>
    <Text>└ Skills: bundled {platformRuntime.skills.bundledRegistered}, dynamic {platformRuntime.skills.dynamicDiscovered}, conditional {platformRuntime.skills.conditionalPending}</Text>
    <Text>└ Security: default {platformRuntime.security.defaultPermissionMode ?? "not set"}, sandbox {platformRuntime.security.sandboxEnabled ? "on" : "off"}, trust {platformRuntime.security.sessionTrustAccepted ? "accepted" : "pending"}, hard-deny {platformRuntime.security.hardDenyRuleCount} ({platformRuntime.security.hardDenySettingsMode})</Text>
    <Text>└ Plugins: enabled {platformRuntime.plugins.enabled}, disabled {platformRuntime.plugins.disabled}, errors {platformRuntime.plugins.errors}</Text>
    <Text>└ MCP: enterprise {platformRuntime.mcp.enterpriseServers}, user {platformRuntime.mcp.userServers}, project {platformRuntime.mcp.projectServers}, local {platformRuntime.mcp.localServers}, errors {platformRuntime.mcp.totalErrors}</Text>
    <Text>└ Remote: policy {platformRuntime.remote.policyAllowed ? "allowed" : "blocked"}, bridge {platformRuntime.remote.bridgeAvailable ? "ready" : platformRuntime.remote.policyAllowed ? "gated" : "off"}, remote-env {platformRuntime.remote.runningInRemoteSession ? "yes" : "no"}, teleported {platformRuntime.remote.teleportedSession ? "yes" : "no"}</Text>
    {platformRuntime.remote.disabledReason ? <Text>└ Remote note: {platformRuntime.remote.disabledReason}</Text> : null}
    <Text>└ Assistant: feature {platformRuntime.assistant.featureEnabled ? "on" : "off"}, discovery {platformRuntime.assistant.discoveryAvailable ? "ready" : "failed"}, discovered sessions {platformRuntime.assistant.discoveredSessions}, attach {platformRuntime.assistant.attachAvailable ? "ready" : "gated"}</Text>
    {platformRuntime.assistant.statusReason ? <Text>  Assistant note: {platformRuntime.assistant.statusReason}</Text> : null}
    <Text>└ Chrome: override {platformRuntime.chrome.cliOverride === null ? "none" : platformRuntime.chrome.cliOverride ? "enabled" : "disabled"}, extension {platformRuntime.chrome.extensionInstalled ? "yes" : "no"}, host {platformRuntime.chrome.nativeHostInstalled ? "yes" : "no"} ({platformRuntime.chrome.nativeHostManifestCount} manifest{platformRuntime.chrome.nativeHostManifestCount === 1 ? "" : "s"}), auto-enable {platformRuntime.chrome.autoEnable ? "yes" : "no"}</Text>
    {platformRuntime.chrome.statusReason && <Text>  Chrome note: {platformRuntime.chrome.statusReason}</Text>}
    <Text>└ Voice: visible {platformRuntime.voice.visible ? "yes" : "no"}, auth {platformRuntime.voice.authAvailable ? "yes" : "no"}, stream {platformRuntime.voice.streamAvailable ? "yes" : "no"}, recording {platformRuntime.voice.recordingAvailable ? "yes" : "no"}, user-setting {platformRuntime.voice.userEnabled ? "on" : "off"}</Text>
    {platformRuntime.voice.recordingReason && <Text>  Voice note: {platformRuntime.voice.recordingReason}</Text>}
    <Text>└ Team memory: build {platformRuntime.teamMemory.buildEnabled ? "on" : "off"}, enabled {platformRuntime.teamMemory.enabled ? "yes" : "no"}, auto-memory {platformRuntime.teamMemory.autoMemoryEnabled ? "yes" : "no"}, rollout {platformRuntime.teamMemory.rolloutEnabled ? "yes" : "no"}, sync {platformRuntime.teamMemory.syncAvailable ? "yes" : "no"}</Text>
    {platformRuntime.teamMemory.statusReason && <Text>  Team memory note: {platformRuntime.teamMemory.statusReason}</Text>}
    <Text>└ Agents: active {platformRuntime.agents.active}, total {platformRuntime.agents.total}, parse errors {platformRuntime.agents.parseErrors}, entrypoint {platformRuntime.agents.entrypoint ?? "unset"}, guide {platformRuntime.agents.includesCodeGuide ? "yes" : "no"}</Text>
    <Text>└ Sessions: project sessions {platformRuntime.sessions.projectSessions}, transcript {platformRuntime.sessions.currentTranscriptPath}</Text>
    <Text>└ Swarm: teammate {platformRuntime.swarm.teammate ? "yes" : "no"}, team {platformRuntime.swarm.teamName ?? "none"}, agent {platformRuntime.swarm.agentName ?? "none"}, created teams {platformRuntime.swarm.sessionCreatedTeams}</Text>
    <Text>└ Domains: {platformRuntime.manifest.map(entry => `${entry.id}:${entry.status}`).join(", ")}</Text>
  </Box>;
  const platformLiveSection = <Box flexDirection="column">
    <Text bold={true}>{getLocalizedText({
      en: 'Platform Live State',
      zh: '平台实时状态'
    })}</Text>
    <Text>└ MCP clients: connected {mcpByState.connected}, pending {mcpByState.pending}, needs-auth {mcpByState.needsAuth}, failed {mcpByState.failed}, disabled {mcpByState.disabled}</Text>
    <Text>└ Plugins: enabled {pluginState.enabled.length}, disabled {pluginState.disabled.length}, errors {pluginState.errors.length}, needs refresh {pluginState.needsRefresh ? "yes" : "no"}</Text>
    <Text>└ Plugin installs: marketplaces {pluginState.installationStatus.marketplaces.length}, plugins {pluginState.installationStatus.plugins.length}</Text>
    <Text>└ Remote session: {remoteConnectionStatus}{remoteSessionUrl ? ` @ ${remoteSessionUrl}` : ""}</Text>
    <Text>└ Companion: {companionReaction ?? "idle"}</Text>
  </Box>;
  let t10;
  if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
    t10 = <Text bold={true}>{getLocalizedText({
      en: 'Diagnostics',
      zh: '诊断信息'
    })}</Text>;
    $[17] = t10;
  } else {
    t10 = $[17];
  }
  let t11;
  if ($[18] !== diagnostic.installationType || $[19] !== diagnostic.version) {
    t11 = <Text>└ {getLocalizedText({
      en: 'Currently running',
      zh: '当前运行'
    })}: {diagnostic.installationType} ({diagnostic.version})</Text>;
    $[18] = diagnostic.installationType;
    $[19] = diagnostic.version;
    $[20] = t11;
  } else {
    t11 = $[20];
  }
  let t12;
  if ($[21] !== diagnostic.packageManager) {
    t12 = diagnostic.packageManager && <Text>└ {getLocalizedText({
      en: 'Package manager',
      zh: '包管理器'
    })}: {diagnostic.packageManager}</Text>;
    $[21] = diagnostic.packageManager;
    $[22] = t12;
  } else {
    t12 = $[22];
  }
  let t13;
  if ($[23] !== diagnostic.installationPath) {
    t13 = <Text>└ Path: {diagnostic.installationPath}</Text>;
    $[23] = diagnostic.installationPath;
    $[24] = t13;
  } else {
    t13 = $[24];
  }
  let t14;
  if ($[25] !== diagnostic.invokedBinary) {
    t14 = <Text>└ Invoked: {diagnostic.invokedBinary}</Text>;
    $[25] = diagnostic.invokedBinary;
    $[26] = t14;
  } else {
    t14 = $[26];
  }
  let t15;
  if ($[27] !== diagnostic.configInstallMethod) {
    t15 = <Text>└ {getLocalizedText({
      en: 'Config install method',
      zh: '配置安装方式'
    })}: {diagnostic.configInstallMethod}</Text>;
    $[27] = diagnostic.configInstallMethod;
    $[28] = t15;
  } else {
    t15 = $[28];
  }
  const t16 = diagnostic.ripgrepStatus.working ? getLocalizedText({
    en: 'OK',
    zh: '正常'
  }) : getLocalizedText({
    en: 'Not working',
    zh: '不可用'
  });
  const t17 = diagnostic.ripgrepStatus.mode === "js-fallback" ? getLocalizedText({
    en: 'JavaScript fallback',
    zh: 'JavaScript 兜底'
  }) : diagnostic.ripgrepStatus.mode === "embedded" ? getLocalizedText({
    en: 'bundled',
    zh: '内置打包'
  }) : diagnostic.ripgrepStatus.mode === "builtin" ? getLocalizedText({
    en: 'vendor',
    zh: '内建'
  }) : diagnostic.ripgrepStatus.systemPath || getLocalizedText({
    en: 'system',
    zh: '系统'
  });
  let t18;
  if ($[29] !== t16 || $[30] !== t17) {
    t18 = <Text>└ {getLocalizedText({
      en: 'Search',
      zh: '搜索'
    })}: {t16} ({t17})</Text>;
    $[29] = t16;
    $[30] = t17;
    $[31] = t18;
  } else {
    t18 = $[31];
  }
  let t19;
  if ($[32] !== diagnostic.recommendation) {
    t19 = diagnostic.recommendation && <><Text /><Text color="warning">{getLocalizedText({
      en: 'Recommendation',
      zh: '建议'
    })}: {diagnostic.recommendation.split("\n")[0]}</Text><Text dimColor={true}>{diagnostic.recommendation.split("\n")[1]}</Text></>;
    $[32] = diagnostic.recommendation;
    $[33] = t19;
  } else {
    t19 = $[33];
  }
  let t20;
  if ($[34] !== diagnostic.multipleInstallations) {
    t20 = diagnostic.multipleInstallations.length > 1 && <><Text /><Text color="warning">{getLocalizedText({
      en: 'Warning: Multiple installations found',
      zh: '警告：发现多个安装版本'
    })}</Text>{diagnostic.multipleInstallations.map(_temp1)}</>;
    $[34] = diagnostic.multipleInstallations;
    $[35] = t20;
  } else {
    t20 = $[35];
  }
  let t21;
  if ($[36] !== diagnostic.warnings) {
    t21 = diagnostic.warnings.length > 0 && <><Text />{diagnostic.warnings.map(_temp10)}</>;
    $[36] = diagnostic.warnings;
    $[37] = t21;
  } else {
    t21 = $[37];
  }
  let t22;
  if ($[38] !== errorsExcludingMcp) {
    t22 = errorsExcludingMcp.length > 0 && <Box flexDirection="column" marginTop={1} marginBottom={1}><Text bold={true}>{getLocalizedText({
      en: 'Invalid Settings',
      zh: '无效设置'
    })}</Text><ValidationErrorsList errors={errorsExcludingMcp} /></Box>;
    $[38] = errorsExcludingMcp;
    $[39] = t22;
  } else {
    t22 = $[39];
  }
  let t23;
  if ($[40] !== t11 || $[41] !== t12 || $[42] !== t13 || $[43] !== t14 || $[44] !== t15 || $[45] !== t18 || $[46] !== t19 || $[47] !== t20 || $[48] !== t21 || $[49] !== t22) {
    t23 = <Box flexDirection="column">{t10}{t11}{t12}{t13}{t14}{t15}{t18}{t19}{t20}{t21}{t22}</Box>;
    $[40] = t11;
    $[41] = t12;
    $[42] = t13;
    $[43] = t14;
    $[44] = t15;
    $[45] = t18;
    $[46] = t19;
    $[47] = t20;
    $[48] = t21;
    $[49] = t22;
    $[50] = t23;
  } else {
    t23 = $[50];
  }
  let t24;
  if ($[51] === Symbol.for("react.memo_cache_sentinel")) {
    t24 = <Text bold={true}>Updates</Text>;
    $[51] = t24;
  } else {
    t24 = $[51];
  }
  const t25 = diagnostic.packageManager ? "Managed by package manager" : diagnostic.autoUpdates;
  let t26;
  if ($[52] !== t25) {
    t26 = <Text>└ Auto-updates:{" "}{t25}</Text>;
    $[52] = t25;
    $[53] = t26;
  } else {
    t26 = $[53];
  }
  let t27;
  if ($[54] !== diagnostic.hasUpdatePermissions) {
    t27 = diagnostic.hasUpdatePermissions !== null && <Text>└ Update permissions:{" "}{diagnostic.hasUpdatePermissions ? "Yes" : "No (requires sudo)"}</Text>;
    $[54] = diagnostic.hasUpdatePermissions;
    $[55] = t27;
  } else {
    t27 = $[55];
  }
  let t28;
  if ($[56] === Symbol.for("react.memo_cache_sentinel")) {
    t28 = <Text>└ Auto-update channel: {autoUpdatesChannel}</Text>;
    $[56] = t28;
  } else {
    t28 = $[56];
  }
  let t29;
  if ($[57] === Symbol.for("react.memo_cache_sentinel")) {
    t29 = <Suspense fallback={null}><DistTagsDisplay promise={distTagsPromise} /></Suspense>;
    $[57] = t29;
  } else {
    t29 = $[57];
  }
  const packageManagerAutoUpdate = describePackageManagerAutoUpdateMode(diagnostic.terminalEnvControls.packageManagerAutoUpdate);
  const t30 = <Box flexDirection="column">{t24}{t26}{t27}{t28}<Text>└ {getLocalizedText({
        zh: '终端环境',
        en: 'Terminal env'
      })}: {getLocalizedText({
        zh: `备用屏幕=${diagnostic.terminalEnvControls.alternateScreen}，同步输出=${diagnostic.terminalEnvControls.synchronizedOutput}，防闪烁=${diagnostic.terminalEnvControls.noFlicker}，无颜色=${diagnostic.terminalEnvControls.noColor}，包管理器自动更新=${getLocalizedText(packageManagerAutoUpdate)}`,
        en: `alternate screen=${diagnostic.terminalEnvControls.alternateScreen}, synchronized output=${diagnostic.terminalEnvControls.synchronizedOutput}, no flicker=${diagnostic.terminalEnvControls.noFlicker}, no color=${diagnostic.terminalEnvControls.noColor}, package manager auto-update=${getLocalizedText(packageManagerAutoUpdate)}`
      })}</Text>{t29}</Box>;
  let t31;
  let t32;
  let t33;
  let t34;
  if ($[61] === Symbol.for("react.memo_cache_sentinel")) {
    t31 = <SandboxDoctorSection />;
    t32 = <McpParsingWarnings />;
    t33 = <KeybindingWarnings />;
    t34 = envValidationErrors.length > 0 && <Box flexDirection="column"><Text bold={true}>{getLocalizedText({
      zh: '环境变量',
      en: 'Environment Variables'
    })}</Text>{envValidationErrors.map(_temp11)}</Box>;
    $[61] = t31;
    $[62] = t32;
    $[63] = t33;
    $[64] = t34;
  } else {
    t31 = $[61];
    t32 = $[62];
    t33 = $[63];
    t34 = $[64];
  }
  let t35;
  if ($[65] !== versionLockInfo) {
    t35 = versionLockInfo?.enabled && <Box flexDirection="column"><Text bold={true}>{getLocalizedText({
      zh: '版本锁',
      en: 'Version Locks'
    })}</Text>{versionLockInfo.staleLocksCleaned > 0 && <Text dimColor={true}>└ {getLocalizedText({
      zh: `已清理 ${versionLockInfo.staleLocksCleaned} 个过期锁`,
      en: `Cleaned ${versionLockInfo.staleLocksCleaned} stale lock(s)`
    })}</Text>}{versionLockInfo.locks.length === 0 ? <Text dimColor={true}>└ {getLocalizedText({
      zh: '当前没有活动版本锁',
      en: 'No active version locks'
    })}</Text> : versionLockInfo.locks.map(_temp12)}</Box>;
    $[65] = versionLockInfo;
    $[66] = t35;
  } else {
    t35 = $[66];
  }
  let t36;
  if ($[67] !== agentInfo) {
    t36 = agentInfo?.failedFiles && agentInfo.failedFiles.length > 0 && <Box flexDirection="column"><Text bold={true} color="error">{getLocalizedText({
      zh: '代理解析错误',
      en: 'Agent Parse Errors'
    })}</Text><Text color="error">└ {getLocalizedText({
      zh: `有 ${agentInfo.failedFiles.length} 个代理文件解析失败：`,
      en: `Failed to parse ${agentInfo.failedFiles.length} agent file(s):`
    })}</Text>{agentInfo.failedFiles.map(_temp13)}</Box>;
    $[67] = agentInfo;
    $[68] = t36;
  } else {
    t36 = $[68];
  }
  let t37;
  if ($[69] !== pluginsErrors) {
    t37 = pluginsErrors.length > 0 && <Box flexDirection="column"><Text bold={true} color="error">{getLocalizedText({
      zh: '插件错误',
      en: 'Plugin Errors'
    })}</Text><Text color="error">└ {getLocalizedText({
      zh: `检测到 ${pluginsErrors.length} 个插件错误：`,
      en: `${pluginsErrors.length} plugin error(s) detected:`
    })}</Text>{pluginsErrors.map(_temp14)}</Box>;
    $[69] = pluginsErrors;
    $[70] = t37;
  } else {
    t37 = $[70];
  }
  let t38;
  if ($[71] !== contextWarnings) {
    t38 = contextWarnings?.unreachableRulesWarning && <Box flexDirection="column"><Text bold={true} color="warning">{getLocalizedText({
      zh: '不可达的权限规则',
      en: 'Unreachable Permission Rules'
    })}</Text><Text>└{" "}<Text color="warning">{figures.warning}{" "}{contextWarnings.unreachableRulesWarning.message}</Text></Text>{contextWarnings.unreachableRulesWarning.details.map(_temp15)}</Box>;
    $[71] = contextWarnings;
    $[72] = t38;
  } else {
    t38 = $[72];
  }
  let t39;
  if ($[73] !== contextWarnings) {
    t39 = contextWarnings && (contextWarnings.mossenMdWarning || contextWarnings.agentWarning || contextWarnings.mcpWarning) && <Box flexDirection="column"><Text bold={true}>{getLocalizedText({
      zh: '上下文使用警告',
      en: 'Context Usage Warnings'
    })}</Text>{contextWarnings.mossenMdWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.mossenMdWarning.message}</Text></Text><Text>{"  "}└ {getLocalizedText({
      zh: '文件：',
      en: 'Files:'
    })}</Text>{contextWarnings.mossenMdWarning.details.map(_temp16)}</>}{contextWarnings.agentWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.agentWarning.message}</Text></Text><Text>{"  "}└ {getLocalizedText({
      zh: '主要贡献项：',
      en: 'Top contributors:'
    })}</Text>{contextWarnings.agentWarning.details.map(_temp17)}</>}{contextWarnings.mcpWarning && <><Text>└{" "}<Text color="warning">{figures.warning} {contextWarnings.mcpWarning.message}</Text></Text><Text>{"  "}└ {getLocalizedText({
      zh: 'MCP 服务器：',
      en: 'MCP servers:'
    })}</Text>{contextWarnings.mcpWarning.details.map(_temp18)}</>}</Box>;
    $[73] = contextWarnings;
    $[74] = t39;
  } else {
    t39 = $[74];
  }
  let t40;
  if ($[75] === Symbol.for("react.memo_cache_sentinel")) {
    t40 = <Box><PressEnterToContinue /></Box>;
    $[75] = t40;
  } else {
    t40 = $[75];
  }
  let t41;
  if ($[76] !== t23 || $[77] !== t30 || $[78] !== t35 || $[79] !== t36 || $[80] !== t37 || $[81] !== t38 || $[82] !== t39) {
    t41 = <Pane>{t23}{platformCoreSection}{platformLiveSection}{t30}{t31}{t32}{t33}{t34}{t35}{t36}{t37}{t38}{t39}{t40}</Pane>;
    $[76] = t23;
    $[77] = t30;
    $[78] = t35;
    $[79] = t36;
    $[80] = t37;
    $[81] = t38;
    $[82] = t39;
    $[83] = t41;
  } else {
    t41 = $[83];
  }
  return t41;
}
function _temp18(detail_2, i_8) {
  return <Text key={i_8} dimColor={true}>{"    "}└ {detail_2}</Text>;
}
function _temp17(detail_1, i_7) {
  return <Text key={i_7} dimColor={true}>{"    "}└ {detail_1}</Text>;
}
function _temp16(detail_0, i_6) {
  return <Text key={i_6} dimColor={true}>{"    "}└ {detail_0}</Text>;
}
function _temp15(detail, i_5) {
  return <Text key={i_5} dimColor={true}>{"  "}└ {detail}</Text>;
}
function _temp14(error_0, i_4) {
  return <Text key={i_4} dimColor={true}>{"  "}└ {error_0.source || "unknown"}{"plugin" in error_0 && error_0.plugin ? ` [${error_0.plugin}]` : ""}:{" "}{getPluginErrorMessage(error_0)}</Text>;
}
function _temp13(file, i_3) {
  return <Text key={i_3} dimColor={true}>{"  "}└ {file.path}: {file.error}</Text>;
}
function _temp12(lock, i_2) {
  return <Text key={i_2}>└ {lock.version}: PID {lock.pid}{" "}{lock.isProcessRunning ? <Text>{getLocalizedText({
    zh: '(运行中)',
    en: '(running)'
  })}</Text> : <Text color="warning">{getLocalizedText({
    zh: '(过期)',
    en: '(stale)'
  })}</Text>}</Text>;
}
function _temp11(validation, i_1) {
  return <Text key={i_1}>└ {validation.name}:{" "}<Text color={validation.status === "capped" ? "warning" : "error"}>{validation.message}</Text></Text>;
}
function _temp10(warning, i_0) {
  return <Box key={i_0} flexDirection="column"><Text color="warning">{getLocalizedText({
    zh: '警告：',
    en: 'Warning:'
  })} {warning.issue}</Text><Text>{getLocalizedText({
    zh: '修复建议：',
    en: 'Fix:'
  })} {warning.fix}</Text></Box>;
}
function _temp1(install, i) {
  return <Text key={i}>└ {install.type} at {install.path}</Text>;
}
function _temp0(a) {
  return {
    agentType: a.agentType,
    source: a.source
  };
}
function _temp9(v_0) {
  return v_0.status !== "valid";
}
function _temp8(v) {
  const value = process.env[v.name];
  const result = validateBoundedIntEnvVar(v.name, value, v.default, v.upperLimit);
  return {
    name: v.name,
    ...result
  };
}
function _temp7(error) {
  return error.mcpErrorMetadata === undefined;
}
function _temp6(diag) {
  const fetchDistTags = diag.installationType === "native" ? getGcsDistTags : getNpmDistTags;
  return fetchDistTags().catch(_temp5);
}
function _temp5() {
  return {
    latest: null,
    stable: null
  };
}
function _temp4(s_2) {
  return s_2.plugins.errors;
}
function _temp3(s_1) {
  return s_1.toolPermissionContext;
}
function _temp2(s_0) {
  return s_0.mcp.tools;
}
function _temp(s) {
  return s.agentDefinitions;
}
