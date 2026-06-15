import chalk from 'chalk';
import figures from 'figures';
import * as React from 'react';
import { color, Text } from '../ink.js';
import type { MCPServerConnection } from '../services/mcp/types.js';
import { calculateTokenWarningState, getAutoCompactThreshold, getEffectiveContextWindowSize, isAutoCompactEnabled } from '../services/compact/autoCompact.js';
import type { Message } from '../types/message.js';
import type { SettingsJson } from './settings/types.js';
import { getAccountInformation, isHostedSubscriber } from './auth.js';
import type { EffortValue } from './effort.js';
import { getLargeMemoryFiles, getMemoryFiles, MAX_MEMORY_CHARACTER_COUNT } from './mossenmd.js';
import { getCustomBackendBaseUrl, getCustomBackendModel, getCustomBackendName, isCustomBackendEnabled } from './customBackend.js';
import { getDoctorDiagnostic } from './doctorDiagnostic.js';
import { getAWSRegion, getDefaultVertexRegion, isEnvTruthy } from './envUtils.js';
import { getDisplayPath } from './file.js';
import { formatNumber, formatTokens } from './format.js';
import { getIdeClientName, type IDEExtensionInstallationStatus, isJetBrainsIde, toIDEDisplayName } from './ide.js';
import { findLastCompactBoundaryIndex, getMessagesAfterCompactBoundary } from './messages.js';
import { getHostedUserDefaultModelDescription, modelDisplayString } from './model/model.js';
import { getAPIProvider } from './model/providers.js';
import { getContextWindowForModel } from './context.js';
import { getMTLSConfig } from './mtls.js';
import { checkInstall } from './nativeInstaller/index.js';
import { getConfiguredExecutionProfile, getCurrentReasoningProfile, getExecutionProfileDescription, getReasoningProfileDescription, reasoningProfileToEffort } from './profile.js';
import { getProxyUrl } from './proxy.js';
import { SandboxManager } from './sandbox/sandbox-adapter.js';
import { getDisplayedModelTier } from './statusLineObservability.js';
import { getSettingsWithAllErrors } from './settings/allErrors.js';
import { getEnabledSettingSources, getSettingSourceDisplayNameCapitalized } from './settings/constants.js';
import { getInitialSettings, getManagedFileSettingsPresence, getPolicySettingsOrigin, getSettingsForSource } from './settings/settings.js';
import {
  describePackageManagerAutoUpdateMode,
  getTerminalEnvControlSnapshot,
} from './terminalEnvControls.js';
import {
  getInteractiveLanguageFooterLabel,
  getLocalizedText,
} from './uiLanguage.js';
import { getCurrentWorktreeObservabilitySnapshot, type WorktreeObservabilitySnapshot } from './worktree.js';
import type { PermissionMode } from './permissions/PermissionMode.js';
import { permissionModeProtocolName, permissionModeTitle } from './permissions/PermissionMode.js';
import type { ThemeName } from './theme.js';
import { tokenCountWithEstimation } from './tokens.js';
export type Property = {
  label?: string;
  value: React.ReactNode | Array<string>;
};
export type Diagnostic = React.ReactNode;
export type CustomBackendObservabilitySnapshot = {
  providerLabel: string;
  modelTier: 'local' | 'cloud';
  backendUrl: string | null;
  customModel: string | null;
  contextWindowTokens: number | null;
  interactiveLanguage: string;
  executionProfile: string;
  reasoningProfile: string;
  worktree: WorktreeObservabilitySnapshot | null;
};

export function buildContextObservabilityProperties(messages: Message[], mainLoopModel: string | null): Property[] {
  if (!mainLoopModel) {
    return [];
  }
  const compactAwareMessages = getMessagesAfterCompactBoundary(messages);
  const currentTokens = tokenCountWithEstimation(compactAwareMessages);
  const effectiveWindow = getEffectiveContextWindowSize(mainLoopModel);
  const contextPercent = Math.min(100, Math.round(currentTokens / effectiveWindow * 100));
  const warningState = calculateTokenWarningState(currentTokens, mainLoopModel);
  const properties: Property[] = [{
    label: 'Context pressure',
    value: `${contextPercent}% used (${formatTokens(currentTokens)} / ${formatTokens(effectiveWindow)})`
  }];
  if (isAutoCompactEnabled()) {
    const autoCompactThreshold = getAutoCompactThreshold(mainLoopModel);
    const autoCompactPercent = Math.round(autoCompactThreshold / effectiveWindow * 100);
    properties.push({
      label: 'Auto-compact',
      value: `Enabled @ ${autoCompactPercent}% (${formatTokens(autoCompactThreshold)})${warningState.isAboveAutoCompactThreshold ? ' · threshold reached' : ''}`
    });
  } else {
    properties.push({
      label: 'Auto-compact',
      value: 'Disabled'
    });
  }
  const compactBoundaryIndex = findLastCompactBoundaryIndex(messages);
  properties.push({
    label: 'Recent compact',
    value: compactBoundaryIndex === -1 ? 'No compact boundary in this session' : `${Math.max(0, messages.length - compactBoundaryIndex - 1)} messages since last compact`
  });
  return properties;
}

