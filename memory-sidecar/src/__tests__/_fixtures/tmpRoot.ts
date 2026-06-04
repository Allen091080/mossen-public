// W435a2 — Tmp memory-sidecar root fixture for integration tests.
//
// Shared by every memory-sidecar test that needs to actually write to disk
// (archive JSONL, dirty markers, dead-letter store, SQLite index, etc).
// Cleanup is rm -rf on the entire tmp dir; safe because all paths derived
// from rootDir live under it.
//
// Usage:
//   let rootDir: string
//   let cleanup: () => Promise<void>
//   beforeAll(async () => ({ rootDir, cleanup } = await createTmpMemoryRoot()))
//   afterAll(async () => await cleanup())
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type TmpMemoryRoot = {
  rootDir: string
  cleanup: () => Promise<void>
}

export async function createTmpMemoryRoot(
  prefix = 'mossen-memtest-',
): Promise<TmpMemoryRoot> {
  const rootDir = await mkdtemp(join(tmpdir(), prefix))
  const cleanup = async (): Promise<void> => {
    await rm(rootDir, { recursive: true, force: true })
  }
  return { rootDir, cleanup }
}
