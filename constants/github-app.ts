import {
  getCustomBackendApiKey,
  getCustomBackendAuthToken,
  getHostedPlatformUrls,
  isPlaceholderHostedPlatformUrl,
  isCustomBackendEnabled,
} from '../utils/customBackend.js'
import { getProductDisplayName } from './product.js'

const OFFICIAL_GITHUB_ACTION_USAGE_DOCS_URL =
  'https://github.com/mossen/mossen-action/blob/main/docs/usage.md'
const OFFICIAL_GITHUB_WORKFLOW_EXAMPLES_URL =
  'https://github.com/mossen/mossen-action/blob/main/examples/'
export const CUSTOM_BACKEND_GITHUB_CREDENTIAL_PLACEHOLDER =
  '__MOSSEN_CODE_CUSTOM_CREDENTIAL__'

export function getWorkflowMentionHandle(): string {
  return isCustomBackendEnabled() ? '@assistant' : '@mossen'
}

export function getWorkflowDisplayName(): string {
  return isCustomBackendEnabled() ? getProductDisplayName() : 'Mossen'
}

export function getReviewWorkflowDisplayName(): string {
  return isCustomBackendEnabled()
    ? `${getProductDisplayName()} Review`
    : 'Mossen Review'
}

export function getGitHubActionUsageDocsUrl(): string {
  if (!isCustomBackendEnabled()) {
    return OFFICIAL_GITHUB_ACTION_USAGE_DOCS_URL
  }

  return `${getHostedPlatformUrls().remoteBaseUrl}/docs/github-actions`
}

export function getGitHubWorkflowExamplesUrl(): string {
  if (!isCustomBackendEnabled()) {
    return OFFICIAL_GITHUB_WORKFLOW_EXAMPLES_URL
  }

  return `${getHostedPlatformUrls().githubActionsDocsUrl}#examples`
}

export function getCliReferenceDocsUrl(): string {
  return `${getHostedPlatformUrls().remoteBaseUrl}/docs/cli-reference`
}

export function getGitHubActionBootstrapUrl(): string {
  const configured =
    process.env.MOSSEN_CODE_GITHUB_ACTION_BOOTSTRAP_URL?.trim()
  if (configured) {
    return configured
  }

  return `${getHostedPlatformUrls().remoteBaseUrl}/integrations/github/bootstrap.sh`
}

export type GitHubWorkflowReadiness = {
  bootstrapUrl: string
  issues: string[]
  ready: boolean
}

export function getGitHubWorkflowReadiness(): GitHubWorkflowReadiness {
  const platformUrls = getHostedPlatformUrls()
  const bootstrapUrl = getGitHubActionBootstrapUrl()
  const issues: string[] = []

  if (isPlaceholderHostedPlatformUrl(platformUrls.remoteBaseUrl)) {
    issues.push('Hosted platform base URL still points to a placeholder domain.')
  }
  if (isPlaceholderHostedPlatformUrl(platformUrls.githubAppUrl)) {
    issues.push('GitHub app install URL still points to a placeholder domain.')
  }
  if (isPlaceholderHostedPlatformUrl(platformUrls.githubActionsDocsUrl)) {
    issues.push('GitHub workflow docs URL still points to a placeholder domain.')
  }
  if (isPlaceholderHostedPlatformUrl(bootstrapUrl)) {
    issues.push(
      'GitHub workflow bootstrap runner URL still points to a placeholder domain.',
    )
  }

  return {
    bootstrapUrl,
    issues,
    ready: issues.length === 0,
  }
}

export const PR_TITLE = isCustomBackendEnabled()
  ? `Add ${getProductDisplayName()} workflow`
  : 'Add hosted code workflow'

export function getGitHubAppInstallUrl(): string {
  return getHostedPlatformUrls().githubAppUrl
}

export function getGitHubActionsSetupDocsUrl(): string {
  return getHostedPlatformUrls().githubActionsDocsUrl
}

export function getPrimaryGitHubWorkflowPath(): string {
  return isCustomBackendEnabled()
    ? '.github/workflows/coding-assistant.yml'
    : '.github/workflows/mossen.yml'
}

