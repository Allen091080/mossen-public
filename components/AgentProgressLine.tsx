import * as React from 'react';
import { Box, Text } from '../ink.js';
import { formatNumber } from '../utils/format.js';
import type { Theme } from '../utils/theme.js';
import { getInteractiveLanguageTag, getLocalizedText } from '../utils/uiLanguage.js';

type Props = {
  agentType: string;
  description?: string;
  name?: string;
  descriptionColor?: keyof Theme;
  taskDescription?: string;
  toolUseCount: number;
  tokens: number | null;
  color?: keyof Theme;
  isLast: boolean;
  isResolved: boolean;
  isError: boolean;
  isAsync?: boolean;
  shouldAnimate: boolean;
  lastToolInfo?: string | null;
  hideType?: boolean;
};

export function AgentProgressLine({
  agentType,
  description,
  name,
  descriptionColor,
  taskDescription,
  toolUseCount,
  tokens,
  color,
  isLast,
  isResolved,
  isError: _isError,
  isAsync = false,
  shouldAnimate: _shouldAnimate,
  lastToolInfo,
  hideType = false,
}: Props): React.ReactNode {
  const treeChar = isLast ? '└─' : '├─';
  const isBackgrounded = isAsync && isResolved;
  const isZh = getInteractiveLanguageTag().startsWith('zh');
  const tokenLabel = getLocalizedText({ en: 'tokens', zh: '令牌' });

  const getStatusText = (): string => {
    if (!isResolved) {
      return (
        lastToolInfo ||
        getLocalizedText({ en: 'Initializing…', zh: '正在初始化…' })
      );
    }
    if (isBackgrounded) {
      return (
        taskDescription ||
        getLocalizedText({
          en: 'Running in the background',
          zh: '正在后台运行',
        })
      );
    }
    return getLocalizedText({ en: 'Done', zh: '已完成' });
  };

  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text dimColor>{treeChar} </Text>
        <Text dimColor={!isResolved}>
          {hideType ? (
            <>
              <Text bold>{name ?? description ?? agentType}</Text>
              {name && description && <Text dimColor>: {description}</Text>}
            </>
          ) : (
            <>
              <Text
                bold
                backgroundColor={color}
                color={color ? 'inverseText' : undefined}
              >
                {agentType}
              </Text>
              {description && (
                <>
                  {' ('}
                  <Text
                    backgroundColor={descriptionColor}
                    color={descriptionColor ? 'inverseText' : undefined}
                  >
                    {description}
                  </Text>
                  {')'}
                </>
              )}
            </>
          )}
          {!isBackgrounded && (
            <>
              {' · '}
              {isZh
                ? `${toolUseCount} 次工具调用`
                : `${toolUseCount} tool ${toolUseCount === 1 ? 'use' : 'uses'}`}
              {tokens !== null && <> · {formatNumber(tokens)} {tokenLabel}</>}
            </>
          )}
        </Text>
      </Box>
      {!isBackgrounded && (
        <Box paddingLeft={3} flexDirection="row">
          <Text dimColor>{isLast ? '   ⎿  ' : '│  ⎿  '}</Text>
          <Text dimColor>{getStatusText()}</Text>
        </Box>
      )}
    </Box>
  );
}
