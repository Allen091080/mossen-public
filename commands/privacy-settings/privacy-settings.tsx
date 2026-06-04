import * as React from 'react';
import { type GroveDecision, GroveDialog, PrivacySettingsDialog } from '../../components/grove/Grove.js';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js';
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import { getGroveNoticeConfig, getGroveSettings, isQualifiedForGrove } from '../../services/api/grove.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { getCustomBackendName, getHostedPlatformUrls, hasConfiguredHostedPlatformUrls, isCustomBackendEnabled } from '../../utils/customBackend.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
function getFallbackMessage(): string {
  if (isCustomBackendEnabled() && !hasConfiguredHostedPlatformUrls()) {
    return getLocalizedText({
      en: `${getCustomBackendName()} has no hosted privacy controls URL configured for this build.`,
      zh: `${getCustomBackendName()} 尚未为这个构建配置托管隐私控制 URL。`
    });
  }
  return getLocalizedText({
    en: `Review and manage your privacy settings at ${getHostedPlatformUrls().privacyUrl}`,
    zh: `请前往 ${getHostedPlatformUrls().privacyUrl} 查看并管理你的隐私设置`
  });
}
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode | null> {
  const qualified = await isQualifiedForGrove();
  if (!qualified) {
    onDone(getFallbackMessage());
    return null;
  }
  const [settingsResult, configResult] = await Promise.all([getGroveSettings(), getGroveNoticeConfig()]);
  // Hide dialog on API failure (after retry)
  if (!settingsResult.success) {
    onDone(getFallbackMessage());
    return null;
  }
  const settings = settingsResult.data;
  const config = configResult.success ? configResult.data : null;
  async function onDoneWithDecision(decision: GroveDecision) {
    if (decision === 'escape' || decision === 'defer') {
      onDone(getLocalizedText({
        en: 'Privacy settings dialog dismissed',
        zh: '已关闭隐私设置对话框'
      }), {
        display: 'system'
      });
      return;
    }
    await onDoneWithSettingsCheck();
  }
  async function onDoneWithSettingsCheck() {
    const updatedSettingsResult = await getGroveSettings();
    if (!updatedSettingsResult.success) {
      onDone(getLocalizedText({
        en: 'Unable to retrieve updated privacy settings',
        zh: '无法获取更新后的隐私设置'
      }), {
        display: 'system'
      });
      return;
    }
    const updatedSettings = updatedSettingsResult.data;
    const groveStatus = updatedSettings.grove_enabled ? 'true' : 'false';
    onDone(getLocalizedText({
      en: `"Help improve Mossen" set to ${groveStatus}.`,
      zh: `“帮助改进 Mossen” 已设置为 ${groveStatus}。`
    }));
    if (settings.grove_enabled !== null && settings.grove_enabled !== updatedSettings.grove_enabled) {
      logMossenEvent('mossen.privacy.grovePolicyToggled', {
        state: updatedSettings.grove_enabled as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        location: 'settings' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
  }

  // Show privacy settings directly if the user has already accepted the
  // terms.
  if (settings.grove_enabled !== null) {
    return <PrivacySettingsDialog settings={settings} domainExcluded={config?.domain_excluded} onDone={onDoneWithSettingsCheck}></PrivacySettingsDialog>;
  }

  // Show the GroveDialog for users who haven't accepted terms yet
  return <GroveDialog showIfAlreadyViewed={true} onDone={onDoneWithDecision} location={'settings'} />;
}
