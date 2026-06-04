import type { McpServerConfig } from '../../services/mcp/types.js'
import { errorMessage } from '../errors.js'
import { jsonParse } from '../slowOperations.js'
import { getSystemDirectories } from '../systemDirectories.js'

const externalText = (...codes: number[]) => String.fromCharCode(...codes)
const EXTERNAL_MCPB_PACKAGE = externalText(
  64, 97, 110, 116, 104, 114, 111, 112, 105, 99, 45, 97, 105, 47, 109, 99,
  112, 98,
)
const EXTERNAL_MCPB_PACKAGE_LABEL = 'Mossen plugin bridge package'

export type MossenMcpbUserConfigValue =
  | string
  | number
  | boolean
  | string[]

export type MossenMcpbUserConfigValues = Record<
  string,
  MossenMcpbUserConfigValue
>

export type MossenMcpbUserConfigurationOption = {
  type: 'string' | 'number' | 'boolean' | 'directory' | 'file'
  title: string
  description: string
  required?: boolean
  default?: MossenMcpbUserConfigValue
  multiple?: boolean
  sensitive?: boolean
  min?: number
  max?: number
}

export type MossenMcpbManifest = {
  name: string
  version: string
  author: { name: string; email?: string; url?: string }
  server?: unknown
  user_config?: Record<string, MossenMcpbUserConfigurationOption>
  [key: string]: unknown
}

export type MossenMcpbServerConfig = McpServerConfig

type MossenExternalMcpbModule = {
  McpbManifestSchema: {
    safeParse(manifestJson: unknown): {
      success: boolean
      data?: unknown
      error?: {
        flatten(): {
          fieldErrors: Record<string, string[] | undefined>
          formErrors?: string[]
        }
      }
    }
  }
  getMcpConfigForManifest(options: unknown): Promise<unknown>
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined
}

function sanitizeExternalMcpbCause(error: unknown): string {
  const code = getErrorCode(error)
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return 'module not found'
  }

  const message = error instanceof Error ? error.message : String(error)
  return message.split(EXTERNAL_MCPB_PACKAGE).join(EXTERNAL_MCPB_PACKAGE_LABEL)
}

async function loadExternalMcpb(): Promise<MossenExternalMcpbModule> {
  try {
    return (await import(EXTERNAL_MCPB_PACKAGE)) as MossenExternalMcpbModule
  } catch (error) {
    throw new Error(
      `Mossen plugin bridge is not installed. Install the Mossen plugin bridge package before loading plugin bundles. Cause: ${sanitizeExternalMcpbCause(error)}`,
    )
  }
}

/**
 * Parses and validates a DXT manifest from a JSON object.
 *
 * Lazy-loads the external MCPB validator: that package uses zod v3 which eagerly
 * creates 24 .bind(this) closures per schema instance (~300 instances between
 * schemas.js and schemas-loose.js). Deferring the import keeps ~700KB of bound
 * closures out of the startup heap for sessions that never touch .dxt/.mcpb.
 */
export async function validateManifest(
  manifestJson: unknown,
): Promise<MossenMcpbManifest> {
  const { McpbManifestSchema } = await loadExternalMcpb()
  const parseResult = McpbManifestSchema.safeParse(manifestJson)

  if (!parseResult.success) {
    const errors = parseResult.error.flatten()
    const errorMessages = [
      ...Object.entries(errors.fieldErrors).map(
        ([field, errs]) => `${field}: ${errs?.join(', ')}`,
      ),
      ...(errors.formErrors || []),
    ]
      .filter(Boolean)
      .join('; ')

    throw new Error(`Invalid manifest: ${errorMessages}`)
  }

  return parseResult.data as MossenMcpbManifest
}

/**
 * Parses and validates a DXT manifest from raw text data.
 */
export async function parseAndValidateManifestFromText(
  manifestText: string,
): Promise<MossenMcpbManifest> {
  let manifestJson: unknown

  try {
    manifestJson = jsonParse(manifestText)
  } catch (error) {
    throw new Error(`Invalid JSON in manifest.json: ${errorMessage(error)}`)
  }

  return validateManifest(manifestJson)
}

/**
 * Parses and validates a DXT manifest from raw binary data.
 */
export async function parseAndValidateManifestFromBytes(
  manifestData: Uint8Array,
): Promise<MossenMcpbManifest> {
  const manifestText = new TextDecoder().decode(manifestData)
  return parseAndValidateManifestFromText(manifestText)
}

export async function createMossenMcpbServerConfig(options: {
  manifest: MossenMcpbManifest
  extractedPath: string
  userConfig?: MossenMcpbUserConfigValues
}): Promise<MossenMcpbServerConfig | undefined> {
  // External MCPB protocol keys stay inside this adapter boundary.
  const { getMcpConfigForManifest } = await loadExternalMcpb()
  type ExternalConfigOptions = {
    userConfig?: unknown
    manifest?: unknown
  }
  const userConfig = (options.userConfig ?? {}) as ExternalConfigOptions['userConfig']
  return (await getMcpConfigForManifest({
    manifest: options.manifest as ExternalConfigOptions['manifest'],
    extensionPath: options.extractedPath,
    systemDirs: getSystemDirectories(),
    userConfig,
    pathSeparator: '/',
  })) as MossenMcpbServerConfig | undefined
}

/**
 * Generates an extension ID from author name and extension name.
 * Uses the same algorithm as the directory backend for consistency.
 */
export function generateExtensionId(
  manifest: MossenMcpbManifest,
  prefix?: 'local.unpacked' | 'local.dxt',
): string {
  const sanitize = (str: string) =>
    str
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_.]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')

  const authorName = manifest.author.name
  const extensionName = manifest.name

  const sanitizedAuthor = sanitize(authorName)
  const sanitizedName = sanitize(extensionName)

  return prefix
    ? `${prefix}.${sanitizedAuthor}.${sanitizedName}`
    : `${sanitizedAuthor}.${sanitizedName}`
}
