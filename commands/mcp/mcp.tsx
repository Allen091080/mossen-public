import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useRef } from 'react';
import { MCPSettings } from '../../components/mcp/index.js';
import { MCPReconnect } from '../../components/mcp/MCPReconnect.js';
import { useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { PluginSettings } from '../plugin/PluginSettings.js';
import { McpAdd } from './McpAdd.js';
import { McpAddTemplate } from './McpAddTemplate.js';
import { McpDoctor } from './McpDoctor.js';
import { McpInstall } from './McpInstall.js';
import { McpStatus } from './McpStatus.js';
import { McpTemplates } from './McpTemplates.js';
import { McpUsage } from './McpUsage.js';
import { parseMcpAddArgs } from './parseAddArgs.js';
import { parseMcpInstallArgs } from './parseInstallArgs.js';
import { parseMcpAddTemplateArgs } from './parseTemplateArgs.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';

// TODO: This is a hack to get the context value from toggleMcpServer (useContext only works in a component)
// Ideally, all MCP state and functions would be in global state.
function MCPToggle(t0) {
  const $ = _c(7);
  const {
    action,
    target,
    onComplete
  } = t0;
  const mcpClients = useAppState(_temp);
  const toggleMcpServer = useMcpToggleEnabled();
  const didRun = useRef(false);
  let t1;
  let t2;
  if ($[0] !== action || $[1] !== mcpClients || $[2] !== onComplete || $[3] !== target || $[4] !== toggleMcpServer) {
    t1 = () => {
      if (didRun.current) {
        return;
      }
      didRun.current = true;
      const isEnabling = action === "enable";
      const clients = mcpClients.filter(_temp2);
      const toToggle = target === "all" ? clients.filter(c_0 => isEnabling ? c_0.type === "disabled" : c_0.type !== "disabled") : clients.filter(c_1 => c_1.name === target);
      if (toToggle.length === 0) {
        onComplete(target === "all" ? getLocalizedText({
          en: `All MCP servers are already ${isEnabling ? "enabled" : "disabled"}`,
          zh: `所有 MCP server 已经是${isEnabling ? "启用" : "禁用"}状态`
        }) : getLocalizedText({
          en: `MCP server "${target}" not found`,
          zh: `未找到 MCP server "${target}"`
        }));
        return;
      }
      for (const s_0 of toToggle) {
        toggleMcpServer(s_0.name);
      }
      onComplete(target === "all" ? getLocalizedText({
        en: `${isEnabling ? "Enabled" : "Disabled"} ${toToggle.length} MCP server(s)`,
        zh: `已${isEnabling ? "启用" : "禁用"} ${toToggle.length} 个 MCP server`
      }) : getLocalizedText({
        en: `MCP server "${target}" ${isEnabling ? "enabled" : "disabled"}`,
        zh: `MCP server "${target}" 已${isEnabling ? "启用" : "禁用"}`
      }));
    };
    t2 = [action, target, mcpClients, toggleMcpServer, onComplete];
    $[0] = action;
    $[1] = mcpClients;
    $[2] = onComplete;
    $[3] = target;
    $[4] = toggleMcpServer;
    $[5] = t1;
    $[6] = t2;
  } else {
    t1 = $[5];
    t2 = $[6];
  }
  useEffect(t1, t2);
  return null;
}
function _temp2(c) {
  return c.name !== "ide";
}
function _temp(s) {
  return s.mcp.clients;
}
export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  if (args) {
    const parts = args.trim().split(/\s+/);

    // Allow /mcp no-redirect to bypass the redirect for testing
    if (parts[0] === 'no-redirect') {
      return <MCPSettings onComplete={onDone} />;
    }
    if (parts[0] === 'reconnect' && parts[1]) {
      return <MCPReconnect serverName={parts.slice(1).join(' ')} onComplete={onDone} />;
    }
    if (parts[0] === 'templates' || parts[0] === 'template') {
      return <McpTemplates onComplete={onDone} />;
    }
    if (parts[0] === 'status' || parts[0] === 'stat') {
      return <McpStatus onComplete={onDone} />;
    }
    if (parts[0] === 'doctor' || parts[0] === 'diag' || parts[0] === 'diagnose') {
      return <McpDoctor onComplete={onDone} />;
    }
    if (parts[0] === 'usage' || parts[0] === 'use') {
      return <McpUsage onComplete={onDone} serverName={parts.slice(1).join(' ')} />;
    }
    if (parts[0] === 'add') {
      return <McpAdd onComplete={onDone} {...parseMcpAddArgs(parts.slice(1))} />;
    }
    if (parts[0] === 'add-template') {
      return <McpAddTemplate onComplete={onDone} {...parseMcpAddTemplateArgs(parts.slice(1))} />;
    }
    if (parts[0] === 'install') {
      return <McpInstall onComplete={onDone} {...parseMcpInstallArgs(parts.slice(1))} />;
    }
    if (parts[0] === 'enable' || parts[0] === 'disable') {
      return <MCPToggle action={parts[0]} target={parts.length > 1 ? parts.slice(1).join(' ') : 'all'} onComplete={onDone} />;
    }
  }

  // Redirect base /mcp command to /plugins installed tab for internal users
  if (("external" as string) === 'internal') {
    return <PluginSettings onComplete={onDone} args="manage" showMcpRedirectMessage />;
  }
  return <MCPSettings onComplete={onDone} />;
}
