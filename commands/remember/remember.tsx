// W418 S3 — /remember <text> implementation.
//
// Renders a one-line status (saving → saved / failed), writes the entry via
// ingestConversationEvent (bypassing captureFilters), then re-emits the
// memory capture event so the existing W418 S2 toast pipeline picks it up.
import { randomUUID } from 'node:crypto'
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { getSessionId } from '../../bootstrap/state.js'
import {
  getDefaultMemorySidecarConfigPath,
  ingestConversationEvent,
  loadMemorySidecarConfig,
  projectIdFromCwd,
  SidecarDisabledError,
} from '../../memory-sidecar/src/index.js'
import { emitMemoryCaptured } from '../../services/memorySidecar/captureEvents.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { t } from '../../utils/i18n/index.js'

type Status =
  | { kind: 'saving' }
  | { kind: 'empty' }
  | { kind: 'disabled' }
  | { kind: 'success' }
  | { kind: 'failed'; reason: string }

function RememberView({
  args,
  onDone,
}: {
  args: string
  onDone: (
    result?: string,
    options?: { display?: 'skip' | 'system' | 'user' },
  ) => void
}) {
  const [status, setStatus] = useState<Status>({ kind: 'saving' })
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const text = args.trim()
    if (!text) {
      setStatus({ kind: 'empty' })
      onDone(t('cmd.remember.usage'), { display: 'system' })
      return
    }

    void (async () => {
      try {
        const config = loadMemorySidecarConfig(
          getDefaultMemorySidecarConfigPath(),
        )
        if (!config.enabled || !config.adapter.enabled) {
          setStatus({ kind: 'disabled' })
          onDone(t('cmd.remember.disabled'), { display: 'system' })
          return
        }

        const cwd = getCwd()
        const projectId = projectIdFromCwd(cwd)
        const sessionId = getSessionId()
        const createdAt = new Date().toISOString()
        const sourceEventId = `mossen:manual:${randomUUID()}`

        const ingestResult = await ingestConversationEvent({
          rootDir: config.homeDir,
          enabled: true,
          event: {
            schemaVersion: 1,
            source: 'mossen',
            sourceEventId,
            projectId,
            sessionId,
            scope: 'project',
            role: 'user',
            kind: 'message',
            text,
            createdAt,
            metadata: { cwd, channel: 'conversation' },
          },
          projectId,
        })

        emitMemoryCaptured({
          sourceEventId,
          // W419 — manual writes have a deterministic archiveEventId from the
          // ingestConversationEvent return; surface it so /undo can target.
          archiveEventId: ingestResult.archiveEvent.eventId,
          text,
          scope: 'project',
          kind: 'manual',
          acceptedCount: 1,
          projectId,
          sessionId,
          createdAt,
        })
        setStatus({ kind: 'success' })
        onDone(t('cmd.remember.success'), { display: 'system' })
      } catch (error) {
        if (error instanceof SidecarDisabledError) {
          setStatus({ kind: 'disabled' })
          onDone(t('cmd.remember.disabled'), { display: 'system' })
          return
        }
        const reason = errorMessage(error)
        logForDebugging(`[remember] failed: ${reason}`, { level: 'error' })
        setStatus({ kind: 'failed', reason })
        onDone(t('cmd.remember.failed', { reason }), { display: 'system' })
      }
    })()
  }, [args, onDone])

  return (
    <Box>
      {status.kind === 'saving' && <Text dimColor>…</Text>}
      {status.kind === 'empty' && <Text color="warning">{t('cmd.remember.usage')}</Text>}
      {status.kind === 'disabled' && <Text color="warning">{t('cmd.remember.disabled')}</Text>}
      {status.kind === 'success' && <Text color="success">{t('cmd.remember.success')}</Text>}
      {status.kind === 'failed' && (
        <Text color="error">{t('cmd.remember.failed', { reason: status.reason })}</Text>
      )}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  return <RememberView args={args} onDone={onDone} />
}
