import { getProductCliName } from '../../constants/product.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import type { MCPServerConnection, ScopedMcpServerConfig } from './types.js'

function sanitizeMcpDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|authorization)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
}

export function isMcpAuthFailureMessage(message: string): boolean {
  return /(^|\D)(401|403)(\D|$)/.test(message) || /unauthori[sz]ed|forbidden|needs?\s+auth|authentication|required token|invalid token/i.test(message)
}

export function isMcpServerEventsFailureMessage(message: string): boolean {
  return /server-events|eventsource|sse stream|text\/event-stream|maximum reconnection attempts|failed to reconnect sse/i.test(message)
}

export function isMcpTimeoutFailureMessage(message: string): boolean {
  return /timed?\s*out|timeout|timeoutserror|operation timed out|request timed out/i.test(message)
}

function inspectCommand(name: string): string {
  return `${getProductCliName()} mcp get "${name}"`
}

function authHint(name: string): string {
  return getLocalizedText({
    en: `run /mcp to authenticate, or ${inspectCommand(name)} to inspect this server`,
    zh: `运行 /mcp 完成认证，或运行 ${inspectCommand(name)} 检查该服务器`,
  })
}

function genericInspectHint(name: string): string {
  return getLocalizedText({
    en: `run ${inspectCommand(name)} or /doctor for details`,
    zh: `运行 ${inspectCommand(name)} 或 /doctor 查看详情`,
  })
}

function timeoutHint(name: string): string {
  return getLocalizedText({
    en: `check the server/network, then retry; tune MCP_TIMEOUT, MCP_TOOL_TIMEOUT, or MCP_REQUEST_TIMEOUT if needed; ${genericInspectHint(name)}`,
    zh: `检查 server/网络后重试；必要时调整 MCP_TIMEOUT、MCP_TOOL_TIMEOUT 或 MCP_REQUEST_TIMEOUT；${genericInspectHint(name)}`,
  })
}

export function describeMcpConnectionStatus(
  name: string,
  connection: MCPServerConnection,
): string {
  if (connection.type === 'connected') {
    return getLocalizedText({ en: '✓ Connected', zh: '✓ 已连接' })
  }
  if (connection.type === 'needs-auth') {
    return getLocalizedText({
      en: `! Needs authentication — ${authHint(name)}`,
      zh: `! 需要认证 — ${authHint(name)}`,
    })
  }
  if (connection.type === 'disabled') {
    return getLocalizedText({ en: 'Disabled', zh: '已禁用' })
  }
  if (connection.type === 'pending') {
    return getLocalizedText({ en: 'Pending connection', zh: '等待连接' })
  }

  const detail = sanitizeMcpDiagnosticText(connection.error ?? '')
  if (detail && isMcpAuthFailureMessage(detail)) {
    return getLocalizedText({
      en: `! Needs authentication — ${authHint(name)}`,
      zh: `! 需要认证 — ${authHint(name)}`,
    })
  }
  if (detail && isMcpServerEventsFailureMessage(detail)) {
    return getLocalizedText({
      en: `✗ Server-events/SSE channel failed — POST/tool path remains isolated; ${genericInspectHint(name)}`,
      zh: `✗ server-events/SSE 通道失败 — POST/tool 路径已隔离；${genericInspectHint(name)}`,
    })
  }
  if (detail && isMcpTimeoutFailureMessage(detail)) {
    return getLocalizedText({
      en: `✗ MCP request timed out — ${timeoutHint(name)}`,
      zh: `✗ MCP 请求超时 — ${timeoutHint(name)}`,
    })
  }
  return getLocalizedText({
    en: `✗ Failed to connect${detail ? ` — ${detail}` : ''}; ${genericInspectHint(name)}`,
    zh: `✗ 连接失败${detail ? ` — ${detail}` : ''}；${genericInspectHint(name)}`,
  })
}

export function describeMcpConnectionError(
  name: string,
  _server: ScopedMcpServerConfig,
  error: unknown,
): string {
  const detail = sanitizeMcpDiagnosticText(
    error instanceof Error ? error.message : String(error),
  )
  if (isMcpAuthFailureMessage(detail)) {
    return getLocalizedText({
      en: `! Needs authentication — ${authHint(name)}`,
      zh: `! 需要认证 — ${authHint(name)}`,
    })
  }
  if (isMcpServerEventsFailureMessage(detail)) {
    return getLocalizedText({
      en: `✗ Server-events/SSE channel failed — POST/tool path remains isolated; ${genericInspectHint(name)}`,
      zh: `✗ server-events/SSE 通道失败 — POST/tool 路径已隔离；${genericInspectHint(name)}`,
    })
  }
  if (isMcpTimeoutFailureMessage(detail)) {
    return getLocalizedText({
      en: `✗ MCP request timed out — ${timeoutHint(name)}`,
      zh: `✗ MCP 请求超时 — ${timeoutHint(name)}`,
    })
  }
  return getLocalizedText({
    en: `✗ Connection error${detail ? ` — ${detail}` : ''}; ${genericInspectHint(name)}`,
    zh: `✗ 连接错误${detail ? ` — ${detail}` : ''}；${genericInspectHint(name)}`,
  })
}
