import * as React from 'react';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { parsePluginArgs } from './parseArgs.js';
import { PluginInstallPlan } from './PluginInstallPlan.js';
import { PluginPaths } from './PluginPaths.js';
import { PluginPrune } from './PluginPrune.js';
import { PluginUrlInstall } from './PluginUrlInstall.js';
import { PluginMarketplaceAddPlan } from './PluginMarketplaceAddPlan.js';
import { PluginDoctor } from './PluginDoctor.js';
import { PluginSettings } from './PluginSettings.js';
import { PluginSources } from './PluginSources.js';
import { PluginStatus } from './PluginStatus.js';
export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  // The plugin command is a thin router: parse the subcommand once at
  // entry so /plugin prune and /plugin status (stand-alone, non-tabbed
  // flows) bypass the tabbed PluginSettings shell. All other subcommands
  // continue to land in PluginSettings, which has its own
  // getInitialViewState dispatch.
  const parsed = parsePluginArgs(args);
  if (parsed.type === 'prune') {
    return <PluginPrune onComplete={onDone} confirmToken={parsed.confirmToken} />;
  }
  if (parsed.type === 'install-plan') {
    return <PluginInstallPlan onComplete={onDone} plugin={parsed.plugin} scope={parsed.scope} confirmToken={parsed.confirmToken} />;
  }
  if (parsed.type === 'install-url') {
    return <PluginUrlInstall onComplete={onDone} url={parsed.url} scope={parsed.scope} />;
  }
  if (parsed.type === 'status') {
    return <PluginStatus onComplete={onDone} />;
  }
  if (parsed.type === 'doctor') {
    return <PluginDoctor onComplete={onDone} />;
  }
  if (parsed.type === 'sources') {
    return <PluginSources onComplete={onDone} />;
  }
  if (parsed.type === 'paths') {
    return <PluginPaths onComplete={onDone} />;
  }
  if (parsed.type === 'marketplace-add-plan') {
    return <PluginMarketplaceAddPlan onComplete={onDone} target={parsed.target} confirmToken={parsed.confirmToken} />;
  }
  return <PluginSettings onComplete={onDone} args={args} />;
}
