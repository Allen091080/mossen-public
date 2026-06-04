/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { type ReactNode, useEffect } from 'react';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { getEffortSuffix } from '../../utils/effort.js';
import { truncate } from '../../utils/format.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { formatModelAndBilling, getLogoDisplayData, truncatePath } from '../../utils/logoV2Utils.js';
import { renderModelSetting } from '../../utils/model/model.js';
import { getProductDisplayName } from '../../constants/product.js';
import { isCustomBackendEnabled } from '../../utils/customBackend.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { AnimatedMossenDotLogo } from './AnimatedMossenDotLogo.js';
import { MossenDotLogo, MOSSEN_TEXT_MARK } from './MossenDotLogo.js';
import { MossenAgentBanner, MOSSEN_AGENT_BANNER_WIDTH } from './MossenAgentBanner.js';
import { GuestPassesUpsell, incrementGuestPassesSeenCount, useShowGuestPassesUpsell } from './GuestPassesUpsell.js';
import { incrementOverageCreditUpsellSeenCount, OverageCreditUpsell, useShowOverageCreditUpsell } from './OverageCreditUpsell.js';
export function CondensedLogo() {
  const $ = _c(31);
  const {
    columns
  } = useTerminalSize();
  const agent = useAppState(_temp);
  const effortValue = useAppState(_temp2);
  const model = useMainLoopModel();
  const modelDisplayName = renderModelSetting(model);
  const {
    version,
    cwd,
    billingType,
    agentName: agentNameFromSettings
  } = getLogoDisplayData();
  const agentName = agent ?? agentNameFromSettings;
  const showGuestPassesUpsell = useShowGuestPassesUpsell();
  const showOverageCreditUpsell = useShowOverageCreditUpsell();
  let t0;
  let t1;
  if ($[0] !== showGuestPassesUpsell) {
    t0 = () => {
      if (showGuestPassesUpsell) {
        incrementGuestPassesSeenCount();
      }
    };
    t1 = [showGuestPassesUpsell];
    $[0] = showGuestPassesUpsell;
    $[1] = t0;
    $[2] = t1;
  } else {
    t0 = $[1];
    t1 = $[2];
  }
  useEffect(t0, t1);
  let t2;
  let t3;
  if ($[3] !== showGuestPassesUpsell || $[4] !== showOverageCreditUpsell) {
    t2 = () => {
      if (showOverageCreditUpsell && !showGuestPassesUpsell) {
        incrementOverageCreditUpsellSeenCount();
      }
    };
    t3 = [showOverageCreditUpsell, showGuestPassesUpsell];
    $[3] = showGuestPassesUpsell;
    $[4] = showOverageCreditUpsell;
    $[5] = t2;
    $[6] = t3;
  } else {
    t2 = $[5];
    t3 = $[6];
  }
  useEffect(t2, t3);
  const textWidth = Math.max(columns - 15, 20);
  const productTitle = isCustomBackendEnabled() ? `${MOSSEN_TEXT_MARK} ${getProductDisplayName()}` : getProductDisplayName();
  const truncatedVersion = truncate(version, Math.max(textWidth - 13, 6));
  const effortSuffix = getEffortSuffix(model, effortValue);
  const {
    shouldSplit,
    truncatedModel,
    truncatedBilling
  } = formatModelAndBilling(modelDisplayName + effortSuffix, billingType, textWidth);
  const cwdAvailableWidth = agentName ? textWidth - 1 - stringWidth(agentName) - 3 : textWidth;
  const truncatedCwd = truncatePath(cwd, Math.max(cwdAvailableWidth, 10));
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = isFullscreenEnvEnabled() ? <AnimatedMossenDotLogo /> : <MossenDotLogo />;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== productTitle) {
    t5 = <Text bold={true}>{productTitle}</Text>;
    $[8] = productTitle;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== truncatedVersion || $[11] !== t5) {
    t6 = <Text>{t5}{" "}<Text dimColor={true}>v{truncatedVersion}</Text></Text>;
    $[10] = truncatedVersion;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
  if ($[13] !== shouldSplit || $[14] !== truncatedBilling || $[15] !== truncatedModel) {
    t7 = shouldSplit ? <><Text dimColor={true}>{truncatedModel}</Text><Text dimColor={true}>{truncatedBilling}</Text></> : <Text dimColor={true}>{truncatedModel} · {truncatedBilling}</Text>;
    $[13] = shouldSplit;
    $[14] = truncatedBilling;
    $[15] = truncatedModel;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  const t8 = agentName ? `@${agentName} · ${truncatedCwd}` : truncatedCwd;
  let t9;
  if ($[17] !== t8) {
    t9 = <Text dimColor={true}>{t8}</Text>;
    $[17] = t8;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  let t10;
  if ($[19] !== showGuestPassesUpsell) {
    t10 = showGuestPassesUpsell && <GuestPassesUpsell />;
    $[19] = showGuestPassesUpsell;
    $[20] = t10;
  } else {
    t10 = $[20];
  }
  let t11;
  if ($[21] !== showGuestPassesUpsell || $[22] !== showOverageCreditUpsell || $[23] !== textWidth) {
    t11 = !showGuestPassesUpsell && showOverageCreditUpsell && <OverageCreditUpsell maxWidth={textWidth} twoLine={true} />;
    $[21] = showGuestPassesUpsell;
    $[22] = showOverageCreditUpsell;
    $[23] = textWidth;
    $[24] = t11;
  } else {
    t11 = $[24];
  }
  let t12;
  if ($[25] !== t10 || $[26] !== t11 || $[27] !== t6 || $[28] !== t7 || $[29] !== t9) {
    t12 = <OffscreenFreeze><Box flexDirection="row" gap={2} alignItems="center">{t4}<Box flexDirection="column">{t6}{t7}{t9}{t10}{t11}</Box></Box></OffscreenFreeze>;
    $[25] = t10;
    $[26] = t11;
    $[27] = t6;
    $[28] = t7;
    $[29] = t9;
    $[30] = t12;
  } else {
    t12 = $[30];
  }
  if (columns >= MOSSEN_AGENT_BANNER_WIDTH + 4) {
    return <Box flexDirection="column"><MossenAgentBanner showMeta={false} />{t12}</Box>;
  }
  return t12;
}
function _temp2(s_0) {
  return s_0.effortValue;
}
function _temp(s) {
  return s.agent;
}
