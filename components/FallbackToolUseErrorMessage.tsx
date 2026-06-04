import type { MossenToolResultBlockParam } from 'src/services/api/mossenSdk.js';
import * as React from 'react';
import { stripUnderlineAnsi } from 'src/components/shell/OutputLine.js';
import { extractTag } from 'src/utils/messages.js';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import { Box, Text } from '../ink.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { countCharInString } from '../utils/stringUtils.js';
import { MessageResponse } from './MessageResponse.js';

const MAX_RENDERED_LINES = 10;

type Props = {
  result: MossenToolResultBlockParam['content'];
  verbose: boolean;
};

export function FallbackToolUseErrorMessage({
  result,
  verbose,
}: Props): React.ReactNode {
  const transcriptShortcut = useShortcutDisplay(
    'app:toggleTranscript',
    'Global',
    'ctrl+o',
  );

  let error: string;
  if (typeof result !== 'string') {
    error = getLocalizedText({
      en: 'Tool execution failed',
      zh: '工具执行失败',
    });
  } else {
    const extractedError = extractTag(result, 'tool_use_error') ?? result;
    const withoutSandboxViolations = removeSandboxViolationTags(extractedError);
    const withoutErrorTags = withoutSandboxViolations.replace(/<\/?error>/g, '');
    const trimmed = withoutErrorTags.trim();

    if (!verbose && trimmed.includes('InputValidationError: ')) {
      error = getLocalizedText({
        en: 'Invalid tool parameters',
        zh: '工具参数无效',
      });
    } else if (
      trimmed.startsWith('Error: ') ||
      trimmed.startsWith('Cancelled: ')
    ) {
      error = trimmed;
    } else {
      error = `${getLocalizedText({ en: 'Error', zh: '错误' })}: ${trimmed}`;
    }
  }

  const plusLines = countCharInString(error, '\n') + 1 - MAX_RENDERED_LINES;

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">
          {stripUnderlineAnsi(
            verbose
              ? error
              : error.split('\n').slice(0, MAX_RENDERED_LINES).join('\n'),
          )}
        </Text>
        {!verbose && plusLines > 0 ? (
          <Box>
            <Text dimColor>
              … +{plusLines}{' '}
              {getLocalizedText({
                en: plusLines === 1 ? 'line' : 'lines',
                zh: '行',
              })}{' '}
              (
            </Text>
            <Text dimColor bold>
              {transcriptShortcut}
            </Text>
            <Text> </Text>
            <Text dimColor>
              {getLocalizedText({ en: 'to see all)', zh: '展开查看全部）' })}
            </Text>
          </Box>
        ) : null}
      </Box>
    </MessageResponse>
  );
}
