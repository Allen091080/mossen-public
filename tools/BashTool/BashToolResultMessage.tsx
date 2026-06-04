import React from 'react';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { OutputLine } from '../../components/shell/OutputLine.js';
import { ShellTimeDisplay } from '../../components/shell/ShellTimeDisplay.js';
import { Box, Text } from '../../ink.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import type { Out as BashOut } from './BashTool.js';

type Props = {
  content: Omit<BashOut, 'interrupted'>;
  verbose: boolean;
  timeoutMs?: number;
};

const SHELL_CWD_RESET_PATTERN = /(?:^|\n)(Shell cwd was reset to .+)$/;

function extractSandboxViolations(stderr: string): {
  cleanedStderr: string;
} {
  const violationsMatch = stderr.match(
    /<sandbox_violations>([\s\S]*?)<\/sandbox_violations>/,
  );
  if (!violationsMatch) {
    return {
      cleanedStderr: stderr,
    };
  }

  return {
    cleanedStderr: removeSandboxViolationTags(stderr).trim(),
  };
}

function extractCwdResetWarning(stderr: string): {
  cleanedStderr: string;
  cwdResetWarning: string | null;
} {
  const match = stderr.match(SHELL_CWD_RESET_PATTERN);
  if (!match) {
    return {
      cleanedStderr: stderr,
      cwdResetWarning: null,
    };
  }

  const cwdResetWarning = match[1] ?? null;
  const cleanedStderr = stderr.replace(SHELL_CWD_RESET_PATTERN, '').trim();
  return {
    cleanedStderr,
    cwdResetWarning,
  };
}

export default function BashToolResultMessage({
  content,
  verbose,
  timeoutMs,
}: Props) {
  const {
    stdout = '',
    stderr: stderrWithViolations = '',
    isImage,
    returnCodeInterpretation,
    noOutputExpected,
    backgroundTaskId,
  } = content;

  const { cleanedStderr: stderrWithoutViolations } =
    extractSandboxViolations(stderrWithViolations);
  const { cleanedStderr: stderr, cwdResetWarning } =
    extractCwdResetWarning(stderrWithoutViolations);

  if (isImage) {
    return (
      <MessageResponse height={1}>
        <Text dimColor>
          {getLocalizedText({
            en: '[Image data detected and sent to Mossen]',
            zh: '[检测到图片数据，已发送给 Mossen]',
          })}
        </Text>
      </MessageResponse>
    );
  }

  const emptyOutput = stdout === '' && stderr.trim() === '' && !cwdResetWarning;
  const backgroundMessage = (
    <>
      {getLocalizedText({
        en: 'Running in the background',
        zh: '正在后台运行',
      })}{' '}
      <KeyboardShortcutHint
        shortcut="↓"
        action={getLocalizedText({ en: 'manage', zh: '管理' })}
        parens
      />
    </>
  );
  const idleMessage =
    returnCodeInterpretation ||
    getLocalizedText({
      en: noOutputExpected ? 'Done' : '(No output)',
      zh: noOutputExpected ? '已完成' : '（无输出）',
    });

  return (
    <Box flexDirection="column">
      {stdout !== '' ? <OutputLine content={stdout} verbose={verbose} /> : null}
      {stderr.trim() !== '' ? (
        <OutputLine content={stderr} verbose={verbose} isError />
      ) : null}
      {cwdResetWarning ? (
        <MessageResponse>
          <Text dimColor>{cwdResetWarning}</Text>
        </MessageResponse>
      ) : null}
      {emptyOutput ? (
        <MessageResponse height={1}>
          <Text dimColor>{backgroundTaskId ? backgroundMessage : idleMessage}</Text>
        </MessageResponse>
      ) : null}
      {timeoutMs ? (
        <MessageResponse>
          <ShellTimeDisplay timeoutMs={timeoutMs} />
        </MessageResponse>
      ) : null}
    </Box>
  );
}
