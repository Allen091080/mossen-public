import { performHeapDump } from '../../utils/heapDumpService.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

export async function call(): Promise<{ type: 'text'; value: string }> {
  const result = await performHeapDump()

  if (!result.success) {
    return {
      type: 'text',
      value: getLocalizedText({
        en: `Failed to create heap dump: ${result.error}`,
        zh: `创建 heap dump 失败：${result.error}`,
      }),
    }
  }

  return {
    type: 'text',
    value: `${result.heapPath}\n${result.diagPath}`,
  }
}
