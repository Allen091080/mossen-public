import capitalize from 'lodash-es/capitalize.js'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { getSettingSourceName } from 'src/utils/settings/constants.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

export function getAgentSourceDisplayName(
  source: SettingSource | 'all' | 'built-in' | 'plugin',
): string {
  if (source === 'all') {
    return getLocalizedText({ en: 'Agents', zh: '代理' })
  }
  if (source === 'built-in') {
    return getLocalizedText({ en: 'Built-in agents', zh: '内置代理' })
  }
  if (source === 'plugin') {
    return getLocalizedText({ en: 'Plugin agents', zh: '插件代理' })
  }
  return capitalize(getSettingSourceName(source))
}
