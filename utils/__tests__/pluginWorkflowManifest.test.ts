import { describe, expect, test } from 'bun:test'
import {
  PluginManifestSchema,
  PluginMarketplaceEntrySchema,
} from '../plugins/schemas.js'

describe('plugin workflow manifest fields', () => {
  test('plugin manifests accept workflow script and directory paths', () => {
    const parsed = PluginManifestSchema().parse({
      name: 'workflow-pack',
      workflows: ['./workflows', './single.js'],
    })

    expect(parsed.workflows).toEqual(['./workflows', './single.js'])
  })

  test('marketplace entries can supplement workflow paths', () => {
    const parsed = PluginMarketplaceEntrySchema().parse({
      name: 'workflow-pack',
      source: './workflow-pack',
      workflows: './workflows',
    })

    expect(parsed.workflows).toBe('./workflows')
  })

  test('workflow paths must remain relative to the plugin root', () => {
    const parsed = PluginManifestSchema().safeParse({
      name: 'workflow-pack',
      workflows: ['/tmp/workflows'],
    })

    expect(parsed.success).toBe(false)
  })
})