export function getReviewGitHubWorkflowPath(): string {
  return isCustomBackendEnabled()
    ? '.github/workflows/coding-assistant-review.yml'
    : '.github/workflows/mossen-review.yml'
}

export function getWorkflowSearchPaths(): string[] {
  return [getPrimaryGitHubWorkflowPath(), getReviewGitHubWorkflowPath()]
}

export function getDefaultGitHubActionsSecretName(): string {
  if (!isCustomBackendEnabled()) {
    return 'MOSSEN_CODE_API_KEY'
  }

  if (getCustomBackendAuthToken() && !getCustomBackendApiKey()) {
    return 'MOSSEN_CODE_CUSTOM_AUTH_TOKEN'
  }

  return 'MOSSEN_CODE_CUSTOM_API_KEY'
}

export const GITHUB_ACTION_SETUP_DOCS_URL = getGitHubActionsSetupDocsUrl()

function getGitHubWorkflowRunnerStep(kind: 'comment' | 'review'): string {
  if (!isCustomBackendEnabled()) {
    const actorName =
      kind === 'review' ? getReviewWorkflowDisplayName() : getWorkflowDisplayName()
    const actorId = kind === 'review'
      ? (isCustomBackendEnabled() ? 'assistant-review' : 'mossen-review')
      : (isCustomBackendEnabled() ? 'assistant' : 'mossen')
    const reviewOnlyInputs =
      kind === 'review'
        ? "          plugin_marketplaces: 'https://github.com/mossen/mossen.git'\n          plugins: 'code-review@mossen-plugins'\n          prompt: '/code-review:code-review \\${{ github.repository }}/pull/\\${{ github.event.pull_request.number }}'\n"
        : ''
    const commentOnlyInputs =
      kind === 'comment'
        ? "          # This is an optional setting that allows Mossen to read CI results on PRs\n          additional_permissions: |\n            actions: read\n\n          # Optional: Give a custom prompt to Mossen. If this is not specified, Mossen will perform the instructions specified in the comment that tagged it.\n          # prompt: 'Update the pull request description to include a summary of changes.'\n\n          # Optional: Add mossen_args to customize behavior and configuration\n"
        : ''
    return `      - name: Run ${actorName}
        id: ${actorId}
        uses: mossen/mossen-action@v1
        with:
          mossen_code_api_key: \${{ secrets.MOSSEN_CODE_API_KEY }}
${reviewOnlyInputs}${commentOnlyInputs}          # See ${getGitHubActionUsageDocsUrl()}
          # or ${getCliReferenceDocsUrl()} for available options
`
  }

  const workflowKind = kind === 'review' ? 'review' : 'comment'
  const actorName =
    kind === 'review' ? getReviewWorkflowDisplayName() : getWorkflowDisplayName()
  return `      - name: Run ${actorName}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          MOSSEN_CODE_USE_CUSTOM_BACKEND: '1'
          MOSSEN_CODE_SUBPROCESS_ENV_SCRUB: '1'
          MOSSEN_CODE_CUSTOM_BASE_URL: \${{ vars.MOSSEN_CODE_CUSTOM_BASE_URL }}
          MOSSEN_CODE_CUSTOM_MODEL: \${{ vars.MOSSEN_CODE_CUSTOM_MODEL }}
          MOSSEN_CODE_CUSTOM_BACKEND_PROTOCOL: \${{ vars.MOSSEN_CODE_CUSTOM_BACKEND_PROTOCOL }}
          MOSSEN_CODE_CUSTOM_NAME: \${{ vars.MOSSEN_CODE_CUSTOM_NAME }}
          MOSSEN_CODE_PLATFORM_BASE_URL: \${{ vars.MOSSEN_CODE_PLATFORM_BASE_URL }}
          MOSSEN_CODE_GITHUB_RUNNER_URL: \${{ vars.MOSSEN_CODE_GITHUB_ACTION_BOOTSTRAP_URL }}
          MOSSEN_CODE_CUSTOM_HEADERS: \${{ secrets.MOSSEN_CODE_CUSTOM_HEADERS }}
          ${CUSTOM_BACKEND_GITHUB_CREDENTIAL_PLACEHOLDER}
          MOSSEN_CODE_GITHUB_WORKFLOW_KIND: '${workflowKind}'
        run: |
          curl -fsSL "$MOSSEN_CODE_GITHUB_RUNNER_URL" -o /tmp/run-coding-assistant-github.sh
          bash /tmp/run-coding-assistant-github.sh

          # See ${getGitHubActionUsageDocsUrl()}
          # or ${getCliReferenceDocsUrl()} for available options
`
}

