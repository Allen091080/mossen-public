import {
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  type ReadResourceResult,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js'
import type { Command } from '../commands.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import { errorMessage } from '../utils/errors.js'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { logMCPError } from '../utils/log.js'
import { memoizeWithLRU } from '../utils/memoize.js'
import { recursivelySanitizeUnicode } from '../utils/sanitization.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'

const MCP_SKILL_FETCH_CACHE_SIZE = 50

function isSkillResource(resource: Resource): boolean {
  return resource.uri.startsWith('skill://')
}

function getSkillResourceName(resource: Resource): string {
  if (resource.name?.trim()) {
    return resource.name.trim()
  }

  try {
    const url = new URL(resource.uri)
    const lastPathPart = url.pathname.split('/').filter(Boolean).at(-1)
    return (lastPathPart || url.hostname || resource.uri).trim()
  } catch {
    return resource.uri.replace(/^skill:\/\//, '').split(/[/?#]/)[0] || 'skill'
  }
}

function getTextContent(result: ReadResourceResult): string | null {
  const text = result.contents
    .map(content => ('text' in content ? content.text : ''))
    .filter(Boolean)
    .join('\n\n')
    .trim()

  return text || null
}

async function readSkillResource(
  client: MCPServerConnection & { type: 'connected' },
  resource: Resource,
): Promise<Command | null> {
  const rawResult = (await client.client.request(
    {
      method: 'resources/read',
      params: { uri: resource.uri },
    },
    ReadResourceResultSchema,
  )) as ReadResourceResult
  const result = recursivelySanitizeUnicode(rawResult)

  const markdown = getTextContent(result)
  if (!markdown) {
    return null
  }

  const resourceName = getSkillResourceName(resource)
  const skillName = `mcp__${normalizeNameForMCP(client.name)}__${normalizeNameForMCP(resourceName)}`
  const { frontmatter, content } = parseFrontmatter(markdown, resource.uri)
  const { createSkillCommand, parseSkillFrontmatterFields } =
    getMCPSkillBuilders()
  const parsed = parseSkillFrontmatterFields(frontmatter, content, skillName)

  return createSkillCommand({
    ...parsed,
    displayName:
      parsed.displayName ?? (resource as { title?: string }).title ?? resourceName,
    skillName,
    markdownContent: content,
    source: 'mcp',
    baseDir: undefined,
    loadedFrom: 'mcp',
    paths: undefined,
  })
}

export const fetchMcpSkillsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected' || !client.capabilities?.resources) {
      return []
    }

    try {
      const result = await client.client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema,
      )
      const resources = recursivelySanitizeUnicode(
        result.resources ?? [],
      ).filter(isSkillResource)
      if (resources.length === 0) {
        return []
      }

      const commands = await Promise.all(
        resources.map(resource =>
          readSkillResource(client, resource).catch(error => {
            logMCPError(
              client.name,
              `Failed to read MCP skill '${resource.uri}': ${errorMessage(error)}`,
            )
            return null
          }),
        ),
      )
      return commands.filter((command): command is Command => command !== null)
    } catch (error) {
      logMCPError(
        client.name,
        `Failed to fetch MCP skills: ${errorMessage(error)}`,
      )
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_SKILL_FETCH_CACHE_SIZE,
)
