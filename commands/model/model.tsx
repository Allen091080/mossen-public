/**
 * /model — 多 profile 列表 + 会话级切换 (S1-09f).
 *
 * 重写自旧 React picker (ModelPicker, sonnet/opus 静态列表). 新实现是 type='local'
 * 的纯文本输出, 走 services/config/profiles facade chain.
 *
 * 旧 src/components/ModelPicker.tsx 不再被本 command 引用; 如需删除留 S2 清理.
 */
import type { LocalCommandCall } from '../../types/command.js'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  createModelProfileAddPlan,
  createModelProfileDefaultPlan,
  createModelProfileRemovePlan,
  createModelProfileUpdatePlan,
  executeModelProfilePlan,
  MODEL_PROFILE_PLAN_TOKEN_TTL_MS,
  type ModelProfilePlanPreview,
  type ModelProfilePlanScope,
} from '../../services/config/profileSlashPlan.js'
import {
  createModelProfileKeychainImportPlan,
  createModelProfileKeychainMigrationPlan,
  executeModelProfileKeychainPlan,
  getModelProfileKeychainStatus,
  type ProfileKeychainPlanPreview,
} from '../../services/config/profileKeychain.js'
import {
  describeProfileCredential,
  desensitizeProfile,
  getCurrentProfile,
  getDefaultProfile,
  getProfileByName,
  listAllProfiles,
  PROFILE_PROVIDER_VALUES,
  resolveDefaultProfileProvider,
  setSessionActiveProfile,
  testProfile,
  testProfileChat,
  type ProfileProvider,
  type ProfileSchema,
} from '../../services/config/profiles.js'
import {
  discoverProfileModels,
  getListedProfileForModelDiscovery,
} from '../../services/config/profileModelDiscovery.js'
import { getModelDiscoveryCatalogHint } from '../../services/config/modelDiscoveryCatalog.js'
import { setMainLoopModelOverride } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import { t } from '../../utils/i18n/index.js'

const API_KEY_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const COMMON_MODEL_ENV_VARS = [
  'QWEN_API_KEY',
  'GLM_API_KEY',
  'MMX_API_KEY',
  'OPENAI_API_KEY',
] as const

type ModelEnvTemplate = {
  name: string
  displayName: string
  envName: (typeof COMMON_MODEL_ENV_VARS)[number]
  baseURL: string
  model: string
}

const MODEL_ENV_TEMPLATES: Record<string, ModelEnvTemplate> = {
  qwen: {
    name: 'qwen',
    displayName: 'Qwen / DashScope',
    envName: 'QWEN_API_KEY',
    baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
    model: 'qwen3.6-plus',
  },
  glm: {
    name: 'glm',
    displayName: 'GLM / Zhipu',
    envName: 'GLM_API_KEY',
    baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5.1',
  },
  minimax: {
    name: 'minimax',
    displayName: 'MiniMax / OpenAI-compatible',
    envName: 'MMX_API_KEY',
    baseURL: 'https://api.minimax.chat/v1',
    model: '<model-id>',
  },
  openai: {
    name: 'openai',
    displayName: 'OpenAI-compatible endpoint',
    envName: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
  },
}

function apiKeyEnvHelp(envName = '<ENV_NAME>'): string[] {
  return [
    `--apiKeyEnv expects an environment variable name, not the API key value.`,
    `Example: export ${envName}="your-real-api-key"`,
    `For new zsh terminals, persist it with: echo 'export ${envName}="your-real-api-key"' >> ~/.zprofile`,
    `For interactive zsh shells, also add it to ~/.zshrc if needed: touch ~/.zshrc && echo 'export ${envName}="your-real-api-key"' >> ~/.zshrc`,
    `Restart Mossen from a shell that can see ${envName}; exporting in a different terminal does not update an already-running Mossen process.`,
    `Then run: /model add <name> --baseURL <url> --model <id> --apiKeyEnv ${envName} --activate`,
  ]
}

function shellPersistenceStatus(envName: string): string {
  const home = os.homedir()
  const candidates = [
    { label: '~/.zprofile', file: path.join(home, '.zprofile') },
    { label: '~/.zshrc', file: path.join(home, '.zshrc') },
  ]
  const parts = candidates.map(candidate => {
    try {
      if (!fs.existsSync(candidate.file)) return `${candidate.label}: missing`
      const body = fs.readFileSync(candidate.file, 'utf8')
      return `${candidate.label}: ${body.includes(envName) ? 'mentions env' : 'no env mention'}`
    } catch {
      return `${candidate.label}: unreadable`
    }
  })
  return parts.join(', ')
}

function formatEnvStatusLines(): string[] {
  return COMMON_MODEL_ENV_VARS.map(envName => {
    const value = process.env[envName]
    return `  ${envName}: ${value && value.trim() ? '<set in current Mossen process>' : '<unset in current Mossen process>'} (${shellPersistenceStatus(envName)})`
  })
}

function formatEnvHelp(templateName?: string): string {
  const key = (templateName || '').toLowerCase()
  const template = key ? MODEL_ENV_TEMPLATES[key] : undefined
  const lines: string[] = []

  lines.push('Model API-key environment setup')
  lines.push('')
  lines.push('Current Mossen process sees:')
  lines.push(...formatEnvStatusLines())
  lines.push('')

  if (!template) {
    lines.push('Usage:')
    lines.push('  /model env qwen')
    lines.push('  /model env glm')
    lines.push('  /model env minimax')
    lines.push('  /model env openai')
    lines.push('')
    lines.push('This helper prints shell setup commands only. It never prints, stores, or validates your real API key.')
    return lines.join('\n')
  }

  lines.push(`${template.displayName}:`)
  lines.push(`  env var: ${template.envName}`)
  lines.push('')
  lines.push('For the current terminal:')
  lines.push(`  export ${template.envName}="your-real-api-key"`)
  lines.push('')
  lines.push('For future macOS zsh login terminals:')
  lines.push(`  echo 'export ${template.envName}="your-real-api-key"' >> ~/.zprofile`)
  lines.push('')
  lines.push('For interactive zsh shells:')
  lines.push('  touch ~/.zshrc')
  lines.push(`  echo 'export ${template.envName}="your-real-api-key"' >> ~/.zshrc`)
  lines.push('')
  lines.push('Important:')
  lines.push(`  - Restart Mossen from a shell where echo $${template.envName} works.`)
  lines.push('  - source ~/.zshrc only affects the current shell; it cannot update an already-running Mossen process.')
  lines.push('')
  lines.push('Then configure Mossen:')
  lines.push(`  /model add ${template.name} --baseURL ${template.baseURL} --model ${template.model} --apiKeyEnv ${template.envName} --activate`)
  lines.push('  /model add --confirm <token>')
  lines.push(`  /model test ${template.name}`)
  lines.push('')
  lines.push('If /model test returns 401/403, the key is visible but may not match the baseURL/model/provider permission.')
  lines.push(`Current persistence check: ${shellPersistenceStatus(template.envName)}`)
  return lines.join('\n')
}

function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim()
  return (
    /^(sk-|sk_|k-sp-|ghp_|gsk_|AIza|eyJ)/i.test(trimmed) ||
    (trimmed.length >= 32 && /[a-z]/i.test(trimmed) && /\d/.test(trimmed))
  )
}

