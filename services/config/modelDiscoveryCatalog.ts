import type { ProfileProvider } from './profiles.js'

export type ModelDiscoveryCatalogHintId =
  | 'dashscope-coding'
  | 'dashscope-standard'
  | 'minimax'
  | 'glm'
  | 'deepseek'
  | 'openai-compatible'
  | 'messages-compatible'

export type ModelDiscoveryCatalogHint = {
  id: ModelDiscoveryCatalogHintId
  host: string
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function discoveryUnsupported(status: number | undefined): boolean {
  return status === 404 || status === 405 || status === 501
}

export function getModelDiscoveryCatalogHint({
  url,
  status,
  provider,
}: {
  url?: string
  status?: number
  provider?: ProfileProvider
}): ModelDiscoveryCatalogHint | null {
  if (!discoveryUnsupported(status)) return null

  const parsed = parseUrl(url)
  const host = parsed?.hostname.toLowerCase() ?? ''
  const pathname = parsed?.pathname.toLowerCase() ?? ''

  if (
    host === 'coding.dashscope.aliyuncs.com' ||
    host === 'coding-intl.dashscope.aliyuncs.com'
  ) {
    return { id: 'dashscope-coding', host }
  }

  if (
    host === 'dashscope.aliyuncs.com' ||
    host === 'dashscope-intl.aliyuncs.com' ||
    host === 'dashscope-us.aliyuncs.com' ||
    host.endsWith('.dashscope.aliyuncs.com')
  ) {
    return { id: 'dashscope-standard', host }
  }

  if (host.includes('minimax') || host.includes('minimaxi')) {
    return { id: 'minimax', host }
  }

  if (
    host.includes('bigmodel.cn') ||
    host.includes('zhipu') ||
    host.includes('glm')
  ) {
    return { id: 'glm', host }
  }

  if (host.includes('deepseek')) {
    return { id: 'deepseek', host }
  }

  if (
    provider === 'messages-compatible' ||
    pathname.includes('/messages')
  ) {
    return { id: 'messages-compatible', host }
  }

  if (provider === 'openai-compatible') {
    return { id: 'openai-compatible', host }
  }

  return null
}
