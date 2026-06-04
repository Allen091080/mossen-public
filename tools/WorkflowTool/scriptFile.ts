import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export const MAX_WORKFLOW_SCRIPT_FILE_BYTES = 512 * 1024

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  )
}

function isWorkflowUncPath(scriptPath: string): boolean {
  return scriptPath.startsWith('\\\\') || scriptPath.startsWith('//')
}

export function readWorkflowScriptFile(scriptPath: string): string {
  if (isWorkflowUncPath(scriptPath)) {
    throw new Error(
      `UNC paths are not allowed for workflow scriptPath: ${scriptPath}`,
    )
  }

  const resolvedPath = resolve(scriptPath)
  try {
    const stat = statSync(resolvedPath)
    if (stat.size > MAX_WORKFLOW_SCRIPT_FILE_BYTES) {
      throw new Error(
        `Workflow script file ${resolvedPath} exceeds ${MAX_WORKFLOW_SCRIPT_FILE_BYTES} bytes`,
      )
    }
    return readFileSync(resolvedPath, 'utf8')
  } catch (err) {
    if (isMissingFileError(err)) {
      throw new Error(`Workflow script file not found: ${resolvedPath}`)
    }
    const message = (err as Error).message || String(err)
    if (
      message.startsWith(`Workflow script file ${resolvedPath} exceeds `)
    ) {
      throw err
    }
    throw new Error(`Failed to read workflow script file ${resolvedPath}: ${message}`)
  }
}
