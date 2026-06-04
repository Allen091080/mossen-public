export type LiveSession = {
  kind?: string
  sessionId?: string
}

export async function listAllLiveSessions(): Promise<LiveSession[]> {
  return []
}

export async function sendToUdsSocket(_socketPath: string, _message: string): Promise<void> {
  throw new Error('UDS socket messaging is not available in this build')
}