function formatList(): string {
  const all = listAllProfiles()
  const current = getCurrentProfile()
  const defaultP = getDefaultProfile()
  const fallbackInList = all.some(item => item.source === 'fallback-env')

  if (all.length === 0) {
    return [
      'No model profiles configured.',
      '',
      'Mossen personal edition needs an OpenAI-compatible model profile before it can send LLM requests.',
      '',
      'Start here:',
      '  /model examples',
      '  /model add <name> --baseURL <url> --model <id> --apiKeyEnv <ENV> --activate',
      '',
      'Then confirm the printed token. The API key is masked in output and written only after confirm.',
    ].join('\n')
  }

  const lines: string[] = []
  lines.push(`Model profiles (${all.length}):`)
  lines.push('')
  for (const item of all) {
    const d = desensitizeProfile(item.profile)
    const tags: string[] = []
    if (current && current.name === item.name) tags.push('session')
    if (defaultP && defaultP.name === item.name) tags.push('default')
    if (item.source === 'fallback-env') tags.push('fallback')
    const tagStr = tags.length ? ` [${tags.join(', ')}]` : ''
    const displayName = d.name || item.name
    lines.push(`  ${item.name}${tagStr}`)
    lines.push(`    name:     ${displayName}`)
    lines.push(`    provider: ${d.provider}`)
    lines.push(`    model:    ${d.model}`)
    lines.push(`    baseURL:  ${d.baseURL}`)
    lines.push(`    maxInput: ${d.maxInputTokens ?? '<default>'}`)
    lines.push(`    apiKey:   ${d.apiKey}`)
    lines.push(`    credential: ${formatCredentialSource(d)}`)
    lines.push(`    source:   ${item.source === 'fallback-env' ? 'env (MOSSEN_CODE_CUSTOM_*)' : 'settings.json'}`)
    lines.push('')
  }

  if (current) {
    const suffix = current.source === 'fallback-env' ? ' (fallback)' : ''
    lines.push(`Current session profile: ${current.name}${suffix}`)
  } else {
    lines.push('Current session profile: <none>')
  }
  if (defaultP) {
    const suffix = defaultP.source === 'fallback-env' ? ' (fallback)' : ''
    lines.push(`Global default profile:  ${defaultP.name}${suffix}`)
  } else {
    lines.push('Global default profile:  <none>')
  }
  if (current && defaultP && current.name !== defaultP.name) {
    lines.push('')
    lines.push(`Session has been overridden — restart mossen to revert to "${defaultP.name}".`)
  }
  if (fallbackInList) {
    lines.push('')
    lines.push('Tip: this profile comes from legacy env (MOSSEN_CODE_CUSTOM_*).')
    lines.push('     Migrate it to ~/.mossen/settings.json so it lives alongside your other profiles:')
    lines.push('       mossen --migrate-fallback-profile')
  }
  lines.push('')
  lines.push('Usage:')
  lines.push('  /model <profileName>           Switch session profile (this conversation only)')
  lines.push('  /model add <name> --baseURL <url> --model <id> --apiKeyEnv <ENV> [--maxInputTokens <tokens>] [--activate]')
  lines.push('  /model update <name> [--baseURL <url>] [--model <id>] [--apiKeyEnv <ENV>] [--maxInputTokens <tokens|default>]')
  lines.push('  /model test <name>             Test /models reachability + a tiny chat probe')
  lines.push('  /model models [PROFILE] [--refresh]  Discover models available under current/profile')
  lines.push('  /model use PROFILE MODEL_ID      Use this profile with a different model for this session')
  lines.push('  /model keychain status         Show keychain credential references')
  lines.push('  /model examples                Show common OpenAI-compatible setup templates')
  lines.push('  /model env [qwen|glm|minimax|openai]  Show persistent API-key env setup')
  lines.push('  /model doctor                  Local read-only configuration check')
  lines.push('  /model remove <name>           Remove a configured profile (dry-run + confirm)')
  lines.push('  /model default <name>          Set global default (persists in ~/.mossen/settings.json)')
  return lines.join('\n')
}

function formatExamples(): string {
  return [
    'Model profile examples',
    '',
    'Qwen / DashScope:',
    '  export QWEN_API_KEY="your-dashscope-key"',
    '  /model add qwen --baseURL https://coding.dashscope.aliyuncs.com/v1 --model qwen3.6-plus --apiKeyEnv QWEN_API_KEY --activate',
    '',
    'GLM / Zhipu:',
    '  export GLM_API_KEY="your-bigmodel-key"',
    '  /model add glm --baseURL https://open.bigmodel.cn/api/coding/paas/v4 --model glm-5.1 --apiKeyEnv GLM_API_KEY --activate',
    '',
    'MiniMax / OpenAI-compatible:',
    '  export MMX_API_KEY="your-minimax-key"',
    '  /model add minimax --baseURL https://api.minimax.chat/v1 --model <model-id> --apiKeyEnv MMX_API_KEY --activate',
    '',
    'OpenAI-compatible endpoint:',
    '  export OPENAI_API_KEY="your-openai-key"',
    '  /model add openai --baseURL https://api.openai.com/v1 --model gpt-4.1 --apiKeyEnv OPENAI_API_KEY --activate',
    '',
    'After adding:',
    '  /model add --confirm <token>',
    '  /model test <name>',
    '  /model <name>',
    '',
    'Persistent zsh setup helpers:',
    '  /model env qwen',
    '  /model env glm',
    '  /model env minimax',
    '',
    'Notes:',
    '  - Mossen currently stores OpenAI-compatible profiles.',
    '  - --apiKeyEnv takes a variable name such as QWEN_API_KEY, not the key value.',
    '  - Prefer --apiKeyEnv so the key is not typed into the slash command.',
    '  - Add exports to ~/.zshrc or ~/.zprofile if you need them in new terminals.',
    '  - Use /model doctor for a local read-only configuration check.',
  ].join('\n')
}

function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function modelGatewayHints(profile: Pick<ProfileSchema, 'baseURL' | 'model'>): string[] {
  const baseURL = profile.baseURL.trim()
  const model = profile.model.trim().toLowerCase()
  const lowerBase = baseURL.toLowerCase().replace(/\/+$/, '')
  const hints: string[] = []

  if (lowerBase.includes('dashscope.aliyuncs.com') && !lowerBase.endsWith('/v1')) {
    hints.push('DashScope coding endpoint usually ends with /v1: https://coding.dashscope.aliyuncs.com/v1')
  }
  if (lowerBase.includes('bigmodel.cn') && !lowerBase.endsWith('/api/coding/paas/v4')) {
    hints.push('GLM coding endpoint usually ends with /api/coding/paas/v4: https://open.bigmodel.cn/api/coding/paas/v4')
  }
  if (model.startsWith('qwen') && !lowerBase.includes('dashscope.aliyuncs.com')) {
    hints.push('Model id looks like Qwen; confirm the baseURL belongs to DashScope or the provider that issued the key.')
  }
  if (model.startsWith('glm') && !lowerBase.includes('bigmodel.cn')) {
    hints.push('Model id looks like GLM; confirm the baseURL belongs to BigModel/Zhipu or the provider that issued the key.')
  }
  if (model.includes('minimax') && !lowerBase.includes('minimax')) {
    hints.push('Model id looks like MiniMax; confirm the baseURL belongs to MiniMax or your compatible proxy.')
  }

  return hints
}

function classifyModelTestResult(result: Awaited<ReturnType<typeof testProfile>>): string {
  if (!result.ok) return 'network-error'
  if (result.status === 401 || result.status === 403) return 'auth-or-permission'
  if (result.status === 404) return 'not-found-or-wrong-base-url'
  if (result.status === 408 || result.status === 504) return 'timeout-or-upstream-timeout'
  if (result.status === 429) return 'rate-limited'
  if (result.status >= 500) return 'provider-server-error'
  if (result.status >= 400) return 'provider-client-error'
  return 'reachable'
}

function classifyModelChatTestResult(result: Awaited<ReturnType<typeof testProfileChat>>): string {
  if (result.ok) return 'chat-ok'
  if (result.status === 0) return 'network-error'
  if (result.providerErrorKind === 'gateway-or-waf-block') return 'chat-gateway-or-waf-block'
  if (result.providerErrorKind === 'model-unsupported') return 'chat-model-unsupported'
  if (result.providerErrorKind === 'payload-rejected') return 'chat-payload-rejected'
  if (result.status === 401 || result.status === 403) return 'chat-auth-or-permission'
  if (result.status === 404) return 'chat-not-found-or-wrong-base-url'
  if (result.status === 408 || result.status === 504) return 'chat-timeout-or-upstream-timeout'
  if (result.status === 429) return 'chat-rate-limited'
  if (result.status >= 500) return 'chat-provider-server-error'
  if (result.status >= 400) return 'chat-provider-client-error'
  return 'chat-unexpected'
}

