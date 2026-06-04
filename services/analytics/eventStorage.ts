import { appendFile, mkdir, readdir, unlink, writeFile } from 'fs/promises'
import * as path from 'path'
import { isFsInaccessible } from '../../utils/errors.js'
import { readJSONLFile } from '../../utils/json.js'
import { logError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'

/**
 * Generic disk-backed storage for event batches that failed to send.
 *
 * Each batch is stored as JSON Lines (one event per line). Files are keyed by
 * a caller-provided `batchKey` (e.g. session id + per-process UUID), which
 * lets the caller correlate stored batches across runs.
 *
 * Pure addition for OTel removal Y-1; wired up by Y-2 (new exporter).
 */
export class EventStorage<T> {
  private readonly storageDir: () => string
  private readonly filePrefix: string

  constructor(opts: { storageDir: () => string; filePrefix: string }) {
    this.storageDir = opts.storageDir
    this.filePrefix = opts.filePrefix
  }

  filePathForKey(batchKey: string): string {
    return path.join(this.storageDir(), `${this.filePrefix}${batchKey}.json`)
  }

  /**
   * Append events to the batch file. Creates the storage dir if needed.
   * Atomic per-write on most filesystems (POSIX append).
   */
  async appendBatch(batchKey: string, events: T[]): Promise<void> {
    if (events.length === 0) return
    try {
      await mkdir(this.storageDir(), { recursive: true })
      const content = events.map(e => jsonStringify(e)).join('\n') + '\n'
      await appendFile(this.filePathForKey(batchKey), content, 'utf8')
    } catch (error) {
      logError(error)
    }
  }

  /**
   * Replace the batch file with the given events. Empty arrays delete
   * the file entirely.
   */
  async saveBatch(batchKey: string, events: T[]): Promise<void> {
    const filePath = this.filePathForKey(batchKey)
    try {
      if (events.length === 0) {
        try {
          await unlink(filePath)
        } catch {
          // already gone
        }
        return
      }
      await mkdir(this.storageDir(), { recursive: true })
      const content = events.map(e => jsonStringify(e)).join('\n') + '\n'
      await writeFile(filePath, content, 'utf8')
    } catch (error) {
      logError(error)
    }
  }

  /**
   * Load events from the batch file. Returns empty array on any error
   * (file missing, parse failure, etc.) so callers don't need to branch.
   */
  async loadBatch(batchKey: string): Promise<T[]> {
    try {
      return await readJSONLFile<T>(this.filePathForKey(batchKey))
    } catch {
      return []
    }
  }

  /**
   * Delete the batch file. Idempotent.
   */
  async deleteBatch(batchKey: string): Promise<void> {
    try {
      await unlink(this.filePathForKey(batchKey))
    } catch {
      // already gone or inaccessible
    }
  }

  /**
   * List filenames matching the storage prefix that aren't in `excludeKeys`.
   * Used by callers to find batches left over from prior process runs.
   * Returns absolute file paths.
   */
  async listOldBatchFiles(
    keyPrefix: string,
    excludeKeys: string[] = [],
  ): Promise<string[]> {
    try {
      const dir = this.storageDir()
      const fullPrefix = `${this.filePrefix}${keyPrefix}`
      const files = await readdir(dir)
      return files
        .filter(f => f.startsWith(fullPrefix) && f.endsWith('.json'))
        .filter(f => !excludeKeys.some(key => f.includes(key)))
        .map(f => path.join(dir, f))
    } catch (e) {
      if (isFsInaccessible(e)) return []
      logError(e as Error)
      return []
    }
  }
}
