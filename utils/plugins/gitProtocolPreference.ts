import { isEnvTruthy } from '../envUtils.js'

export function shouldPreferHttpsForGitHubPluginSources(): boolean {
  return (
    isEnvTruthy(process.env.MOSSEN_CODE_PLUGIN_PREFER_HTTPS) ||
    isEnvTruthy(process.env.MOSSEN_CODE_REMOTE)
  )
}

export function getGitHubPluginGitUrls(repo: string): {
  sshUrl: string
  httpsUrl: string
} {
  return {
    sshUrl: `git@github.com:${repo}.git`,
    httpsUrl: `https://github.com/${repo}.git`,
  }
}
