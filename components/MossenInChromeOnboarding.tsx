/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import React from 'react';
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- enter to continue
import { Box, Link, Newline, Text, useInput } from '../ink.js';
import { getProductAssistantName, getProductDisplayName } from '../constants/product.js';
import { isChromeExtensionInstalled } from '../utils/mossenInChrome/setup.js';
import { saveGlobalConfig } from '../utils/config.js';
import {
  getChromeIntegrationUrls,
  hasConfiguredChromeIntegrationUrls,
} from '../utils/customBackend.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { Dialog } from './design-system/Dialog.js';
const { docsUrl: CHROME_DOCS_URL, extensionUrl: CHROME_EXTENSION_URL, permissionsUrl: CHROME_PERMISSIONS_URL } = getChromeIntegrationUrls();
type Props = {
  onDone(): void;
};
export function MossenInChromeOnboarding(t0) {
  const {
    onDone
  } = t0;
  const [isExtensionInstalled, setIsExtensionInstalled] = React.useState(false);
  const hasConfiguredChromeUrls = hasConfiguredChromeIntegrationUrls();

  React.useEffect(() => {
    logMossenEvent("mossen.browserIntegration.onboardingShown", {});
    isChromeExtensionInstalled().then(setIsExtensionInstalled);
    saveGlobalConfig(_temp);
  }, []);

  useInput((_input, key) => {
      if (key.return) {
        onDone();
      }
    });

  const extensionHint = hasConfiguredChromeUrls && !isExtensionInstalled && <><Newline /><Newline />{getLocalizedText({
    en: 'Requires the Chrome extension. Get started at',
    zh: '需要安装 Chrome 扩展。前往这里开始：'
  })}{" "}<Link url={CHROME_EXTENSION_URL} /></>;

  const permissionLink = hasConfiguredChromeUrls && isExtensionInstalled && <>{" "}(<Link url={CHROME_PERMISSIONS_URL} />)</>;
  const docsHint = hasConfiguredChromeUrls ? <Text dimColor={true}>{getLocalizedText({
    en: 'For more info, use',
    zh: '想了解更多，请使用'
  })}{" "}<Text bold={true} color="chromeYellow">/chrome</Text>{" "}{getLocalizedText({
    en: 'or visit',
    zh: '或访问'
  })} <Link url={CHROME_DOCS_URL} /></Text> : <Text color="warning">{getLocalizedText({
    en: 'Browser integration is not enabled for the current provider or backend configuration.',
    zh: '当前 provider 或后端配置未启用浏览器集成。'
  })}</Text>;

  const content = <Box flexDirection="column" gap={1}>
    <Text>{getLocalizedText({
      en: `Chrome browser integration works with the Chrome extension to let you control your browser directly from ${getProductAssistantName()}. You can navigate websites, fill forms, capture screenshots, record GIFs, and debug with console logs and network requests.`,
      zh: `Chrome 浏览器集成会配合 Chrome 扩展，让你直接通过 ${getProductAssistantName()} 控制浏览器。你可以浏览网站、填写表单、截取屏幕、录制 GIF，并结合控制台日志和网络请求进行调试。`
    })}{extensionHint}</Text>
    <Text dimColor={true}>{getLocalizedText({
      en: `Site-level permissions are inherited from the Chrome extension. Manage permissions in the Chrome extension settings to control which sites ${getProductAssistantName()} can browse, click, and type on`,
      zh: `站点级权限继承自 Chrome 扩展。你可以在 Chrome 扩展设置里管理权限，控制 ${getProductAssistantName()} 可以浏览、点击和输入的站点`
    })}{permissionLink}.</Text>
    {docsHint}
  </Box>;

  return <Dialog title={getLocalizedText({
      en: `${getProductDisplayName()} Browser Integration (Beta)`,
      zh: `${getProductDisplayName()} 浏览器集成（测试版）`
    })} onCancel={onDone} color="chromeYellow">{content}</Dialog>;
}
function _temp(current) {
  return {
    ...current,
    hasCompletedMossenInChromeOnboarding: true
  };
}
