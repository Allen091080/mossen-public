export type RunningServerInfo = {
  pid: number
  httpUrl: string
}

export function writeServerLock(info?: unknown): Promise<void>
export function removeServerLock(): Promise<void>
export function probeRunningServer(): Promise<RunningServerInfo | null>
