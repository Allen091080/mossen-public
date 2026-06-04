/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import axios from 'axios';
import React, { useEffect, useState } from 'react';

import { Spinner } from '../components/Spinner.js';
import { getOauthConfig } from '../constants/oauth.js';
import { useTimeout } from '../hooks/useTimeout.js';
import { Box, Text } from '../ink.js';
import { getSSLErrorHint } from '../services/api/errorUtils.js';
import {
  getCustomBackendAuthHeaders,
  getCustomBackendBaseUrl,
  getCustomBackendName,
  isCustomBackendEnabled,
} from './customBackend.js';
import { getUserAgent } from './http.js';
import { logError } from './log.js';
import { getLocalizedText } from './uiLanguage.js';
import { logMossenEvent } from '../services/analytics/mossenEventLogger.js'
export interface PreflightCheckResult {
  success: boolean;
  error?: string;
  configurationError?: boolean;
  sslHint?: string;
}

function getPreflightEndpoints(): {
  customBackend: boolean;
  endpoints: string[];
  configurationError?: string;
} {
  const customBackendBaseUrl = getCustomBackendBaseUrl();
  if (isCustomBackendEnabled() && customBackendBaseUrl !== null) {
    return {
      customBackend: true,
      endpoints: [customBackendBaseUrl],
    };
  }

  if (isCustomBackendEnabled()) {
    return {
      customBackend: true,
      endpoints: [],
      configurationError: getLocalizedText({
        en: 'Custom backend is enabled, but MOSSEN_CODE_CUSTOM_BASE_URL is not set.',
        zh: '已启用 custom backend，但还没有设置 MOSSEN_CODE_CUSTOM_BASE_URL。',
      }),
    };
  }

  if (!process.env.MOSSEN_CODE_API_BASE_URL) {
    return {
      customBackend: false,
      endpoints: [],
      configurationError: getLocalizedText({
        en: 'No Mossen backend is configured. For personal edition, set MOSSEN_CODE_CUSTOM_BASE_URL and MOSSEN_CODE_CUSTOM_API_KEY (or MOSSEN_CODE_CUSTOM_AUTH_TOKEN) before starting Mossen.',
        zh: '尚未配置 Mossen 后端。个人版请先设置 MOSSEN_CODE_CUSTOM_BASE_URL 和 MOSSEN_CODE_CUSTOM_API_KEY（或 MOSSEN_CODE_CUSTOM_AUTH_TOKEN），再启动 Mossen。',
      }),
    };
  }

  const oauthConfig = getOauthConfig();
  const tokenUrl = new URL(oauthConfig.TOKEN_URL);
  return {
    customBackend: false,
    endpoints: [
      `${oauthConfig.BASE_API_URL}/api/hello`,
      `${tokenUrl.origin}/v1/oauth/hello`,
    ],
  };
}

function isReachableStatus(status: number, customBackend: boolean): boolean {
  // Custom/OpenAI-compatible providers often return 401/404/405 at the bare base
  // URL. That still proves DNS/TLS/connectivity, which is all this preflight needs.
  return customBackend ? status < 500 : status === 200;
}

function formatPreflightError(
  url: string,
  detail: string,
  customBackend: boolean,
): string {
  const hostname = new URL(url).hostname;
  if (customBackend) {
    return `Failed to connect to ${getCustomBackendName()} at ${hostname}: ${detail}`;
  }
  return `Failed to connect to ${hostname}: ${detail}`;
}

