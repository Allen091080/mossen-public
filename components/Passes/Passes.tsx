import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { TEARDROP_ASTERISK } from '../../constants/figures.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { setClipboard } from '../../ink/termio/osc.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- enter to copy link
import { Box, Link, Text, useInput } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import { fetchReferralRedemptions, formatCreditAmount, getCachedOrFetchPassesEligibility } from '../../services/api/referral.js';
import type { ReferralRedemptionsResponse, ReferrerRewardInfo } from '../../services/oauth/types.js';
import { count } from '../../utils/array.js';
import { getProductDisplayName } from '../../constants/product.js';
import { logError } from '../../utils/log.js';
import { getHostedPlatformUrls } from '../../utils/customBackend.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { Pane } from '../design-system/Pane.js';
type PassStatus = {
  passNumber: number;
  isAvailable: boolean;
};
type Props = {
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
const GUEST_PASSES_TERMS_URL = `${getHostedPlatformUrls().remoteBaseUrl}/support/guest-passes`;

function getExitHintText(keyName: string): string {
  return getLocalizedText({
    en: `Press ${keyName} again to exit`,
    zh: `再次按 ${keyName} 退出`
  });
}
export function Passes({
  onDone
}: Props): React.ReactNode {
  const [loading, setLoading] = useState(true);
  const [passStatuses, setPassStatuses] = useState<PassStatus[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referrerReward, setReferrerReward] = useState<ReferrerRewardInfo | null | undefined>(undefined);
  const exitState = useExitOnCtrlCDWithKeybindings(() => onDone(getLocalizedText({
    en: 'Guest passes dialog dismissed',
    zh: '已关闭访客通行证弹层'
  }), {
    display: 'system'
  }));
  const handleCancel = useCallback(() => {
    onDone(getLocalizedText({
      en: 'Guest passes dialog dismissed',
      zh: '已关闭访客通行证弹层'
    }), {
      display: 'system'
    });
  }, [onDone]);
  useKeybinding('confirm:no', handleCancel, {
    context: 'Confirmation'
  });
  useInput((_input, key) => {
    if (key.return && referralLink) {
      void setClipboard(referralLink).then(raw => {
        if (raw) process.stdout.write(raw);
        logMossenEvent('mossen.passes.linkCopied', {});
        onDone(getLocalizedText({
          en: 'Referral link copied to clipboard!',
          zh: '邀请链接已复制到剪贴板！'
        }));
      });
    }
  });
  useEffect(() => {
    async function loadPassesData() {
      try {
        // Check eligibility first (uses cache if available)
        const eligibilityData = await getCachedOrFetchPassesEligibility();
        if (!eligibilityData || !eligibilityData.eligible) {
          setIsAvailable(false);
          setLoading(false);
          return;
        }
        setIsAvailable(true);

        // Store the referral link if available
        if (eligibilityData.referral_code_details?.referral_link) {
          setReferralLink(eligibilityData.referral_code_details.referral_link);
        }

        // Store referrer reward info for v1 campaign messaging
        setReferrerReward(eligibilityData.referrer_reward);

        // Use the campaign returned from eligibility for redemptions
        const campaign = eligibilityData.referral_code_details?.campaign ?? 'mossen_guest_pass';

        // Fetch redemptions data
        let redemptionsData: ReferralRedemptionsResponse;
        try {
          redemptionsData = await fetchReferralRedemptions(campaign);
        } catch (err_0) {
          logError(err_0 as Error);
          setIsAvailable(false);
          setLoading(false);
          return;
        }

        // Build pass statuses array
        const redemptions = redemptionsData.redemptions || [];
        const maxRedemptions = redemptionsData.limit || 3;
        const statuses: PassStatus[] = [];
        for (let i = 0; i < maxRedemptions; i++) {
          const redemption = redemptions[i];
          statuses.push({
            passNumber: i + 1,
            isAvailable: !redemption
          });
        }
        setPassStatuses(statuses);
        setLoading(false);
      } catch (err) {
        // For any error, just show passes as not available
        logError(err as Error);
        setIsAvailable(false);
        setLoading(false);
      }
    }
    void loadPassesData();
  }, []);
  if (loading) {
    return <Pane>
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{getLocalizedText({
          en: 'Loading guest pass information…',
          zh: '正在加载访客通行证信息…'
        })}</Text>
          <Text dimColor italic>
            {exitState.pending ? <>{getExitHintText(exitState.keyName)}</> : <>{getLocalizedText({
            en: 'Esc to cancel',
            zh: 'Esc 取消'
          })}</>}
          </Text>
        </Box>
      </Pane>;
  }
  if (!isAvailable) {
    return <Pane>
        <Box flexDirection="column" gap={1}>
          <Text>{getLocalizedText({
          en: 'Guest passes are not currently available.',
          zh: '访客通行证当前不可用。'
        })}</Text>
          <Text dimColor italic>
            {exitState.pending ? <>{getExitHintText(exitState.keyName)}</> : <>{getLocalizedText({
            en: 'Esc to cancel',
            zh: 'Esc 取消'
          })}</>}
          </Text>
        </Box>
      </Pane>;
  }
  const typedPassStatuses = passStatuses as PassStatus[];
  const availableCount = count(typedPassStatuses, (p: PassStatus) => p.isAvailable);

  // Sort passes: available first, then redeemed
  const sortedPasses = [...typedPassStatuses].sort((a, b) => +b.isAvailable - +a.isAvailable);

  // ASCII art for tickets
  const renderTicket = (pass: PassStatus) => {
    const isRedeemed = !pass.isAvailable;
    if (isRedeemed) {
      // Grayed out redeemed ticket with slashes
      return <Box key={pass.passNumber} flexDirection="column" marginRight={1}>
          <Text dimColor>{'┌─────────╱'}</Text>
          <Text dimColor>{` ) CC ${TEARDROP_ASTERISK} ┊╱`}</Text>
          <Text dimColor>{'└───────╱'}</Text>
        </Box>;
    }
    return <Box key={pass.passNumber} flexDirection="column" marginRight={1}>
        <Text>{'┌──────────┐'}</Text>
        <Text>
          {' ) CC '}
          <Text color="mossen">{TEARDROP_ASTERISK}</Text>
          {' ┊ ( '}
        </Text>
        <Text>{'└──────────┘'}</Text>
      </Box>;
  };
  return <Pane>
      <Box flexDirection="column" gap={1}>
        <Text color="permission">{getLocalizedText({
        en: `Guest passes · ${availableCount} left`,
        zh: `访客通行证 · 剩余 ${availableCount} 张`
      })}</Text>

        <Box flexDirection="row" marginLeft={2}>
          {sortedPasses.slice(0, 3).map(pass_0 => renderTicket(pass_0))}
        </Box>

        {referralLink && <Box marginLeft={2}>
            <Text>{referralLink}</Text>
          </Box>}

        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>
            {referrerReward ? getLocalizedText({
            en: `Share a free week of ${getProductDisplayName()} with friends. If they love it and subscribe, you'll get ${formatCreditAmount(referrerReward)} of extra usage to keep building. `,
            zh: `把 ${getProductDisplayName()} 的免费一周分享给朋友。如果他们喜欢并订阅，你将获得 ${formatCreditAmount(referrerReward)} 的额外额度继续构建。`
          }) : getLocalizedText({
            en: `Share a free week of ${getProductDisplayName()} with friends. `,
            zh: `把 ${getProductDisplayName()} 的免费一周分享给朋友。`
          })}
            <Link url={GUEST_PASSES_TERMS_URL}>
              {getLocalizedText({
              en: 'Terms apply.',
              zh: '条款适用。'
            })}
            </Link>
          </Text>
        </Box>

        <Box>
          <Text dimColor italic>
            {exitState.pending ? <>{getExitHintText(exitState.keyName)}</> : <>{getLocalizedText({
            en: 'Enter to copy link · Esc to cancel',
            zh: 'Enter 复制链接 · Esc 取消'
          })}</>}
          </Text>
        </Box>
      </Box>
    </Pane>;
}
