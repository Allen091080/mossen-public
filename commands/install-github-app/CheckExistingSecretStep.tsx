import React, { useState } from 'react'
import TextInput from '../../components/TextInput.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, color, Text, useTheme } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'

interface CheckExistingSecretStepProps {
  useExistingSecret: boolean
  secretName: string
  onToggleUseExistingSecret: (useExisting: boolean) => void
  onSecretNameChange: (value: string) => void
  onSubmit: () => void
}

export function CheckExistingSecretStep({
  useExistingSecret,
  secretName,
  onToggleUseExistingSecret,
  onSecretNameChange,
  onSubmit,
}: CheckExistingSecretStepProps): React.ReactNode {
  const [cursorOffset, setCursorOffset] = useState(0)
  const terminalSize = useTerminalSize()
  const [theme] = useTheme()

  useKeybindings(
    {
      'confirm:previous': () => onToggleUseExistingSecret(true),
      'confirm:next': () => onToggleUseExistingSecret(false),
      'confirm:yes': onSubmit,
    },
    {
      context: 'Confirmation',
      isActive: useExistingSecret,
    },
  )

  useKeybindings(
    {
      'confirm:previous': () => onToggleUseExistingSecret(true),
      'confirm:next': () => onToggleUseExistingSecret(false),
    },
    {
      context: 'Confirmation',
      isActive: !useExistingSecret,
    },
  )

  return (
    <>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Install GitHub App</Text>
          <Text dimColor>Setup backend secret</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="warning">{secretName} already exists in repository secrets!</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>Would you like to:</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            {useExistingSecret ? color('success', theme)('> ') : '  '}
            Use the existing backend secret
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            {!useExistingSecret ? color('success', theme)('> ') : '  '}
            Create a new secret with a different name
          </Text>
        </Box>
        {!useExistingSecret && (
          <>
            <Box marginBottom={1}>
              <Text>Enter new secret name (alphanumeric with underscores):</Text>
            </Box>
            <TextInput
              value={secretName}
              onChange={onSecretNameChange}
              onSubmit={onSubmit}
              focus
              placeholder="e.g., MOSSEN_CODE_CUSTOM_API_KEY"
              columns={terminalSize.columns}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
              showCursor
            />
          </>
        )}
      </Box>
      <Box marginLeft={3}>
        <Text dimColor>↑/↓ to select · Enter to continue</Text>
      </Box>
    </>
  )
}
