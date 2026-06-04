// W433 — /memory-export implementation.
import { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import { projectIdFromCwd } from '../../memory-sidecar/src/index.js'
import {
  writeMemoryExportFile,
  type MemoryExportFormat,
} from '../../services/memorySidecar/exportMemory.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { t } from '../../utils/i18n/index.js'

type Status =
  | { kind: 'pending' }
  | { kind: 'usage' }
  | { kind: 'empty' }
  | { kind: 'success'; count: number; path: string }
  | { kind: 'disabled' }
  | { kind: 'failed'; reason: string }

function parseFormat(args: string): MemoryExportFormat | 'invalid' | 'default' {
  const trimmed = args.trim().toLowerCase()
  if (!trimmed) return 'default'
  if (trimmed === 'md' || trimmed === 'markdown') return 'markdown'
  if (trimmed === 'json') return 'json'
  return 'invalid'
}

function ExportView({
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

    const parsed = parseFormat(args)
    if (parsed === 'invalid') {
      setStatus({ kind: 'usage' })
      onDone(t('cmd.memory-export.usageInvalid'), { display: 'system' })
      return
    }
    const format: MemoryExportFormat = parsed === 'default' ? 'markdown' : parsed

    void (async () => {
      try {
        const cwd = getCwd()
        const projectId = projectIdFromCwd(cwd)
        const result = await writeMemoryExportFile({
          cwd,
          projectId,
          format,
        })

        if (result.ok === true) {
          if (result.totalCount === 0) {
            setStatus({ kind: 'empty' })
            onDone(t('cmd.memory-export.empty'), { display: 'system' })
            return
          }
          setStatus({
            kind: 'success',
            count: result.totalCount,
            path: result.path,
          })
          onDone(
            t('cmd.memory-export.success', {
              count: String(result.totalCount),
              path: result.path,
            }),
            { display: 'system' },
          )
          return
        }

        if (result.reason === 'sidecar_disabled') {
          setStatus({ kind: 'disabled' })
          onDone(t('cmd.memory-export.disabled'), { display: 'system' })
          return
        }

        const reason = result.detail ?? result.reason
        setStatus({ kind: 'failed', reason })
        onDone(t('cmd.memory-export.failed', { reason }), { display: 'system' })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logForDebugging(`[memory-export] unexpected: ${reason}`, {
          level: 'error',
        })
        setStatus({ kind: 'failed', reason })
        onDone(t('cmd.memory-export.failed', { reason }), { display: 'system' })
      }
    })()
  }, [args, onDone])

  return (
    <Box>
      {status.kind === 'pending' && <Text dimColor>{t('cmd.memory-export.writing')}</Text>}
      {status.kind === 'usage' && (
        <Text color="warning">{t('cmd.memory-export.usageInvalid')}</Text>
      )}
      {status.kind === 'empty' && (
        <Text color="warning">{t('cmd.memory-export.empty')}</Text>
      )}
      {status.kind === 'success' && (
        <Text color="success">
          {t('cmd.memory-export.success', {
            count: String(status.count),
            path: status.path,
          })}
        </Text>
      )}
      {status.kind === 'disabled' && (
        <Text color="warning">{t('cmd.memory-export.disabled')}</Text>
      )}
      {status.kind === 'failed' && (
        <Text color="error">
          {t('cmd.memory-export.failed', { reason: status.reason })}
        </Text>
      )}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  return <ExportView args={args} onDone={onDone} />
}
