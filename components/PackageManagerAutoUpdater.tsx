import * as React from 'react';
import { useState } from 'react';
import { useInterval } from 'usehooks-ts';
import { Text } from '../ink.js';
import { type AutoUpdaterResult, getLatestVersionFromGcs, getMaxVersion, shouldSkipVersion } from '../utils/autoUpdater.js';
import { isAutoUpdaterDisabled } from '../utils/config.js';
import { isCustomBackendEnabled } from '../utils/customBackend.js';
import { logForDebugging } from '../utils/debug.js';
import { getPackageManager, type PackageManager } from '../utils/nativeInstaller/packageManagers.js';
import { gt, gte } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';
import { isPackageManagerAutoUpdateDisabledByEnv } from '../utils/terminalEnvControls.js';
type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};
export function getPackageManagerUpdateCommand(packageManager: PackageManager): string {
  if (isCustomBackendEnabled()) {
    return packageManager === "homebrew" ? "your Homebrew upgrade command for this build" : packageManager === "winget" ? "your winget upgrade command for this build" : packageManager === "apk" ? "your APK upgrade command for this build" : "your package manager update command for this build";
  }
  return packageManager === "homebrew" ? "brew upgrade mossen-code" : packageManager === "winget" ? "the appropriate winget upgrade command for this build" : packageManager === "apk" ? "apk upgrade mossen-code" : "your package manager update command";
}
export function getPackageManagerUpdatePrefix(): string {
  return isCustomBackendEnabled() ? 'Update available! Use ' : 'Update available! Run: ';
}
export function PackageManagerAutoUpdater({
  verbose
}: Props): React.ReactNode {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [packageManager, setPackageManager] = useState<PackageManager>('unknown');
  const checkForUpdates = React.useCallback(async () => {
    false || false;
    if (isAutoUpdaterDisabled() || isPackageManagerAutoUpdateDisabledByEnv()) {
      return;
    }
    const [channel, pm] = await Promise.all([Promise.resolve(getInitialSettings()?.autoUpdatesChannel ?? 'latest'), getPackageManager()]);
    setPackageManager(pm);
    let latest = await getLatestVersionFromGcs(channel);
    const maxVersion = await getMaxVersion();
    if (maxVersion && latest && gt(latest, maxVersion)) {
      logForDebugging(`PackageManagerAutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latest} to ${maxVersion}`);
      if (gte(MACRO.VERSION, maxVersion)) {
        logForDebugging(`PackageManagerAutoUpdater: current version ${MACRO.VERSION} is already at or above maxVersion ${maxVersion}, skipping update`);
        setUpdateAvailable(false);
        return;
      }
      latest = maxVersion;
    }
    const hasUpdate = latest && !gte(MACRO.VERSION, latest) && !shouldSkipVersion(latest);
    setUpdateAvailable(!!hasUpdate);
    if (hasUpdate) {
      logForDebugging(`PackageManagerAutoUpdater: Update available ${MACRO.VERSION} -> ${latest}`);
    }
  }, []);
  React.useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);
  useInterval(checkForUpdates, 30 * 60 * 1000);
  if (!updateAvailable) {
    return null;
  }
  const updateCommand = getPackageManagerUpdateCommand(packageManager);
  const updatePrefix = getPackageManagerUpdatePrefix();
  return <>
      {verbose && <Text dimColor={true} wrap="truncate">
          currentVersion: {MACRO.VERSION}
        </Text>}
      <Text color="warning" wrap="truncate">
        {updatePrefix}<Text bold={true}>{updateCommand}</Text>
      </Text>
    </>;
}
