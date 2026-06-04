import * as React from 'react'
import { Box } from '../../ink.js'
import { MossenDotLogo } from './MossenDotLogo.js'

// Mossen 点阵 logo 是静态 (无 pose / 无 jump 动画).
// 容器高度 = MOSSEN_DOT_LOGO 行数 (10, 紧凑版) 防止 layout 抖动.
const LEAF_HEIGHT = 10

export function AnimatedMossenDotLogo(): React.ReactElement {
  return (
    <Box height={LEAF_HEIGHT} flexDirection="column">
      <MossenDotLogo />
    </Box>
  )
}
