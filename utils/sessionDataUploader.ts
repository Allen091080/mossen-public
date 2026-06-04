export async function uploadSessionData(): Promise<void> {}

export function createSessionTurnUploader(): {
  uploadTurn: (...args: unknown[]) => Promise<void>
  flush: () => Promise<void>
} {
  return {
    uploadTurn: async () => {},
    flush: async () => {},
  }
}