async function checkEndpoints(): Promise<PreflightCheckResult> {
  try {
    const { customBackend, endpoints, configurationError } = getPreflightEndpoints();
    if (configurationError) {
      return {
        success: false,
        error: configurationError,
        configurationError: true,
      };
    }
    const checkEndpoint = async (url: string): Promise<PreflightCheckResult> => {
      try {
        const response = await axios.get(url, {
          headers: {
            'User-Agent': getUserAgent(),
            ...(customBackend ? getCustomBackendAuthHeaders() : {})
          },
          timeout: 5000,
          validateStatus: () => true
        });
        if (!isReachableStatus(response.status, customBackend)) {
          return {
            success: false,
            error: formatPreflightError(
              url,
              `Status ${response.status}`,
              customBackend,
            )
          };
        }
        return {
          success: true
        };
      } catch (error) {
        const sslHint = getSSLErrorHint(error);
        const detail =
          error instanceof Error
            ? (error as ErrnoException).code || error.message
            : String(error);
        return {
          success: false,
          error: formatPreflightError(url, detail, customBackend),
          sslHint: sslHint ?? undefined
        };
      }
    };
    const results = await Promise.all(endpoints.map(checkEndpoint));
    const failedResult = results.find(result => !result.success);
    if (failedResult) {
      // Log failure to Statsig
      logMossenEvent('mossen.preflight.checkFailed', {
        isConnectivityError: false,
        hasErrorMessage: !!failedResult.error,
        isSSLError: !!failedResult.sslHint
      });
    }
    return failedResult || {
      success: true
    };
  } catch (error) {
    logError(error as Error);

    // Log to Statsig
    logMossenEvent('mossen.preflight.checkFailed', {
      isConnectivityError: true
    });
    return {
      success: false,
      error: `Connectivity check error: ${error instanceof Error ? (error as ErrnoException).code || error.message : String(error)}`
    };
  }
}
interface PreflightStepProps {
  onSuccess: () => void;
}
export function PreflightStep(t0) {
  const $ = _c(12);
  const {
    onSuccess
  } = t0;
  const [result, setResult] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const showSpinner = useTimeout(1000) && isChecking;
  let t1;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      const run = async function run() {
        const checkResult = await checkEndpoints();
        setResult(checkResult);
        setIsChecking(false);
      };
      run();
    };
    t2 = [];
    $[0] = t1;
    $[1] = t2;
  } else {
    t1 = $[0];
    t2 = $[1];
  }
  useEffect(t1, t2);
  let t3;
  let t4;
  if ($[2] !== onSuccess || $[3] !== result) {
    t3 = () => {
      if (result?.success) {
        onSuccess();
      } else {
        if (result && !result.success) {
          const timer = setTimeout(_temp, 100);
          return () => clearTimeout(timer);
        }
      }
    };
    t4 = [result, onSuccess];
    $[2] = onSuccess;
    $[3] = result;
    $[4] = t3;
    $[5] = t4;
  } else {
    t3 = $[4];
    t4 = $[5];
  }
  useEffect(t3, t4);
  let t5;
  if ($[6] !== isChecking || $[7] !== result || $[8] !== showSpinner) {
    t5 = isChecking && showSpinner ? <Box paddingLeft={1}><Spinner /><Text>{getLocalizedText({
      en: 'Checking connectivity...',
      zh: '正在检查连接...'
    })}</Text></Box> : !result?.success && !isChecking && <Box flexDirection="column" gap={1}><Text color="error">{getLocalizedText({
      en: 'Unable to connect to backend services',
      zh: '无法连接到后端服务'
    })}</Text><Text color="error">{result?.error}</Text>{result?.sslHint ? <Box flexDirection="column" gap={1}><Text>{result.sslHint}</Text><Text color="suggestion">{getLocalizedText({
      en: 'Check your backend or platform network configuration guide',
      zh: '请检查你的后端或平台网络配置指南'
    })}</Text></Box> : result?.configurationError ? <Box flexDirection="column" gap={1}><Text>{getLocalizedText({
      en: 'Run /model examples, then /model add ... --apiKeyEnv <ENV> --activate to configure an OpenAI-compatible profile.',
      zh: '运行 /model examples，然后用 /model add ... --apiKeyEnv <ENV> --activate 配置 OpenAI-compatible profile。'
    })}</Text><Text>{getLocalizedText({
      en: 'If you use API-key environment variables, add the export lines to ~/.zshrc or ~/.zprofile and open a new terminal.',
      zh: '如果使用 API key 环境变量，请把 export 写入 ~/.zshrc 或 ~/.zprofile，然后重新打开终端。'
    })}</Text></Box> : <Box flexDirection="column" gap={1}><Text>{getLocalizedText({
      en: 'Please check your internet connection and network settings.',
      zh: '请检查网络连接和网络设置。'
    })}</Text><Text>{getLocalizedText({
      en: 'Make sure the current backend and its auth endpoints are reachable from this machine.',
      zh: '请确认当前后端及其认证端点可以从这台机器访问。'
    })}</Text><Text>{getLocalizedText({
      en: 'Run /model doctor to inspect the active profile, then /model test <profile> to verify baseURL + API key + /models reachability.',
      zh: '运行 /model doctor 检查当前 profile，再运行 /model test <profile> 验证 baseURL + API key + /models 连通性。'
    })}</Text><Text>{getLocalizedText({
      en: 'For 401/403, make sure baseURL, API key, and model id belong to the same provider account.',
      zh: '如果是 401/403，请确认 baseURL、API key、model id 属于同一个服务商账号。'
    })}</Text></Box>}</Box>;
    $[6] = isChecking;
    $[7] = result;
    $[8] = showSpinner;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== t5) {
    t6 = <Box flexDirection="column" gap={1} paddingLeft={1}>{t5}</Box>;
    $[10] = t5;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  return t6;
}
function _temp() {
  return process.exit(1);
}
