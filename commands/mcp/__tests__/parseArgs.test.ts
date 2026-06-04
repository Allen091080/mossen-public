import { describe, expect, test } from 'bun:test'
import { parseMcpAddArgs } from '../parseAddArgs.js'
import { parseMcpInstallArgs } from '../parseInstallArgs.js'
import { parseMcpAddTemplateArgs } from '../parseTemplateArgs.js'

describe('parseMcpAddArgs', () => {
  test('parses stdio server with command delimiter', () => {
    expect(parseMcpAddArgs([
      'playwright',
      '--scope',
      'project',
      '--env',
      'A=B',
      '--',
      'npx',
      '-y',
      '@playwright/mcp',
    ])).toEqual({
      serverName: 'playwright',
      scope: 'project',
      transport: undefined,
      commandOrUrl: 'npx',
      args: ['-y', '@playwright/mcp'],
      env: ['A=B'],
      headers: undefined,
    })
  })

  test('parses http server URL and repeated headers', () => {
    expect(parseMcpAddArgs([
      'remote',
      '--transport',
      'http',
      'https://example.test/mcp',
      '--header',
      'Authorization: Bearer x',
      '--header',
      'X-Test: y',
    ])).toMatchObject({
      serverName: 'remote',
      transport: 'http',
      commandOrUrl: 'https://example.test/mcp',
      headers: ['Authorization: Bearer x', 'X-Test: y'],
    })
  })

  test('confirm token short-circuits install plan args', () => {
    expect(parseMcpAddArgs(['--confirm', 'abc', 'ignored'])).toEqual({
      confirmToken: 'abc',
    })
  })

  test('reports unsupported flags before command delimiter', () => {
    expect(parseMcpAddArgs(['server', '--bad'])).toEqual({
      unsupportedFlag: '--bad',
    })
  })
})

describe('parseMcpInstallArgs', () => {
  test('parses source, name, scope, and confirm token', () => {
    expect(parseMcpInstallArgs([
      'https://example.test/server.json',
      '--name',
      'server',
      '--scope',
      'user',
      '--confirm',
      'tok',
    ])).toEqual({
      source: 'https://example.test/server.json',
      serverName: 'server',
      scope: 'user',
      confirmToken: 'tok',
    })
  })

  test('reports unsupported install flags', () => {
    expect(parseMcpInstallArgs(['url', '--transport', 'http'])).toEqual({
      unsupportedFlag: '--transport',
    })
  })
})

describe('parseMcpAddTemplateArgs', () => {
  test('parses template options', () => {
    expect(parseMcpAddTemplateArgs([
      'sqlite',
      '--name',
      'local-db',
      '--scope',
      'project',
      '--root',
      '/tmp/project',
      '--db',
      '/tmp/project/app.db',
    ])).toEqual({
      templateName: 'sqlite',
      serverName: 'local-db',
      scope: 'project',
      root: '/tmp/project',
      db: '/tmp/project/app.db',
      confirmToken: undefined,
    })
  })

  test('reports unsupported template flags', () => {
    expect(parseMcpAddTemplateArgs(['sqlite', '--transport', 'stdio'])).toEqual({
      unsupportedFlag: '--transport',
    })
  })
})
