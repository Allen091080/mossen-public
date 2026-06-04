import { homedir } from 'os'
import { basename, normalize, sep } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionResult } from './PermissionResult.js'
import type { PermissionRule } from './PermissionRule.js'
import { permissionRuleValueToString } from './permissionRuleParser.js'
import { getAllowRules } from './permissions.js'
import {
  loadAllHardDenyPermissionRulesFromDisk,
  shouldAllowManagedPermissionRulesOnly,
} from './permissionsLoader.js'
import {
  matchWildcardPattern,
  parsePermissionRule,
} from './shellRuleMatching.js'

const BASH_TOOL_NAME = 'Bash'
const EDIT_TOOL_NAME = 'Edit'

type BuiltinHardDenyMatch = {
  toolName: string
  rule: string
  reason: string
}

export type HardDenyDecision = PermissionResult & {
  behavior: 'deny'
}

function shellWhitespace(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

function trimShellQuotes(input: string): string {
  return input.replace(/^['"]|['"]$/g, '')
}

function hasRecursiveForce(flags: string): boolean {
  return flags.startsWith('-') && flags.includes('r') && flags.includes('f')
}

function isRootOrHomeToken(token: string): boolean {
  const cleaned = trimShellQuotes(token)
  return cleaned === '/' || cleaned === '~'
}

function matchBuiltinBashHardDeny(command: string): BuiltinHardDenyMatch | null {
  const normalized = shellWhitespace(command)
  const tokens = normalized.split(' ').filter(Boolean)
  const commandName = tokens[0]
  const commandOffset = commandName === 'sudo' ? 1 : 0
  const baseCommand = tokens[commandOffset]

  if (
    baseCommand === 'rm' &&
    tokens[commandOffset + 1] &&
    hasRecursiveForce(tokens[commandOffset + 1]!) &&
    tokens.slice(commandOffset + 2).some(isRootOrHomeToken)
  ) {
    const target = tokens.slice(commandOffset + 2).find(isRootOrHomeToken)
    return {
      toolName: BASH_TOOL_NAME,
      rule:
        commandName === 'sudo'
          ? `Bash(sudo rm -rf ${target})`
          : `Bash(rm -rf ${target})`,
      reason: `Hard deny blocked destructive removal of ${trimShellQuotes(
        target ?? 'a protected path',
      )}`,
    }
  }

  if (
    baseCommand === 'chmod' &&
    tokens[commandOffset + 1]?.includes('R') &&
    tokens[commandOffset + 2] === '777' &&
    tokens.slice(commandOffset + 3).some(token => trimShellQuotes(token) === '/')
  ) {
    return {
      toolName: BASH_TOOL_NAME,
      rule: 'Bash(chmod -R 777 /)',
      reason: 'Hard deny blocked recursive world-writable chmod on /',
    }
  }

  if (baseCommand && /^mkfs(?:[.\w-]*)?$/.test(baseCommand)) {
    return {
      toolName: BASH_TOOL_NAME,
      rule: 'Bash(mkfs*)',
      reason: `Hard deny blocked filesystem formatting command ${baseCommand}`,
    }
  }

  return null
}

export function matchBuiltinEditHardDeny(path: string): BuiltinHardDenyMatch | null {
  const normalizedPath = normalize(path)
  const sshDir = normalize(`${homedir()}${sep}.ssh`)
  if (
    normalizedPath.startsWith(`${sshDir}${sep}`) &&
    basename(normalizedPath).startsWith('id_')
  ) {
    return {
      toolName: EDIT_TOOL_NAME,
      rule: 'Edit(~/.ssh/id_*)',
      reason: 'Hard deny blocked editing private SSH key material',
    }
  }
  return null
}

function userRuleMatchesBash(rule: PermissionRule, command: string): boolean {
  if (rule.ruleValue.toolName !== BASH_TOOL_NAME) return false
  const ruleContent = rule.ruleValue.ruleContent
  if (ruleContent === undefined) return true

  const parsed = parsePermissionRule(ruleContent)
  const normalizedCommand = shellWhitespace(command)
  switch (parsed.type) {
    case 'exact':
      return normalizedCommand === shellWhitespace(parsed.command)
    case 'prefix':
      return (
        normalizedCommand === parsed.prefix ||
        normalizedCommand.startsWith(`${parsed.prefix} `)
      )
    case 'wildcard':
      return matchWildcardPattern(parsed.pattern, normalizedCommand)
  }
}

function allowRuleMatchesBash(
  command: string,
  toolPermissionContext: ToolPermissionContext,
): boolean {
  return getAllowRules(toolPermissionContext).some(rule =>
    userRuleMatchesBash(rule, command),
  )
}

export function getConfiguredHardDenyRuleCount(): number {
  return loadAllHardDenyPermissionRulesFromDisk().length
}

export function getHardDenySettingsMode(): 'managed-only' | 'all-enabled' {
  return shouldAllowManagedPermissionRulesOnly() ? 'managed-only' : 'all-enabled'
}

export function checkBashHardDeny(
  command: string,
  toolPermissionContext: ToolPermissionContext,
): HardDenyDecision | null {
  const configuredRule = loadAllHardDenyPermissionRulesFromDisk().find(rule =>
    userRuleMatchesBash(rule, command),
  )
  if (configuredRule) {
    return {
      behavior: 'deny',
      message: `Permission to use Bash with command ${command} has been hard denied.`,
      decisionReason: {
        type: 'rule',
        rule: configuredRule,
      },
    }
  }

  const builtinMatch = matchBuiltinBashHardDeny(command)
  if (!builtinMatch || allowRuleMatchesBash(command, toolPermissionContext)) {
    return null
  }

  return {
    behavior: 'deny',
    message: builtinMatch.reason,
    decisionReason: {
      type: 'other',
      reason: `${builtinMatch.reason} (${builtinMatch.rule})`,
    },
  }
}

export function formatHardDenyRule(rule: PermissionRule): string {
  return permissionRuleValueToString(rule.ruleValue)
}