function formatDoctor(): string {
  const all = listAllProfiles()
  const current = getCurrentProfile()
  const defaultP = getDefaultProfile()
  const lines: string[] = []
  const issues: string[] = []

  lines.push('Model doctor (read-only)')
  lines.push('')
  lines.push(`Profiles visible: ${all.length}`)
  lines.push(`Current session:  ${current ? `${current.name} (${current.source})` : '<none>'}`)
  lines.push(`Default profile:  ${defaultP ? `${defaultP.name} (${defaultP.source})` : '<none>'}`)
  lines.push(`Legacy env baseURL: ${process.env.MOSSEN_CODE_CUSTOM_BASE_URL ? '<set>' : '<unset>'}`)
  lines.push(`Legacy env api key: ${process.env.MOSSEN_CODE_CUSTOM_API_KEY ? '<set>' : '<unset>'}`)
  lines.push('Common provider env vars:')
  lines.push(...formatEnvStatusLines())
  lines.push('')

  if (all.length === 0) {
    issues.push('No model profiles are configured.')
  }
  if (!current) {
    issues.push('No current session profile is available.')
  }
  if (!defaultP) {
    issues.push('No persisted default profile is available.')
  }

  for (const item of all) {
    const d = desensitizeProfile(item.profile)
    lines.push(`- ${item.name}${item.source === 'fallback-env' ? ' (fallback env)' : ''}`)
    lines.push(`    provider: ${d.provider}`)
    lines.push(`    model:    ${d.model || '<empty>'}`)
    lines.push(`    baseURL:  ${d.baseURL || '<empty>'}`)
    lines.push(`    apiKey:   ${d.apiKey ? '<configured>' : '<empty>'}`)
    lines.push(`    credential: ${formatCredentialSource(d)}`)
    lines.push(`    source:   ${item.source === 'fallback-env' ? 'env (MOSSEN_CODE_CUSTOM_*)' : 'settings.json'}`)

    if (!d.model) issues.push(`${item.name}: model is empty.`)
    if (!d.baseURL) {
      issues.push(`${item.name}: baseURL is empty.`)
    } else if (!looksLikeUrl(d.baseURL)) {
      issues.push(`${item.name}: baseURL does not look like an http(s) URL.`)
    }
    if (!d.apiKey) issues.push(`${item.name}: apiKey is empty.`)
    const gatewayHints = modelGatewayHints(item.profile)
    if (gatewayHints.length > 0) {
      lines.push('    gateway hints:')
      for (const hint of gatewayHints) {
        lines.push(`      - ${hint}`)
        issues.push(`${item.name}: ${hint}`)
      }
    }
  }

  lines.push('')
  if (issues.length === 0) {
    lines.push('Result: OK — local profile metadata looks usable.')
    lines.push('Next: run /model test <name> to verify network reachability.')
    lines.push('If the model later returns 401/403, check that baseURL, API key, and model id all belong to the same provider account.')
  } else {
    lines.push(`Result: ${issues.length} issue(s) found.`)
    for (const issue of issues) {
      lines.push(`  - ${issue}`)
    }
    lines.push('')
    lines.push('Suggested next steps:')
    if (all.length === 0) {
      lines.push('  /model examples')
      lines.push('  /model env qwen')
      lines.push('  /model add <name> --baseURL <url> --model <id> --apiKeyEnv <ENV> --activate')
      lines.push('  export <ENV>="your-real-api-key"')
    } else {
      lines.push('  /model update <name> ...')
      lines.push('  /model default <name>')
      lines.push('  /model test <name>')
    }
  }
  return lines.join('\n')
}

function formatSwitchResult(
  name: string,
  setAppState?: (f: (prev: AppState) => AppState) => void,
): string {
  try {
    const result = setSessionActiveProfile(name)
    // S1-09 闭环修复 (3 层全部要打):
    // 1) setSessionActiveProfile 已写 runtime override (services/config) — customBackend.ts getter 立即看到新 baseURL/apiKey/model
    // 2) setMainLoopModelOverride — bootstrap/state.ts STATE.mainLoopModelOverride, getMainLoopModel() 读它 (server/API 路径)
    // 3) setAppState mainLoopModelForSession — React AppState, useMainLoopModel hook 读它 (statusline/UI 路径)
    // 漏一个: 三处状态不一致 → /model glm 显示切换但请求/UI 仍 qwen.
    // setAppState 在真 REPL context 一定有; harness/SDK headless 可能无, 容错跳过.
    setMainLoopModelOverride(result.profile.model)
    if (typeof setAppState === 'function') {
      setAppState(prev => ({
        ...prev,
        mainLoopModelForSession: result.profile.model,
      }))
    }
    const desensitized = desensitizeProfile(result.profile)
    const defaultP = getDefaultProfile()
    const lines: string[] = []
    const sourceLabel = result.source === 'fallback-env' ? ' (fallback)' : ''
    lines.push(`Switched session profile to "${result.activeProfile}"${sourceLabel}.`)
    lines.push(`  name:     ${desensitized.name || result.activeProfile}`)
    lines.push(`  provider: ${desensitized.provider}`)
    lines.push(`  model:    ${desensitized.model}`)
    lines.push(`  baseURL:  ${desensitized.baseURL}`)
    lines.push(`  apiKey:   ${desensitized.apiKey}`)
    lines.push(`  credential: ${formatCredentialSource(desensitized)}`)
    lines.push(`  source:   ${result.source === 'fallback-env' ? 'env (MOSSEN_CODE_CUSTOM_*)' : 'settings.json'}`)
    lines.push('')
    lines.push('Note: this only affects the current session.')
    if (defaultP && defaultP.name !== result.activeProfile) {
      const defaultSuffix = defaultP.source === 'fallback-env' ? ' (fallback)' : ''
      lines.push(`Global default profile remains "${defaultP.name}"${defaultSuffix}. Restart mossen to revert.`)
    } else if (!defaultP) {
      lines.push('No global default profile set. Use `/model default <name>` to persist.')
    }
    return lines.join('\n')
  } catch (e) {
    const msg = (e as Error).message || String(e)
    const all = listAllProfiles()
    const existing = all.map(item => item.source === 'fallback-env' ? `${item.name} (fallback)` : item.name)
    const lines: string[] = []
    lines.push(`Cannot switch to profile "${name}": ${msg}`)
    lines.push('')
    if (existing.length === 0) {
      lines.push('No profiles configured. Create one with:')
      lines.push('  /model examples')
      lines.push('  /model add <name> --baseURL <url> --model <id> --apiKeyEnv <ENV> --activate')
    } else {
      lines.push(`Available profiles: ${existing.join(', ')}`)
      lines.push('')
      lines.push('To list details: /model')
      lines.push('To see examples: /model examples')
      lines.push('To create new:   /model add <name> --baseURL <url> --model <id> --apiKeyEnv <ENV>')
    }
    return lines.join('\n')
  }
}

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const ch of input) {
    if (escaping) {
      current += ch
      escaping = false
      continue
    }
    if (ch === '\\') {
      escaping = true
      continue
    }
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (escaping) current += '\\'
  if (current) tokens.push(current)
  return tokens
}

function readFlagValue(tokens: readonly string[], flag: string): string | undefined {
  const idx = tokens.indexOf(flag)
  if (idx === -1) return undefined
  const next = tokens[idx + 1]
  if (!next || next.startsWith('--')) return undefined
  return next
}

function parseScope(tokens: readonly string[]): ModelProfilePlanScope {
  const scope = readFlagValue(tokens, '--scope')
  return scope === 'project' ? 'project' : 'user'
}

function readMaxInputTokensInput(
  tokens: readonly string[],
): { ok: true; value?: number | null; present: boolean } | { ok: false; reason: string } {
  const raw =
    readFlagValue(tokens, '--maxInputTokens') ||
    readFlagValue(tokens, '--max-input-tokens')
  if (raw === undefined) {
    return { ok: true, present: false }
  }
  const normalized = raw.trim().toLowerCase()
  if (['default', 'none', 'off', 'clear'].includes(normalized)) {
    return { ok: true, present: true, value: null }
  }
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    return {
      ok: false,
      reason:
        '--maxInputTokens must be a positive integer, or one of default|none|off|clear.',
    }
  }
  return { ok: true, present: true, value: Number.parseInt(normalized, 10) }
}

function readApiKeyInput(tokens: readonly string[]): { ok: true; apiKey?: string; source?: string } | { ok: false; reason: string } {
  const raw = readFlagValue(tokens, '--apiKey') || readFlagValue(tokens, '--api-key')
  const envName = readFlagValue(tokens, '--apiKeyEnv') || readFlagValue(tokens, '--api-key-env')
  if (raw && envName) {
    return { ok: false, reason: 'Use only one of --apiKey or --apiKeyEnv.' }
  }
  if (raw) {
    return { ok: true, apiKey: raw, source: '--apiKey' }
  }
  if (!envName) {
    return { ok: true }
  }
  if (!API_KEY_ENV_NAME_PATTERN.test(envName)) {
    const suggested = looksLikeSecretValue(envName) ? 'QWEN_API_KEY' : '<ENV_NAME>'
    return {
      ok: false,
      reason: [
        `--apiKeyEnv must be an environment variable name, got "${envName}".`,
        '',
        ...apiKeyEnvHelp(suggested),
        '',
        'If you intentionally want to type the key directly, use --apiKey instead, but --apiKeyEnv is safer.',
      ].join('\n'),
    }
  }
  const value = process.env[envName]?.trim()
  if (!value) {
    return {
      ok: false,
      reason: [
        `Environment variable ${envName} is not set or empty in this Mossen process.`,
        '',
        `For this terminal: export ${envName}="your-real-api-key"`,
        `For future macOS zsh login terminals: echo 'export ${envName}="your-real-api-key"' >> ~/.zprofile`,
        `For interactive zsh shells: touch ~/.zshrc && echo 'export ${envName}="your-real-api-key"' >> ~/.zshrc`,
        `Restart Mossen from a shell that can see ${envName}.`,
        `Check with: echo $${envName}`,
      ].join('\n'),
    }
  }
  return { ok: true, apiKey: value, source: `env:${envName}` }
}

