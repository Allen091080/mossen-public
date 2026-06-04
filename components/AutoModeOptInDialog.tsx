import React, { useEffect } from 'react'
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js'
import { Box, Link, Text } from '../ink.js'
import { getHostedPlatformUrls } from '../utils/customBackend.js'
import { updateSettingsForSource } from '../utils/settings/settings.js'
import { getInteractiveLanguageTag } from '../utils/uiLanguage.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'

// NOTE: This copy is legally reviewed — do not modify without Legal team approval.
export const AUTO_MODE_DESCRIPTION =
  "Auto mode lets the coding assistant handle permission prompts automatically — it checks each tool call for risky actions and prompt injection before executing. Actions identified as safe are executed, while risky actions are blocked and the assistant may try a different approach. Ideal for long-running tasks. Sessions are slightly more expensive. The assistant can make mistakes that allow harmful commands to run, it's recommended to only use in isolated environments. Shift+Tab to change mode."

type AutoModeOptInValue = 'accept' | 'accept-default' | 'decline'

type Props = {
  onAccept(): void
  onDecline(): void
  declineExits?: boolean
}

export function AutoModeOptInDialog({
  onAccept,
  onDecline,
  declineExits,
}: Props): React.ReactNode {
  const { securityDocsUrl } = getHostedPlatformUrls()
  const languageTag = getInteractiveLanguageTag()

  useEffect(() => {
    logMossenEvent('mossen.permission.autoModeOptInDialogShown', {})
  }, [])

  function handleChange(value: AutoModeOptInValue) {
    switch (value) {
      case 'accept':
        logMossenEvent('mossen.permission.autoModeOptInDialogAccept', {})
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: true,
        })
        onAccept()
        break
      case 'accept-default':
        logMossenEvent('mossen.permission.autoModeOptInDialogAcceptDefault', {})
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: true,
          permissions: { defaultMode: 'auto' },
        })
        onAccept()
        break
      case 'decline':
        logMossenEvent('mossen.permission.autoModeOptInDialogDecline', {})
        onDecline()
        break
    }
  }

  const options: Array<{ label: string; value: AutoModeOptInValue }> = [
    {
      label:
        languageTag === 'zh'
          ? '是，并设为我的默认模式'
          : 'Yes, and make it my default mode',
      value: 'accept-default',
    },
    {
      label: languageTag === 'zh' ? '是，启用自动模式' : 'Yes, enable auto mode',
      value: 'accept',
    },
    {
      label: declineExits
        ? languageTag === 'zh'
          ? '否，退出'
          : 'No, exit'
        : languageTag === 'zh'
          ? '否，返回'
          : 'No, go back',
      value: 'decline',
    },
  ]

  return (
    <Dialog
      title={languageTag === 'zh' ? '启用自动模式？' : 'Enable auto mode?'}
      color="warning"
      onCancel={onDecline}
    >
      <Box flexDirection="column" gap={1}>
        <Text>{AUTO_MODE_DESCRIPTION}</Text>
        <Link url={securityDocsUrl} />
      </Box>
      <Select
        options={options}
        onChange={value => handleChange(value as AutoModeOptInValue)}
        onCancel={onDecline}
      />
    </Dialog>
  )
}