export function buildProfileProperties(
  model: string | null,
  effortValue: string | number | undefined,
  settings: Pick<SettingsJson, 'executionProfile' | 'reasoningProfile' | 'effortLevel'>,
): Property[] {
  const executionProfile = getConfiguredExecutionProfile(settings);
  const reasoningProfile = getCurrentReasoningProfile(
    effortValue as EffortValue | undefined,
    settings,
  );
  const effortLabel = model ? reasoningProfileToEffort(reasoningProfile) : null;
  return [{
    label: 'Execution profile',
    value: `${executionProfile} · ${getExecutionProfileDescription(executionProfile)}`
  }, {
    label: 'Reasoning profile',
    value: effortLabel ? `${reasoningProfile} · ${getReasoningProfileDescription(reasoningProfile)} (${effortLabel} effort)` : `${reasoningProfile} · ${getReasoningProfileDescription(reasoningProfile)}`
  }];
}

export function buildLanguageProperties(): Property[] {
  return [
    {
      label: 'Language',
      value: getInteractiveLanguageFooterLabel(),
    },
  ];
}

export function buildCurrentPermissionModeProperties(
  permissionMode: PermissionMode | undefined,
): Property[] {
  if (!permissionMode) {
    return [];
  }
  return [
    {
      label: 'Current permission mode',
      value: `${permissionModeProtocolName(permissionMode)} · ${permissionModeTitle(permissionMode)}`,
    },
  ];
}

export function buildWorktreeProperties(
  snapshot = getCurrentWorktreeObservabilitySnapshot(),
): Property[] {
  if (!snapshot) {
    return [];
  }

  const properties: Property[] = [
    {
      label: 'Worktree',
      value: snapshot.branch
        ? `${snapshot.name} · ${snapshot.branch}`
        : snapshot.name,
    },
    {
      label: 'Worktree path',
      value: snapshot.path,
    },
    {
      label: 'Original cwd',
      value: snapshot.originalCwd,
    },
  ];

  if (snapshot.originalBranch) {
    properties.push({
      label: 'Original branch',
      value: snapshot.originalBranch,
    });
  }

  return properties;
}

export function getCustomBackendObservabilitySnapshot(settings = getInitialSettings()): CustomBackendObservabilitySnapshot {
  const customModel = getCustomBackendModel();
  return {
    providerLabel: getCustomBackendName(),
    modelTier: getDisplayedModelTier(),
    backendUrl: getCustomBackendBaseUrl(),
    customModel,
    contextWindowTokens: customModel ? getContextWindowForModel(customModel) : null,
    interactiveLanguage: getInteractiveLanguageFooterLabel(),
    executionProfile: getConfiguredExecutionProfile(settings),
    reasoningProfile: getCurrentReasoningProfile(settings.effortLevel, settings),
    worktree: getCurrentWorktreeObservabilitySnapshot(),
  };
}

