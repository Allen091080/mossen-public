import { c as _c } from "react/compiler-runtime";
/**
 * Shared helper functions and types for plugin details views
 *
 * Used by both DiscoverPlugins and BrowseMarketplace components.
 */

import * as React from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { Box, Text } from '../../ink.js';
import type { PluginMarketplaceEntry } from '../../utils/plugins/schemas.js';
import { estimateMarketplacePluginProjectedSessionTokens } from '../../utils/plugins/projectedContextCost.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';

/**
 * Represents a plugin available for installation from a marketplace
 */
export type InstallablePlugin = {
  entry: PluginMarketplaceEntry;
  marketplaceName: string;
  pluginId: string;
  isInstalled: boolean;
};

/**
 * Menu option for plugin details view
 */
export type PluginDetailsMenuOption = {
  label: string;
  action: string;
};

/**
 * Extract GitHub repo info from a plugin's source
 */
export function extractGitHubRepo(plugin: InstallablePlugin): string | null {
  const isGitHub = plugin.entry.source && typeof plugin.entry.source === 'object' && 'source' in plugin.entry.source && plugin.entry.source.source === 'github';
  if (isGitHub && typeof plugin.entry.source === 'object' && 'repo' in plugin.entry.source) {
    return plugin.entry.source.repo;
  }
  return null;
}

/**
 * Build menu options for plugin details view with scoped installation options
 */
export function buildPluginDetailsMenuOptions(hasHomepage: string | undefined, githubRepo: string | null): PluginDetailsMenuOption[] {
  const options: PluginDetailsMenuOption[] = [{
    label: getLocalizedText({
      en: 'Install for you (user scope)',
      zh: '为你安装（用户范围）'
    }),
    action: 'install-user'
  }, {
    label: getLocalizedText({
      en: 'Install for all collaborators on this repository (project scope)',
      zh: '为此仓库的所有协作者安装（项目范围）'
    }),
    action: 'install-project'
  }, {
    label: getLocalizedText({
      en: 'Install for you, in this repo only (local scope)',
      zh: '仅在此仓库为你安装（本地范围）'
    }),
    action: 'install-local'
  }];
  if (hasHomepage) {
    options.push({
      label: getLocalizedText({
        en: 'Open homepage',
        zh: '打开主页'
      }),
      action: 'homepage'
    });
  }
  if (githubRepo) {
    options.push({
      label: getLocalizedText({
        en: 'View on GitHub',
        zh: '在 GitHub 查看'
      }),
      action: 'github'
    });
  }
  options.push({
    label: getLocalizedText({
      en: 'Back to plugin list',
      zh: '返回插件列表'
    }),
    action: 'back'
  });
  return options;
}

/**
 * Key hint component for plugin selection screens
 */
export function PluginSelectionKeyHint(t0) {
  const $ = _c(7);
  const {
    hasSelection
  } = t0;
  let t1;
  if ($[0] !== hasSelection) {
    t1 = hasSelection && <ConfigurableShortcutHint action="plugin:install" context="Plugin" fallback="i" description={getLocalizedText({
      en: 'install',
      zh: '安装'
    })} bold={true} />;
    $[0] = hasSelection;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  let t3;
  let t4;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <ConfigurableShortcutHint action="plugin:toggle" context="Plugin" fallback="Space" description={getLocalizedText({
      en: 'toggle',
      zh: '切换'
    })} />;
    t3 = <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description={getLocalizedText({
      en: 'details',
      zh: '详情'
    })} />;
    t4 = <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={getLocalizedText({
      en: 'back',
      zh: '返回'
    })} />;
    $[2] = t2;
    $[3] = t3;
    $[4] = t4;
  } else {
    t2 = $[2];
    t3 = $[3];
    t4 = $[4];
  }
  let t5;
  if ($[5] !== t1) {
    t5 = <Box marginTop={1}><Text dimColor={true} italic={true}><Byline>{t1}{t2}{t3}{t4}</Byline></Text></Box>;
    $[5] = t1;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  return t5;
}

export function PluginProjectedContextCost({
  entry
}: {
  entry: PluginMarketplaceEntry;
}): React.ReactNode {
  const tokens = estimateMarketplacePluginProjectedSessionTokens(entry);
  return <Box flexDirection="column">
      <Text dimColor>
        · {getLocalizedText({
        en: 'Projected session tokens (estimate):',
        zh: '预计会话 tokens（估算）：'
      })}{' '}
        ~{tokens}
      </Text>
      <Text dimColor italic>
        {getLocalizedText({
        en: 'Estimate only; actual context depends on enabled components after install.',
        zh: '仅为估算；实际上下文取决于安装后启用的组件。'
      })}
      </Text>
    </Box>;
}
