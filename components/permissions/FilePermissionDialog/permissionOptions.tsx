/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import { basename, join, sep } from 'path';
import React, { type ReactNode } from 'react';
import { getOriginalCwd } from '../../../bootstrap/state.js';
import { Text } from '../../../ink.js';
import { getShortcutDisplay } from '../../../keybindings/shortcutFormat.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import { getMossenConfigHomeDir } from '../../../utils/envUtils.js';
import { getCanonicalConfigDirName } from '../../../utils/naming.js';
import { expandPath, getDirectoryForPath } from '../../../utils/path.js';
import { normalizeCaseForComparison, pathInAllowedWorkingPath } from '../../../utils/permissions/filesystem.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
/**
 * Check if a path is within the project's .mossen/ folder.
 * This is used to determine whether to show the special ".mossen folder" permission option.
 */
export function isInMossenFolder(filePath: string): boolean {
  const absolutePath = expandPath(filePath);
  const mossenFolderPath = expandPath(`${getOriginalCwd()}/${getCanonicalConfigDirName()}`);

  // Check if the path is within the project's .mossen folder
  const normalizedAbsolutePath = normalizeCaseForComparison(absolutePath);
  const normalizedMossenFolderPath = normalizeCaseForComparison(mossenFolderPath);

  // Path must start with the .mossen folder path (and be inside it, not just the folder itself)
  return normalizedAbsolutePath.startsWith(normalizedMossenFolderPath + sep.toLowerCase()) ||
  // Also match case where sep is / on posix systems
  normalizedAbsolutePath.startsWith(normalizedMossenFolderPath + '/');
}

/**
 * Check if a path is within the global ~/.mossen/ folder.
 * This is used to determine whether to show the special ".mossen folder" permission option
 * for files in the user's home directory.
 */
export function isInGlobalMossenFolder(filePath: string): boolean {
  const absolutePath = expandPath(filePath);
  const globalMossenFolderPath = getMossenConfigHomeDir();
  const normalizedAbsolutePath = normalizeCaseForComparison(absolutePath);
  const normalizedGlobalMossenFolderPath = normalizeCaseForComparison(globalMossenFolderPath);
  return normalizedAbsolutePath.startsWith(normalizedGlobalMossenFolderPath + sep.toLowerCase()) || normalizedAbsolutePath.startsWith(normalizedGlobalMossenFolderPath + '/');
}
export type PermissionOption = {
  type: 'accept-once';
} | {
  type: 'accept-session';
  scope?: 'mossen-folder' | 'global-mossen-folder';
} | {
  type: 'reject';
};
export type PermissionOptionWithLabel = OptionWithDescription<string> & {
  option: PermissionOption;
};
export type FileOperationType = 'read' | 'write' | 'create';
export function getFilePermissionOptions({
  filePath,
  toolPermissionContext,
  operationType = 'write',
  onRejectFeedbackChange,
  onAcceptFeedbackChange,
  yesInputMode = false,
  noInputMode = false
}: {
  filePath: string;
  toolPermissionContext: ToolPermissionContext;
  operationType?: FileOperationType;
  onRejectFeedbackChange?: (value: string) => void;
  onAcceptFeedbackChange?: (value: string) => void;
  yesInputMode?: boolean;
  noInputMode?: boolean;
}): PermissionOptionWithLabel[] {
  const options: PermissionOptionWithLabel[] = [];
  const modeCycleShortcut = getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab');
  const yesLabel = getLocalizedText({ en: 'Yes', zh: '是' });
  const noLabel = getLocalizedText({ en: 'No', zh: '否' });

  // When in input mode, show input field
  if (yesInputMode && onAcceptFeedbackChange) {
    options.push({
      type: 'input',
      label: yesLabel,
      value: 'yes',
      placeholder: getLocalizedText({
        en: 'and tell the assistant what to do next',
        zh: '并告诉助手接下来要做什么',
      }),
      onChange: onAcceptFeedbackChange,
      allowEmptySubmitToCancel: true,
      option: {
        type: 'accept-once'
      }
    });
  } else {
    options.push({
      label: yesLabel,
      value: 'yes',
      option: {
        type: 'accept-once'
      }
    });
  }
  const inAllowedPath = pathInAllowedWorkingPath(filePath, toolPermissionContext);

  // Check if this is a .mossen/ folder path (project or global)
  const inMossenFolder = isInMossenFolder(filePath);
  const inGlobalMossenFolder = isInGlobalMossenFolder(filePath);

  // Option 2: For .mossen/ folder, show special option instead of generic session option
  // Note: Session-level options are always shown since they only affect in-memory state,
  // not persisted settings. The allowManagedPermissionRulesOnly setting only restricts
  // persisted permission rules.
  if ((inMossenFolder || inGlobalMossenFolder) && operationType !== 'read') {
    options.push({
      label: getLocalizedText({
        en: 'Yes, and allow Mossen to edit its own settings for this session',
        zh: '是，并允许 Mossen 在本会话中编辑自己的设置',
      }),
      value: 'yes-mossen-folder',
      option: {
        type: 'accept-session',
        scope: inGlobalMossenFolder ? 'global-mossen-folder' : 'mossen-folder'
      }
    });
  } else {
    // Option 2: Allow all changes/reads during session
    let sessionLabel: ReactNode;
    if (inAllowedPath) {
      // Inside working directory
      if (operationType === 'read') {
        sessionLabel = getLocalizedText({
          en: 'Yes, during this session',
          zh: '是，在本会话中允许',
        });
      } else {
        sessionLabel = <Text>
            {getLocalizedText({
              en: 'Yes, allow all edits during this session',
              zh: '是，允许本会话中的所有编辑',
            })}{' '}
            <Text bold>({modeCycleShortcut})</Text>
          </Text>;
      }
    } else {
      // Outside working directory - include directory name
      const dirPath = getDirectoryForPath(filePath);
      const dirName =
        basename(dirPath) ||
        getLocalizedText({ en: 'this directory', zh: '此目录' });
      if (operationType === 'read') {
        sessionLabel = <Text>
            {getLocalizedText({ en: 'Yes, allow reading from', zh: '是，允许读取' })}{' '}
            <Text bold>{dirName}/</Text>{' '}
            {getLocalizedText({ en: 'during this session', zh: '在本会话中' })}
          </Text>;
      } else {
        sessionLabel = <Text>
            {getLocalizedText({ en: 'Yes, allow all edits in', zh: '是，允许编辑' })}{' '}
            <Text bold>{dirName}/</Text>{' '}
            {getLocalizedText({ en: 'during this session', zh: '在本会话中' })}{' '}
            <Text bold>({modeCycleShortcut})</Text>
          </Text>;
      }
    }
    options.push({
      label: sessionLabel,
      value: 'yes-session',
      option: {
        type: 'accept-session'
      }
    });
  }

  // When in input mode, show input field for reject
  if (noInputMode && onRejectFeedbackChange) {
    options.push({
      type: 'input',
      label: noLabel,
      value: 'no',
      placeholder: getLocalizedText({
        en: 'and tell the assistant what to do differently',
        zh: '并告诉助手需要如何调整',
      }),
      onChange: onRejectFeedbackChange,
      allowEmptySubmitToCancel: true,
      option: {
        type: 'reject'
      }
    });
  } else {
    // Not in input mode - simple option
    options.push({
      label: noLabel,
      value: 'no',
      option: {
        type: 'reject'
      }
    });
  }
  return options;
}
