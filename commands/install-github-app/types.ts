export type Workflow = 'mossen' | 'mossen-review'

export type Warning = {
  title: string
  message: string
  instructions: string[]
}

export type State = {
  step:
    | 'check-gh'
    | 'warnings'
    | 'choose-repo'
    | 'api-key'
    | 'install-app'
    | 'check-existing-secret'
    | 'existing-workflow'
    | 'creating'
    | 'success'
    | 'error'
  selectedRepoName: string
  currentRepo: string
  useCurrentRepo: boolean
  apiKeyOrOAuthToken: string
  useExistingKey: boolean
  currentWorkflowInstallStep: number
  warnings: Warning[]
  secretExists: boolean
  secretName: string
  useExistingSecret: boolean
  workflowExists: boolean
  selectedWorkflows: Workflow[]
  selectedApiKeyOption: 'existing' | 'new'
  workflowAction?: 'skip' | 'create' | 'replace'
  error?: string
  errorReason?: string
  errorInstructions?: string[]
}
