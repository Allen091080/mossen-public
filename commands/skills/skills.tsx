import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { SkillsMenu } from '../../components/skills/SkillsMenu.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { GitHubSkillInstall } from './GitHubSkillInstall.js';
import { parseSkillsArgs } from './parseArgs.js';
import { SkillsDoctor } from './SkillsDoctor.js';

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args?: string): Promise<React.ReactNode> {
  const parsed = parseSkillsArgs(args);
  if (parsed.type === 'install') {
    return <GitHubSkillInstall onComplete={onDone} target={parsed.target} confirmToken={parsed.confirmToken} />;
  }
  if (parsed.type === 'help') {
    onDone('Usage:\n  /skills\n  /skills doctor\n  /skills install <github-url>\n  /skills install --confirm <token>');
    return null;
  }
  if (parsed.type === 'doctor') {
    return <SkillsDoctor onComplete={onDone} commands={context.options.commands} />;
  }
  return <SkillsMenu onExit={onDone} commands={context.options.commands} />;
}
