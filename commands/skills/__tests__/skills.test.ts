import { describe, expect, test } from 'bun:test'
import type { Command } from '../../../types/command.js'
import { parseSkillsArgs } from '../parseArgs.js'
import { formatSkillsDoctor } from '../SkillsDoctor.js'

function skill(overrides: Partial<Command> & { name: string }): Command {
  return {
    type: 'prompt',
    name: overrides.name,
    description: 'test skill',
    progressMessage: 'loading',
    contentLength: 12,
    source: 'bundled',
    loadedFrom: 'bundled',
    getPromptForCommand: async () => [],
    ...overrides,
  } as Command
}

describe('parseSkillsArgs', () => {
  test('routes empty and unknown args to menu', () => {
    expect(parseSkillsArgs()).toEqual({ type: 'menu' })
    expect(parseSkillsArgs('   ')).toEqual({ type: 'menu' })
    expect(parseSkillsArgs('unknown anything')).toEqual({ type: 'menu' })
  })

  test('routes help and doctor aliases', () => {
    expect(parseSkillsArgs('help')).toEqual({ type: 'help' })
    expect(parseSkillsArgs('--help')).toEqual({ type: 'help' })
    expect(parseSkillsArgs('diag')).toEqual({ type: 'doctor' })
    expect(parseSkillsArgs('diagnose')).toEqual({ type: 'doctor' })
  })

  test('parses install target and confirm token', () => {
    expect(parseSkillsArgs('install https://example.com/repo')).toEqual({
      type: 'install',
      target: 'https://example.com/repo',
      confirmToken: undefined,
    })
    expect(parseSkillsArgs('i https://example.com/repo --confirm tok123')).toEqual({
      type: 'install',
      target: 'https://example.com/repo',
      confirmToken: 'tok123',
    })
  })
})

describe('formatSkillsDoctor', () => {
  test('summarizes visible skill registry and sources', () => {
    const output = formatSkillsDoctor([
      skill({ name: 'alpha', loadedFrom: 'bundled', source: 'bundled' }),
      skill({ name: 'beta', loadedFrom: 'skills', source: 'builtin' }),
    ])
    expect(output).toMatch(/visible skills: 2|可见 skills: 2/)
    expect(output).toContain('bundled:1')
    expect(output).toContain('skills:1')
    expect(output).toMatch(/Skill registry is visible|可以看到 skill registry/)
  })

  test('reports duplicates and broken prompt handlers', () => {
    const output = formatSkillsDoctor([
      skill({ name: 'dupe', loadedFrom: 'skills', source: 'builtin' }),
      skill({
        name: 'dupe',
        loadedFrom: 'plugin',
        source: 'plugin',
        description: '',
        contentLength: 0,
        getPromptForCommand: undefined,
      } as Partial<Command> & { name: string }),
    ])
    expect(output).toMatch(/Duplicate visible skill names: dupe|skill 名称重复: dupe/)
    expect(output).toMatch(/Skills missing descriptions: dupe|缺少描述的 skills: dupe/)
    expect(output).toMatch(/Skills missing prompt handlers: dupe|缺少 prompt handler 的 skills: dupe/)
    expect(output).toMatch(/unrecorded contentLength metadata: dupe|contentLength 元数据未记录的 skills: dupe/)
  })
})
