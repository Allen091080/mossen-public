import React from 'react'
import { Box } from '../../ink.js'

export function AgentViewDashboard({
  height,
  children,
}: {
  height?: number
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Box flexDirection="column" height={height}>
      {children}
    </Box>
  )
}
