import {
  MEMORY_SIDECAR_SCHEMA_VERSION,
  type MemorySchemaVersion,
  type MemoryScope,
  isMemoryScope,
  isNonEmptyString,
  isRecord,
} from './scope'

export type ProfileSnapshot = {
  schemaVersion: MemorySchemaVersion
  projectId: string
  scope: MemoryScope
  generatedAt: string
  sourceJobId: string
  preferences: string[]
  habits: string[]
  constraints: string[]
  projectFacts: string[]
  confidence: number
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isConfidence = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1

export function isProfileSnapshot(value: unknown): value is ProfileSnapshot {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.schemaVersion === MEMORY_SIDECAR_SCHEMA_VERSION &&
    isNonEmptyString(value.projectId) &&
    isMemoryScope(value.scope) &&
    isNonEmptyString(value.generatedAt) &&
    isNonEmptyString(value.sourceJobId) &&
    isStringArray(value.preferences) &&
    isStringArray(value.habits) &&
    isStringArray(value.constraints) &&
    isStringArray(value.projectFacts) &&
    isConfidence(value.confidence)
  )
}
