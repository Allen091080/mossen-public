// W459-full Batch 4 — memory-sidecar LLM wizard step (replaces W452
// minimum-mode notice).
//
// Auto-memory sidecar can use an independent LLM for background
// classification (often cheaper than the main session LLM). W452
// shipped a minimum-mode notice telling users to run /memory-sidecar
// llm config later; W459-full upgrades that to an actual in-onboarding
// wizard so a fresh-user binary install gets memory-sidecar
// configured in one pass.
//
// Memory-sidecar config differs from main profile config in two ways:
//
//   1. apiKey is ALWAYS an env var NAME (not the key value itself).
//      memory-sidecar's setMemorySidecarLlmConfig() rejects anything
//      not matching /^[A-Z_][A-Z0-9_]*$/ at the persistence boundary
//      so a user who pastes their real key by mistake gets an early
//      error rather than the key leaking into config.json.
//
//   2. provider is hardcoded to 'openai-compatible' (memory-sidecar
//      only supports openai-compatible LLM classifiers; messages-
//      compatible support is a separate sidecar wave).
//
// Stages:
//   intro          Select: configure now / skip (default skip — sidecar
//                  classification is optional; mossen works fine without it)
//   baseurl        Input + new URL() validation
//   model          Input non-empty
//   apikey-env     Input env var name + isValidApiKeyEnvName check
//   saving         setMemorySidecarLlmConfig() write
//   done           PressEnter
//   error          Save threw → display + PressEnter to skip

/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases. */

import React, { useState } from 'react'
import { Box, Text } from '../ink.js'
import {
  isValidApiKeyEnvName,
  setMemorySidecarLlmConfig,
} from 'memory-sidecar/src/config/config.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import { PressEnterToContinue } from './PressEnterToContinue.js'
import { Select } from './CustomSelect/select.js'
import TextInput from './TextInput.js'

type Stage =
  | 'intro'
  | 'baseurl'
  | 'baseurl-error'
  | 'model'
  | 'apikey-env'
  | 'apikey-env-error'
  | 'saving'
  | 'done'
  | 'error'

type Props = {
  onDone(): void
}

