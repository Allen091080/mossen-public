import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js'
import {
  setupTerminal,
  shouldOfferTerminalSetup,
} from '../commands/terminalSetup/terminalSetup.js'
import { getProductAssistantName } from '../constants/product.js'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { Box, Link, Newline, Text, useTheme } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { normalizeApiKeyForConfig } from '../utils/authPortable.js'
import { getCustomApiKeyStatus } from '../utils/config.js'
import { getHostedPlatformUrls } from '../utils/customBackend.js'
import { env } from '../utils/env.js'
import { isRunningOnHomespace } from '../utils/envUtils.js'
import { PreflightStep } from '../utils/preflightChecks.js'
import type { ThemeSetting } from '../utils/theme.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import { ApproveApiKey } from './ApproveApiKey.js'
import { ProfileWizardStep } from './ProfileWizardStep.js'
import { MemorySidecarWizardStep } from './MemorySidecarWizardStep.js'
import { getActiveProfile } from '../services/config/profiles.js'
import { Select } from './CustomSelect/select.js'
import { WelcomeV2 } from './LogoV2/WelcomeV2.js'
import { PressEnterToContinue } from './PressEnterToContinue.js'
import { ThemePicker } from './ThemePicker.js'
import { OrderedList } from './ui/OrderedList.js'

type StepId =
  | 'preflight'
  | 'theme'
  | 'api-key'
  | 'profile-wizard'
  | 'security'
  | 'memory-sidecar-wizard'
  | 'terminal-setup'

type OnboardingStep = {
  id: StepId
  component: React.ReactNode
}

type Props = {
  onDone(): void
}

