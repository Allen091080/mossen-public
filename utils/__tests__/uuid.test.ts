import { describe, expect, test } from 'bun:test'
import { extractLeadingUuid, validateUuid } from '../uuid.js'

const UUID = 'a83b2b6c-795f-4a88-9dbb-0d03a4df4bdc'

describe('uuid helpers', () => {
  test('validates complete UUIDs only', () => {
    expect(validateUuid(UUID)).toBe(UUID)
    expect(validateUuid(`${UUID}i-harness`)).toBeNull()
  })

  test('extracts a UUID from pasted terminal suffix text', () => {
    expect(extractLeadingUuid(`${UUID}i-harness`)).toBe(UUID)
    expect(extractLeadingUuid(`  ${UUID}cli-harness`)).toBe(UUID)
  })

  test('does not extract UUIDs from arbitrary search text', () => {
    expect(extractLeadingUuid('resume yesterday')).toBeNull()
    expect(extractLeadingUuid(`prefix ${UUID}`)).toBeNull()
  })
})
