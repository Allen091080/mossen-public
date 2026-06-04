import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { installPluginFromUrlOp } from '../../utils/plugins/pluginUrlInstall.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';

type Props = {
  url?: string;
  scope?: string;
  onComplete: (result?: string) => void;
};

function formatSuccess(result: Awaited<ReturnType<typeof installPluginFromUrlOp>>): string {
  const lines: string[] = [];
  lines.push(
    getLocalizedText({
      en: `${figures.tick} Installed ${result.pluginId} from URL at ${result.scope} scope.`,
      zh: `${figures.tick} 已从 URL 安装 ${result.pluginId} 到 ${result.scope} scope。`,
    }),
  );
  lines.push(
    getLocalizedText({
      en: `Version: ${result.version}`,
      zh: `版本: ${result.version}`,
    }),
  );
  if (result.hookAutoEnableSuppressed) {
    lines.push(
      getLocalizedText({
        en: 'Hooks were detected, so the plugin was installed disabled by default. Review it, then run /plugin enable <plugin@marketplace>.',
        zh: '检测到 hooks，因此该插件默认以禁用状态安装。请先审查，再运行 /plugin enable <plugin@marketplace>。',
      }),
    );
  } else {
    lines.push(
      getLocalizedText({
        en: 'Run /reload-plugins to activate it in this session.',
        zh: '运行 /reload-plugins 在当前会话中激活。',
      }),
    );
  }
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(
      getLocalizedText({
        en: 'Warnings:',
        zh: '警告:',
      }),
    );
    for (const warning of result.warnings.slice(0, 5)) {
      lines.push(`  - ${warning}`);
    }
  }
  return lines.join('\n');
}

export function PluginUrlInstall({
  url,
  scope = 'user',
  onComplete,
}: Props): React.ReactNode {
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (!url) {
        onComplete(
          getLocalizedText({
            en: `${figures.cross} Usage: /plugin install --url <https-zip-url> [--scope user|project|local]`,
            zh: `${figures.cross} 用法: /plugin install --url <https-zip-url> [--scope user|project|local]`,
          }),
        );
        return;
      }
      if (scope !== 'user' && scope !== 'project' && scope !== 'local') {
        onComplete(
          getLocalizedText({
            en: `${figures.cross} Invalid scope: ${scope}. Use user, project, or local.`,
            zh: `${figures.cross} 无效 scope: ${scope}。请使用 user、project 或 local。`,
          }),
        );
        return;
      }
      try {
        const result = await installPluginFromUrlOp({ url, scope });
        if (cancelled) return;
        onComplete(formatSuccess(result));
      } catch (error) {
        if (cancelled) return;
        logError(error);
        onComplete(
          getLocalizedText({
            en: `${figures.cross} /plugin install --url failed: ${errorMessage(error)}`,
            zh: `${figures.cross} /plugin install --url 失败: ${errorMessage(error)}`,
          }),
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [onComplete, scope, url]);

  return (
    <Box>
      <Text dimColor>
        {getLocalizedText({
          en: 'Installing plugin from URL…',
          zh: '正在从 URL 安装插件…',
        })}
      </Text>
    </Box>
  );
}
