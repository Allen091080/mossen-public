import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  findLocalDocTopic,
  getLocalDocTopics,
  type LocalDocTopic,
} from '../../utils/localDocs.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type Props = {
  topicQuery?: string
  onDone: LocalJSXCommandOnDone
}

function renderTopic(topic: LocalDocTopic): React.ReactNode {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{topic.title}</Text>
      <Text wrap="wrap">{topic.summary}</Text>
      {topic.bullets.map((line, index) => (
        <Text key={`${topic.id}-bullet-${index}`} dimColor wrap="wrap">
          • {line}
        </Text>
      ))}
      <Text dimColor wrap="wrap">
        {getLocalizedText({ en: 'Commands:', zh: '相关命令：' })} {topic.commands.join(' · ')}
      </Text>
    </Box>
  )
}

export function LocalDocsDialog({ topicQuery, onDone }: Props): React.ReactNode {
  const requestedTopic = findLocalDocTopic(topicQuery)
  const topics = getLocalDocTopics()
  const visibleTopics = requestedTopic ? [requestedTopic] : topics
  const title = requestedTopic
    ? getLocalizedText({ en: `Docs: ${requestedTopic.title}`, zh: `文档：${requestedTopic.title}` })
    : getLocalizedText({ en: 'Mossen local docs', zh: 'Mossen 本地文档' })
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'escape' || event.key === 'left') {
      event.preventDefault()
      onDone()
    }
  }

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title={title} onCancel={onDone} color="professionalBlue">
        <Box flexDirection="column">
          {!requestedTopic && (
            <Text dimColor wrap="wrap">
              {getLocalizedText({
                en: 'Use /docs <topic> to jump directly. Topics:',
                zh: '可用 /docs <topic> 直接跳转。主题：',
              })}{' '}
              {topics.map(topic => topic.id).join(' · ')}
            </Text>
          )}
          {!requestedTopic && topicQuery?.trim() && (
            <Text color="warning" wrap="wrap">
              {getLocalizedText({
                en: `Unknown docs topic "${topicQuery.trim()}"; showing all topics.`,
                zh: `未知文档主题 "${topicQuery.trim()}"；已显示全部主题。`,
              })}
            </Text>
          )}
          {visibleTopics.map(topic => (
            <React.Fragment key={topic.id}>{renderTopic(topic)}</React.Fragment>
          ))}
          <Text dimColor>
            {getLocalizedText({ en: 'Esc/← closes docs.', zh: 'Esc/← 关闭文档。' })}
          </Text>
        </Box>
      </Dialog>
    </Box>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  return <LocalDocsDialog topicQuery={args} onDone={onDone} />
}
