import type { StdoutMessage } from '../../entrypoints/sdk/controlTypes.js'

export interface Transport {
  connect(): Promise<void>
  close(): void
  write(message: StdoutMessage): Promise<void>
  isConnectedStatus(): boolean
  isClosedStatus(): boolean
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
  setOnConnect?(callback: () => void): void
  getStateLabel?(): string
  flush?(): Promise<void>
}
