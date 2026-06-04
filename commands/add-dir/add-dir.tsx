import chalk from 'chalk'
import figures from 'figures'
import React, { useEffect } from 'react'
import {
  getAdditionalDirectoriesForMossenMd,
  setAdditionalDirectoriesForMossenMd,
} from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { MessageResponse } from '../../components/MessageResponse.js'
import { AddWorkspaceDirectory } from '../../components/permissions/rules/AddWorkspaceDirectory.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  applyPermissionUpdate,
  persistPermissionUpdate,
} from '../../utils/permissions/PermissionUpdate.js'
import type { PermissionUpdateDestination } from '../../utils/permissions/PermissionUpdateSchema.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { addDirHelpMessage, validateDirectoryForWorkspace } from './validation.js'

function AddDirError({
  message,
  args,
  onDone,
}: {
  message: string
  args: string
  onDone: () => void
}): React.ReactNode {
  useEffect(() => {
    const timer = setTimeout(onDone, 0)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {figures.pointer} /add-dir {args}
      </Text>
      <MessageResponse>
        <Text>{message}</Text>
      </MessageResponse>
    </Box>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const directoryPath = (args ?? '').trim()
  const appState = context.getAppState()

  const handleAddDirectory = async (path: string, remember = false) => {
    const destination: PermissionUpdateDestination = remember
      ? 'localSettings'
      : 'session'

    const permissionUpdate = {
      type: 'addDirectories' as const,
      directories: [path],
      destination,
    }

    const latestAppState = context.getAppState()
    const updatedContext = applyPermissionUpdate(
      latestAppState.toolPermissionContext,
      permissionUpdate,
    )
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: updatedContext,
    }))

    const currentDirs = getAdditionalDirectoriesForMossenMd()
    if (!currentDirs.includes(path)) {
      setAdditionalDirectoriesForMossenMd([...currentDirs, path])
    }
    SandboxManager.refreshConfig()

    let message: string
    if (remember) {
      try {
        persistPermissionUpdate(permissionUpdate)
        message = getLocalizedText({
          en: `Added ${chalk.bold(path)} as a working directory and saved to local settings`,
          zh: `已将 ${chalk.bold(path)} 添加为工作目录，并保存到本地设置`,
        })
      } catch (error) {
        message = getLocalizedText({
          en: `Added ${chalk.bold(path)} as a working directory. Failed to save to local settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
          zh: `已将 ${chalk.bold(path)} 添加为工作目录，但保存到本地设置失败：${error instanceof Error ? error.message : '未知错误'}`,
        })
      }
    } else {
      message = getLocalizedText({
        en: `Added ${chalk.bold(path)} as a working directory for this session`,
        zh: `已将 ${chalk.bold(path)} 添加为当前会话的工作目录`,
      })
    }

    const messageWithHint = `${message} ${chalk.dim(
      getLocalizedText({
        en: '· /permissions to manage',
        zh: '· 使用 /permissions 管理',
      }),
    )}`
    onDone(messageWithHint)
  }

  if (!directoryPath) {
    return (
      <AddWorkspaceDirectory
        permissionContext={appState.toolPermissionContext}
        onAddDirectory={handleAddDirectory}
        onCancel={() => {
          onDone(
            getLocalizedText({
              en: 'Did not add a working directory.',
              zh: '未添加工作目录。',
            }),
          )
        }}
      />
    )
  }

  const result = await validateDirectoryForWorkspace(
    directoryPath,
    appState.toolPermissionContext,
  )

  if (result.resultType !== 'success') {
    const message = addDirHelpMessage(result)
    return (
      <AddDirError
        message={message}
        args={args ?? ''}
        onDone={() => onDone(message)}
      />
    )
  }

  return (
    <AddWorkspaceDirectory
      directoryPath={result.absolutePath}
      permissionContext={appState.toolPermissionContext}
      onAddDirectory={handleAddDirectory}
      onCancel={() => {
        onDone(
          getLocalizedText({
            en: `Did not add ${chalk.bold(result.absolutePath)} as a working directory.`,
            zh: `未将 ${chalk.bold(result.absolutePath)} 添加为工作目录。`,
          }),
        )
      }}
    />
  )
}
