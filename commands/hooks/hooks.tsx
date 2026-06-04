import * as React from 'react';
import { HooksConfigMenu } from '../../components/hooks/HooksConfigMenu.js';
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js';
import { getTools } from '../../tools.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
export const call: LocalJSXCommandCall = async (onDone, context) => {
  logMossenEvent('mossen.hooks.commandOpened', {});
  const appState = context.getAppState();
  const permissionContext = appState.toolPermissionContext;
  const toolNames = getTools(permissionContext).map(tool => tool.name);
  return <HooksConfigMenu toolNames={toolNames} onExit={onDone} />;
};
