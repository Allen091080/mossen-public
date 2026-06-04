import chalk from 'chalk';
import React, { useContext } from 'react';
import { Text } from '../ink.js';
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { getInteractiveLanguageTag } from '../utils/uiLanguage.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { InVirtualListContext } from './messageActions.js';

const SubAgentContext = React.createContext(false);

export function SubAgentProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <SubAgentContext.Provider value={true}>{children}</SubAgentContext.Provider>
  );
}

export function CtrlOToExpand(): React.ReactNode {
  const isInSubAgent = useContext(SubAgentContext);
  const inVirtualList = useContext(InVirtualListContext);
  const expandShortcut = useShortcutDisplay(
    'app:toggleTranscript',
    'Global',
    'ctrl+o',
  );

  if (isInSubAgent || inVirtualList) {
    return null;
  }

  return (
    <Text dimColor>
      <KeyboardShortcutHint
        shortcut={expandShortcut}
        action={getInteractiveLanguageTag().startsWith('zh') ? '展开' : 'expand'}
        parens
      />
    </Text>
  );
}

export function ctrlOToExpand(): string {
  const shortcut = getShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
  const text = getInteractiveLanguageTag().startsWith('zh')
    ? `（${shortcut} 展开）`
    : `(${shortcut} to expand)`;
  return chalk.dim(text);
}