function ttlMinutes(): number {
  return Math.floor(MODEL_PROFILE_PLAN_TOKEN_TTL_MS / 60_000)
}

function formatProfileLines(profile: Pick<ProfileSchema, 'provider' | 'model' | 'baseURL' | 'apiKey' | 'name' | 'maxInputTokens'>, fallbackName = '<profile name>'): string[] {
  return [
    `    name:     ${profile.name || fallbackName}`,
    `    provider: ${profile.provider}`,
    `    model:    ${profile.model}`,
    `    baseURL:  ${profile.baseURL}`,
    `    maxInput: ${profile.maxInputTokens ?? '<default>'}`,
    `    apiKey:   ${profile.apiKey || '<not stored in plaintext>'}`,
  ]
}

function formatCredentialSource(profile: ProfileSchema | { credentialSource?: string }): string {
  if ('credentialSource' in profile && profile.credentialSource) {
    return profile.credentialSource
  }
  return describeProfileCredential(profile as ProfileSchema).source
}

function formatPlan(plan: ModelProfilePlanPreview): string {
  const lines: string[] = []
  if (plan.kind === 'add') {
    lines.push('Model add dry-run')
    lines.push('')
    lines.push(`Profile: ${plan.name}`)
    lines.push(...formatProfileLines(plan.profile, plan.name))
    lines.push(`    credential: ${formatCredentialSource(plan.profile)}`)
    lines.push(`    scope:    ${plan.scope}`)
    lines.push(`    activate: ${plan.activate ? 'yes (persist default + switch current session after confirm)' : 'no'}`)
    lines.push('')
    lines.push('No file has been modified yet. The API key is masked in this preview and will be written to settings.json only after confirm.')
    lines.push(`Within ${ttlMinutes()} minutes, run:`)
    lines.push(`  /model add --confirm ${plan.token}`)
    return lines.join('\n')
  }

  if (plan.kind === 'remove') {
    lines.push('Model remove dry-run')
    lines.push('')
    lines.push(`Profile: ${plan.name}`)
    lines.push(...formatProfileLines(plan.profile, plan.name))
    lines.push(`    credential: ${formatCredentialSource(plan.profile)}`)
    lines.push(`    scope:    ${plan.scope}`)
    if (plan.wasCurrentProfile) {
      lines.push('')
      lines.push('Warning: this is the current session profile. Confirming will remove it from settings and clear the session override.')
    }
    lines.push('')
    lines.push('No file has been modified yet.')
    lines.push(`Within ${ttlMinutes()} minutes, run:`)
    lines.push(`  /model remove --confirm ${plan.token}`)
    return lines.join('\n')
  }

  if (plan.kind === 'update') {
    lines.push('Model update dry-run')
    lines.push('')
    lines.push(`Profile: ${plan.name}`)
    lines.push('  before:')
    lines.push(...formatProfileLines(plan.before, plan.name))
    lines.push(`    credential: ${formatCredentialSource(plan.before)}`)
    lines.push('  after:')
    lines.push(...formatProfileLines(plan.profile, plan.name))
    lines.push(`    credential: ${formatCredentialSource(plan.profile)}`)
    lines.push(`    scope:    ${plan.scope}`)
    if (plan.wasCurrentProfile) {
      lines.push('')
      lines.push('Note: this is the current session profile. Confirming will apply the updated model to this session.')
    }
    lines.push('')
    lines.push('No file has been modified yet.')
    lines.push(`Within ${ttlMinutes()} minutes, run:`)
    lines.push(`  /model update --confirm ${plan.token}`)
    return lines.join('\n')
  }

  lines.push('Model default dry-run')
  lines.push('')
  lines.push(`Profile: ${plan.name}`)
  lines.push(...formatProfileLines(plan.profile, plan.name))
  lines.push(`    credential: ${formatCredentialSource(plan.profile)}`)
  lines.push(`    scope:    ${plan.scope}`)
  lines.push('')
  lines.push('No file has been modified yet. Confirming will persist this profile as the default and switch the current session to it.')
  lines.push(`Within ${ttlMinutes()} minutes, run:`)
  lines.push(`  /model default --confirm ${plan.token}`)
  return lines.join('\n')
}

function applySessionProfile(
  profile: { model: string } | null,
  setAppState?: (f: (prev: AppState) => AppState) => void,
): void {
  setMainLoopModelOverride(profile?.model ?? null)
  if (typeof setAppState === 'function') {
    setAppState(prev => ({
      ...prev,
      mainLoopModelForSession: profile?.model ?? null,
    }))
  }
}

function formatExecuteResult(
  token: string | undefined,
  setAppState?: (f: (prev: AppState) => AppState) => void,
): string {
  if (!token) {
    return 'Missing confirmation token. Re-run the dry-run command and then use the printed --confirm token.'
  }
  const result = executeModelProfilePlan(token)
  if (result.ok === false) {
    return [
      `Cannot apply model profile plan: ${result.reason}`,
      '',
      'Re-run the matching dry-run command to mint a fresh token.',
    ].join('\n')
  }

  if (result.kind === 'add') {
    if (result.activeProfileSet) {
      applySessionProfile(result.rawProfile, setAppState)
    }
    return [
      `Added model profile "${result.name}".`,
      ...formatProfileLines(result.profile, result.name),
      `    credential: ${formatCredentialSource(result.profile)}`,
      `    scope:    ${result.scope}`,
      '',
      result.activeProfileSet
        ? 'It is now the persisted default and current session profile.'
        : `To use it now: /model ${result.name}`,
    ].join('\n')
  }

  if (result.kind === 'remove') {
    if (result.removedWasCurrentProfile) {
      applySessionProfile(result.nextCurrentProfile?.rawProfile ?? null, setAppState)
    }
    const lines: string[] = []
    lines.push(`Removed model profile "${result.name}".`)
    lines.push(...formatProfileLines(result.removedProfile, result.name))
    lines.push(`    credential: ${formatCredentialSource(result.removedProfile)}`)
    lines.push(`    scope:    ${result.scope}`)
    if (result.activeProfileCleared) {
      lines.push('Its persisted default pointer was cleared.')
    }
    if (result.removedWasCurrentProfile) {
      lines.push('')
      if (result.nextCurrentProfile) {
        lines.push(`Current session fell back to "${result.nextCurrentProfile.name}".`)
      } else {
        lines.push('Current session model override was cleared. Configure another profile before sending model requests.')
      }
    }
    return lines.join('\n')
  }

  if (result.kind === 'update') {
    if (result.updatedWasCurrentProfile) {
      applySessionProfile(result.rawProfile, setAppState)
    }
    const lines: string[] = []
    lines.push(`Updated model profile "${result.name}".`)
    lines.push('  before:')
    lines.push(...formatProfileLines(result.before, result.name))
    lines.push(`    credential: ${formatCredentialSource(result.before)}`)
    lines.push('  after:')
    lines.push(...formatProfileLines(result.profile, result.name))
    lines.push(`    credential: ${formatCredentialSource(result.profile)}`)
    lines.push(`    scope:    ${result.scope}`)
    if (result.updatedWasCurrentProfile) {
      lines.push('')
      lines.push('The updated model is active for the current session.')
    }
    return lines.join('\n')
  }

  applySessionProfile(result.rawProfile, setAppState)
  return [
    `Set default model profile to "${result.name}".`,
    ...formatProfileLines(result.profile, result.name),
    `    credential: ${formatCredentialSource(result.profile)}`,
    `    scope:    ${result.scope}`,
    '',
    'It is also active for the current session.',
  ].join('\n')
}

