import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDefaultMemorySidecarConfig,
  hasIndependentLlmConfig,
  isMemorySidecarConfig,
  mergeMemorySidecarConfig,
  setMemorySidecarLlmEnabled,
} from '../config.js'

describe('memory sidecar config', () => {
  test('old configs without per-job provider remain valid', () => {
    const config = mergeMemorySidecarConfig({
      classification: {
        ruleBased: true,
        llm: false,
        llmProvider: 'disabled',
        llmProviderConfig: { kind: 'disabled' },
      },
    })

    expect(isMemorySidecarConfig(config)).toBe(true)
    expect(config.classification.perJobProvider).toEqual({})
    expect(hasIndependentLlmConfig(config)).toBe(false)
  })

  test('merges valid per-job providers and ignores invalid job entries', () => {
    const config = mergeMemorySidecarConfig({
      classification: {
        ruleBased: true,
        llm: true,
        llmProvider: 'disabled',
        llmProviderConfig: { kind: 'disabled' },
        perJobProvider: {
          classify_llm: {
            kind: 'openai-compatible',
            baseUrl: 'https://memory.example.test/v1',
            model: 'cheap-classifier',
            apiKeyEnv: 'MOSSEN_MEMORY_CLASSIFIER_KEY',
          },
          synthesize_profile: {
            kind: 'external-command',
            command: 'profile-sidecar',
            args: ['--json'],
          },
          index_archive: {
            kind: 'openai-compatible',
            baseUrl: '',
            model: '',
          },
        },
      },
    } as never)

    expect(isMemorySidecarConfig(config)).toBe(true)
    expect(config.classification.perJobProvider?.classify_llm?.kind).toBe(
      'openai-compatible',
    )
    expect(config.classification.perJobProvider?.synthesize_profile?.kind).toBe(
      'external-command',
    )
    expect(
      'index_archive' in (config.classification.perJobProvider ?? {}),
    ).toBe(false)
    expect(hasIndependentLlmConfig(config)).toBe(true)
  })

  test('llm enable accepts independent per-job provider without global provider', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'mossen-config-test-'))
    try {
      const env = { ...process.env, MOSSEN_MEMORY_SIDECAR_HOME: rootDir }
      const configPath = join(rootDir, 'config.json')
      const config = createDefaultMemorySidecarConfig(env)
      config.classification.perJobProvider = {
        classify_llm: {
          kind: 'openai-compatible',
          baseUrl: 'https://memory.example.test/v1',
          model: 'cheap-classifier',
          apiKeyEnv: 'MOSSEN_MEMORY_CLASSIFIER_KEY',
        },
      }
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

      const updated = setMemorySidecarLlmEnabled(true, configPath, env)

      expect(updated.classification.llm).toBe(true)
      expect(updated.classification.llmProviderConfig?.kind).toBe('disabled')
      expect(updated.classification.perJobProvider?.classify_llm?.kind).toBe(
        'openai-compatible',
      )
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
