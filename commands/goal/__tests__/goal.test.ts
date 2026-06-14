import { beforeEach, describe, expect, test } from 'bun:test'
import {
  getSessionGoalState,
  resetStateForTests,
} from '../../../bootstrap/state.js'
import {
  clearMossenConfigOverrides,
  setMossenConfigOverride,
} from '../../../services/config/facade.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../../types/command.js'
import { getSessionGoalEventFromMessage } from '../../../utils/sessionGoalEvents.js'
import { call } from '../goal.js'

const BACKEND_ENV_KEYS = [
  'MOSSEN_CODE_API_BASE_URL',
  'MOSSEN_CODE_AUTH_TOKEN',
  'MOSSEN_CODE_AUTH_TOKEN_FILE_DESCRIPTOR',
  'MOSSEN_CODE_AUTH_REFRESH_TOKEN',
  'MOSSEN_CODE_CUSTOM_BASE_URL',
  'MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER',
  'MOSSEN_CODE_USE_CUSTOM_BACKEND',
] as const

beforeEach(() => {
  resetStateForTests()
  clearMossenConfigOverrides()
})

async function withNoBackendConfigured(
  callback: () => Promise<void>,
): Promise<void> {
  const previousEnv = new Map<string, string | undefined>()
  for (const key of BACKEND_ENV_KEYS) {
    previousEnv.set(key, process.env[key])
    delete process.env[key]
  }
  setMossenConfigOverride('mossen.activeProfile', null)
  try {
    await callback()
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    clearMossenConfigOverrides()
  }
}

function createCommandContext(): LocalJSXCommandContext {
  return {
    setMessages: () => {},
    options: {
      ideInstallationStatus: null,
      theme: 'dark',
    },
    onChangeAPIKey: () => {},
  } as unknown as LocalJSXCommandContext
}

describe('/goal command', () => {
  test('sets a paused goal without querying when no backend is configured', async () => {
    await withNoBackendConfigured(async () => {
      let result = ''
      let options: Parameters<LocalJSXCommandOnDone>[1] | undefined

      await call(
        (nextResult, nextOptions) => {
          result = nextResult ?? ''
          options = nextOptions
        },
        createCommandContext(),
        'set finish the user journey',
      )

      expect(result).toContain('finish the user journey')
      expect(result).toContain('/goal resume')
      expect(options?.shouldQuery).toBe(false)
      expect(options?.metaMessages).toEqual([])
      expect(
        options?.systemMessages?.map(message =>
          getSessionGoalEventFromMessage(message)?.type,
        ),
      ).toEqual(['goal_created', 'goal_paused'])
      expect(getSessionGoalState()?.status).toBe('paused')
      expect(getSessionGoalState()?.lastEvaluatorReason).toContain(
        'No Mossen backend is configured',
      )
    })
  })
})
