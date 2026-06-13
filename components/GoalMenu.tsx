import * as React from 'react'
import { useMemo, useState } from 'react'
import type { MossenGoalState } from '../bootstrap/state.js'
import { useRegisterOverlay } from '../context/overlayContext.js'
import { Box, Text } from '../ink.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import { truncateToWidth } from '../utils/format.js'
import { FuzzyPicker } from './design-system/FuzzyPicker.js'
import {
  formatGoalOverlayReason,
  formatGoalOverlayStatus,
  formatGoalOverlayTokens,
  isGoalOverlayEligible,
  type GoalOverlayDisplayState,
} from './GoalOverlay.js'

type GoalMenuAction = 'command' | 'toggle_overlay'

export type GoalMenuItem = {
  id: string
  label: string
  description: string
  keywords: string
  action: GoalMenuAction
  command?: string
}

function text(en: string, zh: string): string {
  return getLocalizedText({ en, zh })
}

export function buildGoalMenuItems(
  goal: MossenGoalState | null,
  overlayVisible: boolean,
): GoalMenuItem[] {
  const items: GoalMenuItem[] = [
    {
      id: 'status',
      label: text('Show status', '查看状态'),
      description: text('Insert /goal status.', '插入 /goal status。'),
      keywords: 'status inspect show 查看 状态',
      action: 'command',
      command: '/goal status',
    },
    {
      id: 'why',
      label: text('Explain state', '解释状态'),
      description: text('Insert /goal why.', '插入 /goal why。'),
      keywords: 'why explain reason 解释 原因',
      action: 'command',
      command: '/goal why',
    },
    {
      id: overlayVisible ? 'hide-overlay' : 'show-overlay',
      label: overlayVisible
        ? text('Hide status card', '隐藏状态卡片')
        : text('Show status card', '显示状态卡片'),
      description: overlayVisible
        ? text('Hide the floating or inline goal status.', '隐藏浮动或紧凑目标状态。')
        : text('Show the floating or inline goal status.', '显示浮动或紧凑目标状态。'),
      keywords: 'overlay card inline float show hide 显示 隐藏 浮层 卡片',
      action: 'toggle_overlay',
    },
    {
      id: 'edit',
      label: text('Edit goal', '编辑目标'),
      description: text('Insert /goal edit and place the cursor at the end.', '插入 /goal edit，光标停在末尾。'),
      keywords: 'edit update criteria constraints 编辑 标准 约束',
      action: 'command',
      command: '/goal edit ',
    },
    {
      id: 'budget',
      label: text('Adjust budget', '调整预算'),
      description: text('Insert /goal budget.', '插入 /goal budget。'),
      keywords: 'budget turns tokens seconds 预算 轮次 token 时间',
      action: 'command',
      command: '/goal budget ',
    },
  ]

  if (goal?.status === 'active') {
    items.push({
      id: 'pause',
      label: text('Pause goal', '暂停目标'),
      description: text('Insert /goal pause.', '插入 /goal pause。'),
      keywords: 'pause stop wait 暂停 等待',
      action: 'command',
      command: '/goal pause',
    })
    items.push({
      id: 'done',
      label: text('Mark done', '标记完成'),
      description: text('Insert /goal done for explicit user completion.', '插入 /goal done，由用户显式完成。'),
      keywords: 'done complete finish 完成 标记',
      action: 'command',
      command: '/goal done',
    })
  }

  if (
    goal?.status === 'paused' ||
    goal?.status === 'blocked' ||
    goal?.status === 'budget_limited'
  ) {
    items.push({
      id: 'resume',
      label: text('Resume goal', '恢复目标'),
      description: text('Insert /goal resume.', '插入 /goal resume。'),
      keywords: 'resume continue restart 恢复 继续',
      action: 'command',
      command: '/goal resume',
    })
  }

  if (goal) {
    items.push({
      id: 'clear',
      label: text('Clear goal', '清除目标'),
      description: text('Insert /goal clear.', '插入 /goal clear。'),
      keywords: 'clear cancel reset 清除 取消 重置',
      action: 'command',
      command: '/goal clear',
    })
  }

  return items
}

export function filterGoalMenuItems(
  items: readonly GoalMenuItem[],
  query: string,
): GoalMenuItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter(item =>
    `${item.label} ${item.description} ${item.keywords} ${item.command ?? ''}`
      .toLowerCase()
      .includes(q),
  )
}

export function GoalMenu({
  goal,
  overlayVisible,
  onToggleOverlay,
  onInsertCommand,
  onDone,
}: {
  goal: MossenGoalState | null
  overlayVisible: boolean
  onToggleOverlay: () => void
  onInsertCommand: (command: string) => void
  onDone: () => void
}): React.ReactNode {
  useRegisterOverlay('goal-menu')
  const [query, setQuery] = useState('')
  const allItems = useMemo(
    () => buildGoalMenuItems(goal, overlayVisible),
    [goal, overlayVisible],
  )
  const items = useMemo(
    () => filterGoalMenuItems(allItems, query),
    [allItems, query],
  )
  const statusGoal =
    goal && isGoalOverlayEligible(goal)
      ? (goal as MossenGoalState & { status: GoalOverlayDisplayState })
      : null
  const previewWidth = 54

  return (
    <FuzzyPicker<GoalMenuItem>
      title={text('Goal Menu', '目标菜单')}
      placeholder={text('Filter goal actions...', '筛选目标操作...')}
      items={items}
      getKey={item => item.id}
      visibleCount={8}
      direction="up"
      previewPosition="right"
      onQueryChange={setQuery}
      onCancel={onDone}
      onSelect={item => {
        if (item.action === 'toggle_overlay') {
          onToggleOverlay()
        } else if (item.command) {
          onInsertCommand(item.command)
        }
        onDone()
      }}
      emptyMessage={text('No matching goal actions', '没有匹配的目标操作')}
      selectAction={text('choose', '选择')}
      renderItem={(item, isFocused) => (
        <Text color={isFocused ? 'suggestion' : undefined}>
          {item.label}
          {item.command ? <Text dimColor>  {item.command}</Text> : null}
        </Text>
      )}
      renderPreview={item => (
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Text bold>{item.label}</Text>
          <Text dimColor>{truncateToWidth(item.description, previewWidth)}</Text>
          {item.command ? <Text color="suggestion">{item.command}</Text> : null}
          {statusGoal ? (
            <>
              <Text dimColor>
                {text('Status', '状态')}: {formatGoalOverlayStatus(statusGoal)}
              </Text>
              <Text dimColor>
                {text('Turns', '轮次')}: {statusGoal.turnCount}/{statusGoal.turnBudget}
              </Text>
              <Text dimColor>
                {text('Tokens', 'Token')}: {formatGoalOverlayTokens(statusGoal)}
              </Text>
              <Text dimColor>
                {text('Reason', '原因')}: {truncateToWidth(formatGoalOverlayReason(statusGoal), previewWidth - 8)}
              </Text>
            </>
          ) : (
            <Text dimColor>{text('No active goal state.', '当前没有目标状态。')}</Text>
          )}
        </Box>
      )}
    />
  )
}