export function buildSandboxProperties(): Property[] {
  if (("external" as string) !== 'internal') {
    return [];
  }
  const isSandboxed = SandboxManager.isSandboxingEnabled();
  return [{
    label: 'Bash Sandbox',
    value: isSandboxed ? 'Enabled' : 'Disabled'
  }];
}
export function buildIDEProperties(mcpClients: MCPServerConnection[], ideInstallationStatus: IDEExtensionInstallationStatus | null = null, theme: ThemeName): Property[] {
  const ideClient = mcpClients?.find(client => client.name === 'ide');
  if (ideInstallationStatus) {
    const ideName = toIDEDisplayName(ideInstallationStatus.ideType);
    const pluginOrExtension = isJetBrainsIde(ideInstallationStatus.ideType) ? 'plugin' : 'extension';
    if (ideInstallationStatus.error) {
      return [{
        label: 'IDE',
        value: <Text>
              {color('error', theme)(figures.cross)} Error installing {ideName}{' '}
              {pluginOrExtension}: {ideInstallationStatus.error}
              {'\n'}Please restart your IDE and try again.
            </Text>
      }];
    }
    if (ideInstallationStatus.installed) {
      if (ideClient && ideClient.type === 'connected') {
        if (ideInstallationStatus.installedVersion !== ideClient.serverInfo?.version) {
          return [{
            label: 'IDE',
            value: `Connected to ${ideName} ${pluginOrExtension} version ${ideInstallationStatus.installedVersion} (server version: ${ideClient.serverInfo?.version})`
          }];
        } else {
          return [{
            label: 'IDE',
            value: `Connected to ${ideName} ${pluginOrExtension} version ${ideInstallationStatus.installedVersion}`
          }];
        }
      } else {
        return [{
          label: 'IDE',
          value: `Installed ${ideName} ${pluginOrExtension}`
        }];
      }
    }
  } else if (ideClient) {
    const ideName = getIdeClientName(ideClient) ?? 'IDE';
    if (ideClient.type === 'connected') {
      return [{
        label: 'IDE',
        value: `Connected to ${ideName} extension`
      }];
    } else {
      return [{
        label: 'IDE',
        value: `${color('error', theme)(figures.cross)} Not connected to ${ideName}`
      }];
    }
  }
  return [];
}
export function buildMcpProperties(clients: MCPServerConnection[] = [], theme: ThemeName): Property[] {
  const servers = clients.filter(client => client.name !== 'ide');
  if (!servers.length) {
    return [];
  }

  // Summary instead of a full server list — 20+ servers wrapped onto many
  // rows, dominating the Status pane. Show counts by state + /mcp hint.
  const byState = {
    connected: 0,
    pending: 0,
    needsAuth: 0,
    failed: 0
  };
  for (const s of servers) {
    if (s.type === 'connected') byState.connected++;else if (s.type === 'pending') byState.pending++;else if (s.type === 'needs-auth') byState.needsAuth++;else byState.failed++;
  }
  const parts: string[] = [];
  if (byState.connected) parts.push(color('success', theme)(`${byState.connected} connected`));
  if (byState.needsAuth) parts.push(color('warning', theme)(`${byState.needsAuth} need auth`));
  if (byState.pending) parts.push(color('inactive', theme)(`${byState.pending} pending`));
  if (byState.failed) parts.push(color('error', theme)(`${byState.failed} failed`));
  return [{
    label: 'MCP servers',
    value: `${parts.join(', ')} ${color('inactive', theme)('· /mcp')}`
  }];
}
export async function buildMemoryDiagnostics(): Promise<Diagnostic[]> {
  const files = await getMemoryFiles();
  const largeFiles = getLargeMemoryFiles(files);
  const diagnostics: Diagnostic[] = [];
  largeFiles.forEach(file => {
    const displayPath = getDisplayPath(file.path);
    diagnostics.push(`Large ${displayPath} will impact performance (${formatNumber(file.content.length)} chars > ${formatNumber(MAX_MEMORY_CHARACTER_COUNT)})`);
  });
  return diagnostics;
}
export function buildSettingSourcesProperties(): Property[] {
  const enabledSources = getEnabledSettingSources();

  // Filter to only sources that actually have settings loaded
  const sourcesWithSettings = enabledSources.filter(source => {
    const settings = getSettingsForSource(source);
    return settings !== null && Object.keys(settings).length > 0;
  });

  // Map internal names to user-friendly names
  // For policySettings, distinguish between remote and local (or skip if neither exists)
  const sourceNames = sourcesWithSettings.map(source => {
    if (source === 'policySettings') {
      const origin = getPolicySettingsOrigin();
      if (origin === null) {
        return null; // Skip - no policy settings exist
      }
      switch (origin) {
        case 'remote':
          return 'Enterprise managed settings (remote)';
        case 'plist':
          return 'Enterprise managed settings (plist)';
        case 'hklm':
          return 'Enterprise managed settings (HKLM)';
        case 'file':
          {
            const {
              hasBase,
              hasDropIns
            } = getManagedFileSettingsPresence();
            if (hasBase && hasDropIns) {
              return 'Enterprise managed settings (file + drop-ins)';
            }
            if (hasDropIns) {
              return 'Enterprise managed settings (drop-ins)';
            }
            return 'Enterprise managed settings (file)';
          }
        case 'hkcu':
          return 'Enterprise managed settings (HKCU)';
      }
    }
    return getSettingSourceDisplayNameCapitalized(source);
  }).filter((name): name is string => name !== null);
  return [{
    label: 'Setting sources',
    value: sourceNames
  }];
}

