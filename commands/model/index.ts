/**
 * /model — 多 profile 列表 + 会话级切换 (S1-09f).
 *
 * 旧路径 (sonnet/opus 静态 React picker) 已删: 违反 D-S09-1 schema (要求统一走
 * mossen.profiles facade). 新路径走 type='local' 文本输出, 简单 + 可测.
 *
 * 用法:
 *   /model                — 列出 profiles, 标 session active vs global default
 *   /model <profileName>  — 切换"当前会话" profile (session-only, 不改全局默认)
 *
 * Legacy process-level profile flags remain supported, but slash usage is preferred.
 */
import type { Command } from '../../commands.js'
import { t } from '../../utils/i18n/index.js'

const model = {
  type: 'local',
  name: 'model',
  description: t('cmd.model.description'),
  argumentHint: '[profileName|add|update|test|models|use|examples|env|doctor|remove|default]',
  supportsNonInteractive: false,
  load: () => import('./model.js'),
} satisfies Command

export default model
