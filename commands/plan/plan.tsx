import * as React from 'react'
import { handlePlanModeTransition } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getExternalEditor } from '../../utils/editor.js'
import { toIDEDisplayName } from '../../utils/ide.js'
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js'
import { prepareContextForPlanMode } from '../../utils/permissions/permissionSetup.js'
import { getPlan, getPlanFilePath } from '../../utils/plans.js'
import { editFileInEditor } from '../../utils/promptEditor.js'
import { renderToString } from '../../utils/staticRender.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

function PlanDisplay({
  planContent,
  planPath,
  editorName,
}: {
  planContent: string
  planPath: string
  editorName: string | undefined
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold>{getLocalizedText({ en: 'Current Plan', zh: '当前计划' })}</Text>
      <Text dimColor>{planPath}</Text>
      <Box marginTop={1}>
        <Text>{planContent}</Text>
      </Box>
      {editorName && (
        <Box marginTop={1}>
          <Text dimColor>"&#47;plan open"</Text>
          <Text dimColor>
            {getLocalizedText({
              en: ' to edit this plan in ',
              zh: ' 可在其中编辑此计划：',
            })}
          </Text>
          <Text bold dimColor>
            {editorName}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const { getAppState, setAppState } = context
  const appState = getAppState()
  const currentMode = appState.toolPermissionContext.mode

  if (currentMode !== 'plan') {
    handlePlanModeTransition(currentMode, 'plan')
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: applyPermissionUpdate(
        prepareContextForPlanMode(prev.toolPermissionContext),
        { type: 'setMode', mode: 'plan', destination: 'session' },
      ),
    }))

    const description = args.trim()
    const enabledMessage = getLocalizedText({
      en: 'Enabled plan mode',
      zh: '已启用规划模式',
    })
    if (description && description !== 'open') {
      onDone(enabledMessage, { shouldQuery: true })
    } else {
      onDone(enabledMessage)
    }
    return null
  }

  const planContent = getPlan()
  const planPath = getPlanFilePath()

  if (!planContent) {
    onDone(
      getLocalizedText({
        en: 'Already in plan mode. No plan written yet.',
        zh: '当前已处于规划模式，但还没有写入计划。',
      }),
    )
    return null
  }

  const argList = args.trim().split(/\s+/)
  if (argList[0] === 'open') {
    const result = await editFileInEditor(planPath)
    if (result.error) {
      onDone(
        getLocalizedText({
          en: `Failed to open plan in editor: ${result.error}`,
          zh: `在编辑器中打开计划失败：${result.error}`,
        }),
      )
    } else {
      onDone(
        getLocalizedText({
          en: `Opened plan in editor: ${planPath}`,
          zh: `已在编辑器中打开计划：${planPath}`,
        }),
      )
    }
    return null
  }

  const editor = getExternalEditor()
  const editorName = editor ? toIDEDisplayName(editor) : undefined
  const display = (
    <PlanDisplay
      planContent={planContent}
      planPath={planPath}
      editorName={editorName}
    />
  )

  const output = await renderToString(display)
  onDone(output)
  return null
}
