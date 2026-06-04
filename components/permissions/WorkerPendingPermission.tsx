/* eslint-disable @typescript-eslint/no-unused-vars -- Legacy compatibility and dead-code surfaces are intentionally left behavior-stable while lint debt is localized. */
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { getAgentName, getTeammateColor, getTeamName } from '../../utils/teammate.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { Spinner } from '../Spinner.js';
import { WorkerBadge } from './WorkerBadge.js';
type Props = {
  toolName: string;
  description: string;
};

/**
 * Visual indicator shown on workers while waiting for leader to approve a permission request.
 * Displays the pending tool with a spinner and information about what's being requested.
 */
export function WorkerPendingPermission(t0) {
  const {
    toolName,
    description
  } = t0;
  const teamName = getTeamName();
  const agentName = getAgentName();
  const agentColor = getTeammateColor();
  const waitingForApprovalText = getLocalizedText({
    en: 'Waiting for team lead approval',
    zh: '等待团队负责人审批'
  });
  const toolLabel = getLocalizedText({
    en: 'Tool: ',
    zh: '工具：'
  });
  const actionLabel = getLocalizedText({
    en: 'Action: ',
    zh: '操作：'
  });
  const teamLeadNotice = teamName ? getLocalizedText({
    en: `Permission request sent to team "${teamName}" leader`,
    zh: `权限申请已发送给团队“${teamName}”负责人`
  }) : null;
  return <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}><Box marginBottom={1}><Spinner /><Text color="warning" bold={true}>{" "}{waitingForApprovalText}</Text></Box>{agentName && agentColor && <Box marginBottom={1}><WorkerBadge name={agentName} color={agentColor} /></Box>}<Box><Text dimColor={true}>{toolLabel}</Text><Text>{toolName}</Text></Box><Box><Text dimColor={true}>{actionLabel}</Text><Text>{description}</Text></Box>{teamLeadNotice && <Box marginTop={1}><Text dimColor={true}>{teamLeadNotice}</Text></Box>}</Box>;
}
