/**
 * Mossen multi-profile CLI flag handler (S1-09c, D-S09-2=Z).
 *
 * 对外 (用户友好):
 *   mossen --list-model-profiles
 *   mossen --get-model-profile [<name>]              # 无 name = 当前 active
 *   mossen --set-model-profile <name>                # 切换 active profile
 *   mossen --add-model-profile <name>
 *           [--provider openai-compatible|messages-compatible]
 *           --baseURL <url>
 *           --model <id>
 *           --apiKey <key>
 *           [--maxInputTokens <tokens>]
 *           [--name <display-name>]
 *           [--scope user|project]                   # default user
 *   mossen --update-model-profile <name>
 *           [--baseURL <url>] [--model <id>]
 *           [--apiKey <key>] [--maxInputTokens <tokens|default>]
 *           [--name <display-name>]
 *           [--scope user|project]
 *   mossen --set-model-profile-key <name> <key> [--scope ...]
 *   mossen --delete-model-profile <name> [--scope ...]
 *
 * 内部 (D-S09-2=Z): 全部走 services/config/profiles.ts (已建在 facade chain 上).
 *
 * 输出 contract:
 *   - stdout = JSON (UI 可解析)
 *   - 任何 dump apiKey 的字段必须用 maskApiKey 脱敏
 *   - exit 0 = 成功; exit 1 = 校验失败 / 未找到; exit 2 = 内部异常
 */

import {
  desensitizeProfile,
  desensitizeProfiles,
  getProfiles,
  getActiveProfileName,
  getProfileByName,
  setProfile,
  setActiveProfile,
  deleteProfile,
  testProfile,
  getFallbackProfile,
  listAllProfiles,
  getCurrentProfile,
  getDefaultProfile,
  migrateFallbackProfile,
  resolveDefaultProfileProvider,
  type ProfileSchema,
  type ProfileProvider,
  PROFILE_PROVIDER_VALUES,
} from './profiles.js'

const MODEL_PROFILE_FLAGS = [
  '--list-model-profiles',
  '--get-model-profile',
  '--set-model-profile',
  '--add-model-profile',
  '--update-model-profile',
  '--set-model-profile-key',
  '--delete-model-profile',
  '--test-model-profile',
  '--migrate-fallback-profile',
] as const

export type ModelProfileFlag = (typeof MODEL_PROFILE_FLAGS)[number]

export function isModelProfileFlagPresent(args: readonly string[]): boolean {
  return args.some(arg => (MODEL_PROFILE_FLAGS as readonly string[]).includes(arg))
}

function findFlag(args: readonly string[], flag: string): number {
  return args.indexOf(flag)
}

function getOptionValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const next = args[idx + 1]
  if (next === undefined || next.startsWith('--')) return undefined
  return next
}

function parseScope(args: readonly string[]): 'user' | 'project' {
  const v = getOptionValue(args, '--scope')
  if (v === 'project') return 'project'
  return 'user'
}

function parseMaxInputTokensOption(
  args: readonly string[],
): { ok: true; present: boolean; value?: number | null } | { ok: false; reason: string } {
  const raw =
    getOptionValue(args, '--maxInputTokens') ||
    getOptionValue(args, '--max-input-tokens')
  if (raw === undefined) return { ok: true, present: false }
  const normalized = raw.trim().toLowerCase()
  if (['default', 'none', 'off', 'clear'].includes(normalized)) {
    return { ok: true, present: true, value: null }
  }
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    return {
      ok: false,
      reason:
        '--maxInputTokens must be a positive integer, or one of default|none|off|clear',
    }
  }
  return { ok: true, present: true, value: Number.parseInt(normalized, 10) }
}

function emitJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function emitError(msg: string): void {
  process.stderr.write(`error: ${msg}\n`)
}

