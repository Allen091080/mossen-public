/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React, { useMemo } from 'react';
import type { ReadonlyDeep as DeepImmutable } from 'type-fest';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text, useTheme } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { getEmptyToolPermissionContext } from '../../Tool.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import { getTools } from '../../tools.js';
import { formatNumber, truncateToWidth } from '../../utils/format.js';
import { t } from '../../utils/i18n/index.js';
import { toInkColor } from '../../utils/ink.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { renderToolActivity } from './renderToolActivity.js';
import { describeTeammateActivity } from './taskStatusUtils.js';
type Props = {
  teammate: DeepImmutable<InProcessTeammateTaskState>;
  onDone: () => void;
  onKill?: () => void;
  onBack?: () => void;
  onForeground?: () => void;
  onAttach?: () => void;
};
function InProcessTeammateDetailDialogImpl(t0) {
  const $ = _c(67);
  const {
    teammate,
    onDone,
    onKill,
    onBack,
    onForeground,
    onAttach
  } = t0;
  const [theme] = useTheme();
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getTools(getEmptyToolPermissionContext());
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const tools = t1;
  const elapsedTime = useElapsedTime(teammate.startTime, teammate.status === "running", 1000, teammate.totalPausedMs ?? 0);
  let t2;
  if ($[1] !== onDone) {
    t2 = {
      "confirm:yes": onDone
    };
    $[1] = onDone;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {
      context: "Confirmation"
    };
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  useKeybindings(t2, t3);
  let t4;
  if ($[4] !== onAttach || $[5] !== onBack || $[6] !== onDone || $[7] !== onForeground || $[8] !== onKill || $[9] !== teammate.status) {
    t4 = e => {
      if (e.key === " ") {
        e.preventDefault();
        onDone();
      } else {
        if (e.key === "left" && onBack) {
          e.preventDefault();
          onBack();
        } else {
          if (e.key === "r" && onAttach) {
            e.preventDefault();
            onAttach();
          } else if (e.key === "x" && teammate.status === "running" && onKill) {
            e.preventDefault();
            onKill();
          } else {
            if (e.key === "f" && teammate.status === "running" && onForeground) {
              e.preventDefault();
              onForeground();
            }
          }
        }
      }
    };
    $[4] = onAttach;
    $[5] = onBack;
    $[6] = onDone;
    $[7] = onForeground;
    $[8] = onKill;
    $[9] = teammate.status;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  const handleKeyDown = t4;
  let t5;
  if ($[11] !== teammate) {
    t5 = describeTeammateActivity(teammate);
    $[11] = teammate;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  const activity = t5;
  const tokenCount = teammate.result?.totalTokens ?? teammate.progress?.tokenCount;
  const toolUseCount = teammate.result?.totalToolUseCount ?? teammate.progress?.toolUseCount;
  let t6;
  if ($[13] !== teammate.prompt) {
    t6 = truncateToWidth(teammate.prompt, 300);
    $[13] = teammate.prompt;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  const displayPrompt = t6;
  let t7;
  if ($[15] !== teammate.identity.color) {
    t7 = toInkColor(teammate.identity.color);
    $[15] = teammate.identity.color;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
  if ($[17] !== t7 || $[18] !== teammate.identity.agentName) {
    t8 = <Text color={t7}>@{teammate.identity.agentName}</Text>;
    $[17] = t7;
    $[18] = teammate.identity.agentName;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  let t9;
  if ($[20] !== activity) {
    t9 = activity && <Text dimColor={true}> ({activity})</Text>;
    $[20] = activity;
    $[21] = t9;
  } else {
    t9 = $[21];
  }
  let t10;
  if ($[22] !== t8 || $[23] !== t9) {
    t10 = <Text>{t8}{t9}</Text>;
    $[22] = t8;
    $[23] = t9;
    $[24] = t10;
  } else {
    t10 = $[24];
  }
  const title = t10;
  let t11;
  if ($[25] !== teammate.status) {
    t11 = teammate.status !== "running" && <Text color={teammate.status === "completed" ? "success" : teammate.status === "killed" ? "warning" : "error"}>{teammate.status === "completed" ? "Completed" : teammate.status === "failed" ? "Failed" : "Stopped"}{" \xB7 "}</Text>;
    $[25] = teammate.status;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  let t12;
  if ($[27] !== tokenCount) {
    t12 = tokenCount !== undefined && tokenCount > 0 && <> · {formatNumber(tokenCount)} tokens</>;
    $[27] = tokenCount;
    $[28] = t12;
  } else {
    t12 = $[28];
  }
  let t13;
  if ($[29] !== toolUseCount) {
    t13 = toolUseCount !== undefined && toolUseCount > 0 && <>{" "}· {toolUseCount} {toolUseCount === 1 ? "tool" : "tools"}</>;
    $[29] = toolUseCount;
    $[30] = t13;
  } else {
    t13 = $[30];
  }
  let t14;
  if ($[31] !== elapsedTime || $[32] !== t12 || $[33] !== t13) {
    t14 = <Text dimColor={true}>{elapsedTime}{t12}{t13}</Text>;
    $[31] = elapsedTime;
    $[32] = t12;
    $[33] = t13;
    $[34] = t14;
  } else {
    t14 = $[34];
  }
  let t15;
  if ($[35] !== t11 || $[36] !== t14) {
    t15 = <Text>{t11}{t14}</Text>;
    $[35] = t11;
    $[36] = t14;
    $[37] = t15;
  } else {
    t15 = $[37];
  }
  const subtitle = t15;
  let t16;
  if ($[38] !== onAttach || $[39] !== onBack || $[40] !== onForeground || $[41] !== onKill || $[42] !== teammate.status) {
    t16 = exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>{onBack && <KeyboardShortcutHint shortcut={"\u2190"} action="go back" />}<KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />{onAttach && <KeyboardShortcutHint shortcut="r" action={t('ui.agentView.reply')} />}{teammate.status === "running" && onKill && <KeyboardShortcutHint shortcut="x" action="stop" />}{teammate.status === "running" && onForeground && <KeyboardShortcutHint shortcut="f" action="foreground" />}</Byline>;
    $[38] = onAttach;
    $[39] = onBack;
    $[40] = onForeground;
    $[41] = onKill;
    $[42] = teammate.status;
    $[43] = t16;
  } else {
    t16 = $[43];
  }
  let t17;
  if ($[44] !== teammate.progress || $[45] !== teammate.status || $[46] !== theme) {
    t17 = teammate.status === "running" && teammate.progress?.recentActivities && teammate.progress.recentActivities.length > 0 && <Box flexDirection="column"><Text bold={true} dimColor={true}>Progress</Text>{teammate.progress.recentActivities.map((activity_0, i) => <Text key={i} dimColor={i < teammate.progress.recentActivities.length - 1} wrap="truncate-end">{i === teammate.progress.recentActivities.length - 1 ? "\u203A " : "  "}{renderToolActivity(activity_0, tools, theme)}</Text>)}</Box>;
    $[44] = teammate.progress;
    $[45] = teammate.status;
    $[46] = theme;
    $[47] = t17;
  } else {
    t17 = $[47];
  }
  let t18;
  if ($[48] === Symbol.for("react.memo_cache_sentinel")) {
    t18 = <Text bold={true} dimColor={true}>Prompt</Text>;
    $[48] = t18;
  } else {
    t18 = $[48];
  }
  let t19;
  if ($[49] !== displayPrompt) {
    t19 = <Box flexDirection="column" marginTop={1}>{t18}<Text wrap="wrap">{displayPrompt}</Text></Box>;
    $[49] = displayPrompt;
    $[50] = t19;
  } else {
    t19 = $[50];
  }
  let t20;
  if ($[51] !== teammate.error || $[52] !== teammate.status) {
    t20 = teammate.status === "failed" && teammate.error && <Box flexDirection="column" marginTop={1}><Text bold={true} color="error">Error</Text><Text color="error" wrap="wrap">{teammate.error}</Text></Box>;
    $[51] = teammate.error;
    $[52] = teammate.status;
    $[53] = t20;
  } else {
    t20 = $[53];
  }
  let t21;
  if ($[54] !== onDone || $[55] !== subtitle || $[56] !== t16 || $[57] !== t17 || $[58] !== t19 || $[59] !== t20 || $[60] !== title) {
    t21 = <Dialog title={title} subtitle={subtitle} onCancel={onDone} color="background" inputGuide={t16}>{t17}{t19}{t20}</Dialog>;
    $[54] = onDone;
    $[55] = subtitle;
    $[56] = t16;
    $[57] = t17;
    $[58] = t19;
    $[59] = t20;
    $[60] = title;
    $[61] = t21;
  } else {
    t21 = $[61];
  }
  let t22;
  if ($[62] !== handleKeyDown || $[63] !== t21) {
    t22 = <Box flexDirection="column" tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t21}</Box>;
    $[62] = handleKeyDown;
    $[63] = t21;
    $[64] = t22;
  } else {
    t22 = $[64];
  }
  return t22;
}

import { withErrorBoundary } from '../MossenErrorBoundary.js';
export const InProcessTeammateDetailDialog = withErrorBoundary(InProcessTeammateDetailDialogImpl, 'InProcessTeammateDetailDialog');
