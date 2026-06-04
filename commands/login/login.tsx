import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getProductDisplayName } from '../../constants/product.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

export function getHostedAuthDisabledMessage(): string {
  return getLocalizedText({
    en: `${getProductDisplayName()} does not use a built-in account flow on this branch. Configure backend credentials with MOSSEN_CODE_CUSTOM_BASE_URL plus MOSSEN_CODE_CUSTOM_API_KEY or MOSSEN_CODE_CUSTOM_AUTH_TOKEN. If you intentionally wrap an external hosted service, enable that Mossen adapter explicitly with MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1 and inject its credentials there.`,
    zh: `${getProductDisplayName()} 当前分支不使用内置账号流程。请通过 MOSSEN_CODE_CUSTOM_BASE_URL 加 MOSSEN_CODE_CUSTOM_API_KEY 或 MOSSEN_CODE_CUSTOM_AUTH_TOKEN 配置后端凭据。如果确实要封装外部托管服务，请显式设置 MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1，并在该 Mossen adapter 中注入凭据。`,
  })
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  onDone(getHostedAuthDisabledMessage(), { display: 'system' })
  return null
}

export function Login(): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>
        {getLocalizedText({
          en: 'Built-in account flow is disabled',
          zh: '内置账号流程已禁用',
        })}
      </Text>
      <Text wrap="wrap">{getHostedAuthDisabledMessage()}</Text>
    </Box>
  )
}
