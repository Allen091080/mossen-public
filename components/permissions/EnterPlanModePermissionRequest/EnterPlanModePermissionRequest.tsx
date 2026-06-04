import React from 'react';
import { handlePlanModeTransition } from '../../../bootstrap/state.js';
import { getProductAssistantName } from '../../../constants/product.js';
import { Box, Text } from '../../../ink.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../../services/analytics/index.js'
import { logMossenEvent } from '../../../services/analytics/mossenEventLogger.js';
import { useAppState } from '../../../state/AppState.js';
import { isPlanModeInterviewPhaseEnabled } from '../../../utils/planModeV2.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
import { Select } from '../../CustomSelect/index.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';

export function EnterPlanModePermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps): React.ReactNode {
  const toolPermissionContextMode = useAppState(
    s => s.toolPermissionContext.mode,
  );
  const assistantName = getProductAssistantName();
  const titleText = getLocalizedText({
    en: 'Enter plan mode?',
    zh: '进入规划模式？',
  });
  const introText = getLocalizedText({
    en: `${assistantName} wants to enter plan mode to explore and design an implementation approach.`,
    zh: `${assistantName} 想进入规划模式，以便探索代码并设计实现方案。`,
  });
  const planModeIntroText = getLocalizedText({
    en: `In plan mode, ${assistantName} will:`,
    zh: `在规划模式下，${assistantName} 会：`,
  });
  const exploreText = getLocalizedText({
    en: ' · Explore the codebase thoroughly',
    zh: ' · 彻底探索代码库',
  });
  const identifyText = getLocalizedText({
    en: ' · Identify existing patterns',
    zh: ' · 识别现有模式',
  });
  const designText = getLocalizedText({
    en: ' · Design an implementation strategy',
    zh: ' · 设计实现策略',
  });
  const approvalText = getLocalizedText({
    en: ' · Present a plan for your approval',
    zh: ' · 提交方案供你确认',
  });
  const noChangesText = getLocalizedText({
    en: 'No code changes will be made until you approve the plan.',
    zh: '在你确认方案之前，不会进行任何代码改动。',
  });
  const enterPlanModeLabel = getLocalizedText({
    en: 'Yes, enter plan mode',
    zh: '是，进入规划模式',
  });
  const implementNowLabel = getLocalizedText({
    en: 'No, start implementing now',
    zh: '否，直接开始实现',
  });

  function handleResponse(value: 'yes' | 'no'): void {
    if (value === 'yes') {
      logMossenEvent('mossen.permission.planEnter', {
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        entryMethod:
          'tool' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });
      handlePlanModeTransition(toolPermissionContextMode, 'plan');
      onDone();
      toolUseConfirm.onAllow({}, [
        { type: 'setMode', mode: 'plan', destination: 'session' },
      ]);
      return;
    }

    onDone();
    onReject();
    toolUseConfirm.onReject();
  }

  return (
    <PermissionDialog
      color="planMode"
      title={titleText}
      workerBadge={workerBadge}
    >
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text>{introText}</Text>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{planModeIntroText}</Text>
          <Text dimColor>{exploreText}</Text>
          <Text dimColor>{identifyText}</Text>
          <Text dimColor>{designText}</Text>
          <Text dimColor>{approvalText}</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>{noChangesText}</Text>
        </Box>

        <Box marginTop={1}>
          <Select
            options={[
              { label: enterPlanModeLabel, value: 'yes' as const },
              { label: implementNowLabel, value: 'no' as const },
            ]}
            onChange={handleResponse}
            onCancel={() => handleResponse('no')}
          />
        </Box>
      </Box>
    </PermissionDialog>
  );
}
