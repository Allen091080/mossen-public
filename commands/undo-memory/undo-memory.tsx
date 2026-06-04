// W419 S3 — /undo implementation.
//
// Reads the latest "for-undo" pointer set by emitMemoryCaptured(), runs
// tombstoneArchiveEvent on it, and reports the outcome inline.
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import {
  clearLatestMemoryCaptureForUndo,
  getLatestMemoryCaptureForUndo,
} from '../../services/memorySidecar/captureEvents.js'
import { tombstoneArchiveEvent } from '../../services/memorySidecar/tombstone.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'
import { t } from '../../utils/i18n/index.js'

type Status =
  | { kind: 'pending' }
  | { kind: 'nothing' }
  | { kind: 'success'; id: string }
  | { kind: 'not_found' }
  | { kind: 'disabled' }
  | { kind: 'failed'; reason: string }

function shortId(id: string): string {
  // archive eventIds are 'evt_<long-hash>'; show first 10 chars + last 6.
  if (id.length <= 18) return id
  return `${id.slice(0, 10)}…${id.slice(-6)}`
}

function UndoView({
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
      const latest = getLatestMemoryCaptureForUndo()
      if (!latest || !latest.archiveEventId) {
        setStatus({ kind: 'nothing' })
        onDone(t('cmd.undo.nothing'), { display: 'system' })
        return
      }

      try {
        const result = await tombstoneArchiveEvent({
          archiveEventId: latest.archiveEventId,
          projectId: latest.projectId,
        })
        if (result.ok === true) {
          clearLatestMemoryCaptureForUndo()
          const display = shortId(result.archiveEventId)
          setStatus({ kind: 'success', id: display })
          onDone(t('cmd.undo.success', { id: display }), { display: 'system' })
        } else if (result.reason === 'not_found') {
          clearLatestMemoryCaptureForUndo()
          setStatus({ kind: 'not_found' })
          onDone(t('cmd.undo.notFound'), { display: 'system' })
        } else if (result.reason === 'sidecar_disabled') {
          setStatus({ kind: 'disabled' })
          onDone(t('cmd.undo.disabled'), { display: 'system' })
        } else {
          const reason = result.detail ?? result.reason
          setStatus({ kind: 'failed', reason })
          onDone(t('cmd.undo.failed', { reason }), { display: 'system' })
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logForDebugging(`[undo] unexpected: ${reason}`, { level: 'error' })
        setStatus({ kind: 'failed', reason })
        onDone(t('cmd.undo.failed', { reason }), { display: 'system' })
      }
    })()
  }, [onDone])

  return (
    <Box>
      {status.kind === 'pending' && <Text dimColor>…</Text>}
      {status.kind === 'nothing' && (
        <Text color="warning">{t('cmd.undo.nothing')}</Text>
      )}
      {status.kind === 'success' && (
        <Text color="success">{t('cmd.undo.success', { id: status.id })}</Text>
      )}
      {status.kind === 'not_found' && (
        <Text color="warning">{t('cmd.undo.notFound')}</Text>
      )}
      {status.kind === 'disabled' && (
        <Text color="warning">{t('cmd.undo.disabled')}</Text>
      )}
      {status.kind === 'failed' && (
        <Text color="error">
          {t('cmd.undo.failed', { reason: status.reason })}
        </Text>
      )}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone) => {
  return <UndoView onDone={onDone} />
}
