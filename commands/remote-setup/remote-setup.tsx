import { execa } from 'execa';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { Select } from '../../components/CustomSelect/index.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { LoadingState } from '../../components/design-system/LoadingState.js';
import { Box, Text } from '../../ink.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS as SafeString } from '../../services/analytics/index.js';
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { openBrowser } from '../../utils/browser.js';
import {
  getHostedPlatformUrls,
  hasConfiguredHostedPlatformUrls,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js';
import { getGhAuthStatus } from '../../utils/github/ghAuthStatus.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { createDefaultEnvironment, getCodeWebUrl, type ImportTokenError, importGithubToken, isSignedIn, RedactedGithubToken } from './api.js';
type CheckResult = {
  status: 'not_signed_in';
} | {
  status: 'has_gh_token';
  token: RedactedGithubToken;
} | {
  status: 'gh_not_installed';
} | {
  status: 'gh_not_authenticated';
};
async function checkLoginState(): Promise<CheckResult> {
  if (!(await isSignedIn())) {
    return {
      status: 'not_signed_in'
    };
  }
  const ghStatus = await getGhAuthStatus();
  if (ghStatus === 'not_installed') {
    return {
      status: 'gh_not_installed'
    };
  }
  if (ghStatus === 'not_authenticated') {
    return {
      status: 'gh_not_authenticated'
    };
  }

  // ghStatus === 'authenticated'. getGhAuthStatus spawns with stdout:'ignore'
  // (telemetry-safe); spawn once more with stdout:'pipe' to read the token.
  const {
    stdout
  } = await execa('gh', ['auth', 'token'], {
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: 5000,
    reject: false
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      status: 'gh_not_authenticated'
    };
  }
  return {
    status: 'has_gh_token',
    token: new RedactedGithubToken(trimmed)
  };
}
function errorMessage(err: ImportTokenError, codeUrl: string): string {
  switch (err.kind) {
    case 'not_signed_in':
      return getLocalizedText({
        en: `Hosted remote setup could not continue. Open ${codeUrl} to finish setup.`,
        zh: `托管远程设置暂时无法继续。请打开 ${codeUrl} 完成设置。`
      });
    case 'invalid_token':
      return getLocalizedText({
        en: 'GitHub rejected that token. Run `gh auth login` and try again.',
        zh: 'GitHub 拒绝了该令牌。请运行 `gh auth login` 后再试。'
      });
    case 'server':
      return getLocalizedText({
        en: `Server error (${err.status}). Try again in a moment.`,
        zh: `服务器错误（${err.status}）。请稍后再试。`
      });
    case 'network':
      return getLocalizedText({
        en: "Couldn't reach the server. Check your connection.",
        zh: '无法连接到服务器。请检查你的网络连接。'
      });
  }
}
type Step = {
  name: 'checking';
} | {
  name: 'confirm';
  token: RedactedGithubToken;
} | {
  name: 'uploading';
};
function Web({
  onDone
}: {
  onDone: LocalJSXCommandOnDone;
}) {
  const [step, setStep] = useState<Step>({
    name: 'checking'
  });
  useEffect(() => {
    logMossenEvent('mossen.remote.setupStarted', {});
    void (async () => {
      if (isCustomBackendEnabled()) {
        const { remoteSetupUrl } = getHostedPlatformUrls();
        if (!hasConfiguredHostedPlatformUrls()) {
          logMossenEvent('mossen.remote.setupResult', {
            result: 'custom_backend_hosted_platform_unconfigured' as SafeString
          });
          onDone(getLocalizedText({
            en: 'Hosted remote setup is not configured for this custom backend. Set MOSSEN_CODE_PLATFORM_BASE_URL when your own hosted service is ready.',
            zh: '当前 custom backend 尚未配置 hosted 远程设置。等你自己的 hosted 服务准备好后，设置 MOSSEN_CODE_PLATFORM_BASE_URL 即可启用。'
          }));
          return;
        }
        await openBrowser(remoteSetupUrl);
        logMossenEvent('mossen.remote.setupResult', {
          result: 'custom_backend_redirect' as SafeString
        });
        onDone(getLocalizedText({
          en: `Opened hosted remote setup: ${remoteSetupUrl}`,
          zh: `已打开托管远程设置：${remoteSetupUrl}`
        }));
        return;
      }
      const result = await checkLoginState();
      switch (result.status) {
        case 'not_signed_in':
          logMossenEvent('mossen.remote.setupResult', {
            result: 'not_signed_in' as SafeString
          });
          onDone(getLocalizedText({
            en: `Hosted remote setup is not ready yet. Open ${getCodeWebUrl()} to continue.`,
            zh: `托管远程设置尚未就绪。请打开 ${getCodeWebUrl()} 继续。`
          }));
          return;
        case 'gh_not_installed':
        case 'gh_not_authenticated':
          {
            const url = getHostedPlatformUrls().remoteSetupUrl;
            await openBrowser(url);
            logMossenEvent('mossen.remote.setupResult', {
              result: result.status as SafeString
            });
            onDone(result.status === 'gh_not_installed' ? getLocalizedText({
              en: `GitHub CLI not found. Install it via https://cli.github.com/, then run \`gh auth login\`, or connect GitHub in the hosted workspace service: ${url}`,
              zh: `未找到 GitHub CLI。请通过 https://cli.github.com/ 安装，然后运行 \`gh auth login\`，或在托管工作区服务中连接 GitHub：${url}`
            }) : getLocalizedText({
              en: `GitHub CLI not authenticated. Run \`gh auth login\` and try again, or connect GitHub in the hosted workspace service: ${url}`,
              zh: `GitHub CLI 尚未认证。请运行 \`gh auth login\` 后重试，或在托管工作区服务中连接 GitHub：${url}`
            }));
            return;
          }
        case 'has_gh_token':
          setStep({
            name: 'confirm',
            token: result.token
          });
      }
    })();
    // onDone is stable across renders; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleCancel = () => {
    logMossenEvent('mossen.remote.setupResult', {
      result: 'cancelled' as SafeString
    });
    onDone();
  };
  const handleConfirm = async (token: RedactedGithubToken) => {
    setStep({
      name: 'uploading'
    });
    const result = await importGithubToken(token);
    if (result.ok === false) {
      logMossenEvent('mossen.remote.setupResult', {
        result: 'import_failed' as SafeString,
        error_kind: result.error.kind as SafeString
      });
      onDone(errorMessage(result.error, getCodeWebUrl()));
      return;
    }

    // Token import succeeded. Environment creation is best-effort — if it
    // fails, the web state machine routes to env-setup on landing, which is
    // one extra click but still better than the OAuth dance.
    await createDefaultEnvironment();
    const url = getCodeWebUrl();
    await openBrowser(url);
    logMossenEvent('mossen.remote.setupResult', {
      result: 'success' as SafeString
    });
    onDone(getLocalizedText({
      en: `Connected as ${result.result.github_username}. Opened ${url}`,
      zh: `已连接为 ${result.result.github_username}。已打开 ${url}`
    }));
  };
  if (step.name === 'checking') {
    return <LoadingState message={getLocalizedText({
      en: 'Checking hosted remote setup…',
      zh: '正在检查托管远程设置…'
    })} />;
  }
  if (step.name === 'uploading') {
    return <LoadingState message={getLocalizedText({
      en: 'Connecting GitHub to the hosted workspace service…',
      zh: '正在将 GitHub 连接到托管工作区服务…'
    })} />;
  }
  const token = step.token;
  return <Dialog title={getLocalizedText({
    en: 'Connect the hosted workspace service to GitHub?',
    zh: '将托管工作区服务连接到 GitHub？'
  })} onCancel={handleCancel} hideInputGuide>
      <Box flexDirection="column">
        <Text>
          {getLocalizedText({
          en: 'The hosted workspace service requires connecting to your GitHub account to clone and push code on your behalf.',
          zh: '托管工作区服务需要连接你的 GitHub 账号，才能代表你克隆和推送代码。'
        })}
        </Text>
        <Text dimColor>
          {getLocalizedText({
          en: 'Your local credentials are used to authenticate with GitHub',
          zh: '将使用你的本地凭据与 GitHub 进行身份验证'
        })}
        </Text>
      </Box>
      <Select options={[{
      label: getLocalizedText({ en: 'Continue', zh: '继续' }),
      value: 'send'
    }, {
      label: getLocalizedText({ en: 'Cancel', zh: '取消' }),
      value: 'cancel'
    }]} onChange={value => {
      if (value === 'send') {
        void handleConfirm(token);
      } else {
        handleCancel();
      }
    }} onCancel={handleCancel} />
    </Dialog>;
}
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  return <Web onDone={onDone} />;
}
