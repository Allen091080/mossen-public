import type { Command, CommandAvailability } from '../../commands.js'
import { getGitHubWorkflowReadiness } from '../../constants/github-app.js'
import { isCustomBackendEnabled } from '../../utils/customBackend.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

const HOSTED_CONSOLE_AVAILABILITY: CommandAvailability[] = ['hosted', 'console']

const installGitHubApp = {
  type: 'local-jsx',
  name: 'install-github-app',
  get description() {
    return isCustomBackendEnabled()
      ? 'Set up the platform GitHub workflow for a repository'
      : 'Set up Mossen GitHub Actions for a repository'
  },
  get availability() {
    return isCustomBackendEnabled() ? undefined : HOSTED_CONSOLE_AVAILABILITY
  },
  isEnabled: () =>
    !isEnvTruthy(process.env.DISABLE_INSTALL_GITHUB_APP_COMMAND) &&
    (!isCustomBackendEnabled() || getGitHubWorkflowReadiness().ready) &&
    !isCustomBackendEnabled(),
  get isHidden() {
    return isCustomBackendEnabled()
  },
  load: () => import('./install-github-app.js'),
} satisfies Command

export default installGitHubApp
