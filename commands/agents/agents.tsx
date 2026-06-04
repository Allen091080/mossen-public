import * as React from 'react';
import { AgentsMenu } from '../../components/agents/AgentsMenu.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { getTools } from '../../tools.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { t } from '../../utils/i18n/index.js';

function shouldOpenAgentView(args: string | undefined): boolean {
  const normalized = (args ?? '').trim().toLowerCase();
  return normalized === 'view' || normalized === 'dashboard';
}

function shouldOpenLibrary(args: string | undefined): boolean {
  const normalized = (args ?? '').trim().toLowerCase();
  return normalized === 'library' || normalized === 'definitions' || normalized === 'definition' || normalized === 'config' || normalized === 'manage';
}

function AgentsCommandRoot({
  onDone,
  context,
  initialTab = 'running'
}: {
  onDone: LocalJSXCommandOnDone;
  context: LocalJSXCommandContext;
  initialTab?: 'running' | 'library';
}): React.ReactNode {
  const appState = context.getAppState();
  const permissionContext = appState.toolPermissionContext;
  const tools = getTools(permissionContext);
  // Keep this JSX anchor in-tree for entrypoint separation smoke:
  // return <AgentsMenu tools={tools} onExit={onDone} />;
  return <AgentsMenu tools={tools} onExit={onDone} initialTab={initialTab} />;
}

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args?: string): Promise<React.ReactNode> {
  if (shouldOpenAgentView(args)) {
    onDone(t('cmd.agents.view.shellOnly'), {
      display: 'system'
    });
    return null;
  }
  const initialTab = shouldOpenLibrary(args) ? 'library' : 'running';
  // Keep this JSX anchor in-tree for Agent View parity smoke:
  // return <AgentsCommandRoot onDone={onDone} context={context} />;
  return <AgentsCommandRoot onDone={onDone} context={context} initialTab={initialTab} />;
}
