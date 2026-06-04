// Mossen 点阵 Logo 紧凑版 (按用户反馈缩小)
// 尺寸: 10 行 × ~17 列 (原版 18×33 的约 1/2)
// 颜色: color="mossen" (theme 中 = rgb(103,203,134))
//
import * as React from 'react'
import { Box, Text } from '../../ink.js'

export const MOSSEN_TEXT_MARK = '◖◗'

const MOSSEN_DOT_LOGO = [
  '          ••',
  '       •••••',
  '     •••••••',
  '   •••••••••',
  '  ••••• ••••',
  ' ••••• ••••',
  ' •••• •••',
  '  •• •••',
  '    ••',
  '     •',
]

export function MossenDotLogo(): React.ReactElement {
  return (
    <Box flexDirection="column">
      {MOSSEN_DOT_LOGO.map((line, index) => (
        <Text key={index} color="mossen">
          {line}
        </Text>
      ))}
    </Box>
  )
}
