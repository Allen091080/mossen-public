// Git-related behaviors that depend on user settings.
//
// This lives outside git.ts because git.ts is in the vscode extension's
// dep graph and must stay free of settings.ts. Also a cycle: settings.ts →
// git/gitignore.ts → git.ts, so git.ts → settings.ts would loop.
//
// If you're tempted to add `import settings` to git.ts — don't. Put it here.

import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { getInitialSettings } from './settings/settings.js'

export function shouldIncludeGitInstructions(): boolean {
  const envVal = process.env.MOSSEN_CODE_DISABLE_GIT_INSTRUCTIONS
  if (isEnvTruthy(envVal)) return false
  if (isEnvDefinedFalsy(envVal)) return true
  return getInitialSettings().includeGitInstructions ?? true
}
