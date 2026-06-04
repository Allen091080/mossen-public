import React, { useEffect, useMemo, useState } from 'react'
import type { CommandResultDisplay } from '../commands.js'
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw input for "any key" dismiss and y/n prompt
import { Box, Text, useInput } from '../ink.js'
import { openBrowser } from '../utils/browser.js'
import {
  getDesktopInstallStatus,
  openCurrentSessionInDesktop,
} from '../utils/desktopDeepLink.js'
import {
  getHostedPlatformUrls,
  getDesktopCompanionName,
  hasConfiguredHostedPlatformUrls,
} from '../utils/customBackend.js'
import { getCwd } from '../utils/cwd.js'
import { errorMessage } from '../utils/errors.js'
import { gracefulShutdown } from '../utils/gracefulShutdown.js'
import { flushSessionStorage } from '../utils/sessionStorage.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import {
  getCurrentWorktreeDevTargetSnapshot,
  type WorktreeDevTargetSnapshot,
} from '../utils/worktree.js'
import { LoadingState } from './design-system/LoadingState.js'

export function getDownloadUrl(): string {
  const { desktopMacDownloadUrl, desktopWindowsDownloadUrl } =
    getHostedPlatformUrls()

  switch (process.platform) {
    case 'win32':
      return desktopWindowsDownloadUrl
    default:
      return desktopMacDownloadUrl
  }
}

type DesktopHandoffState =
  | 'checking'
  | 'prompt-download'
  | 'flushing'
  | 'opening'
  | 'success'
  | 'error'

type Props = {
  onDone: (
    result?: string,
    options?: {
      display?: CommandResultDisplay
    },
  ) => void
}

function getDesktopHandoffTargetName(target: WorktreeDevTargetSnapshot): string {
  return target.branch
    ? `${target.displayName} (${target.branch})`
    : target.displayName
}

function getDesktopHandoffResult(target: WorktreeDevTargetSnapshot): string {
  const targetName = getDesktopHandoffTargetName(target)
  return getLocalizedText({
    en:
      target.kind === 'worktree'
        ? `Session for worktree ${targetName} transferred to ${getDesktopCompanionName()}`
        : `Session for project ${targetName} transferred to ${getDesktopCompanionName()}`,
    zh:
      target.kind === 'worktree'
        ? `工作树 ${targetName} 的会话已转移到${getDesktopCompanionName()}`
        : `项目 ${targetName} 的会话已转移到${getDesktopCompanionName()}`,
  })
}

function DesktopHandoffTargetSummary({
  target,
}: {
  target: WorktreeDevTargetSnapshot
}): React.ReactNode {
  if (target.kind === 'worktree') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>
          {getLocalizedText({
            en: 'Current worktree',
            zh: '当前工作树',
          })}
          : {getDesktopHandoffTargetName(target)}
        </Text>
        <Text dimColor>
          {getLocalizedText({
            en: 'Worktree path',
            zh: '工作树路径',
          })}
          : {target.path}
        </Text>
        {target.originalCwd ? (
          <Text dimColor>
            {getLocalizedText({
              en: 'Original repo',
              zh: '原始仓库',
            })}
            : {target.originalCwd}
          </Text>
        ) : null}
      </Box>
    )
  }

  return (
    <Box marginBottom={1}>
      <Text dimColor>
        {getLocalizedText({
          en: 'Project path',
          zh: '项目路径',
        })}
        : {target.path}
      </Text>
    </Box>
  )
}

async function completeDesktopHandoff(
  onDone: Props['onDone'],
  target: WorktreeDevTargetSnapshot,
): Promise<void> {
  onDone(getDesktopHandoffResult(target), {
    display: 'system',
  })
  await gracefulShutdown(0, 'other')
}

