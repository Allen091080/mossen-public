import { feature } from 'bun:bundle';
import { spawnSync } from 'child_process';
import sample from 'lodash-es/sample.js';
import * as React from 'react';
import { ExitFlow } from '../../components/ExitFlow.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { isBgSession } from '../../utils/concurrentSessions.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { t } from '../../utils/i18n/index.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';
function getRandomGoodbyeMessage(): string {
  return sample([
    t('ui.exit.goodbye1'),
    t('ui.exit.goodbye2'),
    t('ui.exit.goodbye3'),
    t('ui.exit.goodbye4'),
  ]) ?? t('ui.exit.goodbye1');
}
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  // Inside a `mossen --bg` tmux session: detach instead of kill. The REPL
  // keeps running; `mossen attach` can reconnect. Covers /exit, /quit,
  // ctrl+c, ctrl+d — all funnel through here via REPL's handleExit.
  if (feature('BG_SESSIONS') && isBgSession()) {
    onDone();
    spawnSync('tmux', ['detach-client'], {
      stdio: 'ignore'
    });
    return null;
  }
  const showWorktree = getCurrentWorktreeSession() !== null;
  if (showWorktree) {
    return <ExitFlow showWorktree={showWorktree} onDone={onDone} onCancel={() => onDone()} />;
  }
  onDone(getRandomGoodbyeMessage());
  await gracefulShutdown(0, 'prompt_input_exit');
  return null;
}
