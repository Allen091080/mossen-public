type ProactiveSource = 'command' | 'env' | 'system' | string

type ProactiveState = {
  active: boolean
  paused: boolean
  contextBlocked: boolean
  source: ProactiveSource | null
  nextTickAt: number | null
}

const DEFAULT_TICK_MS = 60_000

let state: ProactiveState = {
  active: false,
  paused: false,
  contextBlocked: false,
  source: null,
  nextTickAt: null,
}

const listeners = new Set<() => void>()

function computeNextTickAt(next: ProactiveState): number | null {
  if (!next.active || next.paused || next.contextBlocked) {
    return null
  }
  return Date.now() + DEFAULT_TICK_MS
}

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function update(
  updater: (prev: ProactiveState) => ProactiveState,
): ProactiveState {
  const next = updater(state)
  next.nextTickAt = computeNextTickAt(next)
  state = next
  emit()
  return state
}

export function subscribeToProactiveChanges(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isProactiveActive(): boolean {
  return state.active
}

export function isProactivePaused(): boolean {
  return state.paused || state.contextBlocked
}

export function getNextTickAt(): number | null {
  return state.nextTickAt
}

export function activateProactive(source: ProactiveSource = 'command'): void {
  update(prev => ({
    ...prev,
    active: true,
    paused: false,
    source,
  }))
}

export function deactivateProactive(): void {
  update(prev => ({
    ...prev,
    active: false,
    paused: false,
    source: null,
  }))
}

export function pauseProactive(): void {
  update(prev => ({
    ...prev,
    paused: true,
  }))
}

export function resumeProactive(): void {
  update(prev => ({
    ...prev,
    paused: false,
  }))
}

export function setContextBlocked(blocked: boolean): void {
  update(prev => ({
    ...prev,
    contextBlocked: blocked,
  }))
}

export function getProactiveSource(): ProactiveSource | null {
  return state.source
}
