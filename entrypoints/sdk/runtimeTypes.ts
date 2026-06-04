// Minimal SDK runtime type stubs for reconstructed source builds.
export type AnyZodRawShape = Record<string, unknown>
export type InferShape<T> = T extends Record<string, unknown> ? T : never
export type SdkMcpToolDefinition<T = unknown> = {
  name: string
  description: string
  inputSchema: T
  handler: (args: InferShape<T>, extra: unknown) => Promise<unknown>
  annotations?: unknown
  searchHint?: string
  alwaysLoad?: boolean
}
export type McpSdkServerConfigWithInstance = {
  name: string
  version: string
  tools: Array<SdkMcpToolDefinition<unknown>>
  instance: {
    name: string
    version: string
    tools: Array<SdkMcpToolDefinition<unknown>>
  }
}
export type SDKSession = {
  id: string
  query: (
    prompt: string | AsyncIterable<SDKUserMessage>,
    options?: SDKSessionOptions,
  ) => Query
  prompt: (
    message: string,
    options?: SDKSessionOptions,
  ) => Promise<SDKResultMessage>
}
export type SDKSessionOptions = Record<string, unknown>
export type SDKSessionInfo = Record<string, unknown>
export type SDKUserMessage = Record<string, unknown>
export type SDKMessage = Record<string, unknown>
export type SDKResultMessage = Record<string, unknown>
export type SessionMessage = Record<string, unknown>
export type Options = Record<string, unknown>
export type InternalOptions = Record<string, unknown>
export type Query = AsyncIterable<unknown>
export type InternalQuery = AsyncIterable<unknown>
export type ListSessionsOptions = Record<string, unknown>
export type GetSessionInfoOptions = Record<string, unknown>
export type GetSessionMessagesOptions = Record<string, unknown>
export type SessionMutationOptions = Record<string, unknown>
export type ForkSessionOptions = Record<string, unknown>
export type ForkSessionResult = Record<string, unknown>