export function MemorySidecarWizardStep({ onDone }: Props): React.ReactNode {
  const [stage, setStage] = useState<Stage>('intro')
  const [baseUrl, setBaseUrl] = useState('')
  const [baseUrlCursor, setBaseUrlCursor] = useState(0)
  const [baseUrlErr, setBaseUrlErr] = useState<string | null>(null)
  const [model, setModel] = useState('')
  const [modelCursor, setModelCursor] = useState(0)
  const [apiKeyEnvName, setApiKeyEnvName] = useState('')
  const [apiKeyEnvCursor, setApiKeyEnvCursor] = useState(0)
  const [apiKeyEnvErr, setApiKeyEnvErr] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(false)

  function persist() {
    setStage('saving')
    try {
      setMemorySidecarLlmConfig({
        baseUrl,
        model,
        apiKeyEnv: apiKeyEnvName,
      })
      setStage('done')
    } catch (e: unknown) {
      setErrorMsg(
        e instanceof Error ? e.message : 'Unknown error saving sidecar config',
      )
      setStage('error')
    }
  }

  // ===== terminal stages =====

  if (stage === 'done') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>
          {skipped
            ? getLocalizedText({
                en: 'Memory-sidecar LLM classification skipped — run /memory-sidecar llm config later if you change your mind.',
                zh: '已跳过记忆 sidecar LLM 配置 — 稍后想启用请运行 /memory-sidecar llm config。',
              })
            : getLocalizedText({
                en: `Memory-sidecar LLM saved (baseURL=${baseUrl}, model=${model}, apiKeyEnv=$${apiKeyEnvName}).`,
                zh: `记忆 sidecar LLM 已保存（baseURL=${baseUrl}, model=${model}, apiKeyEnv=$${apiKeyEnvName}）。`,
              })}
        </Text>
        {!skipped && (
          <Text dimColor>
            {getLocalizedText({
              en: `Remember to export ${apiKeyEnvName} in your shell, otherwise sidecar classification falls back to off at runtime.`,
              zh: `记得在 shell 里 export ${apiKeyEnvName}，否则 sidecar 启动时会因为环境变量未设而 fallback 关闭。`,
            })}
          </Text>
        )}
        <PressEnterToContinue onPress={onDone} />
      </Box>
    )
  }

  if (stage === 'error') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold color="red">
          {getLocalizedText({
            en: `Failed to save sidecar config: ${errorMsg ?? '(unknown)'}`,
            zh: `保存 sidecar 配置失败：${errorMsg ?? '(未知错误)'}`,
          })}
        </Text>
        <Text dimColor>
          {getLocalizedText({
            en: 'Skipping — run /memory-sidecar llm config later to retry.',
            zh: '跳过 — 稍后运行 /memory-sidecar llm config 重试。',
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
          {getLocalizedText({
            en: 'Saving sidecar LLM config...',
            zh: '正在保存 sidecar LLM 配置...',
          })}
        </Text>
      </Box>
    )
  }

  // ===== select / input stages =====

  if (stage === 'intro') {
    return (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>
          {getLocalizedText({
            en: 'Optional: memory-sidecar LLM classifier',
            zh: '可选：记忆 sidecar LLM 智能整理',
          })}
        </Text>
        <Box flexDirection="column" width={70} gap={1}>
          <Text>
            {getLocalizedText({
              en: 'Auto-memory sidecar can run a separate (often cheaper) LLM in the background to classify + tier your memory entries. Optional — mossen works fine without it.',
              zh: '自动记忆 sidecar 可在后台用独立（通常更便宜的）LLM 对记忆条目做智能整理。可选 — mossen 不开它也正常工作。',
            })}
          </Text>
          <Select
            defaultValue="skip"
            defaultFocusValue="skip"
            options={[
              { label: getLocalizedText({ en: 'Configure sidecar LLM now (3 prompts)', zh: '现在配置 sidecar LLM（3 步）' }), value: 'now' },
              { label: getLocalizedText({ en: 'Skip — configure later via /memory-sidecar llm config', zh: '跳过 — 之后用 /memory-sidecar llm config 配置' }), value: 'skip' },
            ]}
            onChange={v => {
              if (v === 'now') setStage('baseurl')
              else {
                setSkipped(true)
                setStage('done')
              }
            }}
            onCancel={() => {
              setSkipped(true)
              setStage('done')
            }}
          />
        </Box>
      </Box>
    )
  }

  // Input stages
  let label: string
  let helpText: string
  let value: string
  let cursorOffset: number
  let onChange: (v: string) => void
  let onChangeCursor: (n: number) => void
  let onSubmit: (v: string) => void
  let topMessage: string | null = null

  if (stage === 'baseurl' || stage === 'baseurl-error') {
    label = getLocalizedText({
      en: '1/3 sidecar LLM baseURL:',
      zh: '1/3 sidecar LLM baseURL：',
    })
    helpText = getLocalizedText({
      en: 'Any OpenAI-compatible /chat/completions endpoint (often cheaper than your main profile — e.g. a small/fast model dedicated to background classification).',
      zh: '任何 OpenAI-compatible /chat/completions endpoint（通常用更便宜的模型，例如专门给后台分类的 small/fast 模型）。',
    })
    value = baseUrl
    cursorOffset = baseUrlCursor
    onChange = setBaseUrl
    onChangeCursor = setBaseUrlCursor
    if (stage === 'baseurl-error') topMessage = baseUrlErr
    onSubmit = v => {
      const t = v.trim()
      if (!t) return
      try {
        const parsed = new URL(t)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setBaseUrlErr(
            getLocalizedText({
              en: `baseURL must be http:// or https:// (got ${parsed.protocol})`,
              zh: `baseURL 必须 http:// 或 https://（你输入的是 ${parsed.protocol}）`,
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
            en: 'Not a valid URL — must include scheme + host.',
            zh: '不是合法 URL — 必须含 scheme + host。',
          }),
        )
        setStage('baseurl-error')
      }
    }
  } else if (stage === 'model') {
    label = getLocalizedText({
      en: '2/3 sidecar model ID:',
      zh: '2/3 sidecar 模型 ID：',
    })
    helpText = getLocalizedText({
      en: 'Model ID the sidecar endpoint accepts. Smaller/faster models work best for classification.',
      zh: 'sidecar endpoint 接受的 model ID。分类任务用小/快模型最划算。',
    })
    value = model
    cursorOffset = modelCursor
    onChange = setModel
    onChangeCursor = setModelCursor
    onSubmit = v => {
      const t = v.trim()
      if (!t) return
      setModel(t)
      setStage('apikey-env')
    }
  } else if (stage === 'apikey-env' || stage === 'apikey-env-error') {
    label = getLocalizedText({
      en: '3/3 env var NAME holding the apiKey (not the key value):',
      zh: '3/3 存 apiKey 的环境变量名（不是 key 值本身）：',
    })
    helpText = getLocalizedText({
      en: 'e.g. SIDECAR_API_KEY. Must match /^[A-Z_][A-Z0-9_]*$/. Sidecar resolves $NAME at runtime — config.json only stores the NAME (key never persists to disk).',
      zh: '例如 SIDECAR_API_KEY。须匹配 /^[A-Z_][A-Z0-9_]*$/。Sidecar 运行时读 $NAME — config.json 只存名字（key 永不落盘）。',
    })
    value = apiKeyEnvName
    cursorOffset = apiKeyEnvCursor
    onChange = setApiKeyEnvName
    onChangeCursor = setApiKeyEnvCursor
    if (stage === 'apikey-env-error') topMessage = apiKeyEnvErr
    onSubmit = v => {
      const t = v.trim()
      if (!t) return
      if (!isValidApiKeyEnvName(t)) {
        setApiKeyEnvErr(
          getLocalizedText({
            en: 'Not a valid env-var NAME — must match /^[A-Z_][A-Z0-9_]*$/. Did you paste the key value by mistake?',
            zh: '不是合法的环境变量名 — 须匹配 /^[A-Z_][A-Z0-9_]*$/。是不是误把 key 值粘上了？',
          }),
        )
        setStage('apikey-env-error')
        return
      }
      setApiKeyEnvName(t)
      setApiKeyEnvErr(null)
      persist()
    }
  } else {
    return null
  }

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>
        {getLocalizedText({
          en: 'Configure memory-sidecar LLM',
          zh: '配置记忆 sidecar LLM',
        })}
      </Text>
      {topMessage ? <Text color="red">{topMessage}</Text> : null}
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
