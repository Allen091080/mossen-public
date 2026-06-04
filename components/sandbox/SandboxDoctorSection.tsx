import React from 'react'
import { Box, Text } from '../../ink.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { getInteractiveLanguageTag } from '../../utils/uiLanguage.js'

export function SandboxDoctorSection(): React.ReactNode {
  const languageTag = getInteractiveLanguageTag()

  if (!SandboxManager.isSupportedPlatform()) {
    return null
  }

  if (!SandboxManager.isSandboxEnabledInSettings()) {
    return null
  }

  const depCheck = SandboxManager.checkDependencies()
  const hasErrors = depCheck.errors.length > 0
  const hasWarnings = depCheck.warnings.length > 0

  if (!hasErrors && !hasWarnings) {
    return null
  }

  const statusColor = hasErrors ? ('error' as const) : ('warning' as const)
  const statusText = hasErrors
    ? languageTag === 'zh'
      ? '缺少依赖'
      : 'Missing dependencies'
    : languageTag === 'zh'
      ? '可用（有警告）'
      : 'Available (with warnings)'

  return (
    <Box flexDirection="column">
      <Text bold>{languageTag === 'zh' ? '沙箱' : 'Sandbox'}</Text>
      <Text>
        {languageTag === 'zh' ? '└ 状态：' : '└ Status: '}
        <Text color={statusColor}>{statusText}</Text>
      </Text>
      {depCheck.errors.map((error, index) => (
        <Text key={index} color="error">
          └ {error}
        </Text>
      ))}
      {depCheck.warnings.map((warning, index) => (
        <Text key={index} color="warning">
          └ {warning}
        </Text>
      ))}
      {hasErrors ? (
        <Text dimColor>
          {languageTag === 'zh'
            ? '└ 运行 /sandbox 查看安装说明'
            : '└ Run /sandbox for install instructions'}
        </Text>
      ) : null}
    </Box>
  )
}
