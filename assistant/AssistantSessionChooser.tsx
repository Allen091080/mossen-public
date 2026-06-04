import React from 'react'
import { Box, Text } from '../ink.js'
import type { AssistantSession } from './sessionDiscovery.js'

export function AssistantSessionChooser(props: {
  sessions: AssistantSession[]
  onSelect: (id: string) => void
  onCancel: () => void
}): React.ReactNode {
  if (props.sessions.length === 0) {
    props.onCancel()
    return null
  }

  const first = props.sessions[0]
  if (first) {
    props.onSelect(first.id)
  } else {
    props.onCancel()
  }

  return (
    <Box flexDirection="column">
      <Text>Selecting assistant session…</Text>
    </Box>
  )
}