function formatKeychainPlan(plan: ProfileKeychainPlanPreview): string {
  const lines: string[] = []
  lines.push(plan.kind === 'import' ? 'Model keychain import dry-run' : 'Model keychain migration dry-run')
  lines.push('')
  lines.push(`Profiles: ${plan.entries.length}`)
  for (const entry of plan.entries) {
    lines.push(`- ${entry.name}`)
    lines.push(`    ref:      ${entry.ref.provider}:${entry.ref.service}:${entry.ref.account}`)
    lines.push(`    apiKey:   ${entry.profile.apiKey}`)
    lines.push('    note:     plaintext apiKey is kept for compatibility; confirm only adds apiKeyRef + keychain copy.')
  }
  lines.push('')
  lines.push('No settings file or keychain entry has been modified yet.')
  lines.push(`Within ${ttlMinutes()} minutes, run:`)
  lines.push(`  /model keychain ${plan.kind} --confirm ${plan.token}`)
  return lines.join('\n')
}

function formatKeychainExecute(token: string | undefined): string {
  if (!token) {
    return 'Missing confirmation token. Re-run the keychain dry-run command and use the printed --confirm token.'
  }
  const result = executeModelProfileKeychainPlan(token)
  if (result.ok === false) {
    return [
      `Cannot apply model keychain plan: ${result.reason}`,
      '',
      'Re-run the matching dry-run command to mint a fresh token.',
    ].join('\n')
  }
  const lines: string[] = []
  lines.push(result.kind === 'import' ? 'Model keychain import applied.' : 'Model keychain migration applied.')
  lines.push(`Scope: ${result.scope}`)
  lines.push('')
  for (const entry of result.entries) {
    lines.push(`- ${entry.name}`)
    lines.push(`    ref:      ${entry.ref.provider}:${entry.ref.service}:${entry.ref.account}`)
    lines.push(`    apiKey:   ${entry.profile.apiKey}`)
    lines.push(`    source:   ${formatCredentialSource(entry.profile)}`)
  }
  lines.push('')
  lines.push('Plaintext apiKey values were not deleted; remove them manually only after a successful real request if you want file-at-rest reduction.')
  return lines.join('\n')
}

function formatKeychain(tokens: readonly string[]): string {
  const action = tokens[1]
  if (!action || action === 'status') {
    const status = getModelProfileKeychainStatus()
    const lines: string[] = []
    lines.push('Model profile keychain status')
    lines.push('')
    lines.push(`macOS keychain available: ${status.available ? 'yes' : 'no (plaintext/env fallback still works)'}`)
    lines.push(`Profiles: ${status.profiles.length}`)
    for (const profile of status.profiles) {
      lines.push(`- ${profile.name}`)
      lines.push(`    plaintext apiKey: ${profile.hasPlaintextApiKey ? 'yes' : 'no'}`)
      lines.push(`    apiKeyRef:        ${profile.hasApiKeyRef ? profile.keychainRef ?? 'yes' : 'no'}`)
      lines.push(`    credential:       ${profile.credentialSource}`)
    }
    if (status.profiles.length === 0) {
      lines.push('No settings profiles found.')
    }
    lines.push('')
    lines.push('Usage:')
    lines.push('  /model keychain import <profile>')
    lines.push('  /model keychain migrate --dry-run')
    lines.push('  /model keychain migrate --confirm <token>')
    return lines.join('\n')
  }

  if (action === 'import') {
    const confirmToken = readFlagValue(tokens, '--confirm')
    if (confirmToken !== undefined) return formatKeychainExecute(confirmToken)
    const name = tokens[2]
    if (!name || name.startsWith('--')) {
      return 'Usage: /model keychain import <profile> [--scope user|project]'
    }
    const planned = createModelProfileKeychainImportPlan({ name, scope: parseScope(tokens) })
    if (planned.ok === false) return `Cannot create keychain import plan: ${planned.reason}`
    return formatKeychainPlan(planned.plan)
  }

  if (action === 'migrate') {
    const confirmToken = readFlagValue(tokens, '--confirm')
    if (confirmToken !== undefined) return formatKeychainExecute(confirmToken)
    if (!tokens.includes('--dry-run')) {
      return 'Usage: /model keychain migrate --dry-run [--scope user|project]'
    }
    const planned = createModelProfileKeychainMigrationPlan({ scope: parseScope(tokens) })
    if (planned.ok === false) return `Cannot create keychain migration plan: ${planned.reason}`
    return formatKeychainPlan(planned.plan)
  }

  return [
    `Unknown keychain action "${action}".`,
    '',
    'Usage:',
    '  /model keychain status',
    '  /model keychain import <profile>',
    '  /model keychain migrate --dry-run',
    '  /model keychain migrate --confirm <token>',
  ].join('\n')
}

function formatAdd(
  tokens: readonly string[],
  setAppState?: (f: (prev: AppState) => AppState) => void,
): string {
  const confirmToken = readFlagValue(tokens, '--confirm')
  if (confirmToken !== undefined) {
    return formatExecuteResult(confirmToken, setAppState)
  }

  const name = tokens[1]
  if (!name || name.startsWith('--')) {
    return [
      'Usage:',
      '  /model add <name> --baseURL <url> --model <id> --apiKeyEnv <ENV> [--provider openai-compatible|messages-compatible] [--maxInputTokens <tokens>] [--name <display>] [--scope user|project] [--activate]',
      '',
      'Example:',
      '  export QWEN_API_KEY="your-real-api-key"',
      '  /model add qwen --baseURL https://coding.dashscope.aliyuncs.com/v1 --model qwen3.6-plus --apiKeyEnv QWEN_API_KEY --activate',
      '',
      ...apiKeyEnvHelp('QWEN_API_KEY'),
    ].join('\n')
  }
  const baseURL = readFlagValue(tokens, '--baseURL') || readFlagValue(tokens, '--baseUrl')
  const provider = (
    readFlagValue(tokens, '--provider') || resolveDefaultProfileProvider(baseURL)
  ) as ProfileProvider
  if (!(PROFILE_PROVIDER_VALUES as readonly string[]).includes(provider)) {
    return `--provider must be one of ${PROFILE_PROVIDER_VALUES.join('|')}, got "${provider}"`
  }
  const model = readFlagValue(tokens, '--model')
  const apiKeyInput = readApiKeyInput(tokens)
  if (apiKeyInput.ok === false) return apiKeyInput.reason
  const maxInputTokensInput = readMaxInputTokensInput(tokens)
  if (maxInputTokensInput.ok === false) return maxInputTokensInput.reason
  const apiKey = apiKeyInput.apiKey
  const displayName = readFlagValue(tokens, '--name')
  const missing: string[] = []
  if (!baseURL) missing.push('--baseURL')
  if (!model) missing.push('--model')
  if (!apiKey) missing.push('--apiKey or --apiKeyEnv')
  if (missing.length) {
    return `Missing required flags for /model add: ${missing.join(', ')}`
  }

  const planned = createModelProfileAddPlan({
    name,
    provider,
    baseURL: baseURL!,
    model: model!,
    apiKey: apiKey!,
    ...(maxInputTokensInput.value
      ? { maxInputTokens: maxInputTokensInput.value }
      : {}),
    ...(displayName ? { displayName } : {}),
    scope: parseScope(tokens),
    activate: tokens.includes('--activate'),
  })
  if (planned.ok === false) {
    return `Cannot create model add plan: ${planned.reason}`
  }
  return formatPlan(planned.plan)
}

