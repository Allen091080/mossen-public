// W418 S2 — TUI capture toast.
//
// Subscribes to the memory-sidecar capture event channel and surfaces a
// transient bottom-of-screen notification ("📝 Remembered (project): ...").
// Reuses the existing notifications infrastructure (context/notifications.tsx
// + components/PromptInput/Notifications.tsx) so no new rendering path is
// introduced.
//
// W418 S3 reuses the same emit channel for /remember; the toast text varies
// by event.kind ('auto' vs 'manual').
import { useEffect } from 'react'
import { Text } from 'ink'
import { useNotifications } from '../context/notifications.js'
import {
  onMemoryCaptured,
  type MemoryCaptureEvent,
} from '../services/memorySidecar/captureEvents.js'
import { t } from '../utils/i18n/index.js'

const TOAST_KEY = 'memory-capture'
const TOAST_TIMEOUT_MS = 5000
const PREVIEW_MAX_CHARS = 60

function truncatePreview(text: string, maxChars = PREVIEW_MAX_CHARS): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(0, maxChars - 1).trimEnd() + '…'
}

// W431 — Map an internal scope token to a user-readable label that includes
// the visibility hint ("project · only this project"). Falls back to the
// raw scope string if no key is defined (defensive against future scope
// additions).
function scopeLabel(scope: string): string {
  switch (scope) {
    case 'session':
      return t('ui.memory.scope.session')
    case 'project':
      return t('ui.memory.scope.project')
    case 'workspace':
      return t('ui.memory.scope.workspace')
    case 'user':
      return t('ui.memory.scope.user')
    case 'team':
      return t('ui.memory.scope.team')
    default:
      return scope
  }
}

export function useMemoryCaptureToast(): void {
  const { addNotification } = useNotifications()

  useEffect(() => {
    const off = onMemoryCaptured((event: MemoryCaptureEvent) => {
      const preview = truncatePreview(event.text)
      const prefix =
        event.kind === 'manual'
          ? t('ui.memory.toast.captured.manualPrefix')
          : t('ui.memory.toast.captured.prefix')
      const showBatch = event.acceptedCount > 1
      const batchExtra = event.acceptedCount - 1
      // W419 — when the event carries an archiveEventId, /undo can target it;
      // surface the hint so users discover the command. Otherwise fall back
      // to the W418 generic manage hint.
      const showUndoHint = Boolean(event.archiveEventId)
      addNotification({
        key: TOAST_KEY,
        priority: 'medium',
        timeoutMs: TOAST_TIMEOUT_MS,
        jsx: (
          <>
            <Text color="success">📝 {prefix}</Text>
            <Text dimColor> ({scopeLabel(event.scope)}) </Text>
            <Text>"{preview}"</Text>
            {showBatch ? (
              <Text dimColor>
                {' '}· {t('ui.memory.toast.captured.batch', {
                  extra: String(batchExtra),
                })}
              </Text>
            ) : null}
            {showUndoHint ? (
              <Text dimColor>
                {' '}· {t('ui.memory.toast.captured.undoHint')}
              </Text>
            ) : null}
            <Text dimColor> · {t('ui.memory.toast.captured.hint')}</Text>
          </>
        ),
      })
    })
    return () => {
      off()
    }
  }, [addNotification])
}
