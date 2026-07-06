import type { Command } from '../../commands.js'

const loop = {
  type: 'local-jsx',
  name: 'loop',
  description:
    'Show a unified loop board for goal, workflows, agents, artifacts, and provider gates',
  argumentHint: '[status] [--json]',
  load: () => import('./loop.js'),
} satisfies Command

export default loop
