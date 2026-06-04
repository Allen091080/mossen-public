export class SSHSessionError extends Error {}

export class SSHSession {
  proc: { pid?: number; exitCode?: number | null; signalCode?: string | null; kill?: () => void }
  proxy: { close?: () => void; stop?: () => void }
  dispose(): void
  createManager(_options?: unknown): {
    connect(): void
    disconnect(): void
    respondToPermissionRequest(...args: unknown[]): void
    sendMessage(...args: unknown[]): Promise<boolean>
  }
  getStderrTail(): string
}

export function createLocalSSHSession(..._args: unknown[]): SSHSession
export function createSSHSession(..._args: unknown[]): SSHSession
