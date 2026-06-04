import { c as _c } from "react/compiler-runtime";
import React, { useCallback } from 'react';
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js';
import { getProductAssistantName } from '../constants/product.js';
import { Box, Link, Text } from '../ink.js';
import type { ExternalMossenMdInclude } from '../utils/mossenmd.js';
import { saveCurrentProjectConfig } from '../utils/config.js';
import { getHostedPlatformUrls } from '../utils/customBackend.js';
import { t } from '../utils/i18n/index.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  onDone(): void;
  isStandaloneDialog?: boolean;
  externalIncludes?: ExternalMossenMdInclude[];
};
export function MossenMdExternalIncludesDialog(t0) {
  const $ = _c(20);
  const { securityDocsUrl } = getHostedPlatformUrls();
  const {
    onDone,
    isStandaloneDialog,
    externalIncludes
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  React.useEffect(_temp, t1);
  let t2;
  if ($[1] !== onDone) {
    t2 = value => {
      if (value === "no") {
        logMossenEvent("mossen.memory.externalIncludesDialogDeclined", {});
        saveCurrentProjectConfig(_temp2);
      } else {
        logMossenEvent("mossen.memory.externalIncludesDialogAccepted", {});
        saveCurrentProjectConfig(_temp3);
      }
      onDone();
    };
    $[1] = onDone;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const handleSelection = t2;
  let t3;
  if ($[3] !== handleSelection) {
    t3 = () => {
      handleSelection("no");
    };
    $[3] = handleSelection;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const handleEscape = t3;
  const t4 = !isStandaloneDialog;
  const t5 = !isStandaloneDialog;
  let t6;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text>This project's MOSSEN.md imports files outside the current working directory. Never allow this for third-party repositories.</Text>;
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  let t7;
  if ($[6] !== externalIncludes) {
    t7 = externalIncludes && externalIncludes.length > 0 && <Box flexDirection="column"><Text dimColor={true}>External imports:</Text>{externalIncludes.map(_temp4)}</Box>;
    $[6] = externalIncludes;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  let t8;
  if ($[8] !== securityDocsUrl) {
    t8 = <Text dimColor={true}>Important: Only use {getProductAssistantName()} with files you trust. Accessing untrusted files may pose security risks{" "}<Link url={securityDocsUrl} />{" "}</Text>;
    $[8] = securityDocsUrl;
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  let t9;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = [{
      label: t('ui.externalIncludes.allow'),
      value: "yes"
    }, {
      label: t('ui.externalIncludes.disable'),
      value: "no"
    }];
    $[10] = t9;
  } else {
    t9 = $[10];
  }
  let t10;
  if ($[11] !== handleSelection) {
    t10 = <Select options={t9} onChange={value_0 => handleSelection(value_0 as 'yes' | 'no')} />;
    $[11] = handleSelection;
    $[12] = t10;
  } else {
    t10 = $[12];
  }
  let t11;
  if ($[13] !== handleEscape || $[14] !== t10 || $[15] !== t4 || $[16] !== t5 || $[17] !== t7 || $[18] !== t8) {
    t11 = <Dialog title="Allow external MOSSEN.md file imports?" color="warning" onCancel={handleEscape} hideBorder={t4} hideInputGuide={t5}>{t6}{t7}{t8}{t10}</Dialog>;
    $[13] = handleEscape;
    $[14] = t10;
    $[15] = t4;
    $[16] = t5;
    $[17] = t7;
    $[18] = t8;
    $[19] = t11;
  } else {
    t11 = $[19];
  }
  return t11;
}
function _temp4(include, i) {
  return <Text key={i} dimColor={true}>{"  "}{include.path}</Text>;
}
function _temp3(current_0) {
  return {
    ...current_0,
    hasMossenMdExternalIncludesApproved: true,
    hasMossenMdExternalIncludesWarningShown: true
  };
}
function _temp2(current) {
  return {
    ...current,
    hasMossenMdExternalIncludesApproved: false,
    hasMossenMdExternalIncludesWarningShown: true
  };
}
function _temp() {
  logMossenEvent("mossen.memory.externalIncludesDialogShown", {});
}
