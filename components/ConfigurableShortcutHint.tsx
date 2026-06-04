import * as React from 'react';
import type {
  KeybindingAction,
  KeybindingContextName,
} from '../keybindings/types.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { getInteractiveLanguageTag } from '../utils/uiLanguage.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';

type Props = {
  action: KeybindingAction;
  context: KeybindingContextName;
  fallback: string;
  description: string;
  parens?: boolean;
  bold?: boolean;
};

function localizeShortcutDescription(description: string): string {
  if (!getInteractiveLanguageTag().startsWith('zh')) {
    return description;
  }

  switch (description) {
    case 'back':
    case 'go back':
      return '返回';
    case 'cancel':
      return '取消';
    case 'confirm':
      return '确认';
    case 'continue':
      return '继续';
    case 'copy':
      return '复制';
    case 'details':
      return '详情';
    case 'disable':
      return '禁用';
    case 'dismiss':
      return '忽略';
    case 'expand':
      return '展开';
    case 'expand history':
      return '展开历史';
    case 'exit':
      return '退出';
    case 'manage':
      return '管理';
    case 'background':
      return '转到后台';
    case 'collapse':
      return '收起';
    case 'navigate':
      return '导航';
    case 'remove':
      return '移除';
    case 'select':
      return '选择';
    case 'skip':
      return '跳过';
    case 'toggle':
      return '切换';
    default:
      return description;
  }
}

export function ConfigurableShortcutHint({
  action,
  context,
  fallback,
  description,
  parens,
  bold,
}: Props): React.ReactNode {
  const shortcut = useShortcutDisplay(action, context, fallback);
  return (
    <KeyboardShortcutHint
      shortcut={shortcut}
      action={localizeShortcutDescription(description)}
      parens={parens}
      bold={bold}
    />
  );
}
