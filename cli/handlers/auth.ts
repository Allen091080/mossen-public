/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import { clearAuthRelatedCaches, performLogout, } from '../../commands/logout/logout.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import { getSSLErrorHint } from '../../services/api/errorUtils.js'
import { fetchAndStoreMossenFirstTokenDate } from '../../services/api/firstTokenDate.js'
import {
  createAndStoreApiKey,
  fetchAndStoreUserRoles,
  refreshOAuthToken,
  shouldUseHostedAuth,
  storeOAuthAccountInfo,
} from '../../services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js'
import { OAuthService } from '../../services/oauth/index.js'
import type { OAuthTokens } from '../../services/oauth/types.js'
import {
  clearOAuthTokenCache,
  getMossenApiKeyWithSource,
  getAuthTokenSource,
  getOauthAccountInfo,
  getSubscriptionType,
  isHostedAuthAdapterEnabled,
  isUsing3PServices,
  saveOAuthTokensIfNeeded,
  validateForceLoginOrg,
} from '../../utils/auth.js'
import { saveGlobalConfig } from '../../utils/config.js'
import {
  hasCustomBackendAuth,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import { logForDebugging } from '../../utils/debug.js'
import { isRunningOnHomespace } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  buildAccountProperties,
  buildAPIProviderProperties,
  getCustomBackendObservabilitySnapshot,
} from '../../utils/status.js'
import { getPlatformRuntimeSnapshot } from '../../platform/runtime.js'

/**
 * Shared post-token-acquisition logic. Saves tokens, fetches profile/roles,
 * and sets up the local auth state.
 */