export function DesktopHandoff({ onDone }: Props): React.ReactNode {
  const target = useMemo(
    () => getCurrentWorktreeDevTargetSnapshot(getCwd()),
    [],
  )
  const [state, setState] = useState<DesktopHandoffState>('checking')
  const [error, setError] = useState<string | null>(null)
  const [downloadMessage, setDownloadMessage] = useState('')

  useInput(input => {
    const { desktopDocsUrl } = getHostedPlatformUrls()

    if (state === 'error') {
      onDone(error ?? 'Unknown error', {
        display: 'system',
      })
      return
    }

    if (state !== 'prompt-download') {
      return
    }

    if (input === 'y' || input === 'Y') {
      if (!hasConfiguredHostedPlatformUrls()) {
        onDone(
          getLocalizedText({
            en: 'Desktop downloads require a configured hosted platform URL. Set MOSSEN_CODE_PLATFORM_BASE_URL when your own hosted service is ready.',
            zh: '桌面端下载需要先配置真实的 hosted 平台地址。等你自己的 hosted 服务准备好后，设置 MOSSEN_CODE_PLATFORM_BASE_URL 即可启用。',
          }),
          {
            display: 'system',
          },
        )
        return
      }
      openBrowser(getDownloadUrl()).catch(() => {})
      onDone(
        getLocalizedText({
          en: `Starting download for ${target.kind} ${getDesktopHandoffTargetName(
            target,
          )}. Re-run /desktop once you’ve installed the app.\nLearn more at ${desktopDocsUrl}`,
          zh: `开始为${
            target.kind === 'worktree'
              ? `工作树 ${getDesktopHandoffTargetName(target)}`
              : `项目 ${getDesktopHandoffTargetName(target)}`
          }下载桌面应用。安装完成后请重新运行 /desktop。\n更多信息：${desktopDocsUrl}`,
        }),
        {
          display: 'system',
        },
      )
      return
    }

    if (input === 'n' || input === 'N') {
      onDone(
        getLocalizedText({
          en: `The desktop app is required to continue ${target.kind} ${getDesktopHandoffTargetName(
            target,
          )} in /desktop. Learn more at ${desktopDocsUrl}`,
          zh: `/desktop 需要桌面应用支持，才能继续${
            target.kind === 'worktree'
              ? `工作树 ${getDesktopHandoffTargetName(target)}`
              : `项目 ${getDesktopHandoffTargetName(target)}`
          }。更多信息：${desktopDocsUrl}`,
        }),
        {
          display: 'system',
        },
      )
    }
  })

  useEffect(() => {
    let cancelled = false

    async function performHandoff(): Promise<void> {
      const desktopAppName = getDesktopCompanionName()
      const hasHostedPlatform = hasConfiguredHostedPlatformUrls()
      setState('checking')

      const installStatus = await getDesktopInstallStatus()
      if (cancelled) {
        return
      }

      if (installStatus.status === 'not-installed') {
        if (!hasHostedPlatform) {
          setError(
            getLocalizedText({
              en: `${desktopAppName} handoff requires a configured hosted platform URL. Set MOSSEN_CODE_PLATFORM_BASE_URL when your own hosted service is ready.`,
              zh: `${desktopAppName} 交接需要先配置真实的托管平台地址。等你自己的 hosted 服务准备好后，设置 MOSSEN_CODE_PLATFORM_BASE_URL 即可启用。`,
            }),
          )
          setState('error')
          return
        }
        setDownloadMessage(
          getLocalizedText({
            en: `${desktopAppName} is not installed.`,
            zh: `尚未安装${desktopAppName}。`,
          }),
        )
        setState('prompt-download')
        return
      }

      if (installStatus.status === 'version-too-old') {
        if (!hasHostedPlatform) {
          setError(
            getLocalizedText({
              en: `${desktopAppName} needs an update, but no hosted platform URL is configured for downloads.`,
              zh: `${desktopAppName} 需要更新，但当前没有配置可用于下载的 hosted 平台地址。`,
            }),
          )
          setState('error')
          return
        }
        setDownloadMessage(
          getLocalizedText({
            en: `${desktopAppName} needs to be updated (found v${installStatus.version}, need v1.1.2396+).`,
            zh: `${desktopAppName}需要更新（当前版本 v${installStatus.version}，需要 v1.1.2396+）。`,
          }),
        )
        setState('prompt-download')
        return
      }

      setState('flushing')
      await flushSessionStorage()
      if (cancelled) {
        return
      }

      setState('opening')
      const result = await openCurrentSessionInDesktop()
      if (cancelled) {
        return
      }

      if (!result.success) {
        setError(
          result.error ??
            getLocalizedText({
              en: `Failed to open ${desktopAppName} for ${target.kind} ${getDesktopHandoffTargetName(
                target,
              )}`,
              zh: `无法为${
                target.kind === 'worktree'
                  ? `工作树 ${getDesktopHandoffTargetName(target)}`
                  : `项目 ${getDesktopHandoffTargetName(target)}`
              }打开${desktopAppName}`,
            }),
        )
        setState('error')
        return
      }

      setState('success')
      setTimeout(() => {
        void completeDesktopHandoff(onDone, target)
      }, 500)
    }

    void performHandoff().catch(err => {
      if (cancelled) {
        return
      }

      setError(errorMessage(err))
      setState('error')
    })

    return () => {
      cancelled = true
    }
  }, [onDone, target])

  const targetSummary = <DesktopHandoffTargetSummary target={target} />

  if (state === 'error') {
    return (
      <Box flexDirection="column" paddingX={2}>
        {targetSummary}
        <Text color="error">
          {getLocalizedText({
            en: 'Error:',
            zh: '错误：',
          })}{' '}
          {error}
        </Text>
        <Text dimColor>
          {getLocalizedText({
            en: 'Press any key to continue…',
            zh: '按任意键继续…',
          })}
        </Text>
      </Box>
    )
  }

  if (state === 'prompt-download') {
    return (
      <Box flexDirection="column" paddingX={2}>
        {targetSummary}
        <Text>{downloadMessage}</Text>
        <Text>
          {getLocalizedText({
            en: 'Download now? (y/n)',
            zh: '现在下载吗？(y/n)',
          })}
        </Text>
      </Box>
    )
  }

  const messages: Record<
    Exclude<DesktopHandoffState, 'error' | 'prompt-download'>,
    string
  > = {
    checking: getLocalizedText({
      en: `Checking for ${getDesktopCompanionName()}…`,
      zh: `正在检查${getDesktopCompanionName()}…`,
    }),
    flushing: getLocalizedText({
      en: 'Saving session…',
      zh: '正在保存会话…',
    }),
    opening: getLocalizedText({
      en: `Opening ${getDesktopCompanionName()}…`,
      zh: `正在打开${getDesktopCompanionName()}…`,
    }),
    success: getLocalizedText({
      en: `Opening in ${getDesktopCompanionName()}…`,
      zh: `正在转到${getDesktopCompanionName()}…`,
    }),
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      {targetSummary}
      <LoadingState message={messages[state]} />
    </Box>
  )
}
