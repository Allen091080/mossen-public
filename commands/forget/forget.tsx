// W419b — /forget <id-prefix> implementation.
//
// Three branches by match count after listUserMemory + prefix-filter:
//   0       -> "no match"
//   1       -> tombstoneArchiveEvent + report removed id
//   2..MAX  -> list candidates, ask for longer prefix
//   > MAX   -> error "too many; narrow prefix"
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import {
  projectIdFromCwd,
  type UserMemorySummary,
} from '../../memory-sidecar/src/index.js'
import { findArchiveEventByPrefix } from '../../services/memorySidecar/forgetMemory.js'
import { tombstoneArchiveEvent } from '../../services/memorySidecar/tombstone.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { t } from '../../utils/i18n/index.js'

const MIN_PREFIX_LENGTH = 4
const MAX_CANDIDATES = 8
const ID_DISPLAY_MAX = 32
const TITLE_DISPLAY_MAX = 50

// W432c — plain-text candidate list for onDone(text, display:'system').
// Local-jsx flow tears down rendered JSX on onDone; only the result string
// reaches the user via notification + transcript.
export function formatCandidateList(matches: UserMemorySummary[]): string {
  const header = t('cmd.forget.multipleMatches', {
    count: String(matches.length),
  })
  const lines: string[] = [header]
  for (const entry of matches) {
    const id = truncate(entry.id, ID_DISPLAY_MAX)
    const title = truncate(entry.title, TITLE_DISPLAY_MAX)
    lines.push(`  ${id}  ${title}`)
  }
  return lines.join('\n')
}

type Status =
  | { kind: 'pending' }
  | { kind: 'usage' }
  | { kind: 'tooShort' }
  | { kind: 'noMatch'; prefix: string }
  | { kind: 'multiple'; matches: UserMemorySummary[] }
  | { kind: 'tooMany'; count: number }
  | { kind: 'success'; id: string; title: string }
  | { kind: 'disabled' }
  | { kind: 'failed'; reason: string }

function truncate(value: string | undefined, max: number): string {
  if (!value) return ''
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

function ForgetView({
  args,
  onDone,
}: {
  args: string
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

    const prefix = args.trim()
    if (!prefix) {
      setStatus({ kind: 'usage' })
      onDone(t('cmd.forget.usage'), { display: 'system' })
      return
    }
    if (prefix.length < MIN_PREFIX_LENGTH) {
      setStatus({ kind: 'tooShort' })
      onDone(t('cmd.forget.tooShort'), { display: 'system' })
      return
    }

    void (async () => {
      try {
        const projectId = projectIdFromCwd(getCwd())
        const lookup = await findArchiveEventByPrefix({ projectId, prefix })

        if (lookup.ok === false) {
          if (lookup.reason === 'sidecar_disabled') {
            setStatus({ kind: 'disabled' })
            onDone(t('cmd.forget.disabled'), { display: 'system' })
            return
          }
          const reason = lookup.detail ?? lookup.reason
          setStatus({ kind: 'failed', reason })
          onDone(t('cmd.forget.failed', { reason }), { display: 'system' })
          return
        }

        const matches = lookup.matches
        if (matches.length === 0) {
          setStatus({ kind: 'noMatch', prefix })
          onDone(t('cmd.forget.noMatch', { prefix }), { display: 'system' })
          return
        }
        if (matches.length > MAX_CANDIDATES) {
          setStatus({ kind: 'tooMany', count: matches.length })
          onDone(
            t('cmd.forget.tooManyMatches', { count: String(matches.length) }),
            { display: 'system' },
          )
          return
        }
        if (matches.length > 1) {
          // W432c — emit plain-text candidate list via onDone; local-jsx
          // tears down JSX on onDone so the rendered list never showed.
          setStatus({ kind: 'multiple', matches })
          onDone(formatCandidateList(matches), { display: 'system' })
          return
        }

        // Exactly one match — tombstone it.
        const target = matches[0]!
        const result = await tombstoneArchiveEvent({
          archiveEventId: target.id,
          projectId,
        })

        if (result.ok === true) {
          const display = truncate(target.id, ID_DISPLAY_MAX)
          const title = truncate(target.title, TITLE_DISPLAY_MAX)
          setStatus({ kind: 'success', id: display, title })
          onDone(t('cmd.forget.success', { id: display }), { display: 'system' })
          return
        }

        if (result.reason === 'sidecar_disabled') {
          setStatus({ kind: 'disabled' })
          onDone(t('cmd.forget.disabled'), { display: 'system' })
          return
        }

        const reason = result.detail ?? result.reason
        setStatus({ kind: 'failed', reason })
        onDone(t('cmd.forget.failed', { reason }), { display: 'system' })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logForDebugging(`[forget] unexpected: ${reason}`, { level: 'error' })
        setStatus({ kind: 'failed', reason })
        onDone(t('cmd.forget.failed', { reason }), { display: 'system' })
      }
    })()
  }, [args, onDone])

  if (status.kind === 'pending') {
    return (
      <Box>
        <Text dimColor>…</Text>
      </Box>
    )
  }
  if (status.kind === 'usage') {
    return (
      <Box>
        <Text color="warning">{t('cmd.forget.usage')}</Text>
      </Box>
    )
  }
  if (status.kind === 'tooShort') {
    return (
      <Box>
        <Text color="warning">{t('cmd.forget.tooShort')}</Text>
      </Box>
    )
  }
  if (status.kind === 'noMatch') {
    return (
      <Box>
        <Text color="warning">
          {t('cmd.forget.noMatch', { prefix: status.prefix })}
        </Text>
      </Box>
    )
  }
  if (status.kind === 'tooMany') {
    return (
      <Box>
        <Text color="warning">
          {t('cmd.forget.tooManyMatches', { count: String(status.count) })}
        </Text>
      </Box>
    )
  }
  if (status.kind === 'multiple') {
    return (
      <Box flexDirection="column">
        <Text bold>
          {t('cmd.forget.multipleMatches', {
            count: String(status.matches.length),
          })}
        </Text>
        <Box marginTop={1} flexDirection="column">
          {status.matches.map(entry => (
            <Text key={entry.id}>
              <Text dimColor>{truncate(entry.id, ID_DISPLAY_MAX)}</Text>{' '}
              <Text>{truncate(entry.title, TITLE_DISPLAY_MAX)}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  }
  if (status.kind === 'success') {
    return (
      <Box>
        <Text color="success">{t('cmd.forget.success', { id: status.id })}</Text>
      </Box>
    )
  }
  if (status.kind === 'disabled') {
    return (
      <Box>
        <Text color="warning">{t('cmd.forget.disabled')}</Text>
      </Box>
    )
  }
  return (
    <Box>
      <Text color="error">
        {t('cmd.forget.failed', { reason: status.reason })}
      </Text>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  return <ForgetView args={args} onDone={onDone} />
}
