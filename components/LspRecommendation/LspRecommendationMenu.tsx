import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { Select } from '../CustomSelect/select.js'
import { PermissionDialog } from '../permissions/PermissionDialog.js'

type Props = {
  pluginName: string
  pluginDescription?: string
  fileExtension: string
  onResponse: (response: 'yes' | 'no' | 'never' | 'disable') => void
}

const AUTO_DISMISS_MS = 30_000

export function LspRecommendationMenu({
  pluginName,
  pluginDescription,
  fileExtension,
  onResponse,
}: Props): React.ReactNode {
  const onResponseRef = React.useRef(onResponse)
  onResponseRef.current = onResponse

  React.useEffect(() => {
    const timeoutId = setTimeout(
      ref => ref.current('no'),
      AUTO_DISMISS_MS,
      onResponseRef,
    )
    return () => clearTimeout(timeoutId)
  }, [])

  function onSelect(value: string): void {
    switch (value) {
      case 'yes':
        onResponse('yes')
        break
      case 'no':
        onResponse('no')
        break
      case 'never':
        onResponse('never')
        break
      case 'disable':
        onResponse('disable')
        break
    }
  }

  const options = [
    {
      label: (
        <Text>
          {getLocalizedText({ en: 'Yes, install ', zh: '是，安装 ' })}
          <Text bold>{pluginName}</Text>
        </Text>
      ),
      value: 'yes',
    },
    {
      label: getLocalizedText({ en: 'No, not now', zh: '暂不安装' }),
      value: 'no',
    },
    {
      label: (
        <Text>
          {getLocalizedText({ en: 'Never for ', zh: '不再为此推荐 ' })}
          <Text bold>{pluginName}</Text>
        </Text>
      ),
      value: 'never',
    },
    {
      label: getLocalizedText({
        en: 'Disable code intelligence recommendations',
        zh: '禁用代码智能推荐',
      }),
      value: 'disable',
    },
  ]

  return (
    <PermissionDialog
      title={getLocalizedText({
        en: 'Code Intelligence Plugin Recommendation',
        zh: '代码智能插件推荐',
      })}
    >
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1}>
          <Text dimColor>
            {getLocalizedText({
              en: 'This plugin adds code intelligence like go-to-definition and diagnostics.',
              zh: '这个插件会提供跳转定义、诊断等代码智能能力。',
            })}
          </Text>
        </Box>
        <Box>
          <Text dimColor>
            {getLocalizedText({ en: 'Plugin:', zh: '插件：' })}
          </Text>
          <Text> {pluginName}</Text>
        </Box>
        {pluginDescription && (
          <Box>
            <Text dimColor>{pluginDescription}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>
            {getLocalizedText({ en: 'Triggered by:', zh: '触发来源：' })}
          </Text>
          <Text>
            {' '}
            {getLocalizedText({
              en: `${fileExtension} files`,
              zh: `${fileExtension} 文件`,
            })}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            {getLocalizedText({
              en: 'Install this code intelligence plugin?',
              zh: '要安装这个代码智能插件吗？',
            })}
          </Text>
        </Box>
        <Box>
          <Select
            options={options}
            onChange={onSelect}
            onCancel={() => onResponse('no')}
          />
        </Box>
      </Box>
    </PermissionDialog>
  )
}
