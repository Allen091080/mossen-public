/**
 * Shared LSP server configuration types.
 *
 * Runtime validation lives in utils/plugins/schemas.ts. These types mirror that
 * schema so plugin manifests, the LSP manager, and the server instance agree on
 * the same shape without importing Zod at runtime.
 */

export type LspServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

export type LspServerConfig = {
  command: string
  args?: string[]
  extensionToLanguage: Record<string, string>
  transport?: 'stdio' | 'socket'
  env?: Record<string, string>
  initializationOptions?: unknown
  settings?: unknown
  workspaceFolder?: string
  startupTimeout?: number
  shutdownTimeout?: number
  restartOnCrash?: boolean
  maxRestarts?: number
  /**
   * Filenames that mark a project root for this server (e.g. tsconfig.json,
   * Cargo.toml, .git). Informational metadata used by /lsp probe and editor
   * surfaces; LSPServerInstance does not consume this directly.
   */
  rootPatterns?: string[]
}

export type ScopedLspServerConfig = LspServerConfig & {
  scope: 'dynamic'
  source: string
}

