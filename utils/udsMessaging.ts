import { join } from 'path'

export function getDefaultUdsSocketPath(): string {
  return join('/tmp', 'mossen-uds.sock')
}

export async function startUdsMessaging(
  _socketPath: string,
  _options?: { isExplicit?: boolean },
): Promise<void> {}
