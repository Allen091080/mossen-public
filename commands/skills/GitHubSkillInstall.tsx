import figures from 'figures'
import * as React from 'react'
import { useEffect } from 'react'
import { Box, Text } from '../../ink.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { plural } from '../../utils/stringUtils.js'
import {
  executeGitHubSkillInstallPlan,
  getGitHubSkillInstallPlan,
  GITHUB_SKILL_INSTALL_TOKEN_TTL_MS,
  type GitHubSkillInstallPlan,
  type GitHubSkillInstallResult,
} from '../../utils/skills/githubSkillInstall.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

type Props = {
  onComplete: (result?: string) => void
  target?: string
  confirmToken?: string
}

const SIZE_UNITS = ['B', 'KB', 'MB'] as const

function formatBytes(n: number): string {
  let value = n
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)}${SIZE_UNITS[unit]}`
}

function formatDryRun(plan: GitHubSkillInstallPlan): string {
  const ttlMin = Math.floor(GITHUB_SKILL_INSTALL_TOKEN_TTL_MS / 60_000)
  const lines: string[] = []
  lines.push(
    getLocalizedText({
      en: `${figures.info} GitHub skill install (dry-run)`,
      zh: `${figures.info} GitHub skill 安装（dry-run 预览）`,
    }),
  )
  lines.push('')
  lines.push(
    getLocalizedText({
      en: `Source: ${plan.target.original}`,
      zh: `来源：${plan.target.original}`,
    }),
  )
  lines.push(`GitHub: ${plan.target.owner}/${plan.target.repo}@${plan.target.ref}`)
  if (plan.target.path) lines.push(`Path: ${plan.target.path}`)
  lines.push(`Skill: ${plan.skillName}`)
  lines.push(
    getLocalizedText({
      en: `Description: ${plan.description}`,
      zh: `描述：${plan.description}`,
    }),
  )
  lines.push(
    getLocalizedText({
      en: `Install path: ${plan.installDir}`,
      zh: `安装路径：${plan.installDir}`,
    }),
  )
  lines.push(
    getLocalizedText({
      en: `Files: ${plan.files.length} ${plural(plan.files.length, 'file')} · ${formatBytes(plan.totalBytes)}`,
      zh: `文件：${plan.files.length} 个 · ${formatBytes(plan.totalBytes)}`,
    }),
  )
  for (const file of plan.files.slice(0, 12)) {
    lines.push(`  ${file.path}  ${formatBytes(file.sizeBytes)}`)
  }
  if (plan.files.length > 12) {
    lines.push(`  … ${plan.files.length - 12} more`)
  }
  if (plan.warnings.length > 0) {
    lines.push('')
    lines.push(getLocalizedText({ en: 'Warnings:', zh: '警告：' }))
    for (const warning of plan.warnings) lines.push(`  ${figures.warning} ${warning}`)
  }
  lines.push('')
  lines.push(
    getLocalizedText({
      en: `To install this skill, run within ${ttlMin} min:`,
      zh: `如要安装此 skill，请在 ${ttlMin} 分钟内运行：`,
    }),
  )
  lines.push(`  /skills install --confirm ${plan.token}`)
  return lines.join('\n')
}

function formatResult(result: GitHubSkillInstallResult): string {
  switch (result.status) {
    case 'unknown_token':
      return getLocalizedText({
        en: `${figures.cross} Unknown confirm token. Run /skills install <github-url> first.`,
        zh: `${figures.cross} 未知确认 token。请先运行 /skills install <github-url>。`,
      })
    case 'expired_token':
      return getLocalizedText({
        en: `${figures.cross} Confirm token expired. Run /skills install <github-url> again.`,
        zh: `${figures.cross} 确认 token 已过期。请重新运行 /skills install <github-url>。`,
      })
    case 'already_exists':
      return getLocalizedText({
        en: `${figures.cross} Skill already exists: ${result.installDir}`,
        zh: `${figures.cross} Skill 已存在：${result.installDir}`,
      })
    case 'invalid_target':
      return getLocalizedText({
        en: `${figures.cross} Invalid GitHub skill target: ${result.reason}`,
        zh: `${figures.cross} GitHub skill 目标无效：${result.reason}`,
      })
    case 'installed': {
      const lines: string[] = [
        getLocalizedText({
          en: `${figures.tick} Installed GitHub skill: ${result.skillName}`,
          zh: `${figures.tick} 已安装 GitHub skill：${result.skillName}`,
        }),
        getLocalizedText({
          en: `Path: ${result.installDir}`,
          zh: `路径：${result.installDir}`,
        }),
        getLocalizedText({
          en: `Files written: ${result.filesWritten} · ${formatBytes(result.totalBytes)}`,
          zh: `写入文件：${result.filesWritten} 个 · ${formatBytes(result.totalBytes)}`,
        }),
        getLocalizedText({
          en: 'Skill caches were refreshed. If it is not visible immediately, run /skills again.',
          zh: '已刷新 skill 缓存。如果没有立刻显示，请重新运行 /skills。',
        }),
        '',
        getLocalizedText({
          en: 'Next: /skills',
          zh: '下一步：/skills',
        }),
        getLocalizedText({
          en: 'For all extension install commands: /extensions',
          zh: '查看所有扩展安装命令：/extensions',
        }),
      ]
      if (result.warnings.length > 0) {
        lines.push('')
        lines.push(getLocalizedText({ en: 'Warnings:', zh: '警告：' }))
        for (const warning of result.warnings) lines.push(`  ${figures.warning} ${warning}`)
      }
      return lines.join('\n')
    }
  }
}

export function GitHubSkillInstall({
  onComplete,
  target,
  confirmToken,
}: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        if (confirmToken) {
          const result = await executeGitHubSkillInstallPlan(confirmToken)
          if (!cancelled) onComplete(formatResult(result))
          return
        }
        if (!target) {
          onComplete(
            getLocalizedText({
              en: 'Usage: /skills install <github-url>',
              zh: '用法：/skills install <github-url>',
            }),
          )
          return
        }
        const plan = await getGitHubSkillInstallPlan(target)
        if (cancelled) return
        if ('status' in plan) {
          onComplete(formatResult(plan))
          return
        }
        onComplete(formatDryRun(plan))
      } catch (error) {
        if (cancelled) return
        logError(error)
        onComplete(
          getLocalizedText({
            en: `${figures.cross} GitHub skill install failed: ${errorMessage(error)}`,
            zh: `${figures.cross} GitHub skill 安装失败：${errorMessage(error)}`,
          }),
        )
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [onComplete, target, confirmToken])

  return (
    <Box>
      <Text dimColor>
        {confirmToken
          ? getLocalizedText({
              en: 'Installing GitHub skill…',
              zh: '正在安装 GitHub skill…',
            })
          : getLocalizedText({
              en: 'Checking GitHub skill…',
              zh: '正在检查 GitHub skill…',
            })}
      </Text>
    </Box>
  )
}