function formatUpdate(
  tokens: readonly string[],
  setAppState?: (f: (prev: AppState) => AppState) => void,
): string {
  const confirmToken = readFlagValue(tokens, '--confirm')
  if (confirmToken !== undefined) {
    return formatExecuteResult(confirmToken, setAppState)
  }

  const name = tokens[1]
  if (!name || name.startsWith('--')) {
    return [
      'Usage:',
      '  /model update <name> [--baseURL <url>] [--model <id>] [--apiKey <key> | --apiKeyEnv <ENV>] [--maxInputTokens <tokens|default>] [--name <display>] [--scope user|project]',
      '',
      'Example:',
      '  /model update qwen --model qwen3.6-plus --apiKeyEnv DASHSCOPE_API_KEY',
    ].join('\n')
  }
  const providerRaw = readFlagValue(tokens, '--provider')
  const provider = providerRaw as ProfileProvider | undefined
  if (provider && !(PROFILE_PROVIDER_VALUES as readonly string[]).includes(provider)) {
    return `--provider must be one of ${PROFILE_PROVIDER_VALUES.join('|')}, got "${provider}"`
  }
  const apiKeyInput = readApiKeyInput(tokens)
  if (apiKeyInput.ok === false) return apiKeyInput.reason
  const maxInputTokensInput = readMaxInputTokensInput(tokens)
  if (maxInputTokensInput.ok === false) return maxInputTokensInput.reason
  const hasAnyUpdate =
    provider !== undefined ||
    readFlagValue(tokens, '--baseURL') !== undefined ||
    readFlagValue(tokens, '--baseUrl') !== undefined ||
    readFlagValue(tokens, '--model') !== undefined ||
    apiKeyInput.apiKey !== undefined ||
    readFlagValue(tokens, '--name') !== undefined ||
    maxInputTokensInput.present
  if (!hasAnyUpdate) {
    return 'Nothing to update. Provide at least one of --baseURL, --model, --apiKey, --apiKeyEnv, --name, --maxInputTokens, or --provider.'
  }

  const planned = createModelProfileUpdatePlan({
    name,
    ...(provider ? { provider } : {}),
    ...(readFlagValue(tokens, '--baseURL') || readFlagValue(tokens, '--baseUrl')
      ? { baseURL: (readFlagValue(tokens, '--baseURL') || readFlagValue(tokens, '--baseUrl'))! }
      : {}),
    ...(readFlagValue(tokens, '--model') ? { model: readFlagValue(tokens, '--model')! } : {}),
    ...(apiKeyInput.apiKey ? { apiKey: apiKeyInput.apiKey } : {}),
    ...(maxInputTokensInput.present
      ? { maxInputTokens: maxInputTokensInput.value ?? null }
      : {}),
    ...(readFlagValue(tokens, '--name') ? { displayName: readFlagValue(tokens, '--name')! } : {}),
    scope: parseScope(tokens),
  })
  if (planned.ok === false) {
    return `Cannot create model update plan: ${planned.reason}`
  }
  return formatPlan(planned.plan)
}

function formatRemove(
  tokens: readonly string[],
  setAppState?: (f: (prev: AppState) => AppState) => void,
): string {
  const confirmToken = readFlagValue(tokens, '--confirm')
  if (confirmToken !== undefined) {
    return formatExecuteResult(confirmToken, setAppState)
  }
  const name = tokens[1]
  if (!name || name.startsWith('--')) {
    return 'Usage: /model remove <name> [--scope user|project]'
  }
  const planned = createModelProfileRemovePlan({
    name,
    scope: parseScope(tokens),
  })
  if (planned.ok === false) {
    return `Cannot create model remove plan: ${planned.reason}`
  }
  return formatPlan(planned.plan)
}

function formatDefault(
  tokens: readonly string[],
  setAppState?: (f: (prev: AppState) => AppState) => void,
): string {
  const confirmToken = readFlagValue(tokens, '--confirm')
  if (confirmToken !== undefined) {
    return formatExecuteResult(confirmToken, setAppState)
  }
  const name = tokens[1]
  if (!name || name.startsWith('--')) {
    return 'Usage: /model default <name> [--scope user|project]'
  }
  const planned = createModelProfileDefaultPlan({
    name,
    scope: parseScope(tokens),
  })
  if (planned.ok === false) {
    return `Cannot create model default plan: ${planned.reason}`
  }
  return formatPlan(planned.plan)
}

async function formatTest(tokens: readonly string[]): Promise<string> {
  const name = tokens[1]
  if (!name || name.startsWith('--')) {
    return 'Usage: /model test <name> [--timeout <ms>] [--no-chat]'
  }
  const profile = getProfileByName(name)
  if (!profile) {
    return `Cannot test profile "${name}": not found in settings profiles.`
  }
  const timeoutRaw = readFlagValue(tokens, '--timeout')
  const skipChat = tokens.includes('--no-chat')
  const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined
  if (timeoutRaw && (!Number.isFinite(timeoutMs) || (timeoutMs ?? 0) <= 0)) {
    return `--timeout must be a positive integer in milliseconds, got "${timeoutRaw}".`
  }
  const result = await testProfile(profile, timeoutMs ? { timeoutMs } : undefined)
  const chatResult = skipChat
    ? null
    : await testProfileChat(profile, timeoutMs ? { timeoutMs } : undefined)
  const d = desensitizeProfile(profile)
  const diagnosis = classifyModelTestResult(result)
  const chatDiagnosis = chatResult ? classifyModelChatTestResult(chatResult) : 'skipped'
  const lines: string[] = []
  lines.push(`Model profile test: ${name}`)
  lines.push(...formatProfileLines(d, name))
  lines.push('    models endpoint:')
  lines.push(`      url:       ${result.url}`)
  lines.push(`      status:    ${result.status}`)
  lines.push(`      duration:  ${result.durationMs} ms`)
  lines.push(`      diagnosis: ${diagnosis}`)
  lines.push('    chat probe:')
  if (chatResult) {
    lines.push(`      url:       ${chatResult.url}`)
    lines.push(`      status:    ${chatResult.status}`)
    lines.push(`      duration:  ${chatResult.durationMs} ms`)
    lines.push(`      diagnosis: ${chatDiagnosis}`)
    if (chatResult.providerMessage) {
      lines.push(`      provider:  ${chatResult.providerMessage}`)
    }
    if (chatResult.error) {
      lines.push(`      error:     ${chatResult.error}`)
    }
  } else {
    lines.push('      skipped by --no-chat')
  }
  const gatewayHints = modelGatewayHints(profile)
  if (gatewayHints.length > 0) {
    lines.push('    gateway hints:')
    for (const hint of gatewayHints) {
      lines.push(`      - ${hint}`)
    }
  }
  lines.push('')
  if (chatResult && chatResult.ok) {
    lines.push('Chat: ok. The configured model accepted a minimal non-streaming chat request.')
    if (result.ok && result.status >= 400) {
      lines.push('Note: GET /models is not fully successful, but chat works; this provider may not expose /models consistently.')
    }
  } else if (chatResult && !chatResult.ok) {
    lines.push('Chat: failed. This is the path normal conversations use, so fix this before chatting.')
    if (chatResult.providerErrorKind === 'gateway-or-waf-block') {
      lines.push(t('cmd.model.test.gatewayBlock'))
      lines.push(t('cmd.model.test.gatewayBlockCheck'))
    } else if (chatResult.providerErrorKind === 'model-unsupported') {
      lines.push(t('cmd.model.test.modelUnsupported', { model: profile.model }))
      lines.push(`  - ${t('cmd.model.test.modelUnsupportedModels', { name })}`)
      lines.push(`  - ${t('cmd.model.test.modelUnsupportedManual', { name })}`)
    } else if (chatResult.providerErrorKind === 'payload-rejected') {
      lines.push(t('cmd.model.test.payloadRejected'))
      lines.push(t('cmd.model.test.payloadRejectedCheck'))
    } else if (chatResult.providerErrorKind === 'provider-server-error') {
      lines.push(t('cmd.model.test.providerServerError'))
    } else if (chatResult.status === 401 || chatResult.status === 403) {
      lines.push(`Status ${chatResult.status} means the chat endpoint rejected the key/model/account combination.`)
      lines.push('Check:')
      lines.push('  - API key belongs to the same provider/account as the baseURL.')
      lines.push('  - model id is enabled for this key; some gateways allow /models but deny specific chat models.')
      lines.push('  - if this is a proxy, confirm the proxy allows POST /chat/completions for this key.')
    } else if (chatResult.status === 404) {
      lines.push('Check baseURL and model id. A /models success does not guarantee /chat/completions exists at the same root.')
    } else if (chatResult.status === 429) {
      lines.push('The chat endpoint is rate-limited or quota-limited.')
    } else if (chatResult.status === 0) {
      lines.push(`Reason: ${chatResult.error || 'unknown network error'}`)
    }
  } else if (result.ok) {
    if (result.status === 401 || result.status === 403) {
      lines.push('Reachability: server responded, but authentication failed.')
      lines.push(`Status ${result.status} usually means the endpoint is reachable, but the key/account/model permission is wrong for this provider.`)
      lines.push('Check:')
      lines.push(
        profile.provider === 'openai-compatible'
          ? '  - baseURL belongs to this provider and usually ends with /v1 for OpenAI-compatible endpoints.'
          : '  - baseURL belongs to this provider and points at the messages-compatible API root.',
      )
      lines.push('  - API key belongs to the same provider/account as the baseURL.')
      lines.push('  - model id is enabled for this key; some providers return auth-like errors for unauthorized models.')
      lines.push(`  - run /model models ${name} --refresh to inspect model ids exposed by this baseURL/apiKey, if the provider supports /models.`)
      lines.push('  - if you used --apiKeyEnv, restart Mossen after exporting the env var; an already-running process will not see later shell changes.')
    } else if (result.status === 404) {
      lines.push('Reachability: server responded with 404.')
      lines.push(
        profile.provider === 'openai-compatible'
          ? 'Check baseURL. Many OpenAI-compatible providers expect the versioned API root, for example https://host.example/v1.'
          : 'Check baseURL. Messages-compatible providers may not expose GET /models even when chat requests work.',
      )
      lines.push('Also check whether this provider exposes GET /models; if chat still fails, verify the exact model id with the provider console.')
      lines.push(`Tip: run /model models ${name} --refresh to list model ids exposed by this baseURL/apiKey, if available.`)
    } else if (result.status === 429) {
      lines.push('Reachability: server responded with 429 rate limit.')
      lines.push('The key and endpoint are probably valid, but the account is throttled or quota-limited. Wait, lower concurrency, or switch profile.')
    } else if (result.status >= 500) {
      lines.push('Reachability: provider/server error.')
      lines.push('The request reached the provider, but the provider returned 5xx. Retry later or switch profile if this persists.')
    } else if (result.status >= 400) {
      lines.push('Reachability: provider returned a client error.')
      lines.push('Check whether this endpoint supports GET /models and whether the profile should be tested with a chat request instead.')
    } else {
      lines.push('Reachability: ok. The endpoint responded to GET /models with the configured Authorization header.')
      if (result.status >= 400) {
        lines.push('Note: the server is reachable, but returned a non-success status. A real chat request may still fail if the model id or account permission is wrong.')
      }
    }
  } else {
    lines.push('Reachability: failed.')
    lines.push(`Reason: ${result.error || 'unknown network error'}`)
    lines.push('Check baseURL/network/proxy first, then re-run /model test <name>.')
  }
  return lines.join('\n')
}

