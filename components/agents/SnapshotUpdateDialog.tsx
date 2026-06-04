import React from 'react'
import { Box, Text } from '../../ink.js'
import { Select } from '../CustomSelect/index.js'
import { Dialog } from '../design-system/Dialog.js'
import type { AgentMemoryScope } from '../../tools/AgentTool/agentMemory.js'
import { getMemoryScopeDisplay } from '../../tools/AgentTool/agentMemory.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

export type SnapshotUpdateChoice = 'merge' | 'keep' | 'replace'

type Props = {
  agentType: string
  scope: AgentMemoryScope
  snapshotTimestamp: string
  onComplete: (choice: SnapshotUpdateChoice) => void
  onCancel: () => void
}

export function buildMergePrompt(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  return [
    `Update the ${agentType} agent memory snapshot for ${getMemoryScopeDisplay(scope)}.`,
    'Merge the existing snapshot with the current project/session context.',
    'Preserve durable facts, remove stale assumptions, and keep the result concise.',
  ].join('\n')
}

export function SnapshotUpdateDialog({
  agentType,
  scope,
  snapshotTimestamp,
  onComplete,
  onCancel,
}: Props): React.ReactNode {
  return (
    <Dialog
      title={getLocalizedText({
        en: 'Agent memory snapshot changed',
        zh: 'Agent 记忆快照已变化',
      })}
      subtitle={getLocalizedText({
        en: `${agentType} has an existing ${getMemoryScopeDisplay(scope)} snapshot from ${snapshotTimestamp}.`,
        zh: `${agentType} 已有 ${getMemoryScopeDisplay(scope)} 快照，时间：${snapshotTimestamp}。`,
      })}
      color="warning"
      onCancel={onCancel}
    >
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          {getLocalizedText({
            en: 'Choose how to handle the pending snapshot before the session starts.',
            zh: '请选择会话开始前如何处理这个待更新快照。',
          })}
        </Text>
        <Select
          options={[
            {
              label: getLocalizedText({ en: 'Merge with current context', zh: '合并当前上下文' }),
              value: 'merge',
              description: getLocalizedText({
                en: 'Adds a merge instruction to the first prompt.',
                zh: '把合并指令加入第一条提示。',
              }),
            },
            {
              label: getLocalizedText({ en: 'Keep existing snapshot', zh: '保留现有快照' }),
              value: 'keep',
              description: getLocalizedText({
                en: 'Starts without changing the snapshot.',
                zh: '不修改快照，直接开始。',
              }),
            },
            {
              label: getLocalizedText({ en: 'Replace during this session', zh: '本次会话中替换' }),
              value: 'replace',
              description: getLocalizedText({
                en: 'Starts fresh and lets the agent rebuild the snapshot.',
                zh: '从当前上下文重新生成快照。',
              }),
            },
          ]}
          onChange={value => onComplete(value as SnapshotUpdateChoice)}
          onCancel={onCancel}
        />
      </Box>
    </Dialog>
  )
}
