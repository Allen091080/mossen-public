import React from 'react'
import { join } from 'path'
import { Box, Text } from '../../ink.js'
import type { LocalCommandCall, LocalCommandModule } from '../../types/command.js'
import { getMossenConfigHomeDir } from '../../utils/envUtils.js'

export async function computeDefaultInstallDir(): Promise<string> {
  return join(getMossenConfigHomeDir(), 'assistant')
}

export function NewInstallWizard(props: {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}): React.ReactNode {
  props.onInstalled(props.defaultDir)
  return (
    <Box flexDirection="column">
      <Text>Preparing assistant install…</Text>
    </Box>
  )
}

export const call: LocalCommandCall = async args => {
  const target = args.trim()
  return {
    type: 'text',
    value: target
      ? `Assistant session support is available. Session: ${target}`
      : 'Assistant session support is available.',
  }
}

const command: LocalCommandModule = { call }

export default command
