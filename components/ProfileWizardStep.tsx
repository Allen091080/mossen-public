// W459-full — first-launch LLM profile wizard (complete version).
//
// Promotes W459 minimum mode to the full wizard scope: provider type
// picker + URL validation + apiKey-mode picker (plaintext vs env-var
// ref) + endpoint test call + multi-profile loop. Closes all 5 gaps
// W459 minimum mode left to backlog.
//
// State machine stages (sequential, with retry branches):
//
//   provider-select    Select: openai-compatible / messages-compatible
//   profile-name       Input: profile alias (defaults to 'default' on
//                      first iteration, 'profile-2' / 'profile-3' …
//                      on subsequent iterations in multi-profile loop)
//   baseurl            Input + new URL() validation → baseurl-error
//                      branch on parse failure (reprompt)
//   model              Input non-empty
//   apikey-mode        Select: plaintext (writes apiKey field) vs
//                      env-var (writes apiKeyEnvRef.envVar — W459-schema
//                      added this variant; key value stays in env, never
//                      persists to settings.json)
//   apikey-plain       Input apiKey string (when mode = plaintext)
//   apikey-env         Input env var name + ENV_VAR_NAME_PATTERN check
//                      (when mode = env-var)
//   test-prompt        Select: 测试连接 / 跳过测试直接保存
//   testing            Async fetch ${baseURL}/chat/completions with
//                      4s timeout, ping payload (max_tokens=1)
//   test-result        Select: 保存 / 重新配置 (回到 baseurl) / 不管
//                      错误强制保存
//   saving             Calls setProfile + setMossenConfigOverride
//   another-profile    Select: 再配一个 / 完成 (loops back to
//                      profile-name with iteration counter)
//   done               PressEnter, exits wizard
//   error              Save threw — shows error, PressEnter to skip
//
// Bilingual zh/en throughout.

/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases. */

import React, { useEffect, useState } from 'react'
import { Box, Text } from '../ink.js'
import { setProfile, type ProfileProvider } from '../services/config/profiles.js'
import { setMossenConfigOverride } from '../services/config/index.js'
import {
  MESSAGES_PROTOCOL_VERSION_HEADER,
  MESSAGES_PROTOCOL_VERSION_VALUE,
} from '../services/api/messagesCompatibleClient.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import { PressEnterToContinue } from './PressEnterToContinue.js'
import { Select } from './CustomSelect/select.js'
import TextInput from './TextInput.js'

type Stage =
  | 'provider-select'
  | 'profile-name'
  | 'baseurl'
  | 'baseurl-error'
  | 'model'
  | 'apikey-mode'
  | 'apikey-plain'
  | 'apikey-env'
  | 'apikey-env-error'
  | 'test-prompt'
  | 'testing'
  | 'test-result'
  | 'saving'
  | 'another-profile'
  | 'done'
  | 'error'

type ApiKeyMode = 'plain' | 'env'

const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/

type Props = {
  onDone(): void
}

const ACTIVE_PROFILE_KEY = 'mossen.activeProfile'

type TestOutcome = {
  ok: boolean
  status?: number
  detail?: string
}

async function runEndpointTest(args: {
  provider: ProfileProvider
  baseURL: string
  model: string
  apiKey: string
}): Promise<TestOutcome> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const isMessagesCompat = args.provider !== 'openai-compatible'
    const path = isMessagesCompat ? '/messages' : '/chat/completions'
    const url = args.baseURL.replace(/\/+$/, '') + path
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (isMessagesCompat) {
      headers['x-api-key'] = args.apiKey
      headers[MESSAGES_PROTOCOL_VERSION_HEADER] = MESSAGES_PROTOCOL_VERSION_VALUE
    } else {
      headers['Authorization'] = `Bearer ${args.apiKey}`
    }
    const body = isMessagesCompat
      ? JSON.stringify({
          model: args.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        })
      : JSON.stringify({
          model: args.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        })
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (res.ok) {
      return { ok: true, status: res.status }
    }
    const text = await res.text().catch(() => '')
    return {
      ok: false,
      status: res.status,
      detail: text ? text.slice(0, 200) : `HTTP ${res.status}`,
    }
  } catch (e: unknown) {
    clearTimeout(timeout)
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      detail:
        msg === 'The operation was aborted.' || msg.includes('abort')
          ? 'timeout (>4s)'
          : msg.slice(0, 200),
    }
  }
}