function parseTimeoutMs(tokens: readonly string[]): { ok: true; value?: number } | { ok: false; reason: string } {
  const timeoutRaw = readFlagValue(tokens, '--timeout')
  if (!timeoutRaw) return { ok: true }
  const timeoutMs = Number.parseInt(timeoutRaw, 10)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      ok: false,
      reason: t('cmd.model.models.timeoutInvalid', { value: timeoutRaw }),
    }
  }
  return { ok: true, value: timeoutMs }
}

function formatModelDiscoveryProviderHints(result: { url?: string; status?: number }, profileName: string): string[] {
  const listed = getListedProfileForModelDiscovery(profileName)
  const hint = getModelDiscoveryCatalogHint({
    url: result.url,
    status: result.status,
    provider: listed?.profile.provider,
  })
  const lines: string[] = []
  if (!hint) return lines

  if (hint.id === 'dashscope-coding') {
    lines.push('')
    lines.push(t('cmd.model.models.providerDashscopeCodingTitle'))
    lines.push(t('cmd.model.models.providerDashscopeCodingBody'))
    lines.push('')
    lines.push(t('cmd.model.models.providerDashscopeStandardRoots'))
    lines.push(t('cmd.model.models.providerDashscopeRootChina'))
    lines.push(t('cmd.model.models.providerDashscopeRootSingapore'))
    lines.push(t('cmd.model.models.providerDashscopeRootUs'))
    lines.push('')
    lines.push(t('cmd.model.models.providerDashscopeCodingManual'))
    lines.push(`  /model use ${profileName} MODEL_ID`)
    lines.push(`  /model use ${profileName} MODEL_ID --persist`)
    return lines
  }

  if (hint.id === 'dashscope-standard') {
    lines.push('')
    lines.push(t('cmd.model.models.providerDashscope404Title'))
    lines.push(t('cmd.model.models.providerDashscope404Body'))
    return lines
  }

  const manualLines = () => {
    lines.push(`  /model use ${profileName} MODEL_ID`)
    lines.push(`  /model use ${profileName} MODEL_ID --persist`)
  }

  if (hint.id === 'minimax') {
    lines.push('')
    lines.push(t('cmd.model.models.providerMinimaxTitle'))
    lines.push(t('cmd.model.models.providerMinimaxBody'))
    lines.push(t('cmd.model.models.providerKnownModelManual'))
    manualLines()
    return lines
  }

  if (hint.id === 'glm') {
    lines.push('')
    lines.push(t('cmd.model.models.providerGlmTitle'))
    lines.push(t('cmd.model.models.providerGlmBody'))
    lines.push(t('cmd.model.models.providerKnownModelManual'))
    manualLines()
    return lines
  }

  if (hint.id === 'deepseek') {
    lines.push('')
    lines.push(t('cmd.model.models.providerDeepSeekTitle'))
    lines.push(t('cmd.model.models.providerDeepSeekBody'))
    lines.push(t('cmd.model.models.providerDeepSeekOpenAiRoot'))
    lines.push(t('cmd.model.models.providerKnownModelManual'))
    manualLines()
    return lines
  }

  if (hint.id === 'messages-compatible') {
    lines.push('')
    lines.push(t('cmd.model.models.providerMessagesCompatibleTitle'))
    lines.push(t('cmd.model.models.providerMessagesCompatibleBody'))
    lines.push(t('cmd.model.models.providerKnownModelManual'))
    manualLines()
    return lines
  }

  if (hint.id === 'openai-compatible') {
    lines.push('')
    lines.push(t('cmd.model.models.providerOpenAiCompatibleTitle'))
    lines.push(t('cmd.model.models.providerOpenAiCompatibleBody'))
  }

  return lines
}

async function formatModels(tokens: readonly string[]): Promise<string> {
  const explicitName = tokens[1] && !tokens[1].startsWith('--') ? tokens[1] : undefined
  let implicitReason: string | null = null
  let name = explicitName
  if (!name) {
    const current = getCurrentProfile()
    if (current) {
      name = current.name
      implicitReason = t('cmd.model.models.reasonCurrentProfile')
    } else {
      const profiles = listAllProfiles()
      if (profiles.length === 1) {
        name = profiles[0]!.name
        implicitReason = t('cmd.model.models.reasonOnlyProfile')
      }
    }
  }
  if (!name) {
    const available = listAllProfiles().map(item => item.name)
    return [
      t('cmd.model.models.usageTitle'),
      t('cmd.model.models.usageCommand'),
      '',
      t('cmd.model.models.usageDefaultProfile'),
      t('cmd.model.models.usageDiscovery'),
      t('cmd.model.models.usageOptional'),
      available.length
        ? t('cmd.model.models.availableProfiles', { profiles: available.join(', ') })
        : t('cmd.model.models.noProfiles'),
    ].join('\n')
  }

  const timeout = parseTimeoutMs(tokens)
  if (timeout.ok === false) return timeout.reason
  const result = await discoverProfileModels(name, {
    refresh: tokens.includes('--refresh'),
    ...(timeout.value ? { timeoutMs: timeout.value } : {}),
  })
  const lines: string[] = []
  lines.push(t('cmd.model.models.title', {
    name,
    reason: implicitReason
      ? t('cmd.model.models.reasonSuffix', { reason: implicitReason })
      : '',
  }))
  lines.push('')
  if (result.ok === false) {
    lines.push(t('cmd.model.models.resultFailed', { reason: result.reason }))
    if (result.url) lines.push(t('cmd.model.models.url', { url: result.url }))
    if (result.status !== undefined) lines.push(t('cmd.model.models.httpStatus', { status: result.status }))
    lines.push(t('cmd.model.models.reason', { reason: result.error }))
    lines.push('')
    lines.push(t('cmd.model.models.noProfileChange'))
    lines.push(t('cmd.model.models.manualFallback'))
    lines.push(...formatModelDiscoveryProviderHints(result, name))
    return lines.join('\n')
  }

  const listed = getListedProfileForModelDiscovery(result.profileName)
  lines.push(t('cmd.model.models.source', {
    source: result.source,
    status: result.status !== undefined ? ` (HTTP ${result.status})` : '',
  }))
  lines.push(t('cmd.model.models.url', { url: result.url }))
  lines.push(t('cmd.model.models.fetchedAt', { fetchedAt: result.fetchedAt }))
  lines.push(t('cmd.model.models.cache', { cachePath: result.cachePath }))
  if (listed) {
    const d = desensitizeProfile(listed.profile)
    lines.push(t('cmd.model.models.currentDefault', { model: d.model }))
  }
  lines.push(t('cmd.model.models.modelsCount', { count: result.models.length }))
  const limit = 100
  for (const model of result.models.slice(0, limit)) {
    const suffixParts = [
      model.displayName && model.displayName !== model.id ? model.displayName : '',
      model.ownedBy ? `owned_by=${model.ownedBy}` : '',
    ].filter(Boolean)
    lines.push(`  - ${model.id}${suffixParts.length ? ` (${suffixParts.join(', ')})` : ''}`)
  }
  if (result.models.length > limit) {
    lines.push(t('cmd.model.models.more', { count: result.models.length - limit }))
  }
  lines.push('')
  lines.push(t('cmd.model.models.useWithoutChanging'))
  lines.push(`  /model use ${result.profileName} MODEL_ID`)
  lines.push(t('cmd.model.models.persistDefault'))
  lines.push(`  /model use ${result.profileName} MODEL_ID --persist`)
  return lines.join('\n')
}

