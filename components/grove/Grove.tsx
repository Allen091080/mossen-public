/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { getProductDisplayName } from '../../constants/product.js';
import { Box, Link, Text, useInput } from '../../ink.js';
import { type AccountSettings, calculateShouldShowGrove, type GroveConfig, getGroveNoticeConfig, getGroveSettings, markGroveNoticeViewed, updateGroveSettings } from '../../services/api/grove.js';
import { getHostedPlatformUrls } from '../../utils/customBackend.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { Select } from '../CustomSelect/index.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
export type GroveDecision = 'accept_opt_in' | 'accept_opt_out' | 'defer' | 'escape' | 'skip_rendering';
type Props = {
  showIfAlreadyViewed: boolean;
  location: 'settings' | 'policy_update_modal' | 'onboarding';
  onDone(decision: GroveDecision): void;
};
const NEW_TERMS_ASCII = ` _____________
 |          \\  \\
 | NEW TERMS \\__\\
 |              |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |  ----------  |
 |              |
 |______________|`;
const {
  privacyUrl: GROVE_PRIVACY_URL,
  remoteBaseUrl: GROVE_REMOTE_BASE_URL,
} = getHostedPlatformUrls();
const GROVE_NEWS_URL = `${GROVE_REMOTE_BASE_URL}/news/platform-terms-update`;
const GROVE_TERMS_URL = `${GROVE_REMOTE_BASE_URL}/legal/terms`;
const GROVE_PRIVACY_POLICY_URL = `${GROVE_REMOTE_BASE_URL}/legal/privacy`;
function GracePeriodContentBody() {
  const $ = _c(9);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Text>{getLocalizedText({
      en: 'An update to our Platform Terms and Privacy Policy will take effect on',
      zh: '平台条款和隐私政策的更新将于'
    })}{" "}<Text bold={true}>{getLocalizedText({
      en: 'October 8, 2025',
      zh: '2025 年 10 月 8 日'
    })}</Text>{getLocalizedText({
      en: '. You can accept the updated terms today.',
      zh: '生效。你今天就可以接受更新后的条款。'
    })}</Text>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text>{getLocalizedText({
      en: "What's changing?",
      zh: '有哪些变化？'
    })}</Text>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text>· </Text>;
    t3 = <Text bold={true}>{`You can help improve ${getProductDisplayName()} `}</Text>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box paddingLeft={1}><Text>{t2}{t3}<Text>{getLocalizedText({
      en: '— Allow the use of your chats and coding sessions to train and improve the platform assistant models. Change anytime in your Privacy Settings',
      zh: '— 允许使用你的聊天和编码会话来训练和改进平台助手模型。你可以随时在隐私设置中更改'
    })} (<Link url={GROVE_PRIVACY_URL} />).</Text></Text></Box>;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box flexDirection="column">{t1}{t4}<Box paddingLeft={1}><Text><Text>· </Text><Text bold={true}>{getLocalizedText({
      en: 'Updates to data retention ',
      zh: '数据保留更新'
    })}</Text><Text>{getLocalizedText({
      en: "— To help us improve our AI models and safety protections, we're extending data retention to 5 years.",
      zh: '— 为了帮助我们改进 AI 模型和安全保护，我们将数据保留期延长到 5 年。'
    })}</Text></Text></Box></Box>;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Link url={GROVE_NEWS_URL} />;
    $[6] = t6;
  } else {
    t6 = $[6];
  }
  let t7;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Link url={GROVE_TERMS_URL} />;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  let t8;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <>{t0}{t5}<Text>{getLocalizedText({
      en: 'Learn more',
      zh: '了解更多'
    })} ({t6}) {getLocalizedText({
      en: 'or read the updated Platform Terms',
      zh: '或阅读更新后的平台条款'
    })} ({t7}) {getLocalizedText({
      en: 'and Privacy Policy',
      zh: '和隐私政策'
    })} (<Link url={GROVE_PRIVACY_POLICY_URL} />)</Text></>;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
  return t8;
}
function PostGracePeriodContentBody() {
  const $ = _c(7);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Text>{getLocalizedText({
      en: "We've updated our Platform Terms and Privacy Policy.",
      zh: '我们已更新平台条款和隐私政策。'
    })}</Text>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text>{getLocalizedText({
      en: "What's changing?",
      zh: '有哪些变化？'
    })}</Text>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box flexDirection="column"><Text bold={true}>{getLocalizedText({
      en: `Help improve ${getProductDisplayName()}`,
      zh: `帮助改进 ${getProductDisplayName()}`
    })}</Text><Text>{getLocalizedText({
      en: `Allow the use of your chats and coding sessions to train and improve ${getProductDisplayName()} models. You can change this anytime in Privacy Settings`,
      zh: `允许使用你的聊天和编码会话来训练和改进 ${getProductDisplayName()} 模型。你可以随时在隐私设置中更改此项。`
    })}</Text><Link url={GROVE_PRIVACY_URL} /></Box>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column" gap={1}>{t1}{t2}<Box flexDirection="column"><Text bold={true}>{getLocalizedText({
      en: 'How this affects data retention',
      zh: '这会如何影响数据保留'
    })}</Text><Text>{getLocalizedText({
      en: 'Turning ON the help improve assistant setting extends data retention from 30 days to 5 years. Turning it OFF keeps the default 30-day data retention. Delete data anytime.',
      zh: '开启“帮助改进助手”设置会将数据保留期从 30 天延长到 5 年。关闭后会保持默认的 30 天数据保留期。你可以随时删除数据。'
    })}</Text></Box></Box>;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Link url={GROVE_NEWS_URL} />;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Link url={GROVE_TERMS_URL} />;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <>{t0}{t3}<Text>{getLocalizedText({
      en: 'Learn more',
      zh: '了解更多'
    })} ({t4}) {getLocalizedText({
      en: 'or read the updated Platform Terms',
      zh: '或阅读更新后的平台条款'
    })} ({t5}) {getLocalizedText({
      en: 'and Privacy Policy',
      zh: '和隐私政策'
    })} (<Link url={GROVE_PRIVACY_POLICY_URL} />)</Text></>;
    $[6] = t6;
  } else {
    t6 = $[6];
  }
  return t6;
}
export function GroveDialog(t0) {
  const $ = _c(34);
  const {
    showIfAlreadyViewed,
    location,
    onDone
  } = t0;
  const [shouldShowDialog, setShouldShowDialog] = useState(null);
  const [groveConfig, setGroveConfig] = useState(null);
  let t1;
  let t2;
  if ($[0] !== location || $[1] !== onDone || $[2] !== showIfAlreadyViewed) {
    t1 = () => {
      const checkGroveSettings = async function checkGroveSettings() {
        const [settingsResult, configResult] = await Promise.all([getGroveSettings(), getGroveNoticeConfig()]);
        const config = configResult.success ? configResult.data : null;
        setGroveConfig(config);
        const shouldShow = calculateShouldShowGrove(settingsResult, configResult, showIfAlreadyViewed);
        setShouldShowDialog(shouldShow);
        if (!shouldShow) {
          onDone("skip_rendering");
          return;
        }
        markGroveNoticeViewed();
        logMossenEvent("mossen.grove.policyViewed", {
          location: location as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          dismissable: config?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      };
      checkGroveSettings();
    };
    t2 = [showIfAlreadyViewed, location, onDone];
    $[0] = location;
    $[1] = onDone;
    $[2] = showIfAlreadyViewed;
    $[3] = t1;
    $[4] = t2;
  } else {
    t1 = $[3];
    t2 = $[4];
  }
  useEffect(t1, t2);
  if (shouldShowDialog === null) {
    return null;
  }
  if (!shouldShowDialog) {
    return null;
  }
  let t3;
  if ($[5] !== groveConfig?.notice_is_grace_period || $[6] !== onDone) {
    t3 = async function onChange(value) {
      bb21: switch (value) {
        case "accept_opt_in":
          {
            await updateGroveSettings(true);
            logMossenEvent("mossen.grove.policySubmitted", {
              state: true,
              dismissable: groveConfig?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
            });
            break bb21;
          }
        case "accept_opt_out":
          {
            await updateGroveSettings(false);
            logMossenEvent("mossen.grove.policySubmitted", {
              state: false,
              dismissable: groveConfig?.notice_is_grace_period as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
            });
            break bb21;
          }
        case "defer":
          {
            logMossenEvent("mossen.grove.policyDismissed", {
              state: true
            });
            break bb21;
          }
        case "escape":
          {
            logMossenEvent("mossen.grove.policyEscaped", {});
          }
      }
      onDone(value);
    };
    $[5] = groveConfig?.notice_is_grace_period;
    $[6] = onDone;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  const onChange = t3;
  let t4;
  if ($[8] !== groveConfig?.domain_excluded) {
    t4 = groveConfig?.domain_excluded ? [{
      label: getLocalizedText({
        en: 'Accept terms · Help improve assistant: OFF (for emails with your domain)',
        zh: '接受条款 · 帮助改进助手：关闭（适用于你域名下的邮箱）'
      }),
      value: "accept_opt_out"
    }] : [{
      label: getLocalizedText({
        en: 'Accept terms · Help improve assistant: ON',
        zh: '接受条款 · 帮助改进助手：开启'
      }),
      value: "accept_opt_in"
    }, {
      label: getLocalizedText({
        en: 'Accept terms · Help improve assistant: OFF',
        zh: '接受条款 · 帮助改进助手：关闭'
      }),
      value: "accept_opt_out"
    }];
    $[8] = groveConfig?.domain_excluded;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const acceptOptions = t4;
  let t5;
  if ($[10] !== groveConfig?.notice_is_grace_period || $[11] !== onChange) {
    t5 = function handleCancel() {
      if (groveConfig?.notice_is_grace_period) {
        onChange("defer");
        return;
      }
      onChange("escape");
    };
    $[10] = groveConfig?.notice_is_grace_period;
    $[11] = onChange;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  const handleCancel = t5;
  let t6;
  if ($[13] !== groveConfig?.notice_is_grace_period) {
    t6 = <Box flexDirection="column" gap={1} flexGrow={1}>{groveConfig?.notice_is_grace_period ? <GracePeriodContentBody /> : <PostGracePeriodContentBody />}</Box>;
    $[13] = groveConfig?.notice_is_grace_period;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Box flexShrink={0}><Text color="professionalBlue">{NEW_TERMS_ASCII}</Text></Box>;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let t8;
  if ($[16] !== t6) {
    t8 = <Box flexDirection="row">{t6}{t7}</Box>;
    $[16] = t6;
    $[17] = t8;
  } else {
    t8 = $[17];
  }
  let t9;
  if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = <Box flexDirection="column"><Text bold={true}>{getLocalizedText({
      en: "Please select how you'd like to continue",
      zh: '请选择你想如何继续'
    })}</Text><Text>{getLocalizedText({
      en: 'Your choice takes effect immediately upon confirmation.',
      zh: '你的选择会在确认后立即生效。'
    })}</Text></Box>;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  let t10;
  if ($[19] !== groveConfig?.notice_is_grace_period) {
    t10 = groveConfig?.notice_is_grace_period ? [{
      label: getLocalizedText({
        en: 'Not now',
        zh: '暂不处理'
      }),
      value: "defer"
    }] : [];
    $[19] = groveConfig?.notice_is_grace_period;
    $[20] = t10;
  } else {
    t10 = $[20];
  }
  let t11;
  if ($[21] !== acceptOptions || $[22] !== t10) {
    t11 = [...acceptOptions, ...t10];
    $[21] = acceptOptions;
    $[22] = t10;
    $[23] = t11;
  } else {
    t11 = $[23];
  }
  let t12;
  if ($[24] !== onChange) {
    t12 = value_0 => onChange(value_0 as 'accept_opt_in' | 'accept_opt_out' | 'defer');
    $[24] = onChange;
    $[25] = t12;
  } else {
    t12 = $[25];
  }
  let t13;
  if ($[26] !== handleCancel || $[27] !== t11 || $[28] !== t12) {
    t13 = <Box flexDirection="column" gap={1}>{t9}<Select options={t11} onChange={t12} onCancel={handleCancel} /></Box>;
    $[26] = handleCancel;
    $[27] = t11;
    $[28] = t12;
    $[29] = t13;
  } else {
    t13 = $[29];
  }
  let t14;
  if ($[30] !== handleCancel || $[31] !== t13 || $[32] !== t8) {
    t14 = <Dialog title={getLocalizedText({
      en: 'Updates to Platform Terms and Policies',
      zh: '平台条款与政策更新'
    })} color="professionalBlue" onCancel={handleCancel} inputGuide={_temp}>{t8}{t13}</Dialog>;
    $[30] = handleCancel;
    $[31] = t13;
    $[32] = t8;
    $[33] = t14;
  } else {
    t14 = $[33];
  }
  return t14;
}
function _temp(exitState) {
  return exitState.pending ? <Text>{getLocalizedText({
    en: 'Press',
    zh: '再按'
  })} {exitState.keyName} {getLocalizedText({
    en: 'again to exit',
    zh: '退出'
  })}</Text> : <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><KeyboardShortcutHint shortcut="Esc" action="cancel" /></Byline>;
}
type PrivacySettingsDialogProps = {
  settings: AccountSettings;
  domainExcluded?: boolean;
  onDone(): void;
};
export function PrivacySettingsDialog(t0) {
  const $ = _c(17);
  const {
    settings,
    domainExcluded,
    onDone
  } = t0;
  const [groveEnabled, setGroveEnabled] = useState(settings.grove_enabled);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  React.useEffect(_temp2, t1);
  let t2;
  if ($[1] !== domainExcluded || $[2] !== groveEnabled) {
    t2 = async (input, key) => {
      if (!domainExcluded && (key.tab || key.return || input === " ")) {
        const newValue = !groveEnabled;
        setGroveEnabled(newValue);
        await updateGroveSettings(newValue);
      }
    };
    $[1] = domainExcluded;
    $[2] = groveEnabled;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  useInput(t2);
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text color="error">{getLocalizedText({
      en: 'OFF',
      zh: '关闭'
    })}</Text>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let valueComponent = t3;
  if (domainExcluded) {
    let t4;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Text color="error">{getLocalizedText({
        en: 'OFF (for emails with your domain)',
        zh: '关闭（适用于你域名下的邮箱）'
      })}</Text>;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    valueComponent = t4;
  } else {
    if (groveEnabled) {
      let t4;
      if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
        t4 = <Text color="success">{getLocalizedText({
          en: 'ON',
          zh: '开启'
        })}</Text>;
        $[6] = t4;
      } else {
        t4 = $[6];
      }
      valueComponent = t4;
    }
  }
  let t4;
  if ($[7] !== domainExcluded) {
    t4 = exitState => exitState.pending ? <Text>{getLocalizedText({
      en: 'Press',
      zh: '再按'
    })} {exitState.keyName} {getLocalizedText({
      en: 'again to exit',
      zh: '退出'
    })}</Text> : domainExcluded ? <KeyboardShortcutHint shortcut="Esc" action="cancel" /> : <Byline><KeyboardShortcutHint shortcut="Enter/Tab/Space" action="toggle" /><KeyboardShortcutHint shortcut="Esc" action="cancel" /></Byline>;
    $[7] = domainExcluded;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text>{getLocalizedText({
      en: 'Review and manage your privacy settings at',
      zh: '在此查看和管理你的隐私设置：'
    })}{" "}<Link url={GROVE_PRIVACY_URL} /></Text>;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box width={44}><Text bold={true}>{getLocalizedText({
      en: `Help improve ${getProductDisplayName()}`,
      zh: `帮助改进 ${getProductDisplayName()}`
    })}</Text></Box>;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  let t7;
  if ($[11] !== valueComponent) {
    t7 = <Box>{t6}<Box>{valueComponent}</Box></Box>;
    $[11] = valueComponent;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] !== onDone || $[14] !== t4 || $[15] !== t7) {
    t8 = <Dialog title={getLocalizedText({
      en: 'Data Privacy',
      zh: '数据隐私'
    })} color="professionalBlue" onCancel={onDone} inputGuide={t4}>{t5}{t7}</Dialog>;
    $[13] = onDone;
    $[14] = t4;
    $[15] = t7;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  return t8;
}
function _temp2() {
  logMossenEvent("mossen.grove.privacySettingsViewed", {});
}