export function buildTerminalEnvControlProperties(): Property[] {
  const snapshot = getTerminalEnvControlSnapshot();
  const packageManagerAutoUpdate = describePackageManagerAutoUpdateMode(snapshot.packageManagerAutoUpdate);
  return [{
    label: getLocalizedText({
      en: 'Terminal env',
      zh: '终端环境'
    }),
    value: [
      `${getLocalizedText({
        en: 'Alternate screen',
        zh: '备用屏幕'
      })}: ${snapshot.alternateScreen}`,
      `${getLocalizedText({
        en: 'Synchronized output',
        zh: '同步输出'
      })}: ${snapshot.synchronizedOutput}`,
      `${getLocalizedText({
        en: 'No flicker',
        zh: '防闪烁'
      })}: ${snapshot.noFlicker}`,
      `${getLocalizedText({
        en: 'No color',
        zh: '无颜色'
      })}: ${snapshot.noColor}`,
      `${getLocalizedText({
        en: 'Package manager auto-update',
        zh: '包管理器自动更新'
      })}: ${getLocalizedText(packageManagerAutoUpdate)}`
    ]
  }];
}
export async function buildInstallationDiagnostics(): Promise<Diagnostic[]> {
  const installWarnings = await checkInstall();
  return installWarnings.map(warning => warning.message);
}
export async function buildInstallationHealthDiagnostics(): Promise<Diagnostic[]> {
  const diagnostic = await getDoctorDiagnostic();
  const items: Diagnostic[] = [];
  const {
    errors: validationErrors
  } = getSettingsWithAllErrors();
  if (validationErrors.length > 0) {
    const invalidFiles = Array.from(new Set(validationErrors.map(error => error.file)));
    const fileList = invalidFiles.join(', ');
    items.push(`Found invalid settings files: ${fileList}. They will be ignored.`);
  }

  // Add warnings from doctor diagnostic (includes leftover installations, config mismatches, etc.)
  diagnostic.warnings.forEach(warning => {
    items.push(warning.issue);
  });
  if (diagnostic.hasUpdatePermissions === false) {
    items.push('No write permissions for auto-updates (requires sudo)');
  }
  return items;
}
export function buildAccountProperties(): Property[] {
  const accountInfo = getAccountInformation();
  if (!accountInfo) {
    return [];
  }
  const properties: Property[] = [];
  if (accountInfo.subscription) {
    properties.push({
      label: 'Login method',
      value: `${accountInfo.subscription} Account`
    });
  }
  if (accountInfo.tokenSource) {
    properties.push({
      label: 'Auth token',
      value: accountInfo.tokenSource
    });
  }
  if (accountInfo.apiKeySource) {
    properties.push({
      label: 'API key',
      value: accountInfo.apiKeySource
    });
  }

  // Hide sensitive account info in demo mode
  if (accountInfo.organization && !process.env.IS_DEMO) {
    properties.push({
      label: 'Organization',
      value: accountInfo.organization
    });
  }
  if (accountInfo.email && !process.env.IS_DEMO) {
    properties.push({
      label: 'Email',
      value: accountInfo.email
    });
  }
  return properties;
}
export function buildAPIProviderProperties(): Property[] {
  const settings = getInitialSettings();
  const profileProperties = buildProfileProperties(null, settings.effortLevel, settings);
  const languageProperties = buildLanguageProperties();
  const worktreeProperties = buildWorktreeProperties();
  if (isCustomBackendEnabled()) {
    const snapshot = getCustomBackendObservabilitySnapshot(settings);
    const properties: Property[] = [{
      label: 'API provider',
      value: snapshot.providerLabel
    }, {
      label: 'Model tier',
      value: snapshot.modelTier
    }, ...languageProperties, ...profileProperties, ...worktreeProperties];
    if (snapshot.backendUrl) {
      properties.push({
        label: 'Backend URL',
        value: snapshot.backendUrl
      });
    }
    if (snapshot.customModel) {
      properties.push({
        label: 'Custom model',
        value: snapshot.customModel
      });
      properties.push({
        label: 'Context window',
        value: `${snapshot.contextWindowTokens?.toLocaleString('en-US')} tokens`
      });
    }
    return properties;
  }
  const apiProvider = getAPIProvider();
  const properties: Property[] = [];
  if (apiProvider !== 'firstParty') {
    const providerLabel = {
      bedrock: 'AWS Bedrock',
      vertex: 'Google Vertex AI',
      foundry: 'Microsoft Foundry'
    }[apiProvider];
    properties.push({
      label: 'API provider',
      value: providerLabel
    });
  }
  properties.push({
    label: 'Model tier',
    value: 'cloud'
  });
  properties.push(...languageProperties);
  properties.push(...profileProperties);
  properties.push(...worktreeProperties);
  if (apiProvider === 'firstParty') {
    const mossenBaseUrl = process.env.MOSSEN_CODE_API_BASE_URL;
    if (mossenBaseUrl) {
      properties.push({
        label: 'Provider base URL',
        value: mossenBaseUrl
      });
    }
  } else if (apiProvider === 'bedrock') {
    const bedrockBaseUrl = process.env.MOSSEN_CODE_BEDROCK_BASE_URL;
    if (bedrockBaseUrl) {
      properties.push({
        label: 'Bedrock base URL',
        value: bedrockBaseUrl
      });
    }
    properties.push({
      label: 'AWS region',
      value: getAWSRegion()
    });
    if (isEnvTruthy(process.env.MOSSEN_CODE_SKIP_BEDROCK_AUTH)) {
      properties.push({
        value: 'AWS auth skipped'
      });
    }
  } else if (apiProvider === 'vertex') {
    const vertexBaseUrl = process.env.MOSSEN_CODE_VERTEX_BASE_URL;
    if (vertexBaseUrl) {
      properties.push({
        label: 'Vertex base URL',
        value: vertexBaseUrl
      });
    }
    const gcpProject = process.env.MOSSEN_CODE_VERTEX_PROJECT_ID;
    if (gcpProject) {
      properties.push({
        label: 'GCP project',
        value: gcpProject
      });
    }
    properties.push({
      label: 'Default region',
      value: getDefaultVertexRegion()
    });
    if (isEnvTruthy(process.env.MOSSEN_CODE_SKIP_VERTEX_AUTH)) {
      properties.push({
        value: 'GCP auth skipped'
      });
    }
  } else if (apiProvider === 'foundry') {
    const foundryBaseUrl = process.env.MOSSEN_CODE_FOUNDRY_BASE_URL;
    if (foundryBaseUrl) {
      properties.push({
        label: 'Microsoft Foundry base URL',
        value: foundryBaseUrl
      });
    }
    const foundryResource = process.env.MOSSEN_CODE_FOUNDRY_RESOURCE;
    if (foundryResource) {
      properties.push({
        label: 'Microsoft Foundry resource',
        value: foundryResource
      });
    }
    if (isEnvTruthy(process.env.MOSSEN_CODE_SKIP_FOUNDRY_AUTH)) {
      properties.push({
        value: 'Microsoft Foundry auth skipped'
      });
    }
  }
  const proxyUrl = getProxyUrl();
  if (proxyUrl) {
    properties.push({
      label: 'Proxy',
      value: proxyUrl
    });
  }
  const mtlsConfig = getMTLSConfig();
  if (process.env.NODE_EXTRA_CA_CERTS) {
    properties.push({
      label: 'Additional CA cert(s)',
      value: process.env.NODE_EXTRA_CA_CERTS
    });
  }
  if (mtlsConfig) {
    if (mtlsConfig.cert && process.env.MOSSEN_CODE_CLIENT_CERT) {
      properties.push({
        label: 'mTLS client cert',
        value: process.env.MOSSEN_CODE_CLIENT_CERT
      });
    }
    if (mtlsConfig.key && process.env.MOSSEN_CODE_CLIENT_KEY) {
      properties.push({
        label: 'mTLS client key',
        value: process.env.MOSSEN_CODE_CLIENT_KEY
      });
    }
  }
  return properties;
}
export function getModelDisplayLabel(mainLoopModel: string | null): string {
  let modelLabel = modelDisplayString(mainLoopModel);
  if (mainLoopModel === null && isHostedSubscriber()) {
    const description = getHostedUserDefaultModelDescription();
    modelLabel = `${chalk.bold('Default')} ${description}`;
  }
  return modelLabel;
}
