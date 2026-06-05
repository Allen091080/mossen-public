import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from '../../ink.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import { getExternalEditor } from '../../utils/editor.js'
import { toIDEDisplayName } from '../../utils/ide.js'
import { editPromptInEditor } from '../../utils/promptEditor.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'
import { useAppState } from '../../state/AppState.js'
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
import { buildNamedWorkflowPermissionUpdates } from './permissionRules.js'
import type {
  WorkflowStaticPhase,
  WorkflowStaticPhaseKind,
} from './engine/staticSummary.js'
import {
  recordWorkflowUsageConsent,
  workflowNeedsUsageConsentPrompt,
} from './usageConsent.js'

type WorkflowOptionValue =
  | 'yes'
  | 'yes-always'
  | 'yes-record-consent'
  | 'yes-skip-warning'
  | 'toggle-script'
  | 'no'

const MAX_RAW_SCRIPT_CHARS = 4000

function truncateRawScript(source: string): string {
  if (source.length <= MAX_RAW_SCRIPT_CHARS) return source
  return `${source.slice(0, MAX_RAW_SCRIPT_CHARS - 18)}\n... [truncated]`
}

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

function staticPhaseKindLabel(kind: WorkflowStaticPhaseKind): string {
  switch (kind) {
    case 'loop':
      return 'loop'
    case 'parallel':
      return 'parallel'
    case 'sequential':
      return 'step'
  }
}

function staticPhaseTitle(
  review: WorkflowPermissionReview,
  phase: WorkflowStaticPhase,
  index: number,
): { title: string; detail?: string } {
  const metaPhase = review.meta?.phases?.[index]
  if (metaPhase) {
    return { title: metaPhase.title, detail: metaPhase.detail }
  }
  return {
    title: `${staticPhaseKindLabel(phase.kind)}${phase.annotation ? ` ${phase.annotation}` : ''}`,
  }
}

function promptSamples(phase: WorkflowStaticPhase): string[] {
  const seen = new Set<string>()
  const samples: string[] = []
  for (const agent of phase.agents) {
    if (!agent.prompt || seen.has(agent.prompt)) continue
    seen.add(agent.prompt)
    samples.push(agent.prompt)
    if (samples.length === 2) break
  }
  return samples
}

function StaticSummaryDetails({
  review,
}: {
  review: WorkflowPermissionReview
}): React.ReactNode {
  const summary = review.staticSummary
  if (!summary) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        This dynamic workflow will spin up multiple subagents across the
        following phases:
      </Text>
      {summary.phases.map((phase, index) => {
        const title = staticPhaseTitle(review, phase, index)
        const samples = promptSamples(phase)
        return (
          <Box
            key={`${phase.kind}-${phase.annotation ?? ''}-${index}`}
            flexDirection="column"
          >
            <Text>
              {'  '}
              {index + 1}. {title.title}
              {title.detail ? ` - ${title.detail}` : ''}
            </Text>
            {samples.length ? (
              <Text dimColor>
                {'     '}
                {samples.map(sample => `- "${sample}"`).join('  ')}
                {phase.agents.length > samples.length
                  ? `  +${phase.agents.length - samples.length} more`
                  : ''}
              </Text>
            ) : null}
          </Box>
        )
      })}
      <Text dimColor>
        Estimated agents: {summary.estimatedAgents}
        {summary.hasReturn ? ' - returns a workflow result' : ''}
      </Text>
    </Box>
  )
}

