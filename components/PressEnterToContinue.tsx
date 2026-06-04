import * as React from 'react'
import { Text } from '../ink.js'
import { getLocalizedText } from '../utils/uiLanguage.js'

export function PressEnterToContinue() {
  return (
    <Text color="permission">
      {getLocalizedText({ en: 'Press ', zh: '按 ' })}
      <Text bold={true}>Enter</Text>
      {getLocalizedText({ en: ' to continue…', zh: ' 继续…' })}
    </Text>
  )
}
