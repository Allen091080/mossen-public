import * as React from 'react';
import type { Notification } from '../context/notifications.js';
import { Text } from '../ink.js';
import { isChromeExtensionInstalled, shouldEnableMossenInChrome } from '../utils/mossenInChrome/setup.js';
import { getChromeIntegrationUrls, hasConfiguredChromeIntegrationUrls, isCustomBackendEnabled } from '../utils/customBackend.js';
import { isRunningOnHomespace } from '../utils/envUtils.js';
import { canUseChromeIntegration } from '../utils/hostedFeatureGates.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { useStartupNotification } from './notifs/useStartupNotification.js';
const { extensionUrl: CHROME_EXTENSION_URL } = getChromeIntegrationUrls();
function getChromeFlag(): boolean | undefined {
  if (process.argv.includes('--chrome')) {
    return true;
  }
  if (process.argv.includes('--no-chrome')) {
    return false;
  }
  return undefined;
}
export function useChromeExtensionNotification() {
  useStartupNotification(_temp);
}
export async function getChromeExtensionNotificationSurface() {
  const chromeFlag = getChromeFlag();
  if (!shouldEnableMossenInChrome(chromeFlag)) {
    return null;
  }
  if (!canUseChromeIntegration()) {
    const message = isCustomBackendEnabled() && !hasConfiguredChromeIntegrationUrls()
      ? getLocalizedText({
          en: 'Chrome integration is not configured. Set MOSSEN_CODE_PLATFORM_BASE_URL or the MOSSEN_CODE_CHROME_* URLs first.',
          zh: 'Chrome 集成未配置。请先设置 MOSSEN_CODE_PLATFORM_BASE_URL 或 MOSSEN_CODE_CHROME_* URL。',
        })
      : getLocalizedText({
          en: 'Chrome integration is not enabled for the current provider or backend configuration.',
          zh: '当前 provider 或后端配置未启用 Chrome 集成。',
        });
    return {
      key: "chrome-integration-unavailable",
      level: "error",
      message
    };
  }
  const installed = await isChromeExtensionInstalled();
  if (!installed && !isRunningOnHomespace()) {
    return {
      key: "chrome-extension-not-detected",
      level: "warning",
      message: getLocalizedText({
        en: `Chrome extension not detected · ${CHROME_EXTENSION_URL} to install`,
        zh: `未检测到 Chrome 扩展 · 前往 ${CHROME_EXTENSION_URL} 安装`,
      })
    };
  }
  if (chromeFlag === undefined) {
    return {
      key: "mossen-in-chrome-default-enabled",
      level: "info",
      message: getLocalizedText({
        en: 'Chrome integration enabled · /chrome',
        zh: 'Chrome 集成已启用 · /chrome',
      })
    };
  }
  return null;
}
async function _temp(): Promise<Notification | null> {
  const notice = await getChromeExtensionNotificationSurface();
  if (!notice) {
    return null;
  }
  if (notice.level === "error") {
    return {
      key: notice.key,
      jsx: <Text color="error">{notice.message}</Text>,
      priority: "immediate",
      timeoutMs: 5000
    };
  }
  if (notice.level === "warning") {
    return {
      key: notice.key,
      jsx: <Text color="warning">{notice.message}</Text>,
      priority: "immediate",
      timeoutMs: 3000
    };
  }
  return {
    key: notice.key,
    text: notice.message,
    priority: "low"
  };
}
