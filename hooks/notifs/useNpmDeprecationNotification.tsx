import { isInBundledMode } from 'src/utils/bundledMode.js';
import { getProductCliName, getProductDisplayName } from '../../constants/product.js';
import { getCurrentInstallationType } from 'src/utils/doctorDiagnostic.js';
import { isEnvTruthy } from 'src/utils/envUtils.js';
import { getInstallerDocsUrl } from '../../utils/autoUpdater.js';
import type { Notification } from '../../context/notifications.js';
import { isCustomBackendEnabled } from '../../utils/customBackend.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { useStartupNotification } from './useStartupNotification.js';
export function getNpmDeprecationMessage() {
  const docsUrl = getInstallerDocsUrl();
  if (!docsUrl) {
    return getLocalizedText({
      en: `${getProductDisplayName()} now uses the installer flow instead of npm. Run \`${getProductCliName()} install\` or use your build's installer documentation for more options.`,
      zh: `${getProductDisplayName()} 现在改用安装器流程，不再通过 npm 分发。运行 \`${getProductCliName()} install\`，或查看此构建的安装器文档了解更多选项。`
    });
  }
  return getLocalizedText({
    en: `${getProductDisplayName()} now uses the installer flow instead of npm. Run \`${getProductCliName()} install\` or see ${docsUrl} for more options.`,
    zh: `${getProductDisplayName()} 现在改用安装器流程，不再通过 npm 分发。运行 \`${getProductCliName()} install\`，或查看 ${docsUrl} 了解更多选项。`
  });
}
export function useNpmDeprecationNotification() {
  useStartupNotification(getNpmDeprecationNotification);
}

export async function getNpmDeprecationNotification(): Promise<Notification | null> {
  if (
    isCustomBackendEnabled() ||
    isInBundledMode() ||
    isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)
  ) {
    return null;
  }
  const installationType = await getCurrentInstallationType();
  if (installationType === "development") {
    return null;
  }
  return {
    timeoutMs: 15000,
    key: "npm-deprecation-warning",
    text: getNpmDeprecationMessage(),
    color: "warning",
    priority: "high"
  };
}
