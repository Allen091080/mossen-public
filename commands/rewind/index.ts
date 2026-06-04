import type { Command } from '../../commands.js'

const rewind = {
  description: `Restore the code and/or conversation to a previous point`,
  name: 'rewind',
  aliases: ['checkpoint'],
  argumentHint: '[summarize --dry-run|--confirm <8hex>]',
  type: 'local',
  supportsNonInteractive: false,
  load: () => import('./rewind.js'),
} satisfies Command

export default rewind
