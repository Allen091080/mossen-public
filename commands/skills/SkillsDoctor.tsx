import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import type { Command } from '../../commands.js'
import { getCommandName } from '../../commands.js'
import { Box, Text } from '../../ink.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type Props = {
  onComplete: (result?: string) => void
  commands: Command[]
}

type SkillCommand = Extract<Command, { type: 'prompt' }>

function isSkillCommand(cmd: Command): cmd is SkillCommand {
  return cmd.type === 'prompt' && (
    cmd.loadedFrom === 'skills' ||
    cmd.loadedFrom === 'commands_DEPRECATED' ||
    cmd.loadedFrom === 'bundled' ||
    cmd.loadedFrom === 'plugin' ||
    cmd.loadedFrom === 'mcp'
  )
}

function sourceLabel(cmd: SkillCommand): string {
  return cmd.loadedFrom ?? String(cmd.source ?? 'unknown')
}

export function formatSkillsDoctor(commands: Command[]): string {
  const skills = commands.filter(isSkillCommand)
  const bySource = new Map<string, number>()
  const duplicateNames = new Map<string, number>()
  const missingDescription: string[] = []
  const missingPromptHandler: string[] = []
  const unmeasuredContentLength: string[] = []

  for (const skill of skills) {
    const source = sourceLabel(skill)
    bySource.set(source, (bySource.get(source) ?? 0) + 1)
    const name = getCommandName(skill)
    duplicateNames.set(name, (duplicateNames.get(name) ?? 0) + 1)
    if (!skill.description?.trim()) missingDescription.push(name)
    if (typeof skill.getPromptForCommand !== 'function') {
      missingPromptHandler.push(name)
    }
    if (skill.contentLength <= 0 && skill.loadedFrom !== 'bundled') {
      unmeasuredContentLength.push(name)
    }
  }

  const duplicateList = [...duplicateNames.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort()
  const sourceSummary = [...bySource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, count]) => `${source}:${count}`)
    .join(', ') || '(none)'

  const lines: string[] = [
    getLocalizedText({
      en: `${figures.info} Skills doctor (read-only)`,
      zh: `${figures.info} Skills 诊断（只读）`,
    }),
    '',
    getLocalizedText({
      en: `visible skills: ${skills.length}`,
      zh: `可见 skills: ${skills.length} 个`,
    }),
    getLocalizedText({
      en: `sources: ${sourceSummary}`,
      zh: `来源: ${sourceSummary}`,
    }),
  ]

  if (skills.length === 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.warning} No visible skills. Run /skills, create .mossen/skills/, or install with /skills install <github-url>.`,
        zh: `${figures.warning} 当前没有可见 skill。运行 /skills，创建 .mossen/skills/，或用 /skills install <github-url> 安装。`,
      }),
    )
  } else {
    lines.push(
      getLocalizedText({
        en: `${figures.tick} Skill registry is visible to the current session.`,
        zh: `${figures.tick} 当前会话可以看到 skill registry。`,
      }),
    )
  }

  if (duplicateList.length > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.warning} Duplicate visible skill names: ${duplicateList.join(', ')}`,
        zh: `${figures.warning} 可见 skill 名称重复: ${duplicateList.join(', ')}`,
      }),
    )
  }
  if (missingDescription.length > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.warning} Skills missing descriptions: ${missingDescription.slice(0, 8).join(', ')}`,
        zh: `${figures.warning} 缺少描述的 skills: ${missingDescription.slice(0, 8).join(', ')}`,
      }),
    )
  }
  if (missingPromptHandler.length > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.cross} Skills missing prompt handlers: ${missingPromptHandler.slice(0, 8).join(', ')}`,
        zh: `${figures.cross} 缺少 prompt handler 的 skills: ${missingPromptHandler.slice(0, 8).join(', ')}`,
      }),
    )
  }
  if (unmeasuredContentLength.length > 0) {
    lines.push(
      getLocalizedText({
        en: `${figures.info} Skills with unrecorded contentLength metadata: ${unmeasuredContentLength.slice(0, 8).join(', ')}. They may still be usable; verify with /<skill-name>.`,
        zh: `${figures.info} contentLength 元数据未记录的 skills: ${unmeasuredContentLength.slice(0, 8).join(', ')}。这不代表内容为空；可用 /<skill-name> 验证。`,
      }),
    )
  }

  lines.push('')
  lines.push('/skills')
  lines.push('/skills install <github-url>')
  lines.push('/extensions report')
  lines.push(
    getLocalizedText({
      en: 'This doctor is read-only. It does not install skills, load files, edit frontmatter, or modify config.',
      zh: '本 doctor 只读。它不会安装 skill、读取文件内容、修改 frontmatter 或修改配置。',
    }),
  )
  return lines.join('\n')
}

export function SkillsDoctor({ onComplete, commands }: Props): React.ReactNode {
  useEffect(() => {
    onComplete(formatSkillsDoctor(commands))
  }, [commands, onComplete])

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Reading skills doctor…',
          zh: '正在读取 Skills 诊断…',
        })}
      </Text>
    </Box>
  )
}