export function Onboarding({ onDone }: Props): React.ReactNode {
  const assistantName = getProductAssistantName()
  const { securityDocsUrl } = getHostedPlatformUrls()
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [theme, setTheme] = useTheme()
  const exitState = useExitOnCtrlCDWithKeybindings()

  useEffect(() => {
    logMossenEvent('mossen.onboarding.started', {
      hostedAuthAdapterEnabled: false,
    })
  }, [])

  const apiKeyNeedingApproval = useMemo(() => {
    // On homespace, MOSSEN_CODE_API_KEY is preserved for child processes but ignored by Mossen itself (see auth.ts).
    if (!process.env.MOSSEN_CODE_API_KEY || isRunningOnHomespace()) {
      return ''
    }
    const customApiKeyTruncated = normalizeApiKeyForConfig(
      process.env.MOSSEN_CODE_API_KEY,
    )
    return getCustomApiKeyStatus(customApiKeyTruncated) === 'new'
      ? customApiKeyTruncated
      : ''
  }, [])

  const stepsRef = useRef<OnboardingStep[]>([])
  const steps: OnboardingStep[] = []

  const goToNextStep = useCallback(() => {
    const currentSteps = stepsRef.current
    if (currentStepIndex < currentSteps.length - 1) {
      const nextIndex = currentStepIndex + 1
      setCurrentStepIndex(nextIndex)
      logMossenEvent('mossen.onboarding.step', {
        hostedAuthAdapterEnabled: false,
        stepId: currentSteps[nextIndex]
          ?.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else {
      onDone()
    }
  }, [currentStepIndex, onDone])

  function handleThemeSelection(newTheme: ThemeSetting) {
    setTheme(newTheme)
    goToNextStep()
  }

  function handleApiKeyDone() {
    goToNextStep()
  }

  const preflightStep = <PreflightStep onSuccess={goToNextStep} />

  const themeStep = (
    <Box marginX={1}>
      <ThemePicker
        onThemeSelect={handleThemeSelection}
        showIntroText={true}
        helpText={getLocalizedText({
          en: 'To change this later, run /theme',
          zh: '以后如需修改，请运行 /theme',
        })}
        hideEscToCancel={true}
        skipExitHandling={true}
      />
    </Box>
  )

  const securityStep = (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>
        {getLocalizedText({ en: 'Security notes:', zh: '安全提示：' })}
      </Text>
      <Box flexDirection="column" width={70}>
        <OrderedList>
          <OrderedList.Item>
            <Text>
              {getLocalizedText({
                en: `${assistantName} can make mistakes`,
                zh: `${assistantName} 也可能出错`,
              })}
            </Text>
            <Text dimColor wrap="wrap">
              {getLocalizedText({
                en: "You should always review the assistant's responses, especially when",
                zh: '请始终审查助手的回答，尤其是在',
              })}
              <Newline />
              {getLocalizedText({ en: 'running code.', zh: '运行代码时。' })}
              <Newline />
            </Text>
          </OrderedList.Item>
          <OrderedList.Item>
            <Text>
              {getLocalizedText({
                en: 'Due to prompt injection risks, only use it with code you trust',
                zh: '由于提示注入风险，请只在你信任的代码库中使用它。',
              })}
            </Text>
            <Text dimColor wrap="wrap">
              {getLocalizedText({
                en: 'For more details see:',
                zh: '更多详情请参阅：',
              })}
              <Newline />
              <Link url={securityDocsUrl} />
            </Text>
          </OrderedList.Item>
        </OrderedList>
      </Box>
      <PressEnterToContinue />
    </Box>
  )

  steps.push({ id: 'preflight', component: preflightStep })
  steps.push({ id: 'theme', component: themeStep })

  if (apiKeyNeedingApproval) {
    steps.push({
      id: 'api-key',
      component: (
        <ApproveApiKey
          customApiKeyTruncated={apiKeyNeedingApproval}
          onDone={handleApiKeyDone}
        />
      ),
    })
  }

  // W459: First-launch LLM profile wizard. W452-full promotion — closes
  // the B-class onboarding gap (binary direct-run users had no path to
  // configure a working LLM profile during onboarding; OAuth fallback
  // dies against mossen.invalid). Only shown when no active profile is
  // configured: users who already have ~/.mossen/settings.json with an
  // active profile (Allen with 9 profiles, cli-harness which writes
  // profile before spawning the binary) skip this step entirely.
  if (getActiveProfile() === null) {
    steps.push({
      id: 'profile-wizard',
      component: <ProfileWizardStep onDone={goToNextStep} />,
    })
  }

  steps.push({ id: 'security', component: securityStep })

  // W459-full Batch 4: memory-sidecar LLM wizard (promotes W452 minimum
  // notice). Interactive 3-prompt flow that defaults to skip — sidecar
  // classification is optional, mossen works fine without it. Users who
  // pick "Configure now" get baseURL + model + env-var-name prompts and
  // setMemorySidecarLlmConfig() writes the config in one pass.
  steps.push({
    id: 'memory-sidecar-wizard',
    component: <MemorySidecarWizardStep onDone={goToNextStep} />,
  })

  if (shouldOfferTerminalSetup()) {
    steps.push({
      id: 'terminal-setup',
      component: (
        <Box flexDirection="column" gap={1} paddingLeft={1}>
          <Text bold>
            {getLocalizedText({
              en: 'Use the terminal setup helper?',
              zh: '要使用终端设置助手吗？',
            })}
          </Text>
          <Box flexDirection="column" width={70} gap={1}>
            <Text>
              {getLocalizedText({
                en: 'For the optimal coding experience, enable the recommended settings',
                zh: '为了获得更好的编码体验，请启用推荐设置',
              })}
              <Newline />
              {getLocalizedText({
                en: 'for your terminal:',
                zh: '为你的终端进行设置：',
              })}{' '}
              {env.terminal === 'Apple_Terminal'
                ? getLocalizedText({
                    en: 'Option+Enter for newlines and visual bell',
                    zh: 'Option+Enter 用于换行，并启用视觉提示铃',
                  })
                : getLocalizedText({
                    en: 'Shift+Enter for newlines',
                    zh: 'Shift+Enter 用于换行',
                  })}
            </Text>
            <Select
              options={[
                {
                  label: getLocalizedText({
                    en: 'Yes, use recommended settings',
                    zh: '是，使用推荐设置',
                  }),
                  value: 'install',
                },
                {
                  label: getLocalizedText({
                    en: 'No, maybe later with /terminal-setup',
                    zh: '否，稍后再用 /terminal-setup',
                  }),
                  value: 'no',
                },
              ]}
              onChange={value => {
                if (value === 'install') {
                  void setupTerminal(theme).catch(() => {}).finally(goToNextStep)
                } else {
                  goToNextStep()
                }
              }}
              onCancel={() => goToNextStep()}
            />
            <Text dimColor>
              {exitState.pending
                ? getLocalizedText({
                    en: `Press ${exitState.keyName} again to exit`,
                    zh: `再按 ${exitState.keyName} 退出`,
                  })
                : getLocalizedText({
                    en: 'Enter to confirm · Esc to skip',
                    zh: 'Enter 确认 · Esc 跳过',
                  })}
            </Text>
          </Box>
        </Box>
      ),
    })
  }
  stepsRef.current = steps

  const currentStep = steps[currentStepIndex]

  const handleSecurityContinue = useCallback(() => {
    if (currentStepIndex === steps.length - 1) {
      onDone()
    } else {
      goToNextStep()
    }
  }, [currentStepIndex, steps.length, onDone, goToNextStep])

  const handleTerminalSetupSkip = useCallback(() => {
    goToNextStep()
  }, [goToNextStep])

  useKeybindings(
    { 'confirm:yes': handleSecurityContinue },
    { context: 'Confirmation', isActive: currentStep?.id === 'security' },
  )

  useKeybindings(
    { 'confirm:no': handleTerminalSetupSkip },
    {
      context: 'Confirmation',
      isActive: currentStep?.id === 'terminal-setup',
    },
  )

  return (
    <Box flexDirection="column">
      <WelcomeV2 />
      <Box flexDirection="column" marginTop={1}>
        {currentStep?.component}
        {exitState.pending && (
          <Box padding={1}>
            <Text dimColor>
              {getLocalizedText({
                en: `Press ${exitState.keyName} again to exit`,
                zh: `再按 ${exitState.keyName} 退出`,
              })}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
