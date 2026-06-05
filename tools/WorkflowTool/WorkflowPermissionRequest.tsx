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
  type FeedbackType,
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

export type WorkflowOptionValue =
  | 'yes'
  | 'yes-always'
  | 'yes-source-always'
  | 'yes-skip-warning'
  | 'toggle-script'
  | 'no'

export type WorkflowPermissionOptionSpec = {
  value: WorkflowOptionValue
  label: { en: string; zh: string }
  acceptsPromptAmend?: boolean
}

export type WorkflowPermissionReviewField = {
  label: string
  value?: string
  lines?: string[]
  tone?: 'normal' | 'dim' | 'warning'
  wrap?: 'truncate-end'
}

export type WorkflowPermissionStaticSummaryDisplay = {
  intro: string
  phases: {
    title: string
    samplePrompts: string[]
    extraAgentCount: number
  }[]
  footer: string
}

export type WorkflowPermissionDisplayModel = {
  fields: WorkflowPermissionReviewField[]
  staticSummary: WorkflowPermissionStaticSummaryDisplay | null
  usageWarning: string | null
}

const MAX_RAW_SCRIPT_CHARS = 4000
export const WORKFLOW_PERMISSION_TITLE = {
  en: 'Review dynamic workflow before running',
  zh: '运行前审核动态 workflow',
}
export const WORKFLOW_PERMISSION_QUESTION = {
  en: 'Run this dynamic workflow?',
  zh: '要运行这个动态 workflow 吗？',
}
export const WORKFLOW_USAGE_WARNING_MESSAGE =
  'Dynamic workflows can run multiple subagents and consume tokens quickly. You can inspect running workflows with /workflows or disable them in /config.'
export const WORKFLOW_STATIC_SUMMARY_INTRO =
  'This dynamic workflow will spin up multiple subagents across the following phases:'
export const WORKFLOW_PROMPT_FEEDBACK_CONFIG = {
  type: 'accept' as FeedbackType,
  placeholder: getLocalizedText({
    en: 'adjust the workflow prompt before it runs',
    zh: '在运行前调整 workflow prompt',
  }),
}

function truncateRawScript(source: string): string {
  if (source.length <= MAX_RAW_SCRIPT_CHARS) return source
  return `${source.slice(0, MAX_RAW_SCRIPT_CHARS - 18)}\n... [truncated]`
}

export function buildWorkflowPermissionOptionSpecs({
  sourceLabel,
  hasNamedWorkflowPermissionUpdates,
  canRememberWorkflowSource,
  showUsageWarning,
  hasScriptSource,
  showRawScript,
}: {
  sourceLabel: string
  hasNamedWorkflowPermissionUpdates: boolean
  canRememberWorkflowSource: boolean
  showUsageWarning: boolean
  hasScriptSource: boolean
  showRawScript: boolean
}): WorkflowPermissionOptionSpec[] {
  const options: WorkflowPermissionOptionSpec[] = [
    {
      label: { en: 'Yes, run it', zh: '是，运行' },
      value: 'yes',
      acceptsPromptAmend: true,
    },
  ]
  if (hasNamedWorkflowPermissionUpdates) {
    options.push({
      label: {
        en: `Yes, and don't ask again for ${sourceLabel} in this project`,
        zh: `是，并且在此项目中不再询问 ${sourceLabel}`,
      },
      value: 'yes-always',
      acceptsPromptAmend: true,
    })
  }
  if (canRememberWorkflowSource) {
    options.push({
      label: {
        en: "Yes, and don't ask again for this workflow in this project",
        zh: '是，并且在此项目中不再询问这个 workflow',
      },
      value: 'yes-source-always',
      acceptsPromptAmend: true,
    })
  }
  if (showUsageWarning) {
    options.push({
      label: {
        en: "Yes, and don't show the workflow usage warning again",
        zh: '是，并且不再显示 workflow 用量提醒',
      },
      value: 'yes-skip-warning',
      acceptsPromptAmend: true,
    })
  }
  if (hasScriptSource) {
    options.push({
      label: showRawScript
        ? {
            en: 'View workflow summary',
            zh: '查看 workflow 摘要',
          }
        : {
            en: 'View raw script',
            zh: '查看原始脚本',
          },
      value: 'toggle-script',
    })
  }
  options.push({
    label: { en: 'No', zh: '否' },
    value: 'no',
  })
  return options
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

function buildWorkflowStaticSummaryDisplay(
  review: WorkflowPermissionReview,
): WorkflowPermissionStaticSummaryDisplay | null {
  const summary = review.staticSummary
  if (!summary) return null

  return {
    intro: WORKFLOW_STATIC_SUMMARY_INTRO,
    phases: summary.phases.map((phase, index) => {
      const title = staticPhaseTitle(review, phase, index)
      const samplePrompts = promptSamples(phase)
      return {
        title: `${index + 1}. ${title.title}${
          title.detail ? ` - ${title.detail}` : ''
        }`,
        samplePrompts,
        extraAgentCount: Math.max(0, phase.agents.length - samplePrompts.length),
      }
    }),
    footer: `Estimated agents: ${summary.estimatedAgents}${
      summary.hasReturn ? ' - returns a workflow result' : ''
    }`,
  }
}

export function buildWorkflowPermissionDisplayModel(
  review: WorkflowPermissionReview,
  {
    showRawScript,
  }: {
    showRawScript: boolean
  },
): WorkflowPermissionDisplayModel {
  const fields: WorkflowPermissionReviewField[] = []
  const phases = review.meta?.phases ?? []
  const scriptBody =
    showRawScript && review.scriptSource
      ? truncateRawScript(review.scriptSource)
      : review.scriptPreview

  if (review.meta) {
    fields.push({ label: 'Name', value: review.meta.name })
    fields.push({ label: 'Purpose', value: review.meta.description })
    if (review.meta.whenToUse) {
      fields.push({ label: 'Use when', value: review.meta.whenToUse })
    }
    if (review.meta.model) {
      fields.push({ label: 'Model', value: review.meta.model })
    }
  }

  fields.push({
    label: 'Source',
    value: `${review.sourceKind}: ${review.sourceLabel}`,
  })

  if (review.resumeFromRunId) {
    fields.push({ label: 'Resume', value: review.resumeFromRunId })
  }
  if (review.timeoutMs !== null) {
    fields.push({ label: 'Timeout', value: `${review.timeoutMs} ms` })
  }
  if (review.argsPreview) {
    fields.push({
      label: 'Args',
      value: review.argsPreview,
      wrap: 'truncate-end',
    })
  }
  if (phases.length) {
    fields.push({
      label: 'Phases',
      lines: phases.map(
        (phase, index) =>
          `${index + 1}. ${phase.title}${phase.model ? ` (${phase.model})` : ''}${
            phase.detail ? ` - ${phase.detail}` : ''
          }`,
      ),
    })
  }
  if (review.metaError) {
    fields.push({
      label: 'Warning',
      value: review.metaError,
      tone: 'warning',
    })
  }
  if (scriptBody) {
    fields.push({
      label: 'Script',
      value: scriptBody,
      tone: 'dim',
      wrap: 'truncate-end',
    })
  }

  return {
    fields,
    staticSummary: buildWorkflowStaticSummaryDisplay(review),
    usageWarning: review.showUsageWarning
      ? WORKFLOW_USAGE_WARNING_MESSAGE
      : null,
  }
}

function StaticSummaryDetails({
  summary,
}: {
  summary: WorkflowPermissionStaticSummaryDisplay | null
}): React.ReactNode {
  if (!summary) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{summary.intro}</Text>
      {summary.phases.map((phase, index) => (
        <Box key={`${phase.title}-${index}`} flexDirection="column">
          <Text>
            {'  '}
            {phase.title}
          </Text>
          {phase.samplePrompts.length ? (
            <Text dimColor>
              {'     '}
              {phase.samplePrompts.map(sample => `- "${sample}"`).join('  ')}
              {phase.extraAgentCount ? `  +${phase.extraAgentCount} more` : ''}
            </Text>
          ) : null}
        </Box>
      ))}
      <Text dimColor>{summary.footer}</Text>
    </Box>
  )
}

