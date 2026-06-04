import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const resume: Command = {
  type: 'local-jsx',
  name: 'resume',
  description: t('cmd.resume.description'),
  aliases: ['continue'],
  argumentHint: t('cmd.resume.argumentHint'),
  load: () => import('./resume.js'),
}

export default resume
