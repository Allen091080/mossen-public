import React, { useMemo } from 'react'
import { Box, Text } from '../../ink.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import { getInitialSettings, updateSettingsForSource } from '../../utils/settings/settings.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { type UnaryEvent, usePermissionRequestLogging } from '../../components/permissions/hooks.js'
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js'
import {
  PermissionPrompt,
  type PermissionPromptOption,
  type ToolAnalyticsContext,
} from '../../components/permissions/PermissionPrompt.js'
import type { PermissionRequestProps } from '../../components/permissions/PermissionRequest.js'
import { PermissionRuleExplanation } from '../../components/permissions/PermissionRuleExplanation.js'
import { logUnaryPermissionEvent } from '../../components/permissions/utils.js'
import {
  buildWorkflowPermissionReview,
  type WorkflowPermissionReview,
} from './permissionReview.js'

type WorkflowOptionValue = 'yes' | 'yes-skip-warning' | 'no'

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Box minWidth={12}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        {typeof children === 'string' ? <Text>{children}</Text> : children}
      </Box>
    </Box>
  )
}

function ReviewDetails({
  review,
}: {
  review: WorkflowPermissionReview
}): React.ReactNode {
  const phases = review.meta?.phases ?? []
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {review.meta ? (
        <>
          <DetailRow label="Name">{review.meta.name}</DetailRow>
          <DetailRow label="Purpose">{review.meta.description}</DetailRow>
          {review.meta.whenToUse ? (
            <DetailRow label="Use when">{review.meta.whenToUse}</DetailRow>
          ) : null}
          {review.meta.model ? (
            <DetailRow label="Model">{review.meta.model}</DetailRow>
          ) : null}
        </>
      ) : null}

      <DetailRow label="Source">
        <Text>
          {review.sourceKind}: {review.sourceLabel}
        </Text>
      </DetailRow>
      {review.resumeFromRunId ? (
        <DetailRow label="Resume">{review.resumeFromRunId}</DetailRow>
      ) : null}
      {review.runInBackground ? (
        <DetailRow label="Mode">background</DetailRow>
      ) : null}
      {review.timeoutMs !== null ? (
        <DetailRow label="Timeout">{String(review.timeoutMs)} ms</DetailRow>
      ) : null}
      {review.argsPreview ? (
        <DetailRow label="Args">
          <Text wrap="truncate-end">{review.argsPreview}</Text>
        </DetailRow>
      ) : null}
      {phases.length ? (
        <DetailRow label="Phases">
          <Box flexDirection="column">
            {phases.map((phase, index) => (
              <Text key={`${phase.title}-${index}`}>
                {index + 1}. {phase.title}
                {phase.model ? ` (${phase.model})` : ''}
                {phase.detail ? ` - ${phase.detail}` : ''}
              </Text>
            ))}
          </Box>
        </DetailRow>
      ) : null}
      {review.metaError ? (
        <DetailRow label="Warning">
          <Text color="warning">{review.metaError}</Text>
        </DetailRow>
      ) : null}
      {review.scriptPreview ? (
        <DetailRow label="Script">
          <Text dimColor wrap="truncate-end">
            {review.scriptPreview}
          </Text>
        </DetailRow>
      ) : null}
      {review.showUsageWarning ? (
        <Box marginTop={1}>
          <Text color="warning">
            Dynamic workflows can run multiple subagents and consume tokens
            quickly. You can inspect running workflows with /workflows or
            disable them in /config.
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

export function WorkflowPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps): React.ReactNode {
  const skipUsageWarning =
    getInitialSettings().skipWorkflowUsageWarning === true
  const review = useMemo(
    () =>
      buildWorkflowPermissionReview(toolUseConfirm.input, {
        showUsageWarning: !skipUsageWarning,
      }),
    [skipUsageWarning, toolUseConfirm.input],
  )
  const unaryEvent: UnaryEvent = useMemo(
    () => ({
      completion_type: 'tool_use_single',
      language_name: 'none',
    }),
    [],
  )
  usePermissionRequestLogging(toolUseConfirm, unaryEvent)

  const options: PermissionPromptOption<WorkflowOptionValue>[] = [
    {
      label: getLocalizedText({ en: 'Yes', zh: '是' }),
      value: 'yes',
      feedbackConfig: { type: 'accept' },
    },
  ]
  if (!skipUsageWarning) {
    options.push({
      label: getLocalizedText({
        en: "Yes, and don't show the workflow usage warning again",
        zh: '是，并且不再显示 workflow 用量提醒',
      }),
      value: 'yes-skip-warning',
      feedbackConfig: { type: 'accept' },
    })
  }
  options.push({
    label: getLocalizedText({ en: 'No', zh: '否' }),
    value: 'no',
    feedbackConfig: { type: 'reject' },
  })

  const toolAnalyticsContext: ToolAnalyticsContext = {
    toolName: sanitizeToolNameForAnalytics(toolUseConfirm.tool.name),
    isMcp: toolUseConfirm.tool.isMcp ?? false,
  }

  const handleSelect = (value: WorkflowOptionValue, feedback?: string) => {
    switch (value) {
      case 'yes':
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
        toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback)
        onDone()
        break
      case 'yes-skip-warning': {
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
        updateSettingsForSource('localSettings', {
          skipWorkflowUsageWarning: true,
        })
        toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback)
        onDone()
        break
      }
      case 'no':
        logUnaryPermissionEvent(
          'tool_use_single',
          toolUseConfirm,
          'reject',
          Boolean(feedback),
        )
        toolUseConfirm.onReject(feedback)
        onReject()
        onDone()
        break
    }
  }

  const handleCancel = () => {
    logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'reject')
    toolUseConfirm.onReject()
    onReject()
    onDone()
  }

  const title = getLocalizedText({
    en: 'Review dynamic workflow before running',
    zh: '运行前审核动态 workflow',
  })
  const question = (
    <Text>
      {getLocalizedText({
        en: 'Run this dynamic workflow?',
        zh: '要运行这个动态 workflow 吗？',
      })}
    </Text>
  )

  return (
    <PermissionDialog
      title={title}
      subtitle={review.meta?.name ?? review.sourceLabel}
      workerBadge={workerBadge}
    >
      <ReviewDetails review={review} />
      <Box flexDirection="column">
        <PermissionRuleExplanation
          permissionResult={toolUseConfirm.permissionResult}
          toolType="tool"
        />
        <PermissionPrompt
          question={question}
          options={options}
          onSelect={handleSelect}
          onCancel={handleCancel}
          toolAnalyticsContext={toolAnalyticsContext}
        />
      </Box>
    </PermissionDialog>
  )
}
