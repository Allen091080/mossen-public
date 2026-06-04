import { execaSync } from 'execa'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import type { SecureStorage, SecureStorageData } from './types.js'

const SECRET_TOOL = 'secret-tool'
const SECRET_LABEL = 'Mossen credentials'
const SECRET_ATTRIBUTES = ['application', 'mossen', 'key', 'credentials']

function parseSecret(stdout: string): SecureStorageData | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  return jsonParse(trimmed)
}

export const libsecretStorage = {
  name: 'libsecret',
  read(): SecureStorageData | null {
    try {
      const result = execaSync(
        SECRET_TOOL,
        ['lookup', ...SECRET_ATTRIBUTES],
        {
          reject: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      if (result.exitCode !== 0 || !result.stdout) {
        return null
      }
      return parseSecret(result.stdout)
    } catch {
      return null
    }
  },
  async readAsync(): Promise<SecureStorageData | null> {
    try {
      const { stdout, code } = await execFileNoThrow(
        SECRET_TOOL,
        ['lookup', ...SECRET_ATTRIBUTES],
        { useCwd: false, preserveOutputOnError: false },
      )
      if (code !== 0 || !stdout) {
        return null
      }
      return parseSecret(stdout)
    } catch {
      return null
    }
  },
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    try {
      const result = execaSync(
        SECRET_TOOL,
        ['store', '--label', SECRET_LABEL, ...SECRET_ATTRIBUTES],
        {
          input: jsonStringify(data),
          reject: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      return { success: result.exitCode === 0 }
    } catch {
      return { success: false }
    }
  },
  delete(): boolean {
    try {
      const result = execaSync(SECRET_TOOL, ['clear', ...SECRET_ATTRIBUTES], {
        reject: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return result.exitCode === 0
    } catch {
      return false
    }
  },
} satisfies SecureStorage