function ReviewDetails({
  review,
  showRawScript,
}: {
  review: WorkflowPermissionReview
  showRawScript: boolean
}): React.ReactNode {
  const phases = review.meta?.phases ?? []
  const scriptBody =
    showRawScript && review.scriptSource
      ? truncateRawScript(review.scriptSource)
      : review.scriptPreview
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
      <StaticSummaryDetails review={review} />
      {review.metaError ? (
        <DetailRow label="Warning">
          <Text color="warning">{review.metaError}</Text>
        </DetailRow>
      ) : null}
      {scriptBody ? (
        <DetailRow label="Script">
          <Text dimColor wrap="truncate-end">
            {scriptBody}
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
  const [editedScript, setEditedScript] = useState<string | null>(null)
  const [showRawScript, setShowRawScript] = useState(false)
  const [editorStatus, setEditorStatus] = useState<string | null>(null)
  const permissionMode = useAppState(state => state.toolPermissionContext.mode)
  useEffect(() => {
    setEditedScript(null)
    setShowRawScript(false)
    setEditorStatus(null)
  }, [toolUseConfirm.input])

  const originalReview = useMemo(
    () => buildWorkflowPermissionReview(toolUseConfirm.input),
    [toolUseConfirm.input],
  )
  const effectiveInput = useMemo(
    () =>
      editedScript === null
        ? toolUseConfirm.input
        : { ...toolUseConfirm.input, script: editedScript },
    [editedScript, toolUseConfirm.input],
  )
  const review = useMemo(
    () => {
      const base = buildWorkflowPermissionReview(effectiveInput)
      return {
        ...base,
        showUsageWarning: workflowNeedsUsageConsentPrompt(
          base.usageConsentHash,
        ),
      }
    },
    [effectiveInput],
  )
  const currentScript = editedScript ?? originalReview.scriptSource
  const editor = getExternalEditor()
  const editorName = editor ? toIDEDisplayName(editor) : null
  const unaryEvent: UnaryEvent = useMemo(
    () => ({
      completion_type: 'tool_use_single',
      language_name: 'none',
    }),
    [],
  )
  usePermissionRequestLogging(toolUseConfirm, unaryEvent)
  const namedWorkflowPermissionUpdates =
    originalReview.sourceKind === 'named' && !originalReview.metaError
      ? buildNamedWorkflowPermissionUpdates(originalReview.sourceLabel)
      : []

  const options: PermissionPromptOption<WorkflowOptionValue>[] = [
    {
      label: getLocalizedText({ en: 'Yes, run it', zh: '是，运行' }),
      value: 'yes',
    },
  ]
  if (namedWorkflowPermissionUpdates.length > 0) {
    options.push({
      label: getLocalizedText({
        en: `Yes, and don't ask again for ${originalReview.sourceLabel} in this project`,
        zh: `是，并且在此项目中不再询问 ${originalReview.sourceLabel}`,
      }),
      value: 'yes-always',
    })
  }
  if (review.showUsageWarning && review.usageConsentHash) {
    options.push({
      label: getLocalizedText({
        en: 'Yes, remember this workflow',
        zh: '是，并记住这个 workflow',
      }),
      value: 'yes-record-consent',
    })
  }
  if (review.showUsageWarning) {
    options.push({
      label: getLocalizedText({
        en: "Yes, and don't show the workflow usage warning again",
        zh: '是，并且不再显示 workflow 用量提醒',
      }),
      value: 'yes-skip-warning',
    })
  }
  if (review.scriptSource) {
    options.push({
      label: showRawScript
        ? getLocalizedText({
            en: 'View workflow summary',
            zh: '查看 workflow 摘要',
          })
        : getLocalizedText({
            en: 'View raw script',
            zh: '查看原始脚本',
          }),
      value: 'toggle-script',
    })
  }
  options.push({
    label: getLocalizedText({ en: 'No', zh: '否' }),
    value: 'no',
  })

  const toolAnalyticsContext: ToolAnalyticsContext = {
    toolName: sanitizeToolNameForAnalytics(toolUseConfirm.tool.name),
    isMcp: toolUseConfirm.tool.isMcp ?? false,
  }

  const recordAutoLaunchConsent = () => {
    if (permissionMode === 'auto') {
      recordWorkflowUsageConsent(review.usageConsentHash, 'userSettings')
    }
  }

  const handleSelect = (value: WorkflowOptionValue, feedback?: string) => {
    switch (value) {
      case 'yes':
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
        recordAutoLaunchConsent()
        toolUseConfirm.onAllow(effectiveInput, [], feedback)
        onDone()
        break
      case 'yes-always':
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
        recordAutoLaunchConsent()
        toolUseConfirm.onAllow(
          effectiveInput,
          namedWorkflowPermissionUpdates,
          feedback,
        )
        onDone()
        break
      case 'yes-record-consent':
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
        recordAutoLaunchConsent()
        recordWorkflowUsageConsent(review.usageConsentHash)
        toolUseConfirm.onAllow(effectiveInput, [], feedback)
        onDone()
        break
      case 'yes-skip-warning': {
        logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
        recordAutoLaunchConsent()
        updateSettingsForSource('localSettings', {
          skipWorkflowUsageWarning: true,
        })
        toolUseConfirm.onAllow(effectiveInput, [], feedback)
        onDone()
        break
      }
      case 'toggle-script':
        setShowRawScript(value => !value)
        break
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

  const openCurrentScriptInEditor = () => {
    if (!currentScript) return
    if (!editorName) {
      setEditorStatus(
        getLocalizedText({
          en: 'No external editor is configured. Set VISUAL or EDITOR to edit this workflow script.',
          zh: '尚未配置外部编辑器。请设置 VISUAL 或 EDITOR 后再编辑 workflow 脚本。',
        }),
      )
      return
    }

    const result = editPromptInEditor(currentScript)
    if (result.error) {
      setEditorStatus(result.error)
      return
    }
    if (result.content !== null) {
      setEditedScript(result.content)
      setShowRawScript(false)
      setEditorStatus(
        getLocalizedText({
          en: 'Script updated from editor.',
          zh: '脚本已从编辑器更新。',
        }),
      )
    }
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const editShortcut =
      event.key === 'tab' ||
      (event.ctrl && event.key === 'g')
    if (!editShortcut) return
    event.preventDefault()
    event.stopImmediatePropagation()
    openCurrentScriptInEditor()
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
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <PermissionDialog
        title={title}
        subtitle={review.meta?.name ?? review.sourceLabel}
        workerBadge={workerBadge}
      >
        <ReviewDetails review={review} showRawScript={showRawScript} />
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
      {currentScript && editorName ? (
        <Box flexDirection="row" gap={1} paddingX={1} marginTop={1}>
          <Text dimColor>Tab or ctrl+g to edit script in </Text>
          <Text bold dimColor>
            {editorName}
          </Text>
          {editorStatus ? (
            <>
              <Text dimColor>{' · '}</Text>
              <Text color="success">{editorStatus}</Text>
            </>
          ) : null}
        </Box>
      ) : editorStatus ? (
        <Box paddingX={1} marginTop={1}>
          <Text color="warning">{editorStatus}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
