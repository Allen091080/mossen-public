import * as React from 'react';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { parseProjectArgs } from './parseArgs.js';
import { ProjectList } from './ProjectList.js';
import { ProjectPurge } from './ProjectPurge.js';
import { ProjectStatus } from './ProjectStatus.js';

// /project is a thin router. Round 2 implements `purge`. W56 adds two
// read-only subcommands: `list` and `status`.
// `menu` / `help` / unknown subcommands fall through to a localized usage hint.
export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode> {
  const parsed = parseProjectArgs(args);

  if (parsed.type === 'purge') {
    return (
      <ProjectPurge
        onComplete={onDone}
        target={parsed.target}
        includeMemory={parsed.includeMemory}
        confirmToken={parsed.confirmToken}
      />
    );
  }

  if (parsed.type === 'list') {
    return <ProjectList onComplete={onDone} />;
  }

  if (parsed.type === 'status') {
    return <ProjectStatus onComplete={onDone} />;
  }

  if (parsed.type === 'unsupported_flag') {
    return (
      <ProjectPurge
        onComplete={onDone}
        target={undefined}
        includeMemory={false}
        confirmToken={undefined}
        unsupportedFlag={parsed.flag}
      />
    );
  }

  // help / menu — keep this short. Each subcommand explains itself.
  onDone(
    'Usage:\n' +
      '  /project list                 — read-only inventory of ~/.mossen/projects/.\n' +
      '  /project status               — read-only summary of the active project.\n' +
      '  /project purge [--target <cwd>] [--include-memory] [--confirm <token>]\n' +
      '                                — archive-only purge (active project rejected).\n' +
      '\n' +
      'Memory is preserved by default during purge. Use --include-memory only\n' +
      'when memory is inside the target project dir (external overrides are\n' +
      'rejected).',
  );
  return null;
}
