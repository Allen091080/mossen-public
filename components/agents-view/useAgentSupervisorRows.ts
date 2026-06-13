import { useCallback, useEffect, useRef, useState } from 'react'
import { getTerminalFocusState } from 'src/ink/terminal-focus-state.js'
import { useTerminalNotification } from 'src/ink/useTerminalNotification.js'
import { reconcileAgentSupervisorStaleProcesses } from 'src/services/agentSupervisor/daemon.js'
import {
  resolveAgentSupervisorPrStatuses,
  type AgentSupervisorPrStatus,
} from 'src/services/agentSupervisor/prStatus.js'
import { readAgentSupervisorRoster } from 'src/services/agentSupervisor/roster.js'
import type { AgentSupervisorStatus } from 'src/services/agentSupervisor/schema.js'
import { sendNotification } from 'src/services/notifier.js'
import { t } from '../../utils/i18n/index.js'
import {
  agentViewNotificationDedupeKey,
  agentViewNotificationMessage,
  getAgentViewNotificationMode,
  getSupervisorStatusFlashColor,
  shouldNotifyAgentViewStatusTransition,
} from '../agents/agentViewHelpers.js'
import {
  deriveSupervisorAgentViewItems,
  type SupervisorAgentViewItem,
} from '../tasks/agentSupervisorViewModel.js'

async function readAgentSupervisorRowsForDashboard(): Promise<
  SupervisorAgentViewItem[]
> {
  await reconcileAgentSupervisorStaleProcesses().catch(() => undefined)
  return deriveSupervisorAgentViewItems(await readAgentSupervisorRoster())
}

export function useAgentSupervisorRows({
  agentView,
  listVisible,
}: {
  agentView: boolean
  listVisible: boolean
}): {
  rows: SupervisorAgentViewItem[]
  prStatuses: Record<string, AgentSupervisorPrStatus>
  lastRefreshAt: number | null
  statusFlashColors: Map<string, string>
  loadError: string | null
  refreshRowsOnce: () => Promise<SupervisorAgentViewItem[]>
} {
  const terminal = useTerminalNotification()
  const [rows, setRows] = useState<SupervisorAgentViewItem[]>([])
  const [prStatuses, setPrStatuses] = useState<Record<string, AgentSupervisorPrStatus>>({})
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null)
  const [statusFlashColors, setStatusFlashColors] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const previousStatusesRef = useRef<Map<string, string>>(new Map())
  const notifiedTransitionsRef = useRef<Set<string>>(new Set())

  const applyRows = useCallback(
    (
      nextRows: SupervisorAgentViewItem[],
      options: {
        notify: boolean
        isCancelled?: () => boolean
      },
    ): void => {
      const notificationMode = getAgentViewNotificationMode()
      const focusState = getTerminalFocusState()
      const notifications = options.notify
        ? nextRows.filter(row => {
            const previous = previousStatusesRef.current.get(row.id) as
              | AgentSupervisorStatus
              | undefined
            if (
              !shouldNotifyAgentViewStatusTransition({
                previous,
                current: row.status,
                focusState,
                mode: notificationMode,
              })
            ) {
              return false
            }
            const key = agentViewNotificationDedupeKey(row.id, row.status)
            if (notifiedTransitionsRef.current.has(key)) return false
            notifiedTransitionsRef.current.add(key)
            return true
          })
        : []

      const changedRows = nextRows.flatMap(row => {
        const previous = previousStatusesRef.current.get(row.id)
        const color =
          previous && previous !== row.status
            ? getSupervisorStatusFlashColor(row.status)
            : null
        return color ? [{ id: row.id, color }] : []
      })

      previousStatusesRef.current = new Map(nextRows.map(row => [row.id, row.status]))
      if (changedRows.length > 0) {
        setStatusFlashColors(previous => {
          const next = new Map(previous)
          for (const row of changedRows) next.set(row.id, row.color)
          return next
        })
        setTimeout(() => {
          if (options.isCancelled?.()) return
          setStatusFlashColors(previous => {
            const next = new Map(previous)
            for (const row of changedRows) next.delete(row.id)
            return next
          })
        }, 1200)
      }

      setRows(nextRows)
      setLastRefreshAt(Date.now())
      setLoadError(null)

      for (const item of notifications) {
        void sendNotification(
          {
            title: t('ui.agentView.notification.title'),
            message: agentViewNotificationMessage(item),
            notificationType: 'agent_view_needs_input',
          },
          terminal,
        )
      }
    },
    [terminal],
  )

  const refreshRowsOnce = useCallback(async (): Promise<SupervisorAgentViewItem[]> => {
    const nextRows = await readAgentSupervisorRowsForDashboard()
    applyRows(nextRows, { notify: false })
    return nextRows
  }, [applyRows])

  useEffect(() => {
    if (!agentView) {
      setRows([])
      setLoadError(null)
      setLastRefreshAt(null)
      setStatusFlashColors(new Map())
      previousStatusesRef.current = new Map()
      return
    }
    if (!listVisible) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh(): Promise<void> {
      try {
        const nextRows = await readAgentSupervisorRowsForDashboard()
        if (cancelled) return
        applyRows(nextRows, {
          notify: true,
          isCancelled: () => cancelled,
        })
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => {
            void refresh()
          }, 2000)
        }
      }
    }
    void refresh()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [agentView, listVisible, applyRows])

  useEffect(() => {
    if (!agentView || rows.length === 0) {
      setPrStatuses({})
      return
    }
    let cancelled = false
    void resolveAgentSupervisorPrStatuses(rows)
      .then(statuses => {
        if (!cancelled) setPrStatuses(statuses)
      })
      .catch(() => {
        if (!cancelled) setPrStatuses({})
      })
    return () => {
      cancelled = true
    }
  }, [agentView, rows])

  return {
    rows,
    prStatuses,
    lastRefreshAt,
    statusFlashColors,
    loadError,
    refreshRowsOnce,
  }
}