function ReviewFieldValue({
  field,
}: {
  field: WorkflowPermissionReviewField
}): React.ReactNode {
  if (field.lines) {
    return (
      <Box flexDirection="column">
        {field.lines.map((line, index) => (
          <Text key={`${line}-${index}`}>{line}</Text>
        ))}
      </Box>
    )
  }

  return (
    <Text
      color={field.tone === 'warning' ? 'warning' : undefined}
      dimColor={field.tone === 'dim'}
      wrap={field.wrap}
    >
      {field.value ?? ''}
    </Text>
  )
}

function ReviewDetails({
  review,
  showRawScript,
}: {
  review: WorkflowPermissionReview
  showRawScript: boolean
}): React.ReactNode {
  const display = buildWorkflowPermissionDisplayModel(review, { showRawScript })
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {display.fields.map((field, index) => (
        <React.Fragment key={`${field.label}-${index}`}>
          <DetailRow label={field.label}>
            <ReviewFieldValue field={field} />
          </DetailRow>
        </React.Fragment>
      ))}
      <StaticSummaryDetails summary={display.staticSummary} />
      {display.usageWarning ? (
        <Box marginTop={1}>
          <Text color="warning">{display.usageWarning}</Text>
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
  const canRememberWorkflowSource =
    namedWorkflowPermissionUpdates.length === 0 && Boolean(review.usageConsentHash)

  const options: PermissionPromptOption<WorkflowOptionValue>[] =
    buildWorkflowPermissionOptionSpecs({
      sourceLabel: originalReview.sourceLabel,
      hasNamedWorkflowPermissionUpdates:
        namedWorkflowPermissionUpdates.length > 0,
      canRememberWorkflowSource,
      showUsageWarning: review.showUsageWarning,
      hasScriptSource: Boolean(review.scriptSource),
      showRawScript,
    }).map(option => ({
      label: getLocalizedText(option.label),
      value: option.value,
      ...(option.acceptsPromptAmend
        ? { feedbackConfig: WORKFLOW_PROMPT_FEEDBACK_CONFIG }
        : {}),
    }))

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
      case 'yes-source-always':
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
    if (!(event.ctrl && event.key === 'g')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    openCurrentScriptInEditor()
  }

  const title = getLocalizedText(WORKFLOW_PERMISSION_TITLE)
  const question = (
    <Text>
      {getLocalizedText(WORKFLOW_PERMISSION_QUESTION)}
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
          <Text dimColor>Ctrl+G to edit script in </Text>
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
