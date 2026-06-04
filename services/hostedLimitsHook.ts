import { useEffect, useState } from 'react'
import {
  type HostedLimits,
  currentLimits,
  statusListeners,
} from './hostedLimits.js'

export function useHostedLimits(): HostedLimits {
  const [limits, setLimits] = useState<HostedLimits>({ ...currentLimits })

  useEffect(() => {
    const listener = (newLimits: HostedLimits) => {
      setLimits({ ...newLimits })
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return limits
}
