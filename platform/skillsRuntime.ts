import { getBundledSkills } from '../skills/bundledSkills.js'
import { initBundledSkills } from '../skills/bundled/index.js'
import {
  getConditionalSkillsCount,
  getDynamicSkills,
} from '../skills/loadSkillsDir.js'
import type { SkillsRuntimeSnapshot } from './runtimeTypes.js'

export function getSkillsRuntimeSnapshot(): SkillsRuntimeSnapshot {
  if (getBundledSkills().length === 0) {
    initBundledSkills()
  }

  return {
    bundledRegistered: getBundledSkills().length,
    dynamicDiscovered: getDynamicSkills().length,
    conditionalPending: getConditionalSkillsCount(),
  }
}
