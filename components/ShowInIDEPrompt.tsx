import { basename, relative } from 'path'
import React, { useMemo } from 'react'
import { Box, Text } from '../ink.js'
import { getCwd } from '../utils/cwd.js'
import { isSupportedVSCodeTerminal } from '../utils/ide.js'
import { getLocalizedText } from '../utils/uiLanguage.js'
import {
  getCurrentWorktreeDevTargetSnapshot,
  type WorktreeDevTargetSnapshot,
} from '../utils/worktree.js'
import { Select } from './CustomSelect/index.js'
import { Pane } from './design-system/Pane.js'
import type {
  PermissionOption,
  PermissionOptionWithLabel,
} from './permissions/FilePermissionDialog/permissionOptions.js'

type Props<A> = {
  filePath: string
  input: A
  onChange: (
    option: PermissionOption,
    args: A,
    feedback?: string,
  ) => void
  options: PermissionOptionWithLabel[]
  ideName: string
  symlinkTarget?: string | null
  rejectFeedback: string
  acceptFeedback: string
  setFocusedOption: (value: string) => void
  onInputModeToggle: (value: string) => void
  focusedOption: string
  yesInputMode: boolean
  noInputMode: boolean
}

function getWorktreeTargetDisplayName(target: WorktreeDevTargetSnapshot): string {
  return target.branch
    ? `${target.displayName} (${target.branch})`
    : target.displayName
}

function ShowInIdeTargetSummary({
  target,
}: {
  target: WorktreeDevTargetSnapshot
}): React.ReactNode {
  if (target.kind === 'worktree') {
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {getLocalizedText({
            en: 'Current worktree',
            zh: '当前工作树',
          })}
          : {getWorktreeTargetDisplayName(target)}
        </Text>
        <Text dimColor>
          {getLocalizedText({
            en: 'Worktree path',
            zh: '工作树路径',
          })}
          : {target.path}
        </Text>
        {target.originalCwd ? (
          <Text dimColor>
            {getLocalizedText({
              en: 'Original repo',
              zh: '原始仓库',
            })}
            : {target.originalCwd}
          </Text>
        ) : null}
      </Box>
    )
  }

  return (
    <Text dimColor>
      {getLocalizedText({
        en: 'Project path',
        zh: '项目路径',
      })}
      : {target.path}
    </Text>
  )
}

export function ShowInIDEPrompt<A>({
  onChange,
  options,
  input,
  filePath,
  ideName,
  symlinkTarget,
  rejectFeedback,
  acceptFeedback,
  setFocusedOption,
  onInputModeToggle,
  focusedOption,
  yesInputMode,
  noInputMode,
}: Props<A>): React.ReactNode {
  const target = useMemo(
    () => getCurrentWorktreeDevTargetSnapshot(getCwd()),
    [],
  )
  const isSymlinkOutsideTarget =
    symlinkTarget != null && relative(target.path, symlinkTarget).startsWith('..')
  const symlinkWarning = symlinkTarget ? (
    <Text color="warning">
      {isSymlinkOutsideTarget
        ? getLocalizedText({
            en:
              target.kind === 'worktree'
                ? `This will modify ${symlinkTarget} (outside current worktree) via a symlink`
                : `This will modify ${symlinkTarget} (outside current project) via a symlink`,
            zh:
              target.kind === 'worktree'
                ? `这将通过符号链接修改 ${symlinkTarget}（位于当前工作树之外）`
                : `这将通过符号链接修改 ${symlinkTarget}（位于当前项目之外）`,
          })
        : getLocalizedText({
            en: `Symlink target: ${symlinkTarget}`,
            zh: `符号链接目标：${symlinkTarget}`,
          })}
    </Text>
  ) : null

  return (
    <Pane color="permission">
      <Box flexDirection="column" gap={1}>
        <Text bold color="permission">
          {getLocalizedText({
            en: `Opened changes in ${ideName} ⧉`,
            zh: `已在 ${ideName} 中打开更改 ⧉`,
          })}
        </Text>
        <ShowInIdeTargetSummary target={target} />
        {symlinkWarning}
        {isSupportedVSCodeTerminal() ? (
          <Text dimColor>
            {getLocalizedText({
              en: 'Save file to continue…',
              zh: '保存文件后继续…',
            })}
          </Text>
        ) : null}
        <Box flexDirection="column">
          <Text>
            {getLocalizedText({
              en: 'Do you want to make this edit to',
              zh: '要将此修改应用到',
            })}{' '}
            <Text bold>{basename(filePath)}</Text>
            {getLocalizedText({
              en: '?',
              zh: '吗？',
            })}
          </Text>
          <Select
            options={options}
            inlineDescriptions
            onChange={value => {
              const selected = options.find(opt => opt.value === value)
              if (!selected) {
                return
              }

              if (selected.option.type === 'reject') {
                const trimmedFeedback = rejectFeedback.trim()
                onChange(selected.option, input, trimmedFeedback || undefined)
                return
              }

              if (selected.option.type === 'accept-once') {
                const trimmedFeedback = acceptFeedback.trim()
                onChange(selected.option, input, trimmedFeedback || undefined)
                return
              }

              onChange(selected.option, input)
            }}
            onCancel={() => onChange({ type: 'reject' }, input)}
            onFocus={value => setFocusedOption(value)}
            onInputModeToggle={onInputModeToggle}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            {getLocalizedText({
              en: 'Esc to cancel',
              zh: 'Esc 取消',
            })}
            {((focusedOption === 'yes' && !yesInputMode) ||
              (focusedOption === 'no' && !noInputMode)) &&
              getLocalizedText({
                en: ' · Tab to amend',
                zh: ' · Tab 修改',
              })}
          </Text>
        </Box>
      </Box>
    </Pane>
  )
}
