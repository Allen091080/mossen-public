import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Link, Text } from '../ink.js';
import { getHostedPlatformUrls } from '../utils/customBackend.js';
import { getLocalizedText } from '../utils/uiLanguage.js';
function getMcpDocsUrl() {
  return `${getHostedPlatformUrls().remoteBaseUrl}/docs/mcp`;
}
export function MCPServerDialogCopy() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Text>{getLocalizedText({
      en: 'MCP servers may execute code or access system resources. All tool calls require approval. Learn more in the',
      zh: 'MCP 服务器可能会执行代码或访问系统资源。所有工具调用都需要审批。更多信息请参阅'
    })}{" "}<Link url={getMcpDocsUrl()}>{getLocalizedText({
      en: 'MCP documentation',
      zh: 'MCP 文档'
    })}</Link>.</Text>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
