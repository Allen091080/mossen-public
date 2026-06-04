import memoize from 'lodash-es/memoize.js'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from './utils/config.js'
import { getCwd } from './utils/cwd.js'
import { isDirEmpty } from './utils/file.js'
import { getFsImplementation } from './utils/fsOperations.js'
import {
  getProductAssistantName,
  getProductCliName,
  getProjectInstructionsDisplayName,
} from './constants/product.js'
import { getProjectInstructionsReadCandidates } from './utils/naming.js'
import { getLocalizedText } from './utils/uiLanguage.js'

export type Step = {
  key: string
  text: string
  isComplete: boolean
  isCompletable: boolean
  isEnabled: boolean
}

export function getSteps(): Step[] {
  const hasInstructionsFile = getProjectInstructionsReadCandidates(getCwd()).some(
    candidate => getFsImplementation().existsSync(candidate),
  )
  const isWorkspaceDirEmpty = isDirEmpty(getCwd())
  const assistantName = getProductAssistantName()
  const cliName = getProductCliName()
  const instructionsFileName = getProjectInstructionsDisplayName()

  return [
    {
      key: 'workspace',
      text: getLocalizedText({
        en: `Ask ${assistantName} to create a new app or clone a repository`,
        zh: `让 ${assistantName} 创建一个新应用，或克隆一个仓库`,
      }),
      isComplete: false,
      isCompletable: true,
      isEnabled: isWorkspaceDirEmpty,
    },
    {
      key: 'mossenmd',
      text: getLocalizedText({
        en: `Run /init to create a ${instructionsFileName} project instructions file for ${assistantName} (${cliName})`,
        zh: `运行 /init，为 ${assistantName}（${cliName}）创建 ${instructionsFileName} 项目说明文件`,
      }),
      isComplete: hasInstructionsFile,
      isCompletable: true,
      isEnabled: !isWorkspaceDirEmpty,
    },
  ]
}

export function isProjectOnboardingComplete(): boolean {
  return getSteps()
    .filter(({ isCompletable, isEnabled }) => isCompletable && isEnabled)
    .every(({ isComplete }) => isComplete)
}

export function maybeMarkProjectOnboardingComplete(): void {
  // Short-circuit on cached config — isProjectOnboardingComplete() hits
  // the filesystem, and REPL.tsx calls this on every prompt submit.
  if (getCurrentProjectConfig().hasCompletedProjectOnboarding) {
    return
  }
  if (isProjectOnboardingComplete()) {
    saveCurrentProjectConfig(current => ({
      ...current,
      hasCompletedProjectOnboarding: true,
    }))
  }
}

export const shouldShowProjectOnboarding = memoize((): boolean => {
  const projectConfig = getCurrentProjectConfig()
  // Short-circuit on cached config before isProjectOnboardingComplete()
  // hits the filesystem — this runs during first render.
  if (
    projectConfig.hasCompletedProjectOnboarding ||
    projectConfig.projectOnboardingSeenCount >= 4 ||
    process.env.IS_DEMO
  ) {
    return false
  }

  return !isProjectOnboardingComplete()
})

export function incrementProjectOnboardingSeenCount(): void {
  saveCurrentProjectConfig(current => ({
    ...current,
    projectOnboardingSeenCount: current.projectOnboardingSeenCount + 1,
  }))
}
