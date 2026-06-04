import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getOriginalCwd, setOriginalCwd } from '../../../bootstrap/state.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import {
  hasRecordedWorkflowUsageConsent,
  hasTrustedWorkflowUsageWarningBypass,
  recordWorkflowUsageConsent,
  workflowNeedsUsageConsentPrompt,
  workflowUsageConsentHash,
} from '../usageConsent.js'

let priorCwd = ''
let priorConfigDir: string | undefined
let tempRoot = ''
let tempConfigRoot = ''

function useTempProject(): string {
  priorCwd = getOriginalCwd()
  priorConfigDir = process.env.MOSSEN_CONFIG_DIR
  tempRoot = mkdtempSync(join(tmpdir(), 'mossen-workflow-consent-'))
  tempConfigRoot = join(tempRoot, 'config')
  setOriginalCwd(tempRoot)
  process.env.MOSSEN_CONFIG_DIR = tempConfigRoot
  resetSettingsCache()
  return tempRoot
}

function restoreProject(): void {
  if (priorCwd) {
    setOriginalCwd(priorCwd)
    priorCwd = ''
  }
  if (priorConfigDir === undefined) {
    delete process.env.MOSSEN_CONFIG_DIR
  } else {
    process.env.MOSSEN_CONFIG_DIR = priorConfigDir
  }
  priorConfigDir = undefined
  resetSettingsCache()
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = ''
    tempConfigRoot = ''
  }
}

describe('workflow usage consent', () => {
  beforeEach(() => {
    useTempProject()
  })

  afterEach(() => {
    restoreProject()
  })

  test('hashes workflow source deterministically without storing source text', () => {
    const hash = workflowUsageConsentHash('phase("Review")')

    expect(hash).toMatch(/^wf_sha256:[a-f0-9]{64}$/)
    expect(workflowUsageConsentHash('phase("Review")')).toBe(hash)
    expect(workflowUsageConsentHash('phase("Ship")')).not.toBe(hash)
  })

  test('records local workflow consent and suppresses later prompts for the same source', () => {
    const hash = workflowUsageConsentHash('export const meta = {}')

    expect(workflowNeedsUsageConsentPrompt(hash)).toBe(true)
    expect(hasRecordedWorkflowUsageConsent(hash)).toBe(false)
    expect(recordWorkflowUsageConsent(hash)).toBe(true)
    expect(workflowNeedsUsageConsentPrompt(hash)).toBe(false)
    expect(hasRecordedWorkflowUsageConsent(hash)).toBe(true)

    const settingsPath = join(tempRoot, '.mossen', 'settings.local.json')
    expect(existsSync(settingsPath)).toBe(true)
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(settings.workflowUsageConsentHashes).toEqual([hash])
    expect(JSON.stringify(settings)).not.toContain('export const meta')
  })

  test('can record auto-mode workflow consent in user settings', () => {
    const hash = workflowUsageConsentHash('export const meta = { name: "auto" }')

    expect(recordWorkflowUsageConsent(hash, 'userSettings')).toBe(true)
    expect(workflowNeedsUsageConsentPrompt(hash)).toBe(false)

    const settingsPath = join(tempConfigRoot, 'settings.json')
    expect(existsSync(settingsPath)).toBe(true)
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(settings.workflowUsageConsentHashes).toEqual([hash])
  })

  test('does not trust shared project settings to suppress workflow usage consent', () => {
    const hash = workflowUsageConsentHash('project controlled workflow')
    const projectSettingsDir = join(tempRoot, '.mossen')
    mkdirSync(projectSettingsDir, { recursive: true })
    writeFileSync(
      join(projectSettingsDir, 'settings.json'),
      JSON.stringify(
        {
          skipWorkflowUsageWarning: true,
          workflowUsageConsentHashes: [hash],
        },
        null,
        2,
      ),
    )
    resetSettingsCache()

    expect(hasTrustedWorkflowUsageWarningBypass()).toBe(false)
    expect(hasRecordedWorkflowUsageConsent(hash)).toBe(false)
    expect(workflowNeedsUsageConsentPrompt(hash)).toBe(true)
  })
})
