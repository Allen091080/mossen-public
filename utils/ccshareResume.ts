export async function resumeFromSharedConversation(): Promise<null> {
  return null
}

export function parseCcshareId(_value: string): null {
  return null
}

export async function loadCcshare(_id: string): Promise<never> {
  throw new Error('Shared conversation resume is not available in this build')
}
