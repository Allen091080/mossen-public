import React, { useState } from 'react'
import TextInput from '../../components/TextInput.js'
import { getProductDisplayName } from '../../constants/product.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, color, Text, useTheme } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import {
  getCustomBackendName,
  getHostedPlatformUrls,
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'

interface ApiKeyStepProps {
  existingApiKey: string | null
  useExistingKey: boolean
  apiKeyOrOAuthToken: string
  onApiKeyChange: (value: string) => void
  onToggleUseExistingKey: (useExisting: boolean) => void
  onSubmit: () => void
  selectedOption?: 'existing' | 'new'
  onSelectOption?: (option: 'existing' | 'new') => void
}

export function ApiKeyStep({
  existingApiKey,
  apiKeyOrOAuthToken,
  onApiKeyChange,
  onSubmit,
  onToggleUseExistingKey,
  selectedOption = existingApiKey ? 'existing' : 'new',
  onSelectOption,
}: ApiKeyStepProps): React.ReactNode {
  const [cursorOffset, setCursorOffset] = useState(0)
  const terminalSize = useTerminalSize()
  const [theme] = useTheme()
  const customBackendEnabled = isCustomBackendEnabled()
  const backendName = getCustomBackendName()

  const handlePrevious = () => {
    if (selectedOption === 'new' && existingApiKey) {
      onSelectOption?.('existing')
      onToggleUseExistingKey(true)
    }
  }

  const handleNext = () => {
    if (selectedOption === 'existing') {
      onSelectOption?.('new')
      onToggleUseExistingKey(false)
    }
  }

  const handleConfirm = () => {
    onSubmit()
  }

  const isTextInputVisible = selectedOption === 'new'
  const newCredentialLabel = customBackendEnabled
    ? `Enter a new ${backendName} credential`
    : 'Enter a new API key'
  const newCredentialPlaceholder = customBackendEnabled
    ? `Paste a ${backendName} API key or platform auth token`
    : 'Paste a Mossen API key'
  const installTitle = customBackendEnabled
    ? 'Install GitHub workflow'
    : 'Install GitHub App'
  const installSubtitle = customBackendEnabled
    ? 'Choose a platform backend credential'
    : 'Choose backend credential'
  const existingCredentialLabel = customBackendEnabled
    ? `${backendName} credential`
    : `${getProductDisplayName()} credential`
  const newCredentialHint = customBackendEnabled
    ? hasConfiguredHostedPlatformUrls()
      ? `You can create one from ${getHostedPlatformUrls().remoteBaseUrl}/settings`
      : `Paste a credential from your ${backendName} backend or your own hosted adapter.`
    : null

  useKeybindings(
    {
      'confirm:previous': handlePrevious,
      'confirm:next': handleNext,
      'confirm:yes': handleConfirm,
    },
    {
      context: 'Confirmation',
      isActive: !isTextInputVisible,
    },
  )

  useKeybindings(
    {
      'confirm:previous': handlePrevious,
      'confirm:next': handleNext,
    },
    {
      context: 'Confirmation',
      isActive: isTextInputVisible,
    },
  )

  return (
    <>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{installTitle}</Text>
          <Text dimColor>{installSubtitle}</Text>
        </Box>
        {existingApiKey && (
          <Box marginBottom={1}>
            <Text>
              {selectedOption === 'existing' ? color('success', theme)('> ') : '  '}
              Use your existing {existingCredentialLabel}
            </Text>
          </Box>
        )}
        <Box marginBottom={1}>
          <Text>
            {selectedOption === 'new' ? color('success', theme)('> ') : '  '}
            {newCredentialLabel}
          </Text>
        </Box>
        {selectedOption === 'new' && (
          <TextInput
            value={apiKeyOrOAuthToken}
            onChange={onApiKeyChange}
            onSubmit={onSubmit}
            onPaste={onApiKeyChange}
            focus
            placeholder={newCredentialPlaceholder}
            mask="*"
            columns={terminalSize.columns}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            showCursor
          />
        )}
        {selectedOption === 'new' && newCredentialHint && (
          <Box marginTop={1}>
            <Text dimColor>{newCredentialHint}</Text>
          </Box>
        )}
      </Box>
      <Box marginLeft={3}>
        <Text dimColor>↑/↓ to select · Enter to continue</Text>
      </Box>
    </>
  )
}
