// W435f — Redaction rule behavior tests.
//
// Pure function; no fixture needed. Each test pins a specific redaction
// rule's behavior so a future regex tweak that breaks one rule is caught.
// W119 H5 (think-strip) is owned by captureFilters.test.ts; this file
// covers the secret/PII rules in redact.ts.
import { describe, expect, test } from 'bun:test'
import {
  getMemoryRedactionVersion,
  redactMemoryText,
} from '../redact.js'

describe('getMemoryRedactionVersion', () => {
  test('returns a positive integer', () => {
    const v = getMemoryRedactionVersion()
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThan(0)
  })
})

describe('redactMemoryText — no-op cases', () => {
  test('empty string: applied false, notes empty', () => {
    const r = redactMemoryText('')
    expect(r.text).toBe('')
    expect(r.applied).toBe(false)
    expect(r.notes).toEqual([])
  })

  test('plain prose: passed through unchanged', () => {
    const input = 'The function returns a Promise resolving to an integer.'
    const r = redactMemoryText(input)
    expect(r.text).toBe(input)
    expect(r.applied).toBe(false)
  })
})

describe('redactMemoryText — secret rules', () => {
  test('OpenAI-style sk- key is redacted', () => {
    const r = redactMemoryText(
      'My OpenAI key is sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf01234567 thanks',
    )
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_SECRET]')
    expect(r.text).not.toContain('sk-proj-AbCdEf')
    expect(r.notes).toContain('redacted OpenAI-style API key')
  })

  test('Bearer token is redacted', () => {
    const r = redactMemoryText(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.foo',
    )
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_SECRET]')
    expect(r.text).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  })

  test('GitHub token is redacted', () => {
    const r = redactMemoryText('Use ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456 to push')
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_SECRET]')
    expect(r.text).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456')
  })

  test('AWS access key id is redacted', () => {
    const r = redactMemoryText('AKIAIOSFODNN7EXAMPLE is the access key')
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_SECRET]')
    expect(r.text).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  test('AWS temporary key id (ASIA prefix) is redacted', () => {
    const r = redactMemoryText('Use ASIA1234567890ABCDEF for temp creds')
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_SECRET]')
  })

  test('private key block is redacted whole', () => {
    const input = [
      'Keep this safe:',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIICXQIBAAKBgQDmZxF0fA...',
      'XXXXXXXXXXXXXXXXXXXXXX==',
      '-----END RSA PRIVATE KEY-----',
      'done.',
    ].join('\n')
    const r = redactMemoryText(input)
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_PRIVATE_KEY]')
    expect(r.text).not.toContain('MIICXQIBAAKBgQDmZxF0fA')
    expect(r.notes).toContain('redacted private key block')
  })

  test('email address is redacted', () => {
    const r = redactMemoryText('Contact me at allen@example.com please')
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_EMAIL]')
    expect(r.text).not.toContain('allen@example.com')
  })

  test('SECRET-style env assignment is redacted', () => {
    const r = redactMemoryText('export STRIPE_SECRET_KEY=sk_live_AbCdEfGhIjKl')
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_SECRET]')
    expect(r.text).not.toContain('sk_live_AbCdEfGhIjKl')
  })

  test('--api-key CLI arg is redacted', () => {
    const r = redactMemoryText('curl --api-key abc123abc123abc123 https://api')
    expect(r.applied).toBe(true)
    expect(r.text).toContain('[REDACTED_SECRET]')
    expect(r.text).not.toContain('abc123abc123abc123')
  })

  test('multiple secrets in one text accumulate notes', () => {
    const r = redactMemoryText(
      'sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf01234567 and ghp_AbCdEfGhIjKlMnOpQrStUv1234567',
    )
    expect(r.applied).toBe(true)
    expect(r.notes.length).toBeGreaterThanOrEqual(2)
    expect(r.notes).toContain('redacted OpenAI-style API key')
    expect(r.notes).toContain('redacted GitHub token')
  })

  test('notes are deduplicated across multiple matches of same rule', () => {
    const r = redactMemoryText(
      'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA and sk-proj-BBBBBBBBBBBBBBBBBBBBBBBB',
    )
    expect(r.applied).toBe(true)
    expect(
      r.notes.filter(n => n === 'redacted OpenAI-style API key').length,
    ).toBe(1)
  })
})
