import * as React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { Box, Text } from '../../ink.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import type { Output } from './MemoryContextTool.js'

export function renderToolUseMessage({
  query,
}: Partial<{
  query: string
}>): React.ReactNode {
  return query
    ? getLocalizedText({ en: `memory: ${query}`, zh: `记忆：${query}` })
    : getLocalizedText({ en: 'memory context', zh: '记忆上下文' })
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  if (!output.enabled) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>
          {getLocalizedText({
            en: 'Sidecar memory is disabled.',
            zh: '旁路记忆未启用。',
          })}
        </Text>
      </MessageResponse>
    )
  }

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text>
          {getLocalizedText({
            en: `Found ${output.resultCount} memory items`,
            zh: `找到 ${output.resultCount} 条记忆`,
          })}
          <Text dimColor>{` · ~${output.totalTokenEstimate} tokens`}</Text>
        </Text>
        {output.resultCount === 0 ? (
          <Text dimColor>
            {getLocalizedText({
              en: 'No matching memory context.',
              zh: '没有匹配的记忆上下文。',
            })}
          </Text>
        ) : null}
      </Box>
    </MessageResponse>
  )
}
