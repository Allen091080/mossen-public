import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const command = {
  name: 'scroll-speed',
  aliases: ['scrollspeed'],
  description: t('cmd.scrollSpeed.description'),
  argumentHint: '<slow|normal|fast|0.1-20>',
  supportsNonInteractive: false,
  type: 'local',
  load: () => import('./scroll-speed.js'),
} satisfies Command

export default command
