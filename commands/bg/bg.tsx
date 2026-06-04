import * as React from 'react'
import { launchAgentSupervisorBackgroundJob } from '../../services/agentSupervisor/launch.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

function getCurrentPermissionMode(context: LocalJSXCommandContext): string | null {
  return context.getAppState().toolPermissionContext.mode ?? null
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const prompt = (args ?? '').trim()
  if (!prompt) {
    onDone(
      getLocalizedText({
        en: 'Usage: /bg <task>. The task will appear in `mossen agents`.',
        zh: '用法：/bg <任务>。该任务会出现在 `mossen agents` 中。',
      }),
      { display: 'system' },
    )
    return null
  }

  const result = await launchAgentSupervisorBackgroundJob({
    prompt,
    model: context.options.mainLoopModel ?? null,
    permissionMode: getCurrentPermissionMode(context),
    effort: null,
    agent: null,
    settings: null,
    addDirs: [],
    mcpConfig: [],
    pluginDirs: [],
    strictMcpConfig: false,
    fallbackModel: null,
    allowDangerouslySkipPermissions: false,
    dangerouslySkipPermissions: false,
    testMode: isEnvTruthy(process.env.MOSSEN_CODE_AGENT_SUPERVISOR_TEST_JOBS),
  })

  onDone(
    getLocalizedText({
      en: `Started background job ${result.id}. Manage it with: mossen agents · mossen attach ${result.id} · mossen logs ${result.id}`,
      zh: `已启动后台任务 ${result.id}。可用以下命令管理：mossen agents · mossen attach ${result.id} · mossen logs ${result.id}`,
    }),
    { display: 'system' },
  )
  return null
}
