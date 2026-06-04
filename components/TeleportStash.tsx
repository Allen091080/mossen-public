import figures from 'figures';
import React, { useEffect, useState } from 'react';
import { Box, Text } from '../ink.js';
import { logForDebugging } from '../utils/debug.js';
import type { GitFileStatus } from '../utils/git.js';
import { getFileStatus, stashToCleanState } from '../utils/git.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { Spinner } from './Spinner.js';
type TeleportStashProps = {
  onStashAndContinue: () => void;
  onCancel: () => void;
};
export function TeleportStash({
  onStashAndContinue,
  onCancel
}: TeleportStashProps): React.ReactNode {
  const [gitFileStatus, setGitFileStatus] = useState<GitFileStatus | null>(null);
  const changedFiles = gitFileStatus !== null ? [...gitFileStatus.tracked, ...gitFileStatus.untracked] : [];
  const [loading, setLoading] = useState(true);
  const [stashing, setStashing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load changed files on mount
  useEffect(() => {
    const loadChangedFiles = async () => {
      try {
        const fileStatus = await getFileStatus();
        setGitFileStatus(fileStatus);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logForDebugging(`Error getting changed files: ${errorMessage}`, {
          level: 'error'
        });
        setError(getLocalizedText({
          en: 'Failed to get changed files',
          zh: '获取变更文件失败'
        }));
      } finally {
        setLoading(false);
      }
    };
    void loadChangedFiles();
  }, []);
  const handleStash = async () => {
    setStashing(true);
    try {
      logForDebugging('Stashing changes before teleport...');
      const success = await stashToCleanState('Teleport auto-stash');
      if (success) {
        logForDebugging('Successfully stashed changes');
        onStashAndContinue();
      } else {
        setError(getLocalizedText({
          en: 'Failed to stash changes',
          zh: '暂存更改失败'
        }));
      }
    } catch (err_0) {
      const errorMessage_0 = err_0 instanceof Error ? err_0.message : String(err_0);
      logForDebugging(`Error stashing changes: ${errorMessage_0}`, {
        level: 'error'
      });
      setError(getLocalizedText({
        en: 'Failed to stash changes',
        zh: '暂存更改失败'
      }));
    } finally {
      setStashing(false);
    }
  };
  const handleSelectChange = (value: string) => {
    if (value === 'stash') {
      void handleStash();
    } else {
      onCancel();
    }
  };
  if (loading) {
    return <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Spinner />
          <Text> {getLocalizedText({
          en: 'Checking git status',
          zh: '正在检查 git 状态'
        })}{figures.ellipsis}</Text>
        </Box>
      </Box>;
  }
  if (error) {
    return <Box flexDirection="column" padding={1}>
        <Text bold color="error">
          {getLocalizedText({
          en: 'Error:',
          zh: '错误：'
        })} {error}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>{getLocalizedText({
          en: 'Press ',
          zh: '按 '
        })}</Text>
          <Text bold>Escape</Text>
          <Text dimColor>{getLocalizedText({
          en: ' to cancel',
          zh: ' 取消'
        })}</Text>
        </Box>
      </Box>;
  }
  const showFileCount = changedFiles.length > 8;
  return <Dialog title={getLocalizedText({
    en: 'Working Directory Has Changes',
    zh: '工作目录有未提交更改'
  })} onCancel={onCancel}>
      <Text>
        {getLocalizedText({
        en: 'Teleport will switch git branches. The following changes were found:',
        zh: 'Teleport 将切换 git 分支。检测到以下更改：'
      })}
      </Text>

      <Box flexDirection="column" paddingLeft={2}>
        {changedFiles.length > 0 ? showFileCount ? <Text>{getLocalizedText({
        en: `${changedFiles.length} files changed`,
        zh: `${changedFiles.length} 个文件已更改`
      })}</Text> : changedFiles.map((file: string, index: number) => <Text key={index}>{file}</Text>) : <Text dimColor>{getLocalizedText({
        en: 'No changes detected',
        zh: '未检测到更改'
      })}</Text>}
      </Box>

      <Text>
        {getLocalizedText({
        en: 'Would you like to stash these changes and continue with teleport?',
        zh: '要先暂存这些更改，再继续 teleport 吗？'
      })}
      </Text>

      {stashing ? <Box>
          <Spinner />
          <Text> {getLocalizedText({
          en: 'Stashing changes...',
          zh: '正在暂存更改...'
        })}</Text>
        </Box> : <Select options={[{
      label: getLocalizedText({
        en: 'Stash changes and continue',
        zh: '暂存更改并继续'
      }),
      value: 'stash'
    }, {
      label: getLocalizedText({
        en: 'Exit',
        zh: '退出'
      }),
      value: 'exit'
    }]} onChange={handleSelectChange} />}
    </Dialog>;
}
