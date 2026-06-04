/**
 * Shared utilities for expanding environment variables in MCP server configurations
 */

/**
 * Expand environment variables in a string value
 * Handles ${VAR} and ${VAR:-default} syntax
 * @returns Object with expanded string and list of missing variables
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
    // Support common shell parameter forms used in .mcp.json snippets:
    // ${VAR}, ${VAR-default}, ${VAR:-default}, ${VAR+alt},
    // ${VAR:+alt}, ${VAR?message}, ${VAR:?message}. We do not mutate the
    // environment for assignment forms; they behave as default values here.
    const parsed = /^([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-=+?])(.*))?$/.exec(
      varContent,
    )
    if (!parsed) return match

    const [, varName, operator, operand = ''] = parsed
    const envValue = process.env[varName]
    const isSet = envValue !== undefined
    const isNonEmpty = envValue !== undefined && envValue !== ''

    if (!operator) {
      if (isSet) return envValue
      missingVars.push(varName)
      return match
    }

    switch (operator) {
      case '-':
        return isSet ? envValue : operand
      case ':-':
        return isNonEmpty ? envValue : operand
      case '=':
        return isSet ? envValue : operand
      case ':=':
        return isNonEmpty ? envValue : operand
      case '+':
        return isSet ? operand : ''
      case ':+':
        return isNonEmpty ? operand : ''
      case '?':
        if (isSet) return envValue
        missingVars.push(varName)
        return match
      case ':?':
        if (isNonEmpty) return envValue
        missingVars.push(varName)
        return match
      default:
        return match
    }
  })

  return {
    expanded,
    missingVars,
  }
}