export async function installOAuthTokens(tokens: OAuthTokens): Promise<void> {
  // Clear old state before saving new credentials
  await performLogout({ clearOnboarding: false })

  // Reuse pre-fetched profile if available, otherwise fetch fresh
  const profile =
    tokens.profile ?? (await getOauthProfileFromOauthToken(tokens.accessToken))
  if (profile) {
    storeOAuthAccountInfo({
      accountUuid: profile.account.uuid,
      emailAddress: profile.account.email,
      organizationUuid: profile.organization.uuid,
      displayName: profile.account.display_name || undefined,
      hasExtraUsageEnabled:
        profile.organization.has_extra_usage_enabled ?? undefined,
      billingType: profile.organization.billing_type ?? undefined,
      subscriptionCreatedAt:
        profile.organization.subscription_created_at ?? undefined,
      accountCreatedAt: profile.account.created_at,
    })
  } else if (tokens.tokenAccount) {
    // Fallback to token exchange account data when profile endpoint fails
    storeOAuthAccountInfo({
      accountUuid: tokens.tokenAccount.uuid,
      emailAddress: tokens.tokenAccount.emailAddress,
      organizationUuid: tokens.tokenAccount.organizationUuid,
    })
  }

  const storageResult = saveOAuthTokensIfNeeded(tokens)
  clearOAuthTokenCache()

  if (storageResult.warning) {
    logMossenEvent('mossen.oauth.storageWarning', {
      warning:
        storageResult.warning as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Roles and first-token-date may fail for limited-scope tokens (e.g.
  // inference-only from setup-token). They're not required for core auth.
  await fetchAndStoreUserRoles(tokens.accessToken).catch(err =>
    logForDebugging(String(err), { level: 'error' }),
  )

  if (shouldUseHostedAuth(tokens.scopes)) {
    await fetchAndStoreMossenFirstTokenDate().catch(err =>
      logForDebugging(String(err), { level: 'error' }),
    )
  } else {
    // API key creation is critical for Console users — let it throw.
    const apiKey = await createAndStoreApiKey(tokens.accessToken)
    if (!apiKey) {
      throw new Error(
        'Unable to create API key. The server accepted the request but did not return a key.',
      )
    }
  }

  await clearAuthRelatedCaches()
}

export async function authLogin({
  email,
  sso,
  console: useConsole,
  hosted,
}: {
  email?: string
  sso?: boolean
  console?: boolean
  hosted?: boolean
}): Promise<void> {
  if (isCustomBackendEnabled()) {
    process.stderr.write(
      'Built-in account flow is disabled in Mossen. Configure custom backend credentials instead.\n',
    )
    process.exit(1)
  }
  if (!isHostedAuthAdapterEnabled()) {
    process.stderr.write(
      'Built-in account flow is disabled in Mossen. Configure MOSSEN_CODE_CUSTOM_BASE_URL with MOSSEN_CODE_CUSTOM_API_KEY or MOSSEN_CODE_CUSTOM_AUTH_TOKEN, or explicitly enable an external Mossen auth adapter with MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1.\n',
    )
    process.exit(1)
  }
  if (useConsole && hosted) {
    process.stderr.write(
      'Error: --console and --hosted cannot be used together.\n',
    )
    process.exit(1)
  }

  const settings = getInitialSettings()
  // forceLoginMethod remains a hard constraint for the explicit hosted adapter path.
  // Without it, --console selects console billing; --hosted selects adapter billing.
  const loginWithHostedAccount = settings.forceLoginMethod
    ? settings.forceLoginMethod === 'hosted'
    : !useConsole
  const orgUUID = settings.forceLoginOrgUUID

  // Fast path: if a hosted adapter refresh token is provided via env var, skip
  // the browser flow and exchange it directly for tokens.
  const envRefreshToken = process.env.MOSSEN_CODE_AUTH_REFRESH_TOKEN
  if (envRefreshToken) {
    const envScopes = process.env.MOSSEN_CODE_AUTH_SCOPES
    if (!envScopes) {
      process.stderr.write(
        'MOSSEN_CODE_AUTH_SCOPES is required when using MOSSEN_CODE_AUTH_REFRESH_TOKEN.\n' +
          'Set it to the space-separated scopes the refresh token was issued with\n' +
          '(e.g. "user:inference" or "user:profile user:inference user:sessions:mossen_code user:mcp_servers").\n',
      )
      process.exit(1)
    }

    const scopes = envScopes.split(/\s+/).filter(Boolean)

    try {
      logMossenEvent('mossen.oauth.loginFromRefreshToken', {})

      const tokens = await refreshOAuthToken(envRefreshToken, { scopes })
      await installOAuthTokens(tokens)

      const orgResult = await validateForceLoginOrg()
      if (!orgResult.valid) {
        const message =
          'message' in orgResult
            ? orgResult.message
            : 'Sign-in failed: organization policy validation failed.'
        process.stderr.write(message + '\n')
        process.exit(1)
      }

      // Mark onboarding complete — interactive paths handle this via
      // the Onboarding component, but the env var path skips it.
      saveGlobalConfig(current => {
        if (current.hasCompletedOnboarding) return current
        return { ...current, hasCompletedOnboarding: true }
      })

      logMossenEvent('mossen.oauth.success', {
        loginWithHostedAccount: shouldUseHostedAuth(tokens.scopes),
      })
      process.stdout.write('Sign-in successful.\n')
      process.exit(0)
    } catch (err) {
      logError(err)
      const sslHint = getSSLErrorHint(err)
      process.stderr.write(
        `Sign-in failed: ${errorMessage(err)}\n${sslHint ? sslHint + '\n' : ''}`,
      )
      process.exit(1)
    }
  }

  const resolvedLoginMethod = sso ? 'sso' : undefined

  const oauthService = new OAuthService()

  try {
    logMossenEvent('mossen.oauth.flowStart', { loginWithHostedAccount })

    const result = await oauthService.startOAuthFlow(
      async url => {
        process.stdout.write('Opening browser to sign in…\n')
        process.stdout.write(`If the browser didn't open, visit: ${url}\n`)
      },
      {
        loginWithHostedAccount,
        loginHint: email,
        loginMethod: resolvedLoginMethod,
        orgUUID,
      },
    )

    await installOAuthTokens(result)

    const orgResult = await validateForceLoginOrg()
    if (!orgResult.valid) {
      const message =
        'message' in orgResult
          ? orgResult.message
          : 'Sign-in failed: organization policy validation failed.'
      process.stderr.write(message + '\n')
      process.exit(1)
    }

    logMossenEvent('mossen.oauth.success', { loginWithHostedAccount })

    process.stdout.write('Sign-in successful.\n')
    process.exit(0)
  } catch (err) {
    logError(err)
    const sslHint = getSSLErrorHint(err)
    process.stderr.write(
      `Sign-in failed: ${errorMessage(err)}\n${sslHint ? sslHint + '\n' : ''}`,
    )
    process.exit(1)
  } finally {
    oauthService.cleanup()
  }
}

export async function authStatus(opts: {
  json?: boolean
  text?: boolean
}): Promise<void> {
  if (isCustomBackendEnabled()) {
    const platformRuntime = await getPlatformRuntimeSnapshot({ prime: true })
    const credentialsConfigured = hasCustomBackendAuth()
    const settings = getInitialSettings()
    const snapshot = getCustomBackendObservabilitySnapshot(settings)
    const output = {
      apiProvider: 'custom',
      authMethod: 'custom_backend',
      backendName: snapshot.providerLabel,
      baseUrl: snapshot.backendUrl,
      loggedIn: credentialsConfigured,
      credentialsConfigured,
      model: snapshot.customModel,
      modelTier: snapshot.modelTier,
      contextWindowTokens: snapshot.contextWindowTokens,
      interactiveLanguage: snapshot.interactiveLanguage,
      executionProfile: snapshot.executionProfile,
      reasoningProfile: snapshot.reasoningProfile,
      worktree: snapshot.worktree,
      protocol: platformRuntime.provider.protocol,
      capabilities: platformRuntime.provider.capabilities,
      platformCore: {
        directConnectFeatureEnabled: platformRuntime.directConnect.featureEnabled,
        directConnectServerReady:
          platformRuntime.directConnect.serverRuntimeAvailable,
        directConnectOpenReady:
          platformRuntime.directConnect.openRuntimeAvailable,
        directConnectSnapshotMissing:
          platformRuntime.directConnect.featureEnabled &&
          (!platformRuntime.directConnect.serverRuntimeAvailable ||
            !platformRuntime.directConnect.openRuntimeAvailable) &&
          !platformRuntime.directConnect.recoverableFromLocalCache,
        sshFeatureEnabled: platformRuntime.sshRemote.featureEnabled,
        sshLocalTestReady: platformRuntime.sshRemote.localTestAvailable,
        sshRemoteReady: platformRuntime.sshRemote.remoteSessionAvailable,
        sshSnapshotMissing:
          platformRuntime.sshRemote.featureEnabled &&
          (!platformRuntime.sshRemote.localTestAvailable ||
            !platformRuntime.sshRemote.remoteSessionAvailable) &&
          !platformRuntime.sshRemote.recoverableFromLocalCache,
        systemPromptLayers: platformRuntime.systemPrompt.defaultAssembly.length,
        effectiveSystemPromptItems:
          platformRuntime.systemPrompt.effectiveAssembly?.itemCount ?? 0,
        memoryEnabled: platformRuntime.memory.enabled,
        compressionAvailable: platformRuntime.compression.available,
        bundledSkills: platformRuntime.skills.bundledRegistered,
        defaultPermissionMode:
          platformRuntime.security.defaultPermissionMode ?? 'not set',
        pluginCount: platformRuntime.plugins.enabled,
        mcpServerCount:
          platformRuntime.mcp.enterpriseServers +
          platformRuntime.mcp.userServers +
          platformRuntime.mcp.projectServers +
          platformRuntime.mcp.localServers,
        localGitReady: platformRuntime.localGit.localGitReady,
        localPrReady: platformRuntime.localGit.localPrReady,
        ghInstalled: platformRuntime.localGit.ghInstalled,
        ghAuthenticated: platformRuntime.localGit.ghAuthenticated,
        remoteAllowed: platformRuntime.remote.bridgeAvailable,
        remotePolicyAllowed: platformRuntime.remote.policyAllowed,
        remoteDisabledReason: platformRuntime.remote.disabledReason,
        assistantCommandExposed: platformRuntime.assistant.commandExposed,
        assistantAttachAvailable: platformRuntime.assistant.attachAvailable,
        assistantDiscoveryAvailable:
          platformRuntime.assistant.discoveryAvailable,
        assistantSessionsDiscovered:
          platformRuntime.assistant.discoveredSessions,
        chromeInstalled: platformRuntime.chrome.extensionInstalled,
        chromeHostInstalled: platformRuntime.chrome.nativeHostInstalled,
        voiceAvailable:
          platformRuntime.voice.visible &&
          platformRuntime.voice.streamAvailable &&
          platformRuntime.voice.recordingAvailable,
        voiceUserEnabled: platformRuntime.voice.userEnabled,
        teamMemoryEnabled: platformRuntime.teamMemory.enabled,
        teamMemorySyncAvailable: platformRuntime.teamMemory.syncAvailable,
        activeAgents: platformRuntime.agents.active,
        projectSessions: platformRuntime.sessions.projectSessions,
        swarmActive: platformRuntime.swarm.teammate,
        agentEntrypoint: platformRuntime.agents.entrypoint,
        codeGuideAgent: platformRuntime.agents.includesCodeGuide,
        featureGates: platformRuntime.featureGates,
      },
    }
    if (opts.text) {
      const directState = !output.platformCore.directConnectFeatureEnabled
        ? 'off'
        : output.platformCore.directConnectServerReady &&
            output.platformCore.directConnectOpenReady
          ? 'ready'
          : output.platformCore.directConnectSnapshotMissing
            ? 'snapshot-missing'
            : 'blocked'
      const sshState = !output.platformCore.sshFeatureEnabled
        ? 'off'
        : output.platformCore.sshLocalTestReady &&
            output.platformCore.sshRemoteReady
          ? 'ready'
          : output.platformCore.sshSnapshotMissing
            ? 'snapshot-missing'
            : 'blocked'
      const remoteState = output.platformCore.remoteAllowed
        ? 'ready'
        : output.platformCore.remoteDisabledReason
          ? 'off'
          : output.platformCore.remotePolicyAllowed
            ? 'gated'
            : 'off'
      process.stdout.write(`Login method: ${output.backendName}\n`)
      if (output.baseUrl) {
        process.stdout.write(`Backend URL: ${output.baseUrl}\n`)
      }
      if (output.model) {
        process.stdout.write(`Custom model: ${output.model}\n`)
      }
      process.stdout.write(`Model tier: ${output.modelTier}\n`)
      if (output.contextWindowTokens) {
        process.stdout.write(
          `Context window: ${output.contextWindowTokens.toLocaleString('en-US')} tokens\n`,
        )
      }
      process.stdout.write(`Language: ${output.interactiveLanguage}\n`)
      process.stdout.write(`Execution profile: ${output.executionProfile}\n`)
      process.stdout.write(`Reasoning profile: ${output.reasoningProfile}\n`)
      process.stdout.write(
        `Credential state: ${output.credentialsConfigured ? 'configured' : 'missing'}\n`,
      )
      if (output.protocol) {
        process.stdout.write(`Protocol: ${output.protocol}\n`)
      }
      process.stdout.write(
        `Capabilities: streaming=${String(output.capabilities.streaming)}, tools=${String(output.capabilities.toolUse)}, structured=${String(output.capabilities.structuredOutput)}, auth=${String(output.capabilities.auth)}\n`,
      )
      process.stdout.write(
        `Platform core: git=${output.platformCore.localGitReady ? 'ready' : 'off'}, pr=${output.platformCore.localPrReady ? 'ready' : output.platformCore.ghInstalled ? output.platformCore.ghAuthenticated ? 'command-only' : 'gh-auth-missing' : 'gh-missing'}, direct=${directState}, ssh=${sshState}, system=${String(output.platformCore.systemPromptLayers)} layer(s), memory=${output.platformCore.memoryEnabled ? 'on' : 'off'}, compact=${output.platformCore.compressionAvailable ? 'on' : 'off'}, skills=${String(output.platformCore.bundledSkills)}, agents=${String(output.platformCore.activeAgents)}@${output.platformCore.agentEntrypoint ?? 'unset'}${output.platformCore.codeGuideAgent ? '+guide' : ''}, sessions=${String(output.platformCore.projectSessions)}, swarm=${output.platformCore.swarmActive ? 'on' : 'off'}, plugins=${String(output.platformCore.pluginCount)}, mcp=${String(output.platformCore.mcpServerCount)}, remote=${remoteState}, assistant=${!output.platformCore.assistantCommandExposed ? 'off' : output.platformCore.assistantAttachAvailable ? 'ready' : output.platformCore.assistantDiscoveryAvailable ? `discovery-only(${String(output.platformCore.assistantSessionsDiscovered)})` : 'off'}, chrome=${output.platformCore.chromeInstalled ? 'ready' : output.platformCore.chromeHostInstalled ? 'host-only' : 'not-ready'}, voice=${output.platformCore.voiceAvailable ? output.platformCore.voiceUserEnabled ? 'ready' : 'available-off' : 'off'}, teammem=${output.platformCore.teamMemoryEnabled ? output.platformCore.teamMemorySyncAvailable ? 'ready' : 'local-only' : 'off'}, permissions=${output.platformCore.defaultPermissionMode}\n`,
      )
      if (!output.credentialsConfigured) {
        process.stdout.write(
          'Auth note: no custom backend auth headers are currently configured.\n',
        )
      }
      if (platformRuntime.directConnect.statusReason) {
        process.stdout.write(
          `Direct-connect note: ${platformRuntime.directConnect.statusReason}\n`,
        )
      }
      if (platformRuntime.sshRemote.statusReason) {
        process.stdout.write(`SSH note: ${platformRuntime.sshRemote.statusReason}\n`)
      }
      if (platformRuntime.remote.disabledReason) {
        process.stdout.write(`Remote note: ${platformRuntime.remote.disabledReason}\n`)
      }
      if (platformRuntime.assistant.statusReason) {
        process.stdout.write(
          `Assistant note: ${platformRuntime.assistant.statusReason}\n`,
        )
      }
      if (platformRuntime.chrome.statusReason) {
        process.stdout.write(`Chrome note: ${platformRuntime.chrome.statusReason}\n`)
      }
      if (output.platformCore.voiceAvailable && !output.platformCore.voiceUserEnabled) {
        process.stdout.write(
          'Voice note: backend is ready, but voice is currently disabled in user settings.\n',
        )
      }
      if (platformRuntime.teamMemory.statusReason) {
        process.stdout.write(`Team memory note: ${platformRuntime.teamMemory.statusReason}\n`)
      }
      if (platformRuntime.localGit.statusReason) {
        process.stdout.write(`Local git note: ${platformRuntime.localGit.statusReason}\n`)
      }
      process.stdout.write(
        `Feature gates: direct-connect=${output.platformCore.featureGates.directConnect ? 'on' : 'off'}, ssh=${output.platformCore.featureGates.sshRemote ? 'on' : 'off'}, kairos=${output.platformCore.featureGates.kairos ? 'on' : 'off'}, auto-mode=${output.platformCore.featureGates.transcriptClassifier ? 'on' : 'off'}, chicago-mcp=${output.platformCore.featureGates.chicagoMcp ? 'on' : 'off'}, voice=${output.platformCore.featureGates.voiceMode ? 'on' : 'off'}, daemon=${output.platformCore.featureGates.daemon ? 'on' : 'off'}\n`,
      )
    } else {
      process.stdout.write(jsonStringify(output, null, 2) + '\n')
    }
    process.exit(0)
  }
  const { source: authTokenSource, hasToken } = getAuthTokenSource()
  const { source: apiKeySource } = getMossenApiKeyWithSource()
  const hasApiKeyEnvVar =
    !!process.env.MOSSEN_CODE_API_KEY && !isRunningOnHomespace()
  const oauthAccount = getOauthAccountInfo()
  const subscriptionType = getSubscriptionType()
  const using3P = isUsing3PServices()
  const loggedIn =
    hasToken || apiKeySource !== 'none' || hasApiKeyEnvVar || using3P

  // Determine auth method
  let authMethod: string = 'none'
  if (using3P) {
    authMethod = 'third_party'
  } else if (authTokenSource === 'hosted') {
    authMethod = 'hosted'
  } else if (authTokenSource === 'apiKeyHelper') {
    authMethod = 'api_key_helper'
  } else if (authTokenSource !== 'none') {
    authMethod = 'oauth_token'
  } else if (apiKeySource === 'MOSSEN_CODE_API_KEY' || hasApiKeyEnvVar) {
    authMethod = 'api_key'
  } else if (apiKeySource === 'mossen managed key') {
    authMethod = 'hosted'
  }

  if (opts.text) {
    const properties = [
      ...buildAccountProperties(),
      ...buildAPIProviderProperties(),
    ]
    let hasAuthProperty = false
    for (const prop of properties) {
      const value =
        typeof prop.value === 'string'
          ? prop.value
          : Array.isArray(prop.value)
            ? prop.value.join(', ')
            : null
      if (value === null || value === 'none') {
        continue
      }
      hasAuthProperty = true
      if (prop.label) {
        process.stdout.write(`${prop.label}: ${value}\n`)
      } else {
        process.stdout.write(`${value}\n`)
      }
    }
    if (!hasAuthProperty && hasApiKeyEnvVar) {
      process.stdout.write('API key: MOSSEN_CODE_API_KEY\n')
    }
    if (!loggedIn) {
      process.stdout.write(
        'Not configured. Set MOSSEN_CODE_API_KEY or configure apiKeyHelper.\n',
      )
    }
  } else {
    const apiProvider = getAPIProvider()
    const resolvedApiKeySource =
      apiKeySource !== 'none'
        ? apiKeySource
        : hasApiKeyEnvVar
          ? 'MOSSEN_CODE_API_KEY'
          : null
    const output: Record<string, string | boolean | null> = {
      loggedIn,
      authMethod,
      apiProvider,
    }
    if (resolvedApiKeySource) {
      output.apiKeySource = resolvedApiKeySource
    }
    if (authMethod === 'hosted') {
      output.email = oauthAccount?.emailAddress ?? null
      output.orgId = oauthAccount?.organizationUuid ?? null
      output.orgName = oauthAccount?.organizationName ?? null
      output.subscriptionType = subscriptionType ?? null
    }

    process.stdout.write(jsonStringify(output, null, 2) + '\n')
  }
  process.exit(loggedIn ? 0 : 1)
}

export async function authLogout(): Promise<void> {
  if (isCustomBackendEnabled()) {
    process.stdout.write(
      'Custom backend mode does not keep a separate built-in account session.\n',
    )
    process.exit(0)
  }
  try {
    await performLogout({ clearOnboarding: false })
  } catch {
    process.stderr.write('Failed to log out.\n')
    process.exit(1)
  }
  process.stdout.write(
    'Successfully cleared local login state for the current backend.\n',
  )
  process.exit(0)
}
