/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '../../ink.js';
import { errorMessage } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { validateManifest } from '../../utils/plugins/validatePlugin.js';
import { plural } from '../../utils/stringUtils.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
type Props = {
  onComplete: (result?: string) => void;
  path?: string;
};

function getValidatePluginUsageText(): string {
  return getLocalizedText({
    en: "Usage: /plugin validate <path>\n\nValidate a plugin or marketplace manifest file or directory.\n\nExamples:\n  /plugin validate .mossen-plugin/plugin.json\n  /plugin validate /path/to/plugin-directory\n  /plugin validate .\n\nWhen given a directory, automatically validates .mossen-plugin/marketplace.json\nor .mossen-plugin/plugin.json (prefers marketplace if both exist).\n\nOr from the command line:\n  mossen plugin validate <path>",
    zh: "用法：/plugin validate <path>\n\n校验插件或插件市场的 manifest 文件或目录。\n\n示例：\n  /plugin validate .mossen-plugin/plugin.json\n  /plugin validate /path/to/plugin-directory\n  /plugin validate .\n\n当参数是目录时，会自动校验 .mossen-plugin/marketplace.json\n或 .mossen-plugin/plugin.json（若两者都存在，优先插件市场）。\n\n也可在命令行中运行：\n  mossen plugin validate <path>"
  });
}
export function ValidatePlugin(t0) {
  const $ = _c(5);
  const {
    onComplete,
    path
  } = t0;
  let t1;
  let t2;
  if ($[0] !== onComplete || $[1] !== path) {
    t1 = () => {
      const runValidation = async function runValidation() {
        if (!path) {
          onComplete(getValidatePluginUsageText());
          return;
        }
        ;
        try {
          const result = await validateManifest(path);
          let output = "";
          output = output + `${getLocalizedText({
          en: 'Validating',
          zh: '正在校验'
        })} ${result.fileType} manifest: ${result.filePath}\n\n`;
          output;
          if (result.errors.length > 0) {
            output = output + `${figures.cross} ${getLocalizedText({
            en: `Found ${result.errors.length} ${plural(result.errors.length, "error")}:`,
            zh: `发现 ${result.errors.length} 项错误：`
          })}\n\n`;
            output;
            result.errors.forEach(error_0 => {
              output = output + `  ${figures.pointer} ${error_0.path}: ${error_0.message}\n`;
              output;
            });
            output = output + "\n";
            output;
          }
          if (result.warnings.length > 0) {
            output = output + `${figures.warning} ${getLocalizedText({
            en: `Found ${result.warnings.length} ${plural(result.warnings.length, "warning")}:`,
            zh: `发现 ${result.warnings.length} 项警告：`
          })}\n\n`;
            output;
            result.warnings.forEach(warning => {
              output = output + `  ${figures.pointer} ${warning.path}: ${warning.message}\n`;
              output;
            });
            output = output + "\n";
            output;
          }
          if (result.success) {
            if (result.warnings.length > 0) {
              output = output + `${figures.tick} ${getLocalizedText({
              en: 'Validation passed with warnings',
              zh: '校验通过，但存在警告'
            })}\n`;
              output;
            } else {
              output = output + `${figures.tick} ${getLocalizedText({
              en: 'Validation passed',
              zh: '校验通过'
            })}\n`;
              output;
            }
            process.exitCode = 0;
          } else {
            output = output + `${figures.cross} ${getLocalizedText({
            en: 'Validation failed',
            zh: '校验失败'
          })}\n`;
            output;
            process.exitCode = 1;
          }
          onComplete(output);
        } catch (t3) {
          const error = t3;
          process.exitCode = 2;
          logError(error);
          onComplete(`${figures.cross} ${getLocalizedText({
          en: 'Unexpected error during validation:',
          zh: '校验时发生意外错误：'
        })} ${errorMessage(error)}`);
        }
      };
      runValidation();
    };
    t2 = [onComplete, path];
    $[0] = onComplete;
    $[1] = path;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box flexDirection="column"><Text>{getLocalizedText({
      en: 'Running validation...',
      zh: '正在运行校验...'
    })}</Text></Box>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
