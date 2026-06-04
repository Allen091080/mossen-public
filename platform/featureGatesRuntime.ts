import { feature } from 'bun:bundle'
import type { FeatureGatesRuntimeSnapshot } from './runtimeTypes.js'

function resolve(name: string): boolean {
  if (name === 'DIRECT_CONNECT') {
    return feature('DIRECT_CONNECT') ? true : false
  }
  if (name === 'SSH_REMOTE') {
    return feature('SSH_REMOTE') ? true : false
  }
  if (name === 'KAIROS') {
    return feature('KAIROS') ? true : false
  }
  if (name === 'KAIROS_BRIEF') {
    return feature('KAIROS_BRIEF') ? true : false
  }
  if (name === 'TRANSCRIPT_CLASSIFIER') {
    return feature('TRANSCRIPT_CLASSIFIER') ? true : false
  }
  if (name === 'CHICAGO_MCP') {
    return feature('CHICAGO_MCP') ? true : false
  }
  if (name === 'VOICE_MODE') {
    return feature('VOICE_MODE') ? true : false
  }
  if (name === 'DAEMON') {
    return feature('DAEMON') ? true : false
  }
  return false
}

export function getFeatureGatesRuntimeSnapshot(): FeatureGatesRuntimeSnapshot {
  return {
    directConnect: resolve('DIRECT_CONNECT'),
    sshRemote: resolve('SSH_REMOTE'),
    kairos: resolve('KAIROS'),
    kairosBrief: resolve('KAIROS_BRIEF'),
    transcriptClassifier: resolve('TRANSCRIPT_CLASSIFIER'),
    chicagoMcp: resolve('CHICAGO_MCP'),
    voiceMode: resolve('VOICE_MODE'),
    daemon: resolve('DAEMON'),
  }
}
