/**
 * Mossen 本地 provider 实现 (G1-2):
 *  - LocalDefaultProvider: 内置默认值, 不可写, priority 最低
 *  - UserSettingsProvider:    ~/.mossen/settings.json (MOSSEN_CONFIG_DIR 可 override)
 *  - ProjectSettingsProvider: <cwd>/.mossen/settings.json
 *
 * 设计要点:
 *  - 不缓存; 每次 get 直接读盘 (G1-2 简单实现, G2 阶段可以加 mtime 缓存)
 *  - settings.json 写入失败抛错 (set 是 mutation, 不能静默吞)
 *  - 文件不存在 / 解析失败 → get 返回 undefined (provider miss)
 *  - clear 不存在的文件 = no-op
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import {
  PROVIDER_PRIORITY,
  type ConfigValueSource,
  type MossenConfigProvider,
  type ProviderResult,
} from '../types.js'
import { MOSSEN_BUILTIN_DEFAULTS } from '../defaults.js'

/** 内置默认值, 不可写 */
export class LocalDefaultProvider implements MossenConfigProvider {
  readonly name: ConfigValueSource = 'default'

  readonly priority = PROVIDER_PRIORITY.default

  readonly enabled = true

  get<T>(key: string): ProviderResult<T> {
    if (Object.prototype.hasOwnProperty.call(MOSSEN_BUILTIN_DEFAULTS, key)) {
      return {
        value: MOSSEN_BUILTIN_DEFAULTS[key] as T,
        source: 'default',
      }
    }
    return undefined
  }
}

/** SettingsProvider 共享实现 (User / Project 都基于此) */
abstract class SettingsProviderBase implements MossenConfigProvider {
  abstract readonly name: ConfigValueSource

  abstract readonly priority: number

  readonly enabled = true

  /** 子类返回 settings.json 完整路径 */
  protected abstract resolveSettingsPath(): string

  /**
   * 子类可 override; 返回 mode (如 0o600) 表示写入后强制 chmod 到该权限.
   * 返回 null 表示沿用 OS umask 默认.
   * User scope 覆盖为 0o600 因 settings.json 内嵌 apiKey (D-S09-1=A).
   */
  protected getSecurePermissionMode(): number | null {
    return null
  }

  get<T>(key: string): ProviderResult<T> {
    const data = this.readSettings()
    if (data && Object.prototype.hasOwnProperty.call(data, key)) {
      return { value: data[key] as T, source: this.name }
    }
    return undefined
  }

  set<T>(key: string, value: T): void {
    const settingsPath = this.resolveSettingsPath()
    const current = this.readSettings() ?? {}
    current[key] = value as unknown
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(
      settingsPath,
      `${JSON.stringify(current, null, 2)}\n`,
      'utf-8',
    )
    this.enforceSecurePermission(settingsPath)
  }

  clear(key?: string): void {
    const settingsPath = this.resolveSettingsPath()
    if (!fs.existsSync(settingsPath)) return
    if (key === undefined) {
      try {
        fs.unlinkSync(settingsPath)
      } catch {
        // ignore — 文件可能已被并发删除
      }
      return
    }
    const current = this.readSettings()
    if (current && Object.prototype.hasOwnProperty.call(current, key)) {
      delete current[key]
      fs.writeFileSync(
        settingsPath,
        `${JSON.stringify(current, null, 2)}\n`,
        'utf-8',
      )
      this.enforceSecurePermission(settingsPath)
    }
  }

  private enforceSecurePermission(settingsPath: string): void {
    const securePerm = this.getSecurePermissionMode()
    if (securePerm === null) return
    try {
      const currentMode = fs.statSync(settingsPath).mode & 0o777
      if (currentMode !== securePerm) {
        fs.chmodSync(settingsPath, securePerm)
      }
    } catch {
      // chmod 失败不阻塞写入 (如 Windows / 不支持 mode 的文件系统).
    }
  }

  private readSettings(): Record<string, unknown> | undefined {
    const settingsPath = this.resolveSettingsPath()
    if (!fs.existsSync(settingsPath)) return undefined
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return undefined
    } catch {
      return undefined
    }
  }
}

/** ~/.mossen/settings.json (MOSSEN_CONFIG_DIR env 可 override 测试) */
export class UserSettingsProvider extends SettingsProviderBase {
  readonly name: ConfigValueSource = 'user'

  readonly priority = PROVIDER_PRIORITY.user

  protected resolveSettingsPath(): string {
    const configDir =
      process.env.MOSSEN_CONFIG_DIR ?? path.join(os.homedir(), '.mossen')
    return path.join(configDir, 'settings.json')
  }

  protected getSecurePermissionMode(): number | null {
    return 0o600
  }
}

/** <cwd>/.mossen/settings.json */
export class ProjectSettingsProvider extends SettingsProviderBase {
  readonly name: ConfigValueSource = 'project'

  readonly priority = PROVIDER_PRIORITY.project

  protected resolveSettingsPath(): string {
    return path.join(process.cwd(), '.mossen', 'settings.json')
  }
}
