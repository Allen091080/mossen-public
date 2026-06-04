import React from 'react'
import { Box, Text } from '../../ink.js'

type SuccessStepProps = {
  secretExists: boolean
  useExistingSecret: boolean
  secretName: string
  skipWorkflow?: boolean
}

export function SuccessStep({
  secretExists,
  useExistingSecret,
  secretName,
  skipWorkflow = false,
}: SuccessStepProps): React.ReactNode {
  return (
    <>
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Install GitHub workflow</Text>
          <Text dimColor>Success</Text>
        </Box>
        {!skipWorkflow && (
          <Text color="success">✓ GitHub workflow created!</Text>
        )}
        {secretExists && useExistingSecret && (
          <Box marginTop={1}>
            <Text color="success">✓ Using existing {secretName} secret</Text>
          </Box>
        )}
        {(!secretExists || !useExistingSecret) && (
          <Box marginTop={1}>
            <Text color="success">✓ Credential saved as {secretName} secret</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text>Next steps:</Text>
        </Box>
        {skipWorkflow ? (
          <>
            <Text>1. Install the platform GitHub integration if you haven't already</Text>
            <Text>2. Your workflow file was kept unchanged</Text>
            <Text>3. Backend credentials are configured and ready to use</Text>
          </>
        ) : (
          <>
            <Text>1. A pre-filled PR page has been created</Text>
            <Text>2. Install the platform GitHub integration if you haven't already</Text>
            <Text>3. Merge the PR to enable platform review automation</Text>
          </>
        )}
      </Box>
      <Box marginLeft={3}>
        <Text dimColor>Press any key to exit</Text>
      </Box>
    </>
  )
}
