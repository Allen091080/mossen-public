import figures from 'figures'
import React from 'react'
import {
  GITHUB_ACTION_SETUP_DOCS_URL,
  getGitHubAppInstallUrl,
} from '../../constants/github-app.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { isCustomBackendEnabled } from '../../utils/customBackend.js'

interface InstallAppStepProps {
  repoUrl: string
  onSubmit: () => void
}

export function InstallAppStep({
  repoUrl,
  onSubmit,
}: InstallAppStepProps): React.ReactNode {
  useKeybinding('confirm:yes', onSubmit, { context: 'Confirmation' })
  const integrationName = isCustomBackendEnabled()
    ? 'platform GitHub workflow'
    : 'hosted GitHub integration'

  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Install the {integrationName}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>Opening browser to install the {integrationName}…</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>If your browser doesn't open automatically, visit:</Text>
      </Box>
      <Box marginBottom={1}>
        <Text underline>{getGitHubAppInstallUrl()}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text>
          Please install the integration for repository: <Text bold>{repoUrl}</Text>
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>
          Important: Make sure to grant access to this specific repository
        </Text>
      </Box>
      <Box>
        <Text bold color="permission">
          Press Enter once you've installed the integration{figures.ellipsis}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Having trouble? See manual setup instructions at:{' '}
          <Text color="mossen">{GITHUB_ACTION_SETUP_DOCS_URL}</Text>
        </Text>
      </Box>
    </Box>
  )
}
