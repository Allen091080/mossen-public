import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { MOSSEN_TEXT_MARK } from './MossenDotLogo.js'

const MOSSEN_AGENT_BANNER = [
  '███   ███  ██████  ██████  ██████  ██████  ███   ██   █████   ██████  ██████  ███   ██ ████████',
  '████ ████ ██    ██ ██      ██      ██      ████  ██   ██   ██ ██      ██      ████  ██    ██',
  '██ ███ ██ ██    ██ ██████  ██████  █████   ██ ██ ██   ███████ ██  ███ █████   ██ ██ ██    ██',
  '██  █  ██ ██    ██      ██      ██ ██      ██  ████   ██   ██ ██   ██ ██      ██  ████    ██',
  '██     ██  ██████  ██████  ██████  ██████  ██   ███   ██   ██  ██████ ██████  ██   ███    ██',
]

export const MOSSEN_AGENT_BANNER_WIDTH = Math.max(
  ...MOSSEN_AGENT_BANNER.map(line => line.length),
)

function BannerLine({
  line,
  previousLine,
}: {
  line: string
  previousLine?: string
}): React.ReactElement {
  const cells: React.ReactNode[] = []

  for (let index = 0; index < MOSSEN_AGENT_BANNER_WIDTH + 1; index++) {
    const foreground = line[index] ?? ' '
    const rightShadow = line[index - 1] ?? ' '
    const dropShadow = previousLine?.[index - 1] ?? ' '

    if (foreground !== ' ') {
      cells.push(
        <Text key={index} color="success">
          {foreground}
        </Text>,
      )
    } else if (rightShadow !== ' ' || dropShadow !== ' ') {
      cells.push(
        <Text key={index} color="mossen" dimColor>
          ░
        </Text>,
      )
    } else {
      cells.push(<Text key={index}> </Text>)
    }
  }

  return <Text>{cells}</Text>
}

export function MossenAgentBanner({
  showMeta = true,
}: {
  showMeta?: boolean
}): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center">
      {showMeta && <Text color="mossen">{MOSSEN_TEXT_MARK} Mossen Agent</Text>}
      <Box flexDirection="column" marginTop={showMeta ? 1 : 0}>
        {MOSSEN_AGENT_BANNER.map((line, index) => {
          const previousLine = MOSSEN_AGENT_BANNER[index - 1]
          const paddedLine = line.padEnd(MOSSEN_AGENT_BANNER_WIDTH, ' ')
          return (
            <React.Fragment key={index}>
              <BannerLine
                line={paddedLine}
                previousLine={previousLine?.padEnd(
                  MOSSEN_AGENT_BANNER_WIDTH,
                  ' ',
                )}
              />
            </React.Fragment>
          )
        })}
      </Box>
    </Box>
  )
}
