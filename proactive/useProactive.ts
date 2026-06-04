import { useEffect, useRef } from 'react'
import {
  getNextTickAt,
  isProactiveActive,
  isProactivePaused,
  subscribeToProactiveChanges,
} from './index.js'

type UseProactiveOptions = {
  isLoading: boolean
  queuedCommandsLength: number
  hasActiveLocalJsxUI: boolean
  isInPlanMode: boolean
  onSubmitTick: (prompt: string) => void
  onQueueTick: (prompt: string) => void
}

const DEFAULT_TICK_PROMPT =
  '<tick>Continue working proactively. Make the most useful next move, or sleep if there is nothing to do.</tick>'

export function useProactive(options: UseProactiveOptions): void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    function schedule(): void {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      if (!isProactiveActive() || isProactivePaused()) {
        return
      }

      const nextTickAt = getNextTickAt()
      if (nextTickAt === null) {
        return
      }

      const delay = Math.max(0, nextTickAt - Date.now())
      timeoutId = setTimeout(() => {
        const current = optionsRef.current
        if (
          current.isLoading ||
          current.queuedCommandsLength > 0 ||
          current.hasActiveLocalJsxUI ||
          current.isInPlanMode
        ) {
          current.onQueueTick(DEFAULT_TICK_PROMPT)
        } else {
          current.onSubmitTick(DEFAULT_TICK_PROMPT)
        }
      }, delay)
    }

    schedule()
    const unsubscribe = subscribeToProactiveChanges(schedule)
    return () => {
      unsubscribe()
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  }, [])
}