function formatUsePersistExecute(
  token: string | undefined,
  setAppState?: (f: (prev: AppState) => AppState) => void,
): string {
  if (!token) {
    return 'Missing confirmation token. Re-run /model use PROFILE MODEL_ID --persist and then use the printed --confirm token.'
  }
  const result = executeModelProfilePlan(token)
  if (result.ok === false) {
    return [
      `Cannot apply model use plan: ${result.reason}`,
      '',
      'Re-run /model use PROFILE MODEL_ID --persist to mint a fresh token.',
    ].join('\n')
  }
  if (result.kind !== 'update') {
    return [
      `Cannot apply model use plan: token belongs to a "${result.kind}" operation, not a model update.`,
      '',
      'Use the matching command printed by the original dry-run.',
    ].join('\n')
  }

  try {
    setSessionActiveProfile(result.name)
  } catch {
    // The update already succeeded. If activation somehow fails, still apply
    // the model override so the current session follows the confirmed model.
  }
  applySessionProfile(result.rawProfile, setAppState)
  return [
    `Updated and selected model "${result.rawProfile.model}" under profile "${result.name}".`,
    ...formatProfileLines(result.profile, result.name),
    `    credential: ${formatCredentialSource(result.profile)}`,
    `    scope:    ${result.scope}`,
    '',
    'It is now active for the current session. It is also persisted as this profile default.',
  ].join('\n')
}

function formatUse(
  tokens: readonly string[],
  setAppState?: (f: (prev: AppState) => AppState) => void,
): string {
  const confirmToken = readFlagValue(tokens, '--confirm')
  if (confirmToken !== undefined) {
    return formatUsePersistExecute(confirmToken, setAppState)
  }

  const profileName = tokens[1]
  const model = tokens[2]
  if (!profileName || profileName.startsWith('--') || !model || model.startsWith('--')) {
    return [
      'Usage:',
      '  /model use PROFILE MODEL_ID',
      '  /model use PROFILE MODEL_ID --persist',
      '',
      'Session-only use keeps the saved profile unchanged.',
      'Use /model models PROFILE to discover available model ids first.',
    ].join('\n')
  }

  const persist = tokens.includes('--persist')
  if (persist) {
    const listed = getListedProfileForModelDiscovery(profileName)
    if (listed?.source === 'fallback-env') {
      return [
        `Cannot persist model "${model}" for fallback env profile "${profileName}".`,
        '',
        'Fallback profiles come from MOSSEN_CODE_CUSTOM_* env vars and are not writable settings profiles.',
        'First migrate it, then persist:',
        '  mossen --migrate-fallback-profile',
        `  /model use ${profileName} ${model} --persist`,
      ].join('\n')
    }
    const planned = createModelProfileUpdatePlan({
      name: profileName,
      model,
      scope: parseScope(tokens),
    })
    if (planned.ok === false) {
      return `Cannot create model use persist plan: ${planned.reason}`
    }
    return [
      formatPlan(planned.plan).replace('/model update --confirm', '/model use --confirm'),
      '',
      'Confirming will also switch the current session to this profile/model.',
    ].join('\n')
  }

  const listed = getListedProfileForModelDiscovery(profileName)
  if (!listed) {
    const existing = listAllProfiles().map(item => item.source === 'fallback-env' ? `${item.name} (fallback)` : item.name)
    return [
      `Cannot use profile "${profileName}": not found.`,
      existing.length ? `Available profiles: ${existing.join(', ')}` : 'No profiles configured.',
    ].join('\n')
  }

  const result = setSessionActiveProfile(profileName)
  setMainLoopModelOverride(model)
  if (typeof setAppState === 'function') {
    setAppState(prev => ({
      ...prev,
      mainLoopModelForSession: model,
    }))
  }
  const d = desensitizeProfile(result.profile)
  return [
    `Using model "${model}" under profile "${result.activeProfile}" for this session.`,
    `  name:     ${d.name || result.activeProfile}`,
    `  provider: ${d.provider}`,
    `  baseURL:  ${d.baseURL}`,
    `  apiKey:   ${d.apiKey}`,
    `  credential: ${formatCredentialSource(d)}`,
    `  source:   ${result.source === 'fallback-env' ? 'env (MOSSEN_CODE_CUSTOM_*)' : 'settings.json'}`,
    '',
    `Saved default model for this profile remains "${d.model}".`,
    `To persist this model as the default: /model use ${result.activeProfile} ${model} --persist`,
  ].join('\n')
}

export const call: LocalCommandCall = async (args, context) => {
  const trimmed = (args || '').trim()
  if (!trimmed) {
    return { type: 'text', value: formatList() }
  }
  const tokens = tokenizeArgs(trimmed)
  const name = tokens[0]!
  const rest = tokens.slice(1)

  if (name === 'add') {
    return { type: 'text', value: formatAdd(tokens, context.setAppState) }
  }
  if (name === 'update' || name === 'edit') {
    return { type: 'text', value: formatUpdate(tokens, context.setAppState) }
  }
  if (name === 'test' || name === 'check') {
    return { type: 'text', value: await formatTest(tokens) }
  }
  if (name === 'models' || name === 'list-models') {
    return { type: 'text', value: await formatModels(tokens) }
  }
  if (name === 'use') {
    return { type: 'text', value: formatUse(tokens, context.setAppState) }
  }
  if (name === 'examples' || name === 'example') {
    return { type: 'text', value: formatExamples() }
  }
  if (name === 'env' || name === 'environment') {
    return { type: 'text', value: formatEnvHelp(tokens[1]) }
  }
  if (name === 'doctor' || name === 'diag' || name === 'diagnose') {
    return { type: 'text', value: formatDoctor() }
  }
  if (name === 'keychain' || (name === 'profile' && tokens[1] === 'keychain')) {
    return {
      type: 'text',
      value: formatKeychain(name === 'profile' ? tokens.slice(1) : tokens),
    }
  }
  if (name === 'remove' || name === 'rm' || name === 'delete') {
    return { type: 'text', value: formatRemove(tokens, context.setAppState) }
  }
  if (name === 'default' || name === 'set-default') {
    return { type: 'text', value: formatDefault(tokens, context.setAppState) }
  }
  if (name === 'help' || name === '--help' || name === '-h') {
    return {
      type: 'text',
      value: [
        'Usage:',
        '  /model                         List configured model profiles',
        '  /model <profileName>           Switch this conversation only',
        '  /model add <name> --baseURL <url> --model <id> --apiKeyEnv <ENV> [--maxInputTokens <tokens>] [--activate]',
        '  /model update <name> [--baseURL <url>] [--model <id>] [--apiKeyEnv <ENV>] [--maxInputTokens <tokens|default>]',
        '  /model test <name> [--timeout <ms>]',
        '  /model models [PROFILE] [--refresh] [--timeout MS]',
        '  /model use PROFILE MODEL_ID [--persist]',
        '  /model examples',
        '  /model env [qwen|glm|minimax|openai]',
        '  /model doctor',
        '  /model keychain status',
        '  /model keychain import <profile>',
        '  /model keychain migrate --dry-run',
        '  /model remove <name>',
        '  /model default <name>',
        '',
        '--apiKeyEnv is an environment variable name, not the key value.',
        'All write operations are dry-run first and require --confirm <token>.',
      ].join('\n'),
    }
  }

  if (rest.length > 0) {
    return {
      type: 'text',
      value: [
        `/model: ignoring extra arguments: ${rest.join(' ')}`,
        '',
        formatSwitchResult(name, context.setAppState),
      ].join('\n'),
    }
  }
  // 不存在的 profile 也走 formatSwitchResult, 它内部 catch 会输出可读错误.
  void getProfileByName(name)
  return { type: 'text', value: formatSwitchResult(name, context.setAppState) }
}
