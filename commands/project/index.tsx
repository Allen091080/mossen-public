import type { Command } from '../../commands.js';
import { t } from '../../utils/i18n/index.js';

const project = {
  type: 'local-jsx',
  name: 'project',
  aliases: [],
  description: t('cmd.project.description'),
  immediate: true,
  load: () => import('./project.js'),
} satisfies Command;

export default project;
