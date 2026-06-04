import * as React from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { Box, Text } from '../ink.js';
import type { Screen } from '../screens/REPL.js';
import type { NormalizedUserMessage } from '../types/message.js';
import { t } from '../utils/i18n/index.js';
import { getUserMessageText } from '../utils/messages.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { MessageResponse } from './MessageResponse.js';

type Props = {
  message: NormalizedUserMessage;
  screen: Screen;
};

// UX-Wave1 S4C: 移除原 React Compiler _c(24) cache 包装。
// 原 4 处 sentinel + 4 处 deps-based slot 不带 langTag，i18n 切换无法
// invalidate；逐 slot 改动会破坏索引。CompactSummary 非 hot path，
// 直接走每次 render，让 t() 按当前 lang 取值即可。如 mossen build
// 跑 React Compiler，会自动按当前结构重新生成 cache。
export function CompactSummary({ message, screen }: Props) {
  const isTranscriptMode = screen === 'transcript';
  const textContent = getUserMessageText(message) || '';
  const metadata = message.summarizeMetadata;
  const bullet = (
    <Box minWidth={2}>
      <Text color="text">{BLACK_CIRCLE}</Text>
    </Box>
  );

  if (metadata) {
    const detailKey =
      metadata.direction === 'up_to'
        ? 'ui.compact.summarizedDetailUpTo'
        : 'ui.compact.summarizedDetailFrom';
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          {bullet}
          <Box flexDirection="column">
            <Text bold>{t('ui.compact.summarizedTitle')}</Text>
            {!isTranscriptMode && (
              <MessageResponse>
                <Box flexDirection="column">
                  <Text dimColor>
                    {t(detailKey, { count: metadata.messagesSummarized })}
                  </Text>
                  {metadata.userContext && (
                    <Text dimColor>
                      {t('ui.compact.contextLabel')}
                      {'“'}
                      {metadata.userContext}
                      {'”'}
                    </Text>
                  )}
                  <Text dimColor>
                    <ConfigurableShortcutHint
                      action="app:toggleTranscript"
                      context="Global"
                      fallback="ctrl+o"
                      description={t('ui.compact.expandHistoryHint')}
                      parens={true}
                    />
                  </Text>
                </Box>
              </MessageResponse>
            )}
            {isTranscriptMode && (
              <MessageResponse>
                <Text>{textContent}</Text>
              </MessageResponse>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        {bullet}
        <Box flexDirection="column">
          <Text bold>
            {t('ui.compact.summaryTitle')}
            {!isTranscriptMode && (
              <Text dimColor>
                {' '}
                <ConfigurableShortcutHint
                  action="app:toggleTranscript"
                  context="Global"
                  fallback="ctrl+o"
                  description={t('ui.compact.expandHint')}
                  parens={true}
                />
              </Text>
            )}
          </Text>
        </Box>
      </Box>
      {isTranscriptMode && (
        <MessageResponse>
          <Text>{textContent}</Text>
        </MessageResponse>
      )}
    </Box>
  );
}
