import figures from 'figures';
import { homedir } from 'os';
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import type { Step } from '../../projectOnboardingState.js';
import { formatCreditAmount, getCachedReferrerReward } from '../../services/api/referral.js';
import { getProductAssistantName, getProductDisplayName } from '../../constants/product.js';
import type { LogOption } from '../../types/logs.js';
import { getCwd } from '../../utils/cwd.js';
import { formatRelativeTimeAgo } from '../../utils/format.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import type { FeedConfig, FeedLine } from './Feed.js';
export function createRecentActivityFeed(activities: LogOption[]): FeedConfig {
  const lines: FeedLine[] = activities.map(log => {
    const time = formatRelativeTimeAgo(log.modified);
    const description = log.summary && log.summary !== 'No prompt' ? log.summary : log.firstPrompt;
    return {
      text: description || '',
      timestamp: time
    };
  });
  return {
    title: getLocalizedText({
      en: 'Recent activity',
      zh: '最近动态'
    }),
    lines,
    footer: lines.length > 0 ? getLocalizedText({
      en: '/resume for more',
      zh: '使用 /resume 查看更多'
    }) : undefined,
    emptyMessage: getLocalizedText({
      en: 'No recent activity',
      zh: '暂无最近动态'
    })
  };
}
export function createWhatsNewFeed(releaseNotes: string[]): FeedConfig {
  const lines: FeedLine[] = releaseNotes.map(note => {
    if (("external" as string) === 'internal') {
      const match = note.match(/^(\d+\s+\w+\s+ago)\s+(.+)$/);
      if (match) {
        return {
          timestamp: match[1],
          text: match[2] || ''
        };
      }
    }
    return {
      text: note
    };
  });
  return {
    title: ("external" as string) === 'internal' ? getLocalizedText({
      en: "What's new [Internal: Latest commits]",
      zh: '最新动态 [内部：最新提交]'
    }) : getLocalizedText({
      en: "What's new",
      zh: '最新动态'
    }),
    lines,
    footer: lines.length > 0 ? getLocalizedText({
      en: '/release-notes for more',
      zh: '使用 /release-notes 查看更多'
    }) : undefined,
    emptyMessage: ("external" as string) === 'internal' ? getLocalizedText({
      en: 'Unable to fetch latest mossen-internal commits',
      zh: '无法获取最新的 mossen-internal 提交'
    }) : getLocalizedText({
      en: 'Check the changelog for updates',
      zh: '查看更新日志了解详情'
    })
  };
}
export function createProjectOnboardingFeed(steps: Step[]): FeedConfig {
  const enabledSteps = steps.filter(({
    isEnabled
  }) => isEnabled).sort((a, b) => Number(a.isComplete) - Number(b.isComplete));
  const lines: FeedLine[] = enabledSteps.map(({
    text,
    isComplete
  }) => {
    const checkmark = isComplete ? `${figures.tick} ` : '';
    return {
      text: `${checkmark}${text}`
    };
  });
  const warningText = getCwd() === homedir() ? getLocalizedText({
    en: `Note: You have launched ${getProductAssistantName()} in your home directory. For the best experience, launch it in a project directory instead.`,
    zh: `注意：你当前是在主目录中启动 ${getProductAssistantName()}。为了获得更好的体验，建议在项目目录中启动。`
  }) : undefined;
  if (warningText) {
    lines.push({
      text: warningText
    });
  }
  return {
    title: getLocalizedText({
      en: 'Tips for getting started',
      zh: '开始使用提示'
    }),
    lines
  };
}
export function createGuestPassesFeed(): FeedConfig {
  const reward = getCachedReferrerReward();
  const subtitle = reward ? getLocalizedText({
    en: `Share ${getProductDisplayName()} and earn ${formatCreditAmount(reward)} of extra usage`,
    zh: `分享 ${getProductDisplayName()}，可额外获得 ${formatCreditAmount(reward)} 用量`
  }) : getLocalizedText({
    en: `Share ${getProductDisplayName()} with friends`,
    zh: `把 ${getProductDisplayName()} 分享给朋友`
  });
  return {
    title: getLocalizedText({
      en: '3 guest passes',
      zh: '3 张访客通行证'
    }),
    lines: [],
    customContent: {
      content: <>
          <Box marginY={1}>
            <Text color="mossen">[✻] [✻] [✻]</Text>
          </Box>
          <Text dimColor>{subtitle}</Text>
        </>,
      width: 48
    },
    footer: getLocalizedText({
      en: '/passes',
      zh: '/passes'
    })
  };
}
