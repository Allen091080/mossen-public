import React from 'react';
import stripAnsi from 'strip-ansi';
import { Box, Text } from '../../ink.js';
import { formatFileSize } from '../../utils/format.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { MessageResponse } from '../MessageResponse.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { ShellTimeDisplay } from './ShellTimeDisplay.js';
import { getLongRunningCommandProgressText, type LongRunningCommandState } from '../../tools/BashTool/longRunningCommand.js';

type Props = {
  output: string;
  fullOutput: string;
  elapsedTimeSeconds?: number;
  totalLines?: number;
  totalBytes?: number;
  timeoutMs?: number;
  taskId?: string;
  longRunningState?: LongRunningCommandState;
  verbose: boolean;
};

export function ShellProgressMessage({
  output,
  fullOutput,
  elapsedTimeSeconds,
  totalLines,
  totalBytes,
  timeoutMs,
  longRunningState = 'none',
  verbose,
}: Props): React.ReactNode {
  const strippedFullOutput = stripAnsi(fullOutput.trim());
  const strippedOutput = stripAnsi(output.trim());
  const lines = strippedOutput.split('\n').filter(line => line);
  const displayLines = verbose ? strippedFullOutput : lines.slice(-5).join('\n');
  const longRunningHint = getLongRunningCommandProgressText(longRunningState);

  if (!lines.length) {
    return (
      <MessageResponse>
        <OffscreenFreeze>
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Text dimColor>{getLocalizedText({ en: 'Running… ', zh: '正在运行… ' })}</Text>
              <ShellTimeDisplay
                elapsedTimeSeconds={elapsedTimeSeconds}
                timeoutMs={timeoutMs}
              />
            </Box>
            {longRunningHint ? (
              <Text dimColor>{getLocalizedText(longRunningHint)}</Text>
            ) : null}
          </Box>
        </OffscreenFreeze>
      </MessageResponse>
    );
  }

  const extraLines = totalLines ? Math.max(0, totalLines - 5) : 0;
  let lineStatus = '';

  if (!verbose && totalBytes && totalLines) {
    lineStatus = getLocalizedText({
      en: `~${totalLines} lines`,
      zh: `约 ${totalLines} 行`,
    });
  } else if (!verbose && extraLines > 0) {
    lineStatus = getLocalizedText({
      en: `+${extraLines} lines`,
      zh: `+${extraLines} 行`,
    });
  }

  return (
    <MessageResponse>
      <OffscreenFreeze>
        <Box flexDirection="column">
          <Box
            height={verbose ? undefined : Math.min(5, lines.length)}
            flexDirection="column"
            overflow="hidden"
          >
            <Text dimColor>{displayLines}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            {lineStatus ? <Text dimColor>{lineStatus}</Text> : null}
            <ShellTimeDisplay
              elapsedTimeSeconds={elapsedTimeSeconds}
              timeoutMs={timeoutMs}
            />
            {totalBytes ? <Text dimColor>{formatFileSize(totalBytes)}</Text> : null}
          </Box>
          {longRunningHint ? (
            <Text dimColor>
              {getLocalizedText(longRunningHint)}
            </Text>
          ) : null}
        </Box>
      </OffscreenFreeze>
    </MessageResponse>
  );
}