export function ProfileWizardStep({ onDone }: Props): React.ReactNode {
  const [stage, setStage] = useState<Stage>('provider-select')
  const [iterationCount, setIterationCount] = useState(0)
  const [provider, setProvider] = useState<ProfileProvider>('openai-compatible')
  const [profileName, setProfileName] = useState('default')
  const [profileNameCursor, setProfileNameCursor] = useState('default'.length)
  const [baseUrl, setBaseUrl] = useState('')
  const [baseUrlCursor, setBaseUrlCursor] = useState(0)
  const [baseUrlErr, setBaseUrlErr] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [modelCursor, setModelCursor] = useState(0)
  const [apiKeyMode, setApiKeyMode] = useState<ApiKeyMode>('plain')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyCursor, setApiKeyCursor] = useState(0)
  const [apiKeyEnvName, setApiKeyEnvName] = useState('')
  const [apiKeyEnvCursor, setApiKeyEnvCursor] = useState(0)
  const [apiKeyEnvErr, setApiKeyEnvErr] = useState<string | null>(null)
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [savedProfiles, setSavedProfiles] = useState<string[]>([])

  // Async endpoint test triggered when stage transitions to 'testing'.
  useEffect(() => {
    if (stage !== 'testing') return
    let cancelled = false
    runEndpointTest({
      provider,
      baseURL: baseUrl,
      model,
      apiKey,
    })
      .then(out => {
        if (!cancelled) {
          setTestOutcome(out)
          setStage('test-result')
        }
      })
      .catch(e => {
        if (!cancelled) {
          setTestOutcome({ ok: false, detail: String(e) })
          setStage('test-result')
        }
      })
    return () => {
      cancelled = true
    }
  }, [stage, provider, baseUrl, model, apiKey])

  function persistAndAdvance(setActive: boolean) {
    setStage('saving')
    try {
      // W459-schema — env-var mode writes apiKeyEnvRef field (key value
      // never persisted to settings.json). Plain mode writes apiKey
      // string field as before.
      const schema: Parameters<typeof setProfile>[1] =
        apiKeyMode === 'env'
          ? {
              provider,
              baseURL: baseUrl,
              model,
              apiKeyEnvRef: { provider: 'env-var', envVar: apiKeyEnvName },
            }
          : {
              provider,
              baseURL: baseUrl,
              model,
              apiKey,
            }
      setProfile(profileName, schema, 'user')
      if (setActive) {
        setMossenConfigOverride(ACTIVE_PROFILE_KEY, profileName, 'user')
      }
      setSavedProfiles(prev => [...prev, profileName])
      setStage('another-profile')
    } catch (e: unknown) {
      setErrorMsg(
        e instanceof Error ? e.message : 'Unknown error saving profile',
      )
      setStage('error')
    }
  }

  function resetForNextIteration() {
    const nextCount = iterationCount + 1
    setIterationCount(nextCount)
    const defaultName = `profile-${nextCount + 1}`
    setProfileName(defaultName)
    setProfileNameCursor(defaultName.length)
    setProvider('openai-compatible')
    setBaseUrl('')
    setBaseUrlCursor(0)
    setBaseUrlErr(null)
    setModel('')
    setModelCursor(0)
    setApiKeyMode('plain')
    setApiKey('')
    setApiKeyCursor(0)
    setApiKeyEnvName('')
    setApiKeyEnvCursor(0)
    setApiKeyEnvErr(null)
    setTestOutcome(null)
    setStage('provider-select')
  }

  // ===== terminal stages =====

  if (stage === 'done') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>
          {getLocalizedText({
            en: `Saved ${savedProfiles.length} profile(s): ${savedProfiles.join(', ')}. Active: '${savedProfiles[0] ?? ''}'.`,
            zh: `已保存 ${savedProfiles.length} 个 profile：${savedProfiles.join(', ')}。当前 active：'${savedProfiles[0] ?? ''}'。`,
          })}
        </Text>
        <Text dimColor>
          {getLocalizedText({
            en: 'To switch active profile or add more later, run /model.',
            zh: '稍后切换或新增 profile，运行 /model。',
          })}
        </Text>
        <PressEnterToContinue onPress={onDone} />
      </Box>
    )
  }

  if (stage === 'error') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold color="red">
          {getLocalizedText({
            en: `Failed to save profile: ${errorMsg ?? '(unknown)'}`,
            zh: `保存 profile 失败：${errorMsg ?? '(未知错误)'}`,
          })}
        </Text>
        <Text dimColor>
          {getLocalizedText({
            en: 'Continuing without saving this profile — try /model add later.',
            zh: '跳过未保存的 profile — 稍后运行 /model add 重试。',
          })}
        </Text>
        <PressEnterToContinue onPress={onDone} />
      </Box>
    )
  }

  if (stage === 'saving') {
    return (
      <Box paddingLeft={1}>
        <Text>
          {getLocalizedText({ en: 'Saving profile...', zh: '正在保存 profile...' })}
        </Text>
      </Box>
    )
  }

  if (stage === 'testing') {
    return (
      <Box paddingLeft={1}>
        <Text>
          {getLocalizedText({
            en: `Testing connection to ${baseUrl} (4s timeout)...`,
            zh: `正在测试连接到 ${baseUrl}（4 秒超时）...`,
          })}
        </Text>
      </Box>
    )
  }

  // ===== Select stages =====

  if (stage === 'provider-select') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>
          {getLocalizedText({
            en: `[${iterationCount + 1}] Pick provider protocol`,
            zh: `[第 ${iterationCount + 1} 个] 选择 provider 协议`,
          })}
        </Text>
        <Box width={70}>
          <Select
            defaultValue="openai-compatible"
            defaultFocusValue="openai-compatible"
            options={[
              {
                label: getLocalizedText({
                  en: 'OpenAI-compatible (most third-party LLM gateways)',
                  zh: 'OpenAI 兼容（多数第三方 LLM 网关）',
                }),
                value: 'openai-compatible',
              },
              {
                label: getLocalizedText({
                  en: 'Messages-compatible (upstream messages protocol)',
                  zh: 'Messages 兼容（上游 messages 协议）',
                }),
                value: 'messages-compatible',
              },
            ]}
            onChange={v => {
              setProvider(v as ProfileProvider)
              setStage('profile-name')
            }}
            onCancel={() => {
              setProvider('openai-compatible')
              setStage('profile-name')
            }}
          />
        </Box>
      </Box>
    )
  }

  if (stage === 'apikey-mode') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>
          {getLocalizedText({
            en: `[${profileName}] How to store the API key?`,
            zh: `[${profileName}] API key 怎么存？`,
          })}
        </Text>
        <Box width={70}>
          <Select
            defaultValue="plain"
            defaultFocusValue="plain"
            options={[
              {
                label: getLocalizedText({
                  en: 'Save key directly to ~/.mossen/settings.json (plaintext)',
                  zh: '直接把密钥存到 ~/.mossen/settings.json（明文）',
                }),
                value: 'plain',
              },
              {
                label: getLocalizedText({
                  en: 'Save env-var NAME (key resolved from $ENV at runtime; never persisted)',
                  zh: '只存环境变量名（运行时从 $ENV 解析，密钥不落盘）',
                }),
                value: 'env',
              },
            ]}
            onChange={v => {
              const mode = v as ApiKeyMode
              setApiKeyMode(mode)
              setStage(mode === 'plain' ? 'apikey-plain' : 'apikey-env')
            }}
            onCancel={() => {
              setApiKeyMode('plain')
              setStage('apikey-plain')
            }}
          />
        </Box>
      </Box>
    )
  }

  if (stage === 'test-prompt') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>
          {getLocalizedText({
            en: `[${profileName}] Test endpoint+key now? (sends a 1-token ping)`,
            zh: `[${profileName}] 现在测试 endpoint + key？（发送 1-token ping）`,
          })}
        </Text>
        <Box width={70}>
          <Select
            defaultValue="test"
            defaultFocusValue="test"
            options={[
              { label: getLocalizedText({ en: 'Yes, test connection (recommended)', zh: '是，测试连接（推荐）' }), value: 'test' },
              { label: getLocalizedText({ en: 'No, just save the profile', zh: '否，直接保存 profile' }), value: 'skip' },
            ]}
            onChange={v => {
              if (v === 'test') setStage('testing')
              else persistAndAdvance(savedProfiles.length === 0)
            }}
            onCancel={() => persistAndAdvance(savedProfiles.length === 0)}
          />
        </Box>
      </Box>
    )
  }

  if (stage === 'test-result' && testOutcome) {
    const okLabel = getLocalizedText({
      en: 'Connection OK',
      zh: '连接 OK',
    })
    const failLabel = getLocalizedText({
      en: `Connection failed: ${testOutcome.detail ?? `HTTP ${testOutcome.status ?? '?'}`}`,
      zh: `连接失败：${testOutcome.detail ?? `HTTP ${testOutcome.status ?? '?'}`}`,
    })
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold color={testOutcome.ok ? 'green' : 'red'}>
          {testOutcome.ok ? okLabel : failLabel}
        </Text>
        <Box width={70}>
          <Select
            defaultValue={testOutcome.ok ? 'save' : 'retry'}
            defaultFocusValue={testOutcome.ok ? 'save' : 'retry'}
            options={[
              { label: getLocalizedText({ en: 'Save profile', zh: '保存 profile' }), value: 'save' },
              { label: getLocalizedText({ en: 'Re-enter baseURL / model / apiKey', zh: '重新输入 baseURL / model / apiKey' }), value: 'retry' },
              ...(testOutcome.ok
                ? []
                : [{ label: getLocalizedText({ en: 'Save anyway (ignore failure)', zh: '仍然保存（忽略失败）' }), value: 'force' }]),
            ]}
            onChange={v => {
              if (v === 'retry') {
                setBaseUrl('')
                setBaseUrlCursor(0)
                setModel('')
                setModelCursor(0)
                setApiKey('')
                setApiKeyCursor(0)
                setApiKeyEnvName('')
                setApiKeyEnvCursor(0)
                setTestOutcome(null)
                setStage('baseurl')
              } else {
                // 'save' or 'force' — both call persistAndAdvance
                persistAndAdvance(savedProfiles.length === 0)
              }
            }}
            onCancel={() => persistAndAdvance(savedProfiles.length === 0)}
          />
        </Box>
      </Box>
    )
  }

  if (stage === 'another-profile') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>
          {getLocalizedText({
            en: `Profile '${profileName}' saved. Saved so far: ${savedProfiles.join(', ')}.`,
            zh: `Profile '${profileName}' 已保存。已保存：${savedProfiles.join(', ')}。`,
          })}
        </Text>
        <Box width={70}>
          <Select
            defaultValue="done"
            defaultFocusValue="done"
            options={[
              { label: getLocalizedText({ en: 'Done — continue onboarding', zh: '完成 — 继续引导' }), value: 'done' },
              { label: getLocalizedText({ en: 'Add another profile', zh: '再加一个 profile' }), value: 'more' },
            ]}
            onChange={v => {
              if (v === 'more') resetForNextIteration()
              else setStage('done')
            }}
            onCancel={() => setStage('done')}
          />
        </Box>
      </Box>
    )
  }

  // ===== Input stages =====

  // baseurl-error: show error message above the input.
  // apikey-env-error: show error message above the input.

  let label: string
  let helpText: string
  let value: string
  let cursorOffset: number
  let onChange: (v: string) => void
  let onChangeCursor: (n: number) => void
  let onSubmit: (v: string) => void
  let topMessage: string | null = null

  if (stage === 'profile-name') {
    label = getLocalizedText({
      en: 'Profile name (alias):',
      zh: 'Profile 名称（别名）：',
    })
    helpText = getLocalizedText({
      en: 'Short identifier used by /model and as the value of mossen.activeProfile in settings.json.',
      zh: '短标识，给 /model 命令和 settings.json 的 mossen.activeProfile 字段用。',
    })
    value = profileName
    cursorOffset = profileNameCursor
    onChange = setProfileName
    onChangeCursor = setProfileNameCursor
    onSubmit = v => {
      const t = v.trim()
      if (!t) return
      setProfileName(t)
      setStage('baseurl')
    }
  } else if (stage === 'baseurl' || stage === 'baseurl-error') {
    label = getLocalizedText({
      en: `[${profileName}] LLM endpoint baseURL:`,
      zh: `[${profileName}] LLM endpoint baseURL：`,
    })
    helpText = getLocalizedText({
      en: 'e.g. https://api.openai.com/v1 or https://your-gateway.example.com/v1',
      zh: '例如 https://api.openai.com/v1 或 https://your-gateway.example.com/v1',
    })
    value = baseUrl
    cursorOffset = baseUrlCursor
    onChange = setBaseUrl
    onChangeCursor = setBaseUrlCursor
    if (stage === 'baseurl-error') topMessage = baseUrlErr
    onSubmit = v => {
      const t = v.trim()
      if (!t) return
      // Validate via new URL(); reject anything not http(s)://
      try {
        const parsed = new URL(t)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setBaseUrlErr(
            getLocalizedText({
              en: `baseURL must be http:// or https:// (got ${parsed.protocol})`,
              zh: `baseURL 必须是 http:// 或 https:// 开头（你输入的是 ${parsed.protocol}）`,
            }),
          )
          setStage('baseurl-error')
          return
        }
        setBaseUrl(t)
        setBaseUrlErr(null)
        setStage('model')
      } catch {
        setBaseUrlErr(
          getLocalizedText({
            en: 'Not a valid URL — must include scheme + host (e.g. https://...)',
            zh: '不是合法 URL — 必须含 scheme + host（例如 https://...）',
          }),
        )
        setStage('baseurl-error')
      }
    }
  } else if (stage === 'model') {
    label = getLocalizedText({
      en: `[${profileName}] Model ID:`,
      zh: `[${profileName}] 模型 ID：`,
    })
    helpText = getLocalizedText({
      en: 'The full model ID your endpoint accepts (e.g. gpt-4o, qwen-max).',
      zh: '你的 endpoint 接受的完整 model ID（例如 gpt-4o、qwen-max）。',
    })
    value = model
    cursorOffset = modelCursor
    onChange = setModel
    onChangeCursor = setModelCursor
    onSubmit = v => {
      const t = v.trim()
      if (!t) return
      setModel(t)
      setStage('apikey-mode')
    }
  } else if (stage === 'apikey-plain') {
    label = getLocalizedText({
      en: `[${profileName}] API key:`,
      zh: `[${profileName}] API 密钥：`,
    })
    helpText = getLocalizedText({
      en: 'Saved to ~/.mossen/settings.json plaintext (matches existing profile convention).',
      zh: '明文存到 ~/.mossen/settings.json（跟现有 profile 同款）。',
    })
    value = apiKey
    cursorOffset = apiKeyCursor
    onChange = setApiKey
    onChangeCursor = setApiKeyCursor
    onSubmit = v => {
      const t = v.trim()
      if (!t) return
      setApiKey(t)
      setStage('test-prompt')
    }
  } else if (stage === 'apikey-env' || stage === 'apikey-env-error') {
    label = getLocalizedText({
      en: `[${profileName}] Env var NAME (NOT the key value):`,
      zh: `[${profileName}] 环境变量名（不是 key 值本身）：`,
    })
    helpText = getLocalizedText({
      en: 'e.g. OPENAI_API_KEY. Must match /^[A-Z_][A-Z0-9_]*$/. Settings.json stores the NAME only; mossen resolves $NAME at runtime (key value never persists).',
      zh: '例如 OPENAI_API_KEY。须匹配 /^[A-Z_][A-Z0-9_]*$/。settings.json 只存名字；mossen 运行时读 $NAME（key 值永不落盘）。',
    })
    value = apiKeyEnvName
    cursorOffset = apiKeyEnvCursor
    onChange = setApiKeyEnvName
    onChangeCursor = setApiKeyEnvCursor
    if (stage === 'apikey-env-error') topMessage = apiKeyEnvErr
    onSubmit = v => {
      const t = v.trim()
      if (!t) return
      if (!ENV_VAR_NAME_PATTERN.test(t)) {
        setApiKeyEnvErr(
          getLocalizedText({
            en: 'Not a valid env-var NAME — must match /^[A-Z_][A-Z0-9_]*$/. Did you paste the key value by mistake?',
            zh: '不是合法的环境变量名 — 须匹配 /^[A-Z_][A-Z0-9_]*$/。是不是误把 key 值粘上了？',
          }),
        )
        setStage('apikey-env-error')
        return
      }
      // Resolve env value now so the test-call can use it. If env not
      // exported in this shell, apiKey stays empty — test-call will
      // surface "no env value yet" feedback.
      const resolved = process.env[t] ?? ''
      setApiKey(resolved)
      setApiKeyEnvName(t)
      setApiKeyEnvErr(null)
      setStage('test-prompt')
    }
  } else {
    // Should not happen — exhaustive Stage union covered above.
    return null
  }

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>
        {getLocalizedText({
          en: 'Configure LLM profile',
          zh: '配置 LLM profile',
        })}
      </Text>
      {topMessage ? (
        <Text color="red">{topMessage}</Text>
      ) : null}
      <Box flexDirection="column" width={70} gap={1}>
        <Text>{label}</Text>
        <Text dimColor>{helpText}</Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          focus={true}
          showCursor={true}
          columns={70}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={onChangeCursor}
        />
      </Box>
    </Box>
  )
}
