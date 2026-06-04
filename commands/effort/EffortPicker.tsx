import * as React from 'react';
import { useCallback, useMemo } from 'react';
import { Box, Text } from '../../ink.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import {
  type EffortLevel,
  type EffortValue,
  EFFORT_LEVELS,
  getEffortValueDescription,
  modelSupportsMaxEffort,
} from '../../utils/effort.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { isWorkflowRuntimeEnabled } from '../../utils/workflowAvailability.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { Select } from '../../components/CustomSelect/select.js';
import { executeEffort } from './effort.js';

type Props = {
  onComplete: (result: string) => void;
};

type EffortChoice = 'auto' | EffortLevel | 'ultracode';

const PICKER_ORDER: readonly EffortChoice[] = [
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode',
];

function describeChoice(choice: EffortChoice): string {
  if (choice === 'auto') {
    return getLocalizedText({
      en: "Use the model's default effort level",
      zh: '使用当前模型的默认 effort 级别',
    });
  }
  return getEffortValueDescription(choice as EffortValue);
}

export function EffortPicker({ onComplete }: Props): React.ReactNode {
  const appStateEffort = useAppState(s => s.effortValue);
  const setAppState = useSetAppState();
  const model = useMainLoopModel();
  const workflowsEnabled = useMemo(() => isWorkflowRuntimeEnabled(), []);

  // Determine the currently-active effort label for the highlighted default.
  const currentLabel: EffortChoice = useMemo(() => {
    if (appStateEffort === undefined) return 'auto';
    if (appStateEffort === 'ultracode') return 'ultracode';
    if (typeof appStateEffort === 'string' && EFFORT_LEVELS.includes(appStateEffort as EffortLevel)) {
      return appStateEffort as EffortLevel;
    }
    return 'auto';
  }, [appStateEffort]);

  const supportsMax = modelSupportsMaxEffort(model);

  const options = useMemo(() => {
    return PICKER_ORDER.map(choice => {
      const disabled =
        ((choice === 'xhigh' || choice === 'max' || choice === 'ultracode') &&
          !supportsMax) ||
        (choice === 'ultracode' && !workflowsEnabled);
      const labelLeft =
        choice === 'auto'
          ? getLocalizedText({ en: 'auto', zh: 'auto' })
          : choice;
      const suffix = disabled
        ? choice === 'ultracode' && !workflowsEnabled
          ? getLocalizedText({
              en: '  (Workflow disabled)',
              zh: '  （Workflow 已禁用）',
            })
          : getLocalizedText({
              en: '  (unsupported by current model)',
              zh: '  （当前模型不支持）',
            })
        : '';
      return {
        label: `${labelLeft}${suffix}`,
        value: choice,
        description: describeChoice(choice),
        disabled,
      };
    });
  }, [supportsMax, workflowsEnabled]);

  const handleSelect = useCallback(
    (value: string): void => {
      // Reuse existing executeEffort path (no new write surface). 'auto' maps
      // to unsetEffortLevel via the existing string-arg dispatch.
      const result = executeEffort(value);
      if (result.effortUpdate) {
        setAppState(prev => ({
          ...prev,
          effortValue: result.effortUpdate?.value,
        }));
      }
      onComplete(result.message);
    },
    [onComplete, setAppState],
  );

  const handleCancel = useCallback((): void => {
    onComplete(
      getLocalizedText({
        en: 'Effort picker cancelled (no change applied).',
        zh: '已取消 effort 选择（未做任何修改）。',
      }),
    );
  }, [onComplete]);

  const title = getLocalizedText({
    en: 'Choose effort level',
    zh: '选择 effort 级别',
  });
  const subtitle = getLocalizedText({
    en: `Currently: ${currentLabel}`,
    zh: `当前：${currentLabel}`,
  });

  return (
    <Dialog title={title} subtitle={subtitle} onCancel={handleCancel}>
      <Box flexDirection="column" gap={1}>
        <Select
          options={options}
          defaultValue={currentLabel}
          onChange={handleSelect}
          onCancel={handleCancel}
          inlineDescriptions
        />
        <Text dimColor italic>
          {getLocalizedText({
            en: '↑/↓ to move · Enter to apply · Esc to cancel',
            zh: '↑/↓ 移动 · Enter 应用 · Esc 取消',
          })}
        </Text>
      </Box>
    </Dialog>
  );
}
