import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { FILE_READ_TOOL_NAME } from '../tools/FileReadTool/prompt.js'
import { GREP_TOOL_NAME } from '../tools/GrepTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '../tools/WebFetchTool/prompt.js'
import type { ContextData } from './analyzeContext.js'
import { getDisplayPath } from './file.js'
import { formatTokens } from './format.js'
import { getLocalizedText } from './uiLanguage.js'

// --

export type SuggestionSeverity = 'info' | 'warning'

export type ContextSuggestion = {
  severity: SuggestionSeverity
  title: string
  detail: string
  /** Estimated tokens that could be saved */
  savingsTokens?: number
}

// Thresholds for triggering suggestions
const LARGE_TOOL_RESULT_PERCENT = 15 // tool results > 15% of context
const LARGE_TOOL_RESULT_TOKENS = 10_000
const READ_BLOAT_PERCENT = 5 // Read results > 5% of context
const NEAR_CAPACITY_PERCENT = 80
const MEMORY_HIGH_PERCENT = 5
const MEMORY_HIGH_TOKENS = 5_000

// --

export function generateContextSuggestions(
  data: ContextData,
): ContextSuggestion[] {
  const suggestions: ContextSuggestion[] = []

  checkNearCapacity(data, suggestions)
  checkLargeToolResults(data, suggestions)
  checkReadResultBloat(data, suggestions)
  checkMemoryBloat(data, suggestions)
  checkAutoCompactDisabled(data, suggestions)

  // Sort: warnings first, then by savings descending
  suggestions.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'warning' ? -1 : 1
    }
    return (b.savingsTokens ?? 0) - (a.savingsTokens ?? 0)
  })

  return suggestions
}

// --

function checkNearCapacity(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  if (data.percentage >= NEAR_CAPACITY_PERCENT) {
    suggestions.push({
      severity: 'warning',
      title: getLocalizedText({
        en: `Context is ${data.percentage}% full`,
        zh: `上下文已使用 ${data.percentage}%`,
      }),
      detail: data.isAutoCompactEnabled
        ? getLocalizedText({
            en: 'Autocompact will trigger soon, which discards older messages. Use /compact now to control what gets kept.',
            zh: '自动压缩即将触发，这会丢弃较早的消息。现在使用 /compact 可以控制要保留的内容。',
          })
        : getLocalizedText({
            en: 'Autocompact is disabled. Use /compact to free space, or enable autocompact in /config.',
            zh: '自动压缩当前已关闭。可使用 /compact 释放空间，或在 /config 中开启自动压缩。',
          }),
    })
  }
}

function checkLargeToolResults(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  if (!data.messageBreakdown) return

  for (const tool of data.messageBreakdown.toolCallsByType) {
    const totalToolTokens = tool.callTokens + tool.resultTokens
    const percent = (totalToolTokens / data.rawMaxTokens) * 100

    if (
      percent < LARGE_TOOL_RESULT_PERCENT ||
      totalToolTokens < LARGE_TOOL_RESULT_TOKENS
    ) {
      continue
    }

    const suggestion = getLargeToolSuggestion(
      tool.name,
      totalToolTokens,
      percent,
    )
    if (suggestion) {
      suggestions.push(suggestion)
    }
  }
}

function getLargeToolSuggestion(
  toolName: string,
  tokens: number,
  percent: number,
): ContextSuggestion | null {
  const tokenStr = formatTokens(tokens)

  switch (toolName) {
    case BASH_TOOL_NAME:
      return {
        severity: 'warning',
        title: getLocalizedText({
          en: `Bash results using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
          zh: `Bash 结果占用 ${tokenStr} token（${percent.toFixed(0)}%）`,
        }),
        detail: getLocalizedText({
          en: 'Pipe output through head, tail, or grep to reduce result size. Avoid cat on large files — use Read with offset/limit instead.',
          zh: '可通过 head、tail 或 grep 缩小输出结果。不要对大文件直接用 cat，改用带 offset/limit 的 Read。',
        }),
        savingsTokens: Math.floor(tokens * 0.5),
      }
    case FILE_READ_TOOL_NAME:
      return {
        severity: 'info',
        title: getLocalizedText({
          en: `Read results using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
          zh: `Read 结果占用 ${tokenStr} token（${percent.toFixed(0)}%）`,
        }),
        detail: getLocalizedText({
          en: 'Use offset and limit parameters to read only the sections you need. Avoid re-reading entire files when you only need a few lines.',
          zh: '使用 offset 和 limit 只读取需要的片段。只需几行内容时，避免重复读取整个文件。',
        }),
        savingsTokens: Math.floor(tokens * 0.3),
      }
    case GREP_TOOL_NAME:
      return {
        severity: 'info',
        title: getLocalizedText({
          en: `Grep results using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
          zh: `Grep 结果占用 ${tokenStr} token（${percent.toFixed(0)}%）`,
        }),
        detail: getLocalizedText({
          en: 'Add more specific patterns or use the glob or type parameter to narrow file types. Consider Glob for file discovery instead of Grep.',
          zh: '可使用更具体的匹配模式，或通过 glob/type 限定文件类型。只做文件发现时，优先考虑用 Glob 而不是 Grep。',
        }),
        savingsTokens: Math.floor(tokens * 0.3),
      }
    case WEB_FETCH_TOOL_NAME:
      return {
        severity: 'info',
        title: getLocalizedText({
          en: `WebFetch results using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
          zh: `WebFetch 结果占用 ${tokenStr} token（${percent.toFixed(0)}%）`,
        }),
        detail: getLocalizedText({
          en: 'Web page content can be very large. Consider extracting only the specific information needed.',
          zh: '网页内容可能非常大，建议只提取当前需要的关键信息。',
        }),
        savingsTokens: Math.floor(tokens * 0.4),
      }
    default:
      if (percent >= 20) {
        return {
          severity: 'info',
          title: getLocalizedText({
            en: `${toolName} using ${tokenStr} tokens (${percent.toFixed(0)}%)`,
            zh: `${toolName} 占用 ${tokenStr} token（${percent.toFixed(0)}%）`,
          }),
          detail: getLocalizedText({
            en: 'This tool is consuming a significant portion of context.',
            zh: '这个工具当前占用了较大比例的上下文。',
          }),
          savingsTokens: Math.floor(tokens * 0.2),
        }
      }
      return null
  }
}

