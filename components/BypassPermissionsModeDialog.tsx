import { c as _c } from "react/compiler-runtime";
import React, { useCallback } from 'react';
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js';
import { Box, Link, Newline, Text } from '../ink.js';
import { getProductAssistantName } from '../constants/product.js';
import { getHostedPlatformUrls } from '../utils/customBackend.js';
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js';
import { t } from '../utils/i18n/index.js';
import { updateSettingsForSource } from '../utils/settings/settings.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  onAccept(): void;
};
export function BypassPermissionsModeDialog(t0) {
  const $ = _c(6);
  const { securityDocsUrl } = getHostedPlatformUrls();
  const {
    onAccept
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
  if ($[1] !== onAccept) {
    t2 = function onChange(value) {
      bb3: switch (value) {
        case "accept":
          {
            logMossenEvent("mossen.permission.bypassModeDialogAccept", {});
            updateSettingsForSource("userSettings", {
              skipDangerousModePermissionPrompt: true
            });
            onAccept();
            break bb3;
          }
        case "decline":
          {
            gracefulShutdownSync(1);
          }
      }
    };
    $[1] = onAccept;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const onChange = t2;
  const handleEscape = _temp2;
  const t3 = <Box flexDirection="column" gap={1}><Text>{getLocalizedText({ en: `In YOLO Mode, ${getProductAssistantName()} will not ask for your approval before running potentially dangerous commands.`, zh: `在 YOLO 模式下，${getProductAssistantName()} 在运行潜在危险命令前不会请求你的确认。` })}<Newline />{getLocalizedText({ en: 'This mode should only be used in a sandboxed container/VM that has restricted internet access and can easily be restored if damaged.', zh: '此模式只应在受沙箱保护、互联网访问受限、且损坏后可轻松恢复的容器或虚拟机中使用。' })}</Text><Text>{getLocalizedText({ en: 'By proceeding, you accept all responsibility for actions taken while running in YOLO Mode.', zh: '继续即表示你接受在 YOLO 模式下运行所产生的全部责任。' })}</Text><Link url={securityDocsUrl} /></Box>;
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = [{
      label: t('ui.bypassPermissions.noExit'),
      value: "decline"
    }, {
      label: t('ui.bypassPermissions.yesAccept'),
      value: "accept"
    }];
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const t5 = <Dialog title={getLocalizedText({ en: `WARNING: ${getProductAssistantName()} running in YOLO Mode`, zh: `警告：${getProductAssistantName()} 正在以 YOLO 模式运行` })} color="error" onCancel={handleEscape}>{t3}<Select options={t4} onChange={value_0 => onChange(value_0 as 'accept' | 'decline')} /></Dialog>;
  return t5;
}
function _temp2() {
  gracefulShutdownSync(0);
}
function _temp() {
  logMossenEvent("mossen.permission.bypassModeDialogShown", {});
}
