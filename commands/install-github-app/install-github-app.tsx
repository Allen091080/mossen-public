import { execa } from 'execa';
import React, { useCallback, useState } from 'react';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js';
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js';
import { WorkflowMultiselectDialog } from '../../components/WorkflowMultiselectDialog.js';
import { GITHUB_ACTION_SETUP_DOCS_URL, getDefaultGitHubActionsSecretName, getGitHubAppInstallUrl, getGitHubWorkflowReadiness, getPrimaryGitHubWorkflowPath, getWorkflowSearchPaths } from '../../constants/github-app.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box } from '../../ink.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getMossenApiKey } from '../../utils/auth.js';
import { openBrowser } from '../../utils/browser.js';
import { getCustomBackendApiKey, getCustomBackendAuthToken, isCustomBackendEnabled } from '../../utils/customBackend.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import { getGithubRepo } from '../../utils/git.js';
import { plural } from '../../utils/stringUtils.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { ApiKeyStep } from './ApiKeyStep.js';
import { CheckExistingSecretStep } from './CheckExistingSecretStep.js';
import { CheckGitHubStep } from './CheckGitHubStep.js';
import { ChooseRepoStep } from './ChooseRepoStep.js';
import { CreatingStep } from './CreatingStep.js';
import { ErrorStep } from './ErrorStep.js';
import { ExistingWorkflowStep } from './ExistingWorkflowStep.js';
import { InstallAppStep } from './InstallAppStep.js';
import { SuccessStep } from './SuccessStep.js';
import { setupGitHubActions } from './setupGitHubActions.js';
import type { State, Warning, Workflow } from './types.js';
import { WarningsStep } from './WarningsStep.js';
const INITIAL_STATE: State = {
  step: 'check-gh',
  selectedRepoName: '',
  currentRepo: '',
  useCurrentRepo: false,
  // Default to false, will be set to true if repo detected
  apiKeyOrOAuthToken: '',
  useExistingKey: true,
  currentWorkflowInstallStep: 0,
  warnings: [],
  secretExists: false,
  secretName: getDefaultGitHubActionsSecretName(),
  useExistingSecret: true,
  workflowExists: false,
  selectedWorkflows: ['mossen', 'mossen-review'] as Workflow[],
  selectedApiKeyOption: 'new' as 'existing' | 'new'
};
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function InstallGitHubApp(props: {
  onDone: (message: string) => void;
}): React.ReactNode {
  const customBackendEnabled = isCustomBackendEnabled();
  const [existingApiKey] = useState(() => customBackendEnabled ? getCustomBackendApiKey() ?? getCustomBackendAuthToken() : getMossenApiKey());
  const [state, setState] = useState<State>(() => {
    const initialState = {
      ...INITIAL_STATE,
      useExistingKey: !!existingApiKey,
      selectedApiKeyOption: (existingApiKey ? 'existing' : 'new') as 'existing' | 'new'
    };
    if (!customBackendEnabled) {
      return initialState;
    }
    const readiness = getGitHubWorkflowReadiness();
    if (readiness.ready) {
      return initialState;
    }
    return {
      ...initialState,
      step: 'error',
      error: 'The platform GitHub workflow is not configured for this personal build.',
      errorReason: 'Hosted workflow endpoint missing',
      errorInstructions: [
        ...readiness.issues,
        'Set MOSSEN_CODE_PLATFORM_BASE_URL to a real platform URL, or set MOSSEN_CODE_GITHUB_ACTION_BOOTSTRAP_URL directly.',
        'Re-run /install-github-app after the workflow runner and docs URLs are configured.',
      ],
    };
  });
  useExitOnCtrlCDWithKeybindings();
  React.useEffect(() => {
    logMossenEvent('mossen.github.installAppStarted', {});
  }, []);
  const checkGitHubCLI = useCallback(async () => {
    const warnings: Warning[] = [];

    // Check if gh is installed
    const ghVersionResult = await execa('gh --version', {
      shell: true,
      reject: false
    });
    if (ghVersionResult.exitCode !== 0) {
      warnings.push({
        title: getLocalizedText({
          en: 'GitHub CLI not found',
          zh: '未找到 GitHub CLI',
        }),
        message: 'GitHub CLI (gh) does not appear to be installed or accessible.',
        instructions: ['Install GitHub CLI from https://cli.github.com/', 'macOS: brew install gh', 'Windows: winget install --id GitHub.cli', 'Linux: See installation instructions at https://github.com/cli/cli#installation']
      });
    }

    // Check auth status
    const authResult = await execa('gh auth status -a', {
      shell: true,
      reject: false
    });
    if (authResult.exitCode !== 0) {
      warnings.push({
        title: getLocalizedText({
          en: 'GitHub CLI not authenticated',
          zh: 'GitHub CLI 未认证',
        }),
        message: 'GitHub CLI does not appear to be authenticated.',
        instructions: ['Run: gh auth login', 'Follow the prompts to authenticate with GitHub', 'Or set up authentication using environment variables or other methods']
      });
    } else {
      // Check if required scopes are present in the Token scopes line
      const tokenScopesMatch = authResult.stdout.match(/Token scopes:.*$/m);
      if (tokenScopesMatch) {
        const scopes = tokenScopesMatch[0];
        const missingScopes: string[] = [];
        if (!scopes.includes('repo')) {
          missingScopes.push('repo');
        }
        if (!scopes.includes('workflow')) {
          missingScopes.push('workflow');
        }
        if (missingScopes.length > 0) {
          // Missing required scopes - exit immediately
          setState(prev => ({
            ...prev,
            step: 'error',
            error: `GitHub CLI is missing required permissions: ${missingScopes.join(', ')}.`,
            errorReason: 'Missing required scopes',
            errorInstructions: [`Your GitHub CLI authentication is missing the "${missingScopes.join('" and "')}" ${plural(missingScopes.length, 'scope')} needed to manage GitHub Actions and secrets.`, '', 'To fix this, run:', '  gh auth refresh -h github.com -s repo,workflow', '', 'This will add the necessary permissions to manage workflows and secrets.']
          }));
          return;
        }
      }
    }

    // Check if in a git repo and get remote URL
    const currentRepo = (await getGithubRepo()) ?? '';
    logMossenEvent('mossen.github.installAppStepCompleted', {
      step: 'check-gh' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setState(prev_0 => ({
      ...prev_0,
      warnings,
      currentRepo,
      selectedRepoName: currentRepo,
      useCurrentRepo: !!currentRepo,
      // Set to false if no repo detected
      step: warnings.length > 0 ? 'warnings' : 'choose-repo'
    }));
  }, []);
  React.useEffect(() => {
    if (state.step === 'check-gh') {
      void checkGitHubCLI();
    }
  }, [state.step, checkGitHubCLI]);
  const runSetupGitHubActions = useCallback(async (apiKeyOrOAuthToken: string | null, secretName: string) => {
    setState(prev_1 => ({
      ...prev_1,
      step: 'creating',
      currentWorkflowInstallStep: 0
    }));
    try {
      await setupGitHubActions(state.selectedRepoName, apiKeyOrOAuthToken, secretName, () => {
        setState(prev_4 => ({
          ...prev_4,
          currentWorkflowInstallStep: prev_4.currentWorkflowInstallStep + 1
        }));
      }, state.workflowAction === 'skip', state.selectedWorkflows, {
        useCurrentRepo: state.useCurrentRepo,
        workflowExists: state.workflowExists,
        secretExists: state.secretExists
      });
      logMossenEvent('mossen.github.installAppStepCompleted', {
        step: 'creating' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      setState(prev_5 => ({
        ...prev_5,
        step: 'success'
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set up GitHub Actions';
      if (errorMessage.includes('workflow file already exists')) {
        logMossenEvent('mossen.github.installAppError', {
          reason: 'workflow_file_exists' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_2 => ({
          ...prev_2,
          step: 'error',
          error: 'A platform workflow file already exists in this repository.',
          errorReason: 'Workflow file conflict',
          errorInstructions: [`A workflow file like ${getPrimaryGitHubWorkflowPath()} already exists`, 'You can either:', '  1. Delete the existing file and run this command again', '  2. Update the existing file manually using the template from:', `     ${GITHUB_ACTION_SETUP_DOCS_URL}`]
        }));
      } else if (errorMessage.includes('GitHub workflow execution is not configured')) {
        logMossenEvent('mossen.github.installAppError', {
          reason: 'custom_backend_workflow_runner_unconfigured' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_2 => ({
          ...prev_2,
          step: 'error',
          error: 'The platform GitHub workflow runner is not configured for this custom backend yet.',
          errorReason: 'Hosted workflow execution endpoint missing',
          errorInstructions: [
            'Set MOSSEN_CODE_PLATFORM_BASE_URL to a real hosted platform URL instead of a placeholder domain',
            'Or set MOSSEN_CODE_GITHUB_ACTION_BOOTSTRAP_URL directly to your real GitHub bootstrap runner',
            'Re-run /install-github-app after the hosted workflow runner and docs URLs are reachable',
          ]
        }));
      } else {
        logMossenEvent('mossen.github.installAppError', {
          reason: 'setup_github_actions_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_3 => ({
          ...prev_3,
          step: 'error',
          error: errorMessage,
          errorReason: 'GitHub Actions setup failed',
          errorInstructions: []
        }));
      }
    }
  }, [state.selectedRepoName, state.workflowAction, state.selectedWorkflows, state.useCurrentRepo, state.workflowExists, state.secretExists]);
  async function openGitHubAppInstallation() {
    const installUrl = getGitHubAppInstallUrl();
    await openBrowser(installUrl);
  }
  async function checkRepositoryPermissions(repoName: string): Promise<{
    hasAccess: boolean;
    error?: string;
  }> {
    try {
      const result = await execFileNoThrow('gh', ['api', `repos/${repoName}`, '--jq', '.permissions.admin']);
      if (result.code === 0) {
        const hasAdmin = result.stdout.trim() === 'true';
        return {
          hasAccess: hasAdmin
        };
      }
      if (result.stderr.includes('404') || result.stderr.includes('Not Found')) {
        return {
          hasAccess: false,
          error: 'repository_not_found'
        };
      }
      return {
        hasAccess: false
      };
    } catch {
      return {
        hasAccess: false
      };
    }
  }
  async function checkExistingWorkflowFile(repoName_0: string): Promise<boolean> {
    for (const workflowPath of getWorkflowSearchPaths()) {
      const checkFileResult = await execFileNoThrow('gh', ['api', `repos/${repoName_0}/contents/${workflowPath}`, '--jq', '.sha']);
      if (checkFileResult.code === 0) {
        return true;
      }
    }
    return false;
  }
  async function checkExistingSecret() {
    const checkSecretsResult = await execFileNoThrow('gh', ['secret', 'list', '--app', 'actions', '--repo', state.selectedRepoName]);
    if (checkSecretsResult.code === 0) {
      const lines = checkSecretsResult.stdout.split('\n');
      const secretPattern = new RegExp(`^${escapeRegex(state.secretName)}\\s+`);
      const hasMossenSecret = lines.some((line: string) => {
        return secretPattern.test(line);
      });
      if (hasMossenSecret) {
        setState(prev_6 => ({
          ...prev_6,
          secretExists: true,
          step: 'check-existing-secret'
        }));
      } else {
        // No existing secret found
        if (existingApiKey) {
          // User has local key, skip to creating with it
          setState(prev_7 => ({
            ...prev_7,
            apiKeyOrOAuthToken: existingApiKey,
            useExistingKey: true
          }));
          await runSetupGitHubActions(existingApiKey, state.secretName);
        } else {
          // No local key, go to API key step
          setState(prev_8 => ({
            ...prev_8,
            step: 'api-key'
          }));
        }
      }
    } else {
      // Error checking secrets
      if (existingApiKey) {
        // User has local key, skip to creating with it
        setState(prev_9 => ({
          ...prev_9,
          apiKeyOrOAuthToken: existingApiKey,
          useExistingKey: true
        }));
        await runSetupGitHubActions(existingApiKey, state.secretName);
      } else {
        // No local key, go to API key step
        setState(prev_10 => ({
          ...prev_10,
          step: 'api-key'
        }));
      }
    }
  }
  const handleSubmit = async () => {
    if (state.step === 'warnings') {
      logMossenEvent('mossen.github.installAppStepCompleted', {
        step: 'warnings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      setState(prev_11 => ({
        ...prev_11,
        step: 'install-app'
      }));
      setTimeout(openGitHubAppInstallation, 0);
    } else if (state.step === 'choose-repo') {
      let repoName_1 = state.useCurrentRepo ? state.currentRepo : state.selectedRepoName;
      if (!repoName_1.trim()) {
        return;
      }
      const repoWarnings: Warning[] = [];
      if (repoName_1.includes('github.com')) {
        const match = repoName_1.match(/github\.com[:/]([^/]+\/[^/]+)(\.git)?$/);
        if (!match) {
          repoWarnings.push({
            title: getLocalizedText({
              en: 'Invalid GitHub URL format',
              zh: 'GitHub URL 格式无效',
            }),
            message: 'The repository URL format appears to be invalid.',
            instructions: ['Use format: owner/repo or https://github.com/owner/repo', 'Example: owner/repo']
          });
        } else {
          repoName_1 = match[1]?.replace(/\.git$/, '') || '';
        }
      }
      if (!repoName_1.includes('/')) {
        repoWarnings.push({
          title: getLocalizedText({
            en: 'Repository format warning',
            zh: '仓库格式警告',
          }),
          message: 'Repository should be in format "owner/repo"',
          instructions: ['Use format: owner/repo', 'Example: owner/repo']
        });
      }
      const permissionCheck = await checkRepositoryPermissions(repoName_1);
      if (permissionCheck.error === 'repository_not_found') {
        repoWarnings.push({
          title: getLocalizedText({
            en: 'Repository not found',
            zh: '未找到仓库',
          }),
          message: `Repository ${repoName_1} was not found or you don't have access.`,
          instructions: [`Check that the repository name is correct: ${repoName_1}`, 'Ensure you have access to this repository', 'For private repositories, make sure your GitHub token has the "repo" scope', 'You can add the repo scope with: gh auth refresh -h github.com -s repo,workflow']
        });
      } else if (!permissionCheck.hasAccess) {
        repoWarnings.push({
          title: getLocalizedText({
            en: 'Admin permissions required',
            zh: '需要管理员权限',
          }),
          message: `You might need admin permissions on ${repoName_1} to set up GitHub Actions.`,
          instructions: ['Repository admins can install GitHub Apps and set secrets', 'Ask a repository admin to run this command if setup fails', 'Alternatively, you can use the manual setup instructions']
        });
      }
      const workflowExists = await checkExistingWorkflowFile(repoName_1);
      if (repoWarnings.length > 0) {
        const allWarnings = [...state.warnings, ...repoWarnings];
        setState(prev_12 => ({
          ...prev_12,
          selectedRepoName: repoName_1,
          workflowExists,
          warnings: allWarnings,
          step: 'warnings'
        }));
      } else {
        logMossenEvent('mossen.github.installAppStepCompleted', {
          step: 'choose-repo' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_13 => ({
          ...prev_13,
          selectedRepoName: repoName_1,
          workflowExists,
          step: 'install-app'
        }));
        setTimeout(openGitHubAppInstallation, 0);
      }
    } else if (state.step === 'install-app') {
      logMossenEvent('mossen.github.installAppStepCompleted', {
        step: 'install-app' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      if (state.workflowExists) {
        setState(prev_14 => ({
          ...prev_14,
          step: 'check-existing-workflow'
        }));
      } else {
        setState(prev_15 => ({
          ...prev_15,
          step: 'select-workflows'
        }));
      }
    } else if (state.step === 'check-existing-workflow') {
      return;
    } else if (state.step === 'select-workflows') {
      // Handled by the WorkflowMultiselectDialog component
      return;
    } else if (state.step === 'check-existing-secret') {
      logMossenEvent('mossen.github.installAppStepCompleted', {
        step: 'check-existing-secret' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      if (state.useExistingSecret) {
        await runSetupGitHubActions(null, state.secretName);
      } else {
        // User wants to use a new secret name with their API key
        await runSetupGitHubActions(state.apiKeyOrOAuthToken, state.secretName);
      }
    } else if (state.step === 'api-key') {
      // In the hard-cut Mossen flow, api-key step only appears when no local
      // credential was found or the user chose to override it.

      // If user selected 'existing' option, use the existing API key
      const apiKeyToUse = state.selectedApiKeyOption === 'existing' ? existingApiKey : state.apiKeyOrOAuthToken;
      if (!apiKeyToUse) {
        logMossenEvent('mossen.github.installAppError', {
          reason: 'api_key_missing' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_16 => ({
          ...prev_16,
          step: 'error',
          error: 'API key is required'
        }));
        return;
      }

      // Store the API key being used (either existing or newly entered)
      setState(prev_17 => ({
        ...prev_17,
        apiKeyOrOAuthToken: apiKeyToUse,
        useExistingKey: state.selectedApiKeyOption === 'existing'
      }));

      // Check if the selected secret already exists
      const checkSecretsResult_0 = await execFileNoThrow('gh', ['secret', 'list', '--app', 'actions', '--repo', state.selectedRepoName]);
      if (checkSecretsResult_0.code === 0) {
        const lines_0 = checkSecretsResult_0.stdout.split('\n');
        const secretPattern_0 = new RegExp(`^${escapeRegex(state.secretName)}\\s+`);
        const hasMossenSecret_0 = lines_0.some((line_0: string) => {
          return secretPattern_0.test(line_0);
        });
        if (hasMossenSecret_0) {
          logMossenEvent('mossen.github.installAppStepCompleted', {
            step: 'api-key' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          setState(prev_18 => ({
            ...prev_18,
            secretExists: true,
            step: 'check-existing-secret'
          }));
        } else {
          logMossenEvent('mossen.github.installAppStepCompleted', {
            step: 'api-key' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          // No existing secret, proceed to creating
          await runSetupGitHubActions(apiKeyToUse, state.secretName);
        }
      } else {
        logMossenEvent('mossen.github.installAppStepCompleted', {
          step: 'api-key' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        // Error checking secrets, proceed anyway
        await runSetupGitHubActions(apiKeyToUse, state.secretName);
      }
    }
  };
  const handleRepoUrlChange = (value: string) => {
    setState(prev_19 => ({
      ...prev_19,
      selectedRepoName: value
    }));
  };
  const handleApiKeyChange = (value_0: string) => {
    setState(prev_20 => ({
      ...prev_20,
      apiKeyOrOAuthToken: value_0
    }));
  };
  const handleApiKeyOptionChange = (option: 'existing' | 'new') => {
    setState(prev_21 => ({
      ...prev_21,
      selectedApiKeyOption: option
    }));
  };
  const handleSecretNameChange = (value_1: string) => {
    if (value_1 && !/^[a-zA-Z0-9_]+$/.test(value_1)) return;
    setState(prev_25 => ({
      ...prev_25,
      secretName: value_1
    }));
  };
  const handleToggleUseCurrentRepo = (useCurrentRepo: boolean) => {
    setState(prev_26 => ({
      ...prev_26,
      useCurrentRepo,
      selectedRepoName: useCurrentRepo ? prev_26.currentRepo : ''
    }));
  };
  const handleToggleUseExistingKey = (useExistingKey: boolean) => {
    setState(prev_27 => ({
      ...prev_27,
      useExistingKey
    }));
  };
  const handleToggleUseExistingSecret = (useExistingSecret: boolean) => {
    setState(prev_28 => ({
      ...prev_28,
      useExistingSecret,
      secretName: useExistingSecret ? getDefaultGitHubActionsSecretName() : ''
    }));
  };
  const handleWorkflowAction = async (action: 'update' | 'skip' | 'exit') => {
    if (action === 'exit') {
      props.onDone('Installation cancelled by user');
      return;
    }
    logMossenEvent('mossen.github.installAppStepCompleted', {
      step: 'check-existing-workflow' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    setState(prev_29 => ({
      ...prev_29,
      workflowAction: action
    }));
    if (action === 'skip' || action === 'update') {
      // Check if user has existing local API key
      if (existingApiKey) {
        await checkExistingSecret();
      } else {
        // No local key, go straight to API key step
        setState(prev_30 => ({
          ...prev_30,
          step: 'api-key'
        }));
      }
    }
  };
  function handleDismissKeyDown(e: KeyboardEvent): void {
    e.preventDefault();
    if (state.step === 'success') {
      logMossenEvent('mossen.github.installAppCompleted', {});
    }
    props.onDone(state.step === 'success' ? 'GitHub workflow setup complete!' : state.error ? `Couldn't install the platform GitHub workflow: ${state.error}\nFor manual setup instructions, see: ${GITHUB_ACTION_SETUP_DOCS_URL}` : `Platform GitHub workflow setup failed\nFor manual setup instructions, see: ${GITHUB_ACTION_SETUP_DOCS_URL}`);
  }
  switch (state.step) {
    case 'check-gh':
      return <CheckGitHubStep />;
    case 'warnings':
      return <WarningsStep warnings={state.warnings} onContinue={handleSubmit} />;
    case 'choose-repo':
      return <ChooseRepoStep currentRepo={state.currentRepo} useCurrentRepo={state.useCurrentRepo} repoUrl={state.selectedRepoName} onRepoUrlChange={handleRepoUrlChange} onToggleUseCurrentRepo={handleToggleUseCurrentRepo} onSubmit={handleSubmit} />;
    case 'install-app':
      return <InstallAppStep repoUrl={state.selectedRepoName} onSubmit={handleSubmit} />;
    case 'check-existing-workflow':
      return <ExistingWorkflowStep repoName={state.selectedRepoName} onSelectAction={handleWorkflowAction} />;
    case 'check-existing-secret':
      return <CheckExistingSecretStep useExistingSecret={state.useExistingSecret} secretName={state.secretName} onToggleUseExistingSecret={handleToggleUseExistingSecret} onSecretNameChange={handleSecretNameChange} onSubmit={handleSubmit} />;
    case 'api-key':
      return <ApiKeyStep existingApiKey={existingApiKey} useExistingKey={state.useExistingKey} apiKeyOrOAuthToken={state.apiKeyOrOAuthToken} onApiKeyChange={handleApiKeyChange} onToggleUseExistingKey={handleToggleUseExistingKey} onSubmit={handleSubmit} selectedOption={state.selectedApiKeyOption} onSelectOption={handleApiKeyOptionChange} />;
    case 'creating':
      return <CreatingStep currentWorkflowInstallStep={state.currentWorkflowInstallStep} secretExists={state.secretExists} useExistingSecret={state.useExistingSecret} secretName={state.secretName} skipWorkflow={state.workflowAction === 'skip'} selectedWorkflows={state.selectedWorkflows} />;
    case 'success':
      return <Box tabIndex={0} autoFocus onKeyDown={handleDismissKeyDown}>
          <SuccessStep secretExists={state.secretExists} useExistingSecret={state.useExistingSecret} secretName={state.secretName} skipWorkflow={state.workflowAction === 'skip'} />
        </Box>;
    case 'error':
      return <Box tabIndex={0} autoFocus onKeyDown={handleDismissKeyDown}>
          <ErrorStep error={state.error} errorReason={state.errorReason} errorInstructions={state.errorInstructions} />
        </Box>;
    case 'select-workflows':
      return <WorkflowMultiselectDialog defaultSelections={state.selectedWorkflows} onSubmit={selectedWorkflows => {
        logMossenEvent('mossen.github.installAppStepCompleted', {
          step: 'select-workflows' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setState(prev_31 => ({
          ...prev_31,
          selectedWorkflows
        }));
        // Check if user has existing local API key
        if (existingApiKey) {
          void checkExistingSecret();
        } else {
          // No local key, go straight to API key step
          setState(prev_32 => ({
            ...prev_32,
            step: 'api-key'
          }));
        }
      }} />;
  }
}
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <InstallGitHubApp onDone={onDone} />;
}