function checkReadResultBloat(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  if (!data.messageBreakdown) return

  const callsByType = data.messageBreakdown.toolCallsByType
  const readTool = callsByType.find(t => t.name === FILE_READ_TOOL_NAME)
  if (!readTool) return

  const totalReadTokens = readTool.callTokens + readTool.resultTokens
  const totalReadPercent = (totalReadTokens / data.rawMaxTokens) * 100
  const readPercent = (readTool.resultTokens / data.rawMaxTokens) * 100

  // Skip if already covered by checkLargeToolResults (>= 15% band)
  if (
    totalReadPercent >= LARGE_TOOL_RESULT_PERCENT &&
    totalReadTokens >= LARGE_TOOL_RESULT_TOKENS
  ) {
    return
  }

  if (
    readPercent >= READ_BLOAT_PERCENT &&
    readTool.resultTokens >= LARGE_TOOL_RESULT_TOKENS
  ) {
    suggestions.push({
      severity: 'info',
      title: getLocalizedText({
        en: `File reads using ${formatTokens(readTool.resultTokens)} tokens (${readPercent.toFixed(0)}%)`,
        zh: `文件读取占用 ${formatTokens(readTool.resultTokens)} token（${readPercent.toFixed(0)}%）`,
      }),
      detail: getLocalizedText({
        en: 'If you are re-reading files, consider referencing earlier reads. Use offset/limit for large files.',
        zh: '如果你在重复读取文件，建议复用之前的读取结果。大文件请配合 offset/limit 使用。',
      }),
      savingsTokens: Math.floor(readTool.resultTokens * 0.3),
    })
  }
}

function checkMemoryBloat(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  const totalMemoryTokens = data.memoryFiles.reduce(
    (sum, f) => sum + f.tokens,
    0,
  )
  const memoryPercent = (totalMemoryTokens / data.rawMaxTokens) * 100

  if (
    memoryPercent >= MEMORY_HIGH_PERCENT &&
    totalMemoryTokens >= MEMORY_HIGH_TOKENS
  ) {
    const largestFiles = [...data.memoryFiles]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 3)
      .map(f => {
        const name = getDisplayPath(f.path)
        return `${name} (${formatTokens(f.tokens)})`
      })
      .join(', ')

    suggestions.push({
      severity: 'info',
      title: getLocalizedText({
        en: `Memory files using ${formatTokens(totalMemoryTokens)} tokens (${memoryPercent.toFixed(0)}%)`,
        zh: `记忆文件占用 ${formatTokens(totalMemoryTokens)} token（${memoryPercent.toFixed(0)}%）`,
      }),
      detail: getLocalizedText({
        en: `Largest: ${largestFiles}. Use /memory to review and prune stale entries.`,
        zh: `最大项：${largestFiles}。使用 /memory 查看并清理过期条目。`,
      }),
      savingsTokens: Math.floor(totalMemoryTokens * 0.3),
    })
  }
}

function checkAutoCompactDisabled(
  data: ContextData,
  suggestions: ContextSuggestion[],
): void {
  if (
    !data.isAutoCompactEnabled &&
    data.percentage >= 50 &&
    data.percentage < NEAR_CAPACITY_PERCENT
  ) {
    suggestions.push({
      severity: 'info',
      title: getLocalizedText({
        en: 'Autocompact is disabled',
        zh: '自动压缩已关闭',
      }),
      detail: getLocalizedText({
        en: 'Without autocompact, you will hit context limits and lose the conversation. Enable it in /config or use /compact manually.',
        zh: '如果不开启自动压缩，你会更快触达上下文上限并丢失对话上下文。可在 /config 中启用，或手动使用 /compact。',
      }),
    })
  }
}
