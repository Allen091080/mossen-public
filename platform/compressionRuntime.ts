import { getInvokedSkills } from '../bootstrap/state.js'
import {
  POST_COMPACT_MAX_FILES_TO_RESTORE,
  POST_COMPACT_MAX_TOKENS_PER_FILE,
  POST_COMPACT_TOKEN_BUDGET,
} from '../services/compact/compact.js'
import type { CompressionRuntimeSnapshot } from './runtimeTypes.js'

export function getCompressionRuntimeSnapshot(): CompressionRuntimeSnapshot {
  return {
    available: true,
    postCompactTokenBudget: POST_COMPACT_TOKEN_BUDGET,
    postCompactMaxFilesToRestore: POST_COMPACT_MAX_FILES_TO_RESTORE,
    postCompactMaxTokensPerFile: POST_COMPACT_MAX_TOKENS_PER_FILE,
    invokedSkillCount: getInvokedSkills().size,
  }
}
