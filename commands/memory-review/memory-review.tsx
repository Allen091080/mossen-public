// W432 — /memory-review implementation.
// W432c — Build a plain-text table and route through onDone(text,
// display:'system') instead of relying on JSX render after onDone, which
// the local-jsx flow tears down immediately (screens/REPL.tsx:3251-3268).
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import {
  projectIdFromCwd,
  type UserMemorySummary,
} from '../../memory-sidecar/src/index.js'
import {
  humanAge,
  listStaleArchiveEntries,
} from '../../services/memorySidecar/staleReview.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { t } from '../../utils/i18n/index.js'

type Status =
  | { kind: 'pending' }
  | { kind: 'empty' }
  | { kind: 'success' }
  | { kind: 'disabled' }
  | { kind: 'failed'; reason: string }

const PREVIEW_MAX = 60
const ID_MAX = 28

function shortPreview(value: string | undefined): string {
  if (!value) return ''
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length <= PREVIEW_MAX
    ? trimmed
    : `${trimmed.slice(0, PREVIEW_MAX - 1)}…`
}

function shortId(value: string): string {
  return value.length <= ID_MAX ? value : `${value.slice(0, ID_MAX - 1)}…`
}

// W432c — plain-text table builder for onDone(text, display:'system').
// Loses ANSI color but the local-jsx flow can't keep JSX rendered after
// onDone returns.
export function formatReviewTable(
  entries: UserMemorySummary[],
  totalCount: number,
  generatedAt: string,
): string {
  const now = new Date(generatedAt)
  const heading = t('cmd.memory-review.heading', {
    count: String(entries.length),
  })
  const lines: string[] = [
    heading,
    `scanned ${totalCount} entries · generated ${generatedAt}`,
    '',
  ]
  entries.forEach((entry, idx) => {
    const ageLabel = `[${humanAge(entry.createdAt, now)}]`
    const idLabel = shortId(entry.id)
    const preview = shortPreview(entry.title)
    lines.push(
      `${String(idx + 1).padStart(2, ' ')}. ${ageLabel} ${idLabel}  ${preview}`,
    )
  })
  lines.push('')
  lines.push(t('cmd.memory-review.footer'))
  return lines.join('\n')
}

function ReviewView({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: 'skip' | 'system' | 'user' },
  ) => void
}) {
  const [status, setStatus] = useState<Status>({ kind: 'pending' })
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    void (async () => {
      try {
        const projectId = projectIdFromCwd(getCwd())
        const result = await listStaleArchiveEntries({ projectId })

        if (result.ok === true) {
          if (result.entries.length === 0) {
            setStatus({ kind: 'empty' })
            onDone(t('cmd.memory-review.empty'), { display: 'system' })
            return
          }
          const table = formatReviewTable(
            result.entries,
            result.totalCount,
            result.generatedAt,
          )
          setStatus({ kind: 'success' })
          onDone(table, { display: 'system' })
          return
        }

        if (result.reason === 'sidecar_disabled') {
          setStatus({ kind: 'disabled' })
          onDone(t('cmd.memory-review.disabled'), { display: 'system' })
          return
        }

        const reason = result.detail ?? result.reason
        setStatus({ kind: 'failed', reason })
        onDone(t('cmd.memory-review.failed', { reason }), { display: 'system' })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logForDebugging(`[memory-review] unexpected: ${reason}`, {
          level: 'error',
        })
        setStatus({ kind: 'failed', reason })
        onDone(t('cmd.memory-review.failed', { reason }), { display: 'system' })
      }
    })()
  }, [onDone])

  // Transient feedback only — onDone is called for every branch, which
  // tears down this component via setToolJSX(null). The notification
  // string is the user-visible payload.
  if (status.kind === 'pending') {
    return (
      <Box>
        <Text dimColor>{t('cmd.memory-review.pending')}</Text>
      </Box>
    )
  }
  return null
}

export const call: LocalJSXCommandCall = async (onDone) => {
  return <ReviewView onDone={onDone} />
}