export async function handleModelProfileCliFlag(
  args: readonly string[],
): Promise<{ handled: boolean; exitCode: number }> {
  if (!isModelProfileFlagPresent(args)) {
    return { handled: false, exitCode: 0 }
  }

  try {
    // --list-model-profiles
    if (findFlag(args, '--list-model-profiles') !== -1) {
      const settingsProfiles = getProfiles()
      const desensitizedSettings = desensitizeProfiles(settingsProfiles)
      const all = listAllProfiles()
      const fallback = getFallbackProfile()
      const current = getCurrentProfile()
      const defaultP = getDefaultProfile()
      const allWithSource = all.map(item => ({
        name: item.name,
        source: item.source,
        profile: desensitizeProfile(item.profile),
      }))
      emitJson({
        // 兼容旧 contract: settings-持久化 profile map (apiKey 脱敏)
        profiles: desensitizedSettings,
        // 旧字段: settings 中 active 字段值 (run-time override 后是 session 名;
        // 若 active 指向不存在的 profile 或为 null → null)
        activeProfile: getActiveProfileName(),
        // S1-09 闭环新字段:
        // 完整可见 profile 列表 (含 fallback 虚拟 profile, source 区分)
        allProfiles: allWithSource,
        // fallback (env-based 虚拟 profile, apiKey 脱敏); 不存在则 null
        fallbackProfile: fallback
          ? { name: fallback.name, source: fallback.source, profile: desensitizeProfile(fallback.profile) }
          : null,
        // 当前会话实际在用的 profile (session > user > fallback)
        currentProfile: current
          ? { name: current.name, source: current.source, profile: desensitizeProfile(current.profile) }
          : null,
        // 全局默认 profile (settings active > fallback)
        defaultProfile: defaultP
          ? { name: defaultP.name, source: defaultP.source, profile: desensitizeProfile(defaultP.profile) }
          : null,
        count: Object.keys(desensitizedSettings).length,
        countAll: allWithSource.length,
      })
      return { handled: true, exitCode: 0 }
    }

    // --get-model-profile [<name>]
    {
      const idx = findFlag(args, '--get-model-profile')
      if (idx !== -1) {
        const explicitName = args[idx + 1]
        const targetName = explicitName && !explicitName.startsWith('--') ? explicitName : null
        if (targetName) {
          const p = getProfileByName(targetName)
          if (p) {
            emitJson({ name: targetName, source: 'settings', profile: desensitizeProfile(p) })
            return { handled: true, exitCode: 0 }
          }
          const fb = getFallbackProfile()
          if (fb && fb.name === targetName) {
            emitJson({ name: targetName, source: fb.source, profile: desensitizeProfile(fb.profile) })
            return { handled: true, exitCode: 0 }
          }
          emitError(`profile "${targetName}" not found`)
          return { handled: true, exitCode: 1 }
        }
        // 无 name → 当前会话实际在用的 (session > user-default > fallback)
        const current = getCurrentProfile()
        if (!current) {
          emitJson({ name: null, source: null, profile: null })
          return { handled: true, exitCode: 0 }
        }
        emitJson({ name: current.name, source: current.source, profile: desensitizeProfile(current.profile) })
        return { handled: true, exitCode: 0 }
      }
    }

    const scope = parseScope(args)

    // --set-model-profile <name>  (切换 active)
    {
      const idx = findFlag(args, '--set-model-profile')
      if (idx !== -1) {
        const name = args[idx + 1]
        if (!name || name.startsWith('--')) {
          emitError('--set-model-profile requires a <name> argument')
          return { handled: true, exitCode: 1 }
        }
        try {
          const r = setActiveProfile(name, scope)
          emitJson({
            ok: true,
            activeProfile: r.activeProfile,
            source: r.source,
            profile: desensitizeProfile(r.profile),
            scope,
          })
          return { handled: true, exitCode: 0 }
        } catch (e) {
          emitError((e as Error).message)
          return { handled: true, exitCode: 1 }
        }
      }
    }

    // --add-model-profile <name> [--provider X] --baseURL Y --model M --apiKey K [--name N]
    {
      const idx = findFlag(args, '--add-model-profile')
      if (idx !== -1) {
        const name = args[idx + 1]
        if (!name || name.startsWith('--')) {
          emitError('--add-model-profile requires a <name> argument')
          return { handled: true, exitCode: 1 }
        }
        if (getProfileByName(name)) {
          emitError(`profile "${name}" already exists; use --update-model-profile to modify`)
          return { handled: true, exitCode: 1 }
        }
        const provider = getOptionValue(args, '--provider')
        const baseURL = getOptionValue(args, '--baseURL')
        const model = getOptionValue(args, '--model')
        const apiKey = getOptionValue(args, '--apiKey')
        const displayName = getOptionValue(args, '--name')
        const maxInputTokens = parseMaxInputTokensOption(args)
        if (maxInputTokens.ok === false) {
          emitError(maxInputTokens.reason)
          return { handled: true, exitCode: 1 }
        }

        const missing: string[] = []
        if (!baseURL) missing.push('--baseURL')
        if (!model) missing.push('--model')
        if (!apiKey) missing.push('--apiKey')
        if (missing.length) {
          emitError(`--add-model-profile missing required: ${missing.join(', ')}`)
          return { handled: true, exitCode: 1 }
        }
        const resolvedProvider = provider ?? resolveDefaultProfileProvider(baseURL)
        if (!(PROFILE_PROVIDER_VALUES as readonly string[]).includes(resolvedProvider)) {
          emitError(`--provider must be one of ${PROFILE_PROVIDER_VALUES.join('|')}, got "${provider}"`)
          return { handled: true, exitCode: 1 }
        }
        const schema: ProfileSchema = {
          provider: resolvedProvider as ProfileProvider,
          baseURL: baseURL!,
          model: model!,
          apiKey: apiKey!,
          ...(maxInputTokens.value ? { maxInputTokens: maxInputTokens.value } : {}),
          ...(displayName ? { name: displayName } : {}),
        }
        try {
          setProfile(name, schema, scope)
          emitJson({
            ok: true,
            action: 'add',
            name,
            profile: desensitizeProfile(schema),
            scope,
          })
          return { handled: true, exitCode: 0 }
        } catch (e) {
          emitError((e as Error).message)
          return { handled: true, exitCode: 1 }
        }
      }
    }

    // --update-model-profile <name> [--baseURL Y] [--model M] [--apiKey K] [--name N]
    {
      const idx = findFlag(args, '--update-model-profile')
      if (idx !== -1) {
        const name = args[idx + 1]
        if (!name || name.startsWith('--')) {
          emitError('--update-model-profile requires a <name> argument')
          return { handled: true, exitCode: 1 }
        }
        const existing = getProfileByName(name)
        if (!existing) {
          emitError(`profile "${name}" not found; use --add-model-profile to create`)
          return { handled: true, exitCode: 1 }
        }
        const baseURL = getOptionValue(args, '--baseURL') ?? existing.baseURL
        const model = getOptionValue(args, '--model') ?? existing.model
        const apiKey = getOptionValue(args, '--apiKey') ?? existing.apiKey
        const displayName = getOptionValue(args, '--name') ?? existing.name
        const provider = getOptionValue(args, '--provider') ?? existing.provider
        const maxInputTokens = parseMaxInputTokensOption(args)
        if (maxInputTokens.ok === false) {
          emitError(maxInputTokens.reason)
          return { handled: true, exitCode: 1 }
        }
        const schema: ProfileSchema = {
          provider: provider as ProfileProvider,
          baseURL,
          model,
          apiKey,
          ...(maxInputTokens.present
            ? maxInputTokens.value
              ? { maxInputTokens: maxInputTokens.value }
              : {}
            : existing.maxInputTokens
              ? { maxInputTokens: existing.maxInputTokens }
              : {}),
          ...(displayName ? { name: displayName } : {}),
        }
        try {
          setProfile(name, schema, scope)
          emitJson({
            ok: true,
            action: 'update',
            name,
            profile: desensitizeProfile(schema),
            scope,
          })
          return { handled: true, exitCode: 0 }
        } catch (e) {
          emitError((e as Error).message)
          return { handled: true, exitCode: 1 }
        }
      }
    }

    // --set-model-profile-key <name> <key>
    {
      const idx = findFlag(args, '--set-model-profile-key')
      if (idx !== -1) {
        const name = args[idx + 1]
        const key = args[idx + 2]
        if (!name || name.startsWith('--') || !key || key.startsWith('--')) {
          emitError('--set-model-profile-key requires <name> <key> arguments')
          return { handled: true, exitCode: 1 }
        }
        const existing = getProfileByName(name)
        if (!existing) {
          emitError(`profile "${name}" not found`)
          return { handled: true, exitCode: 1 }
        }
        try {
          const updated: ProfileSchema = { ...existing, apiKey: key }
          setProfile(name, updated, scope)
          emitJson({
            ok: true,
            action: 'set-key',
            name,
            profile: desensitizeProfile(updated),
            scope,
          })
          return { handled: true, exitCode: 0 }
        } catch (e) {
          emitError((e as Error).message)
          return { handled: true, exitCode: 1 }
        }
      }
    }

    // --delete-model-profile <name>
    {
      const idx = findFlag(args, '--delete-model-profile')
      if (idx !== -1) {
        const name = args[idx + 1]
        if (!name || name.startsWith('--')) {
          emitError('--delete-model-profile requires a <name> argument')
          return { handled: true, exitCode: 1 }
        }
        const r = deleteProfile(name, scope)
        emitJson({
          ok: true,
          action: 'delete',
          name,
          deleted: r.deleted,
          activeProfileCleared: r.activeProfileCleared,
          remainingProfiles: Object.keys(r.profiles).sort(),
          scope,
        })
        return { handled: true, exitCode: r.deleted ? 0 : 1 }
      }
    }

    // --migrate-fallback-profile [--scope user|project] [--name <override>] [--force]
    //                            [--activate auto|always|never]
    // S1-09 收口: 把 env fallback 升级为正式 settings profile.
    {
      const idx = findFlag(args, '--migrate-fallback-profile')
      if (idx !== -1) {
        const targetName = getOptionValue(args, '--name')
        const force = args.includes('--force')
        const activateRaw = getOptionValue(args, '--activate')
        let activate: 'auto' | 'always' | 'never' = 'auto'
        if (activateRaw === 'always' || activateRaw === 'never' || activateRaw === 'auto') {
          activate = activateRaw
        } else if (activateRaw !== undefined) {
          emitError(`--activate must be one of auto|always|never, got "${activateRaw}"`)
          return { handled: true, exitCode: 1 }
        }
        const result = migrateFallbackProfile({
          scope,
          ...(targetName ? { targetName } : {}),
          force,
          activate,
        })
        if (result.ok === false) {
          emitError(result.reason)
          return { handled: true, exitCode: 1 }
        }
        if (result.migrated === true) {
          const written = getProfileByName(result.profileName)
          emitJson({
            ok: true,
            action: 'migrate',
            migrated: true,
            profileName: result.profileName,
            activeProfileSet: result.activeProfileSet,
            scope: result.scope,
            profile: written ? desensitizeProfile(written) : null,
          })
          return { handled: true, exitCode: 0 }
        }
        emitJson({
          ok: true,
          action: 'migrate',
          migrated: false,
          reason: result.reason,
          ...(result.profileName ? { profileName: result.profileName } : {}),
          scope: result.scope,
        })
        return { handled: true, exitCode: 0 }
      }
    }

    // --test-model-profile <name> [--timeout <ms>]
    // 真发 GET <baseURL>/models 验连通性 + apiKey 透传 (Workbench 测试连接).
    {
      const idx = findFlag(args, '--test-model-profile')
      if (idx !== -1) {
        const name = args[idx + 1]
        if (!name || name.startsWith('--')) {
          emitError('--test-model-profile requires a <name> argument')
          return { handled: true, exitCode: 1 }
        }
        const profile = getProfileByName(name)
        if (!profile) {
          emitError(`profile "${name}" not found`)
          return { handled: true, exitCode: 1 }
        }
        const timeoutStr = getOptionValue(args, '--timeout')
        const timeoutMs = timeoutStr ? Number.parseInt(timeoutStr, 10) : undefined
        const result = await testProfile(profile, timeoutMs ? { timeoutMs } : undefined)
        emitJson({
          ok: result.ok,
          action: 'test',
          name,
          profile: desensitizeProfile(profile),
          result,
        })
        return { handled: true, exitCode: result.ok ? 0 : 1 }
      }
    }

    return { handled: false, exitCode: 0 }
  } catch (e) {
    emitError(`internal error: ${(e as Error).message}`)
    return { handled: true, exitCode: 2 }
  }
}
