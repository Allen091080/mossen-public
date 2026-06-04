import React, { useCallback, useEffect, useState } from 'react'
import {
  checkIsGitClean,
  checkNeedsHostedLogin,
} from 'src/utils/background/remote/preconditions.js'
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js'
import { Box, Text } from '../ink.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { TeleportStash } from './TeleportStash.js'

export type TeleportLocalErrorType = 'needsLogin' | 'needsGitStash'

type TeleportErrorProps = {
  onComplete: () => void
  errorsToIgnore?: ReadonlySet<TeleportLocalErrorType>
}

const EMPTY_ERRORS_TO_IGNORE: ReadonlySet<TeleportLocalErrorType> = new Set()

export function TeleportError({
  onComplete,
  errorsToIgnore = EMPTY_ERRORS_TO_IGNORE,
}: TeleportErrorProps): React.ReactNode {
  const [currentError, setCurrentError] =
    useState<TeleportLocalErrorType | null>(null)

  const checkErrors = useCallback(async () => {
    const currentErrors = await getTeleportErrors()
    const filteredErrors = new Set(
      Array.from(currentErrors).filter(error => !errorsToIgnore.has(error)),
    )

    if (filteredErrors.size === 0) {
      onComplete()
      return
    }

    if (filteredErrors.has('needsLogin')) {
      setCurrentError('needsLogin')
      return
    }

    if (filteredErrors.has('needsGitStash')) {
      setCurrentError('needsGitStash')
    }
  }, [onComplete, errorsToIgnore])

  useEffect(() => {
    void checkErrors()
  }, [checkErrors])

  const onCancel = useCallback(() => {
    gracefulShutdownSync(0)
  }, [])

  const handleStashComplete = useCallback(() => {
    void checkErrors()
  }, [checkErrors])

  if (!currentError) {
    return null
  }

  switch (currentError) {
    case 'needsGitStash':
      return (
        <TeleportStash
          onStashAndContinue={handleStashComplete}
          onCancel={onCancel}
        />
      )
    case 'needsLogin':
      return (
        <Dialog
          title={getLocalizedText({
            en: 'Configure Mossen bridge adapter',
            zh: '配置 Mossen bridge adapter',
          })}
          onCancel={onCancel}
        >
          <Box flexDirection="column">
            <Text dimColor>
              {getLocalizedText({
                en: 'Teleport needs a Mossen bridge credential before it can open hosted sessions.',
                zh: 'Teleport 需要 Mossen bridge 凭证后才能打开托管会话。',
              })}
            </Text>
            <Text dimColor>
              {getLocalizedText({
                en: 'The built-in account flow is disabled. Set MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1 and inject a Mossen-managed bridge token, or point Teleport at your own Mossen bridge endpoint.',
                zh: '内置账号流程已禁用。设置 MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1 并注入 Mossen 管理的 bridge token，或将 Teleport 指向你自己的 Mossen bridge endpoint。',
              })}
            </Text>
          </Box>
          <Select
            options={[
              {
                label: getLocalizedText({ en: 'Exit', zh: '退出' }),
                value: 'exit',
              },
            ]}
            onChange={() => onCancel()}
          />
        </Dialog>
      )
  }
}

export async function getTeleportErrors(): Promise<Set<TeleportLocalErrorType>> {
  const errors = new Set<TeleportLocalErrorType>()
  const [needsLogin, isGitClean] = await Promise.all([
    checkNeedsHostedLogin(),
    checkIsGitClean(),
  ])

  if (needsLogin) {
    errors.add('needsLogin')
  }
  if (!isGitClean) {
    errors.add('needsGitStash')
  }

  return errors
}
