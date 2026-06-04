let assistantForced = false

export function markAssistantForced(): void {
  assistantForced = true
}

export function isAssistantForced(): boolean {
  return assistantForced
}

export function isAssistantMode(): boolean {
  return assistantForced || process.env.MOSSENSRC_ASSISTANT_MODE === '1'
}

export async function initializeAssistantTeam(): Promise<undefined> {
  return undefined
}

export function getAssistantSystemPromptAddendum(): string {
  return `\n# Assistant Mode\n\nYou are running in assistant mode. Prefer autonomous progress, preserve context between wake-ups, and use user-facing messaging tools when communicating outward.`
}

export function getAssistantActivationPath(): string | undefined {
  return undefined
}
