// W122-A: read-only documentation helper that explains the capture
// boundary plus current capture/redaction config + archive size. Used by
// /memory-sidecar explain-capture so the user can see exactly what is
// captured, what is dropped, and what is redacted.
//
// HARD CONSTRAINT: read-only. No fs writes. No mutation. No worker run.
// Configuration content (captured/notCaptured/redacted bullets) is the
// canonical W122-A reference text — keep it stable, ASCII-friendly, and
// bilingual zh+en in a single string.

import type { MemoryRootOptions } from '../index.js'
import {
  getDefaultMemorySidecarConfigPath,
  loadMemorySidecarConfig,
  type MemorySidecarConfig,
} from '../config/config.js'
import { getArchiveStoreManifest } from '../storage/manifest.js'

export type ExplainCaptureOptions = MemoryRootOptions

export type ExplainCaptureReport = {
  generatedAt: string
  projectId: string
  config: {
    sidecarEnabled: boolean
    captureEnabled: boolean
    adapterEnabled: boolean
    redactionEnabled: true
  }
  archive: { events: number; lastEventAt: string | null }
  captured: string[]
  notCaptured: string[]
  redacted: string[]
  howToDisable: string
  howToVerifyZeroWrites: string[]
}

const CAPTURED: readonly string[] = [
  'user plain text messages / 用户文本消息',
  'assistant plain text messages / 助手文本消息',
  'metadata: sessionId/projectId/cwd/model/permissionMode / 元数据',
]

const NOT_CAPTURED: readonly string[] = [
  'tool output / tool input / 工具输出与输入',
  'bash stdout/stderr blocks / Bash 标准输出与错误',
  'local-command-stdout/stderr/caveat blocks / 本地命令包裹块',
  'slash commands (lines starting with /) / 斜杠命令',
  '<system-reminder> blocks / 系统提示包裹块',
  '<think>...</think> internal reasoning / 内部推理',
  'wave / control-plane instruction packets (执行 W… / 硬红线 / Smoke 要求 / Implement W… / red lines:) / wave 指令包',
  'short operational reports (修复完成 / 全部通过 / 现在运行 smoke / 我来检查文件 / Let me…) / 短操作性回复',
  'synthetic / meta / virtual / compact-summary / api-error messages / 合成与元消息',
]

const REDACTED: readonly string[] = [
  'API keys (sk-..., k-..., bearer-..., provider-issued tokens) / API key',
  'bearer tokens / Bearer 令牌',
  'password=... / password: ... / 密码',
  'private keys (BEGIN PRIVATE KEY) / 私钥',
  'email addresses / 邮箱地址',
  'secret-like long base64/hex tokens / 长 base64/hex 凭据',
]

const HOW_TO_DISABLE = '/memory-sidecar disable'

const HOW_TO_VERIFY_ZERO_WRITES: readonly string[] = [
  '/memory-sidecar status',
  '/memory-sidecar doctor',
]

export async function generateExplainCaptureReport(
  options: ExplainCaptureOptions,
): Promise<ExplainCaptureReport> {
  const generatedAt = new Date().toISOString()
  const configPath = getDefaultMemorySidecarConfigPath()

  let config: MemorySidecarConfig | null = null
  try {
    config = loadMemorySidecarConfig(configPath)
  } catch {
    // unreadable config — surface defaults (all-disabled). Doctor handles
    // surfacing the parse error; explain-capture only needs the boolean
    // snapshot.
    config = null
  }

  const manifest = await getArchiveStoreManifest(options).catch(() => null)
  const archiveEvents = manifest?.stats.archiveEventCount ?? 0
  const archiveLastEvent = manifest?.stats.lastEventAt ?? null

  return {
    generatedAt,
    projectId: options.projectId,
    config: {
      sidecarEnabled: config?.enabled ?? false,
      captureEnabled: config?.capture.enabled ?? false,
      adapterEnabled: config?.adapter.enabled ?? false,
      redactionEnabled: true,
    },
    archive: {
      events: archiveEvents,
      lastEventAt: archiveLastEvent,
    },
    captured: [...CAPTURED],
    notCaptured: [...NOT_CAPTURED],
    redacted: [...REDACTED],
    howToDisable: HOW_TO_DISABLE,
    howToVerifyZeroWrites: [...HOW_TO_VERIFY_ZERO_WRITES],
  }
}
