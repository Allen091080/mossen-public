export type AssistantSession = {
  id: string
  title?: string
  updatedAt?: string
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  return []
}
