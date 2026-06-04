import * as React from 'react';
import { useState } from 'react';
import { useDoublePress } from '../hooks/useDoublePress.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import { backgroundAll, hasForegroundTasks } from '../tasks/LocalShellTask/LocalShellTask.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { env } from '../utils/env.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';

type Props = {
  onBackgroundSession: () => void;
  isLoading: boolean;
};

export function SessionBackgroundHint({
  onBackgroundSession,
  isLoading,
}: Props): React.ReactElement | null {
  const setAppState = useSetAppState();
  const appStateStore = useAppStateStore();
  const [showSessionHint, setShowSessionHint] = useState(false);

  const handleDoublePress = useDoublePress(
    setShowSessionHint,
    onBackgroundSession,
    () => {},
  );

  const handleBackground = React.useCallback(() => {
    if (isEnvTruthy(process.env.MOSSEN_CODE_DISABLE_BACKGROUND_TASKS)) {
      return;
    }

    const state = appStateStore.getState();
    if (hasForegroundTasks(state)) {
      backgroundAll(() => appStateStore.getState(), setAppState);
      if (!getGlobalConfig().hasUsedBackgroundTask) {
        saveGlobalConfig((config) =>
          config.hasUsedBackgroundTask
            ? config
            : { ...config, hasUsedBackgroundTask: true },
        );
      }
      return;
    }

    if (isEnvTruthy('false') && isLoading) {
      handleDoublePress();
    }
  }, [appStateStore, handleDoublePress, isLoading, setAppState]);

  const hasForeground = useAppState(hasForegroundTasks);
  const sessionBgEnabled = isEnvTruthy('false');

  useKeybinding('task:background', handleBackground, {
    context: 'Task',
    isActive: hasForeground || (sessionBgEnabled && isLoading),
  });

  const baseShortcut = useShortcutDisplay('task:background', 'Task', 'ctrl+b');
  const shortcut =
    env.terminal === 'tmux' && baseShortcut === 'ctrl+b'
      ? 'ctrl+b ctrl+b'
      : baseShortcut;

  if (!isLoading || !showSessionHint) {
    return null;
  }

  return (
    <Box paddingLeft={2}>
      <Text dimColor>
        <KeyboardShortcutHint
          shortcut={shortcut}
          action={getLocalizedText({ en: 'background', zh: '转到后台' })}
        />
      </Text>
    </Box>
  );
}
