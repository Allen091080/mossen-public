import React from 'react'
import { getMcpConfigsByScope } from 'src/services/mcp/config.js'
import type { ConfigScope } from 'src/services/mcp/types.js'
import {
  describeMcpConfigFilePath,
  getScopeLabel,
} from 'src/services/mcp/utils.js'
import type { ValidationError } from 'src/utils/settings/validation.js'
import { Box, Link, Text } from '../../ink.js'
import { getHostedPlatformUrls } from '../../utils/customBackend.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

function getMcpDocsUrl() {
  return `${getHostedPlatformUrls().remoteBaseUrl}/docs/mcp`
}

function McpConfigErrorSection({
  scope,
  parsingErrors,
  warnings,
}: {
  scope: ConfigScope
  parsingErrors: ValidationError[]
  warnings: ValidationError[]
}): React.ReactNode {
  const hasErrors = parsingErrors.length > 0
  const hasWarnings = warnings.length > 0

  if (!hasErrors && !hasWarnings) {
    return null
  }

  const statusLabel = hasErrors
    ? getLocalizedText({ en: 'Failed to parse', zh: '解析失败' })
    : getLocalizedText({ en: 'Contains warnings', zh: '包含警告' })

  const locationLabel = getLocalizedText({ en: 'Location: ', zh: '位置：' })
  const warningLabel = getLocalizedText({ en: 'Warning', zh: '警告' })
  const errorLabel = getLocalizedText({ en: 'Error', zh: '错误' })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={hasErrors ? 'error' : 'warning'}>[{statusLabel}] </Text>
        <Text>{getScopeLabel(scope)}</Text>
      </Box>
      <Box>
        <Text dimColor>{locationLabel}</Text>
        <Text dimColor>{describeMcpConfigFilePath(scope)}</Text>
      </Box>
      <Box marginLeft={1} flexDirection="column">
        {parsingErrors.map((error, i) => {
          const serverName = error.mcpErrorMetadata?.serverName
          return (
            <Box key={`error-${i}`}>
              <Text>
                <Text dimColor>└ </Text>
                <Text color="error">[{errorLabel}]</Text>
                <Text dimColor>
                  {' '}
                  {serverName && `[${serverName}] `}
                  {error.path && error.path !== '' ? `${error.path}: ` : ''}
                  {error.message}
                </Text>
              </Text>
            </Box>
          )
        })}
        {warnings.map((warning, i) => {
          const serverName = warning.mcpErrorMetadata?.serverName
          return (
            <Box key={`warning-${i}`}>
              <Text>
                <Text dimColor>└ </Text>
                <Text color="warning">[{warningLabel}]</Text>
                <Text dimColor>
                  {' '}
                  {serverName && `[${serverName}] `}
                  {warning.path && warning.path !== '' ? `${warning.path}: ` : ''}
                  {warning.message}
                </Text>
              </Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export function McpParsingWarnings() {
  const scopes = [
    { scope: 'user', config: getMcpConfigsByScope('user') },
    { scope: 'project', config: getMcpConfigsByScope('project') },
    { scope: 'local', config: getMcpConfigsByScope('local') },
    { scope: 'enterprise', config: getMcpConfigsByScope('enterprise') },
  ] satisfies Array<{
    scope: ConfigScope
    config: { errors: ValidationError[] }
  }>

  const hasParsingErrors = scopes.some(({ config }) => {
    return filterErrors(config.errors, 'fatal').length > 0
  })
  const hasWarnings = scopes.some(({ config }) => {
    return filterErrors(config.errors, 'warning').length > 0
  })

  if (!hasParsingErrors && !hasWarnings) {
    return null
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text bold>{getLocalizedText({ en: 'MCP Config Diagnostics', zh: 'MCP 配置诊断' })}</Text>
      <Box marginTop={1}>
        <Text dimColor>
          {getLocalizedText({
            en: 'For help configuring MCP servers, see: ',
            zh: '如需配置 MCP 服务器，请参阅：',
          })}
          <Link url={getMcpDocsUrl()}>{getMcpDocsUrl()}</Link>
        </Text>
      </Box>
      {scopes.map(({ scope, config }) => (
        <React.Fragment key={scope}>
          <McpConfigErrorSection
            scope={scope}
            parsingErrors={filterErrors(config.errors, 'fatal')}
            warnings={filterErrors(config.errors, 'warning')}
          />
        </React.Fragment>
      ))}
    </Box>
  )
}

function filterErrors(
  errors: ValidationError[],
  severity: 'fatal' | 'warning',
): ValidationError[] {
  return errors.filter(e => e.mcpErrorMetadata?.severity === severity)
}
