import { describe, expect, test } from 'bun:test'
import {
  extractGoalContract,
  extractTurnBudget,
  parseSessionGoalAction,
} from '../sessionGoalCommand.js'

describe('extractTurnBudget', () => {
  test('returns text unchanged when no flag', () => {
    expect(extractTurnBudget('implement the parser')).toEqual({
      text: 'implement the parser',
    })
  })

  test('parses a trailing --turns N', () => {
    expect(extractTurnBudget('ship the feature --turns 30')).toEqual({
      text: 'ship the feature',
      turnBudget: 30,
    })
  })

  test('parses --turns=N form', () => {
    expect(extractTurnBudget('do it --turns=12')).toEqual({
      text: 'do it',
      turnBudget: 12,
    })
  })

  test('parses an inline flag and collapses whitespace', () => {
    expect(extractTurnBudget('fix --turns 5 the bug')).toEqual({
      text: 'fix the bug',
      turnBudget: 5,
    })
  })

  test('clamps to [1,500]', () => {
    expect(extractTurnBudget('x --turns 9999').turnBudget).toBe(500)
    expect(extractTurnBudget('x --turns 0').turnBudget).toBe(1)
  })

  test('ignores a non-numeric flag value', () => {
    expect(extractTurnBudget('x --turns abc')).toEqual({ text: 'x --turns abc' })
  })

  test('ignores --turns inside code spans', () => {
    expect(extractTurnBudget('document `--turns 99` behavior --turns 3')).toEqual({
      text: 'document `--turns 99` behavior',
      turnBudget: 3,
    })
  })

  test('a body that is only the flag yields empty text', () => {
    expect(extractTurnBudget('--turns 10')).toEqual({ text: '', turnBudget: 10 })
  })
})

// parseSessionGoalAction returns { action, body }. The --turns flag lives in
// `body` and is extracted by the set handler via extractTurnBudget, so here we
// only lock that the parser routes actions correctly and leaves body intact.
describe('parseSessionGoalAction', () => {
  test('empty args → status', () => {
    expect(parseSessionGoalAction('')).toEqual({ action: 'status', body: '' })
  })

  test('explicit set keeps the body (flag included) for the handler', () => {
    expect(parseSessionGoalAction('set build the API --turns 40')).toEqual({
      action: 'set',
      body: 'build the API --turns 40',
    })
  })

  test('bare text (no subcommand) is treated as set', () => {
    expect(parseSessionGoalAction('refactor module --turns 8')).toEqual({
      action: 'set',
      body: 'refactor module --turns 8',
    })
  })

  test('subcommands route correctly', () => {
    expect(parseSessionGoalAction('status').action).toBe('status')
    expect(parseSessionGoalAction('why').action).toBe('explain')
    expect(parseSessionGoalAction('explain').action).toBe('explain')
    expect(parseSessionGoalAction('pause').action).toBe('pause')
    expect(parseSessionGoalAction('resume').action).toBe('resume')
    expect(parseSessionGoalAction('edit').action).toBe('edit')
    expect(parseSessionGoalAction('budget').action).toBe('budget')
    expect(parseSessionGoalAction('history').action).toBe('history')
    expect(parseSessionGoalAction('done').action).toBe('done')
    expect(parseSessionGoalAction('complete').action).toBe('done')
    expect(parseSessionGoalAction('stop').action).toBe('clear')
    expect(parseSessionGoalAction('off').action).toBe('clear')
    expect(parseSessionGoalAction('clear').action).toBe('clear')
  })
})

describe('extractGoalContract', () => {
  test('extracts success criteria and constraints', () => {
    expect(
      extractGoalContract('Fix goal --criteria tests pass --constraints no secrets'),
    ).toEqual({
      text: 'Fix goal',
      successCriteria: 'tests pass',
      constraints: 'no secrets',
    })
  })

  test('leaves plain text unchanged', () => {
    expect(extractGoalContract('Fix goal')).toEqual({ text: 'Fix goal' })
  })

  test('extracts multiline criteria and constraints', () => {
    expect(
      extractGoalContract('Fix goal\n--criteria tests pass\n- smoke passes\n--constraints no secrets'),
    ).toEqual({
      text: 'Fix goal',
      successCriteria: 'tests pass\n- smoke passes',
      constraints: 'no secrets',
    })
  })

  test('allows quoted values to contain flag-like text', () => {
    expect(
      extractGoalContract(
        'Document flags --criteria "mention --constraints literally" --constraints no secrets',
      ),
    ).toEqual({
      text: 'Document flags',
      successCriteria: 'mention --constraints literally',
      constraints: 'no secrets',
    })
  })

  test('ignores flag-like text inside code spans', () => {
    expect(
      extractGoalContract('Document `--criteria value` examples --constraints no secrets'),
    ).toEqual({
      text: 'Document `--criteria value` examples',
      constraints: 'no secrets',
    })
  })
})

// End-to-end of the set-handler logic: extractTurnBudget applied to a parsed
// body yields both the goal text and the budget the handler passes through.
describe('set body → extractTurnBudget composition', () => {
  test('explicit set with a budget', () => {
    const { body } = parseSessionGoalAction('set build the API --turns 40')
    expect(extractTurnBudget(body)).toEqual({
      text: 'build the API',
      turnBudget: 40,
    })
  })

  test('bare set without a budget', () => {
    const { body } = parseSessionGoalAction('write the tests')
    expect(extractTurnBudget(body)).toEqual({ text: 'write the tests' })
  })
})
