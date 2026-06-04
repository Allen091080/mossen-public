import React from 'react';
import { Box, Text } from 'src/ink.js';
import { getProductDisplayName, getProductWelcomeMessage } from '../../constants/product.js';
import { isCustomBackendEnabled } from '../../utils/customBackend.js';
import { getDisplayAppVersion } from '../../utils/version.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { MossenAgentBanner, MOSSEN_AGENT_BANNER_WIDTH } from './MossenAgentBanner.js';
import { MossenDotLogo, MOSSEN_TEXT_MARK } from './MossenDotLogo.js';
const WELCOME_V2_WIDTH = 58;
export function WelcomeV2() {
  const { columns } = useTerminalSize();
  if (columns >= MOSSEN_AGENT_BANNER_WIDTH + 4) {
    return <MossenAgentBanner />;
  }
  if (isCustomBackendEnabled()) {
    return <Box width={WELCOME_V2_WIDTH} flexDirection="column" alignItems="center"><Text><Text color="mossen">{MOSSEN_TEXT_MARK} {getProductWelcomeMessage()} </Text><Text dimColor={true}>v{getDisplayAppVersion()} </Text></Text><Box marginTop={1} marginBottom={1}><MossenDotLogo /></Box><Text bold={true}>{getProductDisplayName()}</Text></Box>;
  }
  const fallbackMessage = getLocalizedText({
    en: 'Mossen model not configured. Run `mossen --list-model-profiles` to see profiles or `mossen --migrate-fallback-profile` to migrate.',
    zh: '未配置 Mossen 模型。请运行 `mossen --list-model-profiles` 查看可用 profile，或运行 `mossen --migrate-fallback-profile` 迁移旧配置。',
  });
  return <Box width={WELCOME_V2_WIDTH} flexDirection="column"><Text><Text color="mossen">{getProductWelcomeMessage()} </Text><Text dimColor={true}>v{getDisplayAppVersion()} </Text></Text><Box marginTop={1}><Text color="warning">{fallbackMessage}</Text></Box></Box>;
}