export const WORKFLOW_CONTENT = `name: ${getWorkflowDisplayName()}

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  ${isCustomBackendEnabled() ? 'assistant' : 'mossen'}:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '${getWorkflowMentionHandle()}')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '${getWorkflowMentionHandle()}')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '${getWorkflowMentionHandle()}')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '${getWorkflowMentionHandle()}') || contains(github.event.issue.title, '${getWorkflowMentionHandle()}')))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
      actions: read # Required for ${
        isCustomBackendEnabled() ? 'the assistant' : 'Mossen'
      } to read CI results on PRs
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

${getGitHubWorkflowRunnerStep('comment')}
`

export const PR_BODY = `## 🤖 Installing the ${
  isCustomBackendEnabled()
    ? `${getProductDisplayName()} workflow`
    : 'hosted code workflow'
}

This PR adds a GitHub Actions workflow that enables the ${
  isCustomBackendEnabled()
    ? `${getProductDisplayName()} integration`
    : 'hosted coding integration'
} for this repository.

### What does this workflow do?

The ${
  isCustomBackendEnabled()
    ? `${getProductDisplayName()} workflow`
    : 'hosted code workflow'
} can help with:
- Bug fixes and improvements  
- Documentation updates
- Implementing new features
- Code reviews and suggestions
- Writing tests
- And more!

### How it works

Once this PR is merged, we'll be able to interact with the workflow by mentioning ${getWorkflowMentionHandle()} in a pull request or issue comment.
Once the workflow is triggered, the ${
  isCustomBackendEnabled()
    ? `${getProductDisplayName()} runtime`
    : 'hosted coding runtime'
} will analyze the comment and surrounding context, and execute on the request in a GitHub action.

### Important Notes

- **This workflow won't take effect until this PR is merged**
- **${getWorkflowMentionHandle()} mentions won't work until after the merge is complete**
- The workflow runs automatically whenever ${getWorkflowMentionHandle()} is mentioned in PR or issue comments
- The ${
  isCustomBackendEnabled()
    ? `${getProductDisplayName()} runtime`
    : 'hosted runtime'
} gets access to the entire PR or issue context including files, diffs, and previous comments

### Security

- Our ${
  isCustomBackendEnabled() ? 'platform backend' : 'hosted backend'
} credential is securely stored as a GitHub Actions secret
- Only users with write access to the repository can trigger the workflow
- All workflow runs are stored in the GitHub Actions run history
- The coding runtime's default tools are limited to reading/writing files and interacting with our repo by creating comments, branches, and commits.
- We can add more allowed tools by adding them to the workflow file like:

\`\`\`
allowed_tools: Bash(npm install),Bash(npm run build),Bash(npm run lint),Bash(npm run test)
\`\`\`

There's more information in the [workflow setup guide](${GITHUB_ACTION_SETUP_DOCS_URL}).

After merging this PR, let's try mentioning ${getWorkflowMentionHandle()} in a comment on any PR to get started!`

export const CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT = `name: ${getReviewWorkflowDisplayName()}

on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]
    # Optional: Only run on specific file changes
    # paths:
    #   - "src/**/*.ts"
    #   - "src/**/*.tsx"
    #   - "src/**/*.js"
    #   - "src/**/*.jsx"

jobs:
  ${isCustomBackendEnabled() ? 'assistant-review' : 'mossen-review'}:
    # Optional: Filter by PR author
    # if: |
    #   github.event.pull_request.user.login == 'external-contributor' ||
    #   github.event.pull_request.user.login == 'new-developer' ||
    #   github.event.pull_request.author_association == 'FIRST_TIME_CONTRIBUTOR'

    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

${getGitHubWorkflowRunnerStep('review')}
`
