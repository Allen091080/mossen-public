/**
 * `mossen mcp xaa` — manage the XAA (SEP-990) IdP connection.
 *
 * The IdP connection is user-level: configure once, all XAA-enabled MCP
 * servers reuse it. Lives in settings.xaaIdp (non-secret) + a keychain slot
 * keyed by issuer (secret). Separate trust domain from per-server AS secrets.
 */
import type { Command } from '@commander-js/extra-typings'
import { readFileSync } from 'fs'
import { cliError, cliOk } from '../../cli/exit.js'
import { getProductCliName, getProductDisplayName } from '../../constants/product.js'
import {
  acquireIdpIdToken,
  clearIdpClientSecret,
  clearIdpIdToken,
  getCachedIdpIdToken,
  getIdpClientSecret,
  getXaaIdpSettings,
  issuerKey,
  saveIdpClientSecret,
  saveIdpIdTokenFromJwt,
} from '../../services/mcp/xaaIdpLogin.js'
import { errorMessage } from '../../utils/errors.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import { getLocalizedText } from '../../utils/uiLanguage.js'

export function getXaaIdpClientIdHelpText(): string {
  return getLocalizedText({
    en: `${getProductDisplayName()}'s client_id at the IdP`,
    zh: `${getProductDisplayName()} 在 IdP 上的 client_id`,
  })
}

export function registerMcpXaaIdpCommand(mcp: Command): void {
  const xaaIdp = mcp
    .command('xaa')
    .description(
      getLocalizedText({
        en: 'Manage the XAA (SEP-990) IdP connection',
        zh: '管理 XAA（SEP-990）IdP 连接',
      }),
    )

  xaaIdp
    .command('setup')
    .description(
      getLocalizedText({
        en: 'Configure the IdP connection (one-time setup for all XAA-enabled servers)',
        zh: '配置 IdP 连接（对所有启用 XAA 的服务器只需设置一次）',
      }),
    )
    .requiredOption(
      '--issuer <url>',
      getLocalizedText({
        en: 'IdP issuer URL (OIDC discovery)',
        zh: 'IdP issuer URL（OIDC discovery）',
      }),
    )
    .requiredOption('--client-id <id>', getXaaIdpClientIdHelpText())
    .option(
      '--client-secret',
      getLocalizedText({
        en: 'Read IdP client secret from MCP_XAA_IDP_CLIENT_SECRET env var',
        zh: '从 MCP_XAA_IDP_CLIENT_SECRET 环境变量读取 IdP client secret',
      }),
    )
    .option(
      '--callback-port <port>',
      getLocalizedText({
        en: 'Fixed loopback callback port (only if IdP does not honor RFC 8252 port-any matching)',
        zh: '固定 loopback 回调端口（仅在 IdP 不支持 RFC 8252 任意端口匹配时使用）',
      }),
    )
    .action(options => {
      // Validate everything BEFORE any writes. An exit(1) mid-write leaves
      // settings configured but keychain missing — confusing state.
      // updateSettingsForSource doesn't schema-check on write; a non-URL
      // issuer lands on disk and then poisons the whole userSettings source
      // on next launch (SettingsSchema .url() fails → parseSettingsFile
      // returns { settings: null }, dropping everything, not just xaaIdp).
      let issuerUrl: URL
      try {
        issuerUrl = new URL(options.issuer)
      } catch {
        return cliError(
          getLocalizedText({
            en: `Error: --issuer must be a valid URL (got "${options.issuer}")`,
            zh: `错误：--issuer 必须是有效 URL（当前为 "${options.issuer}"）`,
          }),
        )
      }
      // OIDC discovery + token exchange run against this host. Allow http://
      // only for loopback (conformance harness mock IdP); anything else leaks
      // the client secret and authorization code over plaintext.
      if (
        issuerUrl.protocol !== 'https:' &&
        !(
          issuerUrl.protocol === 'http:' &&
          (issuerUrl.hostname === 'localhost' ||
            issuerUrl.hostname === '127.0.0.1' ||
            issuerUrl.hostname === '[::1]')
        )
      ) {
        return cliError(
          getLocalizedText({
            en: `Error: --issuer must use https:// (got "${issuerUrl.protocol}//${issuerUrl.host}")`,
            zh: `错误：--issuer 必须使用 https://（当前为 "${issuerUrl.protocol}//${issuerUrl.host}"）`,
          }),
        )
      }
      const callbackPort = options.callbackPort
        ? parseInt(options.callbackPort, 10)
        : undefined
      // callbackPort <= 0 fails Zod's .positive() on next launch — same
      // settings-poisoning failure mode as the issuer check above.
      if (
        callbackPort !== undefined &&
        (!Number.isInteger(callbackPort) || callbackPort <= 0)
      ) {
        return cliError(
          getLocalizedText({
            en: 'Error: --callback-port must be a positive integer',
            zh: '错误：--callback-port 必须是正整数',
          }),
        )
      }
      const secret = options.clientSecret
        ? process.env.MCP_XAA_IDP_CLIENT_SECRET
        : undefined
      if (options.clientSecret && !secret) {
        return cliError(
          getLocalizedText({
            en: 'Error: --client-secret requires MCP_XAA_IDP_CLIENT_SECRET env var',
            zh: '错误：--client-secret 需要设置 MCP_XAA_IDP_CLIENT_SECRET 环境变量',
          }),
        )
      }

      // Read old config now (before settings overwrite) so we can clear stale
      // keychain slots after a successful write. `clear` can't do this after
      // the fact — it reads the *current* settings.xaaIdp, which by then is
      // the new one.
      const old = getXaaIdpSettings()
      const oldIssuer = old?.issuer
      const oldClientId = old?.clientId

      // callbackPort MUST be present (even as undefined) — mergeWith deep-merges
      // and only deletes on explicit `undefined`, not on absent key. A conditional
      // spread would leak a prior fixed port into a new IdP's config.
      const { error } = updateSettingsForSource('userSettings', {
        xaaIdp: {
          issuer: options.issuer,
          clientId: options.clientId,
          callbackPort,
        },
      })
      if (error) {
        return cliError(
          getLocalizedText({
            en: `Error writing settings: ${error.message}`,
            zh: `写入设置失败：${error.message}`,
          }),
        )
      }

      // Clear stale keychain slots only after settings write succeeded —
      // otherwise a write failure leaves settings pointing at oldIssuer with
      // its secret already gone. Compare via issuerKey(): trailing-slash or
      // host-case differences normalize to the same keychain slot.
      if (oldIssuer) {
        if (issuerKey(oldIssuer) !== issuerKey(options.issuer)) {
          clearIdpIdToken(oldIssuer)
          clearIdpClientSecret(oldIssuer)
        } else if (oldClientId !== options.clientId) {
          // Same issuer slot but different OAuth client registration — the
          // cached id_token's aud claim and the stored secret are both for the
          // old client. `xaa login` would send {new clientId, old secret} and
          // fail with opaque `invalid_client`; downstream SEP-990 exchange
          // would fail aud validation. Keep both when clientId is unchanged:
          // re-setup without --client-secret means "tweak port, keep secret".
          clearIdpIdToken(oldIssuer)
          clearIdpClientSecret(oldIssuer)
        }
      }

      if (secret) {
        const { success, warning } = saveIdpClientSecret(options.issuer, secret)
        if (!success) {
          return cliError(
            getLocalizedText({
              en:
                `Error: settings written but keychain save failed${warning ? ` — ${warning}` : ''}. ` +
                `Re-run with --client-secret once keychain is available.`,
              zh:
                `错误：设置已写入，但保存到钥匙串失败${warning ? ` —— ${warning}` : ''}。` +
                `请在钥匙串可用后重新使用 --client-secret 执行。`,
            }),
          )
        }
      }

      cliOk(
        getLocalizedText({
          en: `XAA IdP connection configured for ${options.issuer}`,
          zh: `已为 ${options.issuer} 配置 XAA IdP 连接`,
        }),
      )
    })

  xaaIdp
    .command('login')
    .description(
      getLocalizedText({
        en:
          'Cache an IdP id_token so XAA-enabled MCP servers authenticate ' +
          'silently. Default: run the OIDC browser login. With --id-token: ' +
          'write a pre-obtained JWT directly (used by conformance/e2e tests ' +
          'where the mock IdP does not serve /authorize).',
        zh:
          '缓存 IdP 的 id_token，让启用 XAA 的 MCP 服务器静默完成认证。默认会执行 OIDC 浏览器登录；带 --id-token 时，可直接写入预先获取的 JWT（主要用于 conformance/e2e 测试场景）。',
      }),
    )
    .option(
      '--force',
      getLocalizedText({
        en: 'Ignore any cached id_token and re-login (useful after IdP-side revocation)',
        zh: '忽略任何已缓存的 id_token 并重新登录（适用于 IdP 侧撤销后）',
      }),
    )
    .option(
      '--id-token <jwt>',
      getLocalizedText({
        en: 'Write this pre-obtained id_token directly to cache, skipping the OIDC browser login',
        zh: '将预先获取的 id_token 直接写入缓存，跳过 OIDC 浏览器登录',
      }),
    )
    .option(
      '--id-token-stdin',
      getLocalizedText({
        en: 'Read a pre-obtained id_token from stdin, skipping the OIDC browser login',
        zh: '从 stdin 读取预先获取的 id_token，跳过 OIDC 浏览器登录',
      }),
    )
    .action(async options => {
      const idp = getXaaIdpSettings()
      if (!idp) {
        return cliError(
          getLocalizedText({
            en: `Error: no XAA IdP connection. Run '${getProductCliName()} mcp xaa setup' first.`,
            zh: `错误：当前没有 XAA IdP 连接。请先运行 '${getProductCliName()} mcp xaa setup'。`,
          }),
        )
      }

      if (options.idToken && options.idTokenStdin) {
        return cliError(
          getLocalizedText({
            en: 'Error: choose only one of --id-token or --id-token-stdin',
            zh: '错误：--id-token 和 --id-token-stdin 只能选择一个',
          }),
        )
      }

      const idTokenFromStdin = options.idTokenStdin
        ? readIdTokenFromStdin()
        : undefined
      if (idTokenFromStdin instanceof Error) {
        return cliError(
          getLocalizedText({
            en: `Error: ${idTokenFromStdin.message}`,
            zh: `错误：${idTokenFromStdin.message}`,
          }),
        )
      }

      // Direct-inject path: skip cache check, skip OIDC. Writing IS the
      // operation. Issuer comes from settings (single source of truth), not
      // a separate flag — one less thing to desync.
      const directIdToken = options.idToken ?? idTokenFromStdin
      if (directIdToken) {
        const expiresAt = saveIdpIdTokenFromJwt(idp.issuer, directIdToken)
        return cliOk(
          getLocalizedText({
            en: `id_token cached for ${idp.issuer} (expires ${new Date(expiresAt).toISOString()})`,
            zh: `已为 ${idp.issuer} 缓存 id_token（过期时间：${new Date(expiresAt).toISOString()}）`,
          }),
        )
      }

      if (options.force) {
        clearIdpIdToken(idp.issuer)
      }

      const wasCached = getCachedIdpIdToken(idp.issuer) !== undefined
      if (wasCached) {
        return cliOk(
          getLocalizedText({
            en: `Already logged in to ${idp.issuer} (cached id_token still valid). Use --force to re-login.`,
            zh: `已登录 ${idp.issuer}（缓存的 id_token 仍然有效）。可使用 --force 重新登录。`,
          }),
        )
      }

      process.stdout.write(
        getLocalizedText({
          en: `Opening browser for IdP login at ${idp.issuer}…\n`,
          zh: `正在打开浏览器以登录 ${idp.issuer}…\n`,
        }),
      )
      try {
        await acquireIdpIdToken({
          idpIssuer: idp.issuer,
          idpClientId: idp.clientId,
          idpClientSecret: getIdpClientSecret(idp.issuer),
          callbackPort: idp.callbackPort,
          onAuthorizationUrl: url => {
            process.stdout.write(
              getLocalizedText({
                en: `If the browser did not open, visit:\n  ${url}\n`,
                zh: `如果浏览器没有自动打开，请访问：\n  ${url}\n`,
              }),
            )
          },
        })
        cliOk(
          getLocalizedText({
            en: 'Logged in. MCP servers with --xaa will now authenticate silently.',
            zh: '已登录。带有 --xaa 的 MCP 服务器现在会静默完成认证。',
          }),
        )
      } catch (e) {
        cliError(
          getLocalizedText({
            en: `IdP login failed: ${errorMessage(e)}`,
            zh: `IdP 登录失败：${errorMessage(e)}`,
          }),
        )
      }
    })

  xaaIdp
    .command('show')
    .description(
      getLocalizedText({
        en: 'Show the current IdP connection config',
        zh: '显示当前 IdP 连接配置',
      }),
    )
    .action(() => {
      const idp = getXaaIdpSettings()
      if (!idp) {
        return cliOk(
          getLocalizedText({
            en: 'No XAA IdP connection configured.',
            zh: '当前未配置 XAA IdP 连接。',
          }),
        )
      }
      const hasSecret = getIdpClientSecret(idp.issuer) !== undefined
      const hasIdToken = getCachedIdpIdToken(idp.issuer) !== undefined
      process.stdout.write(
        getLocalizedText({
          en: `Issuer:        ${idp.issuer}\n`,
          zh: `Issuer：       ${idp.issuer}\n`,
        }),
      )
      process.stdout.write(
        getLocalizedText({
          en: `Client ID:     ${idp.clientId}\n`,
          zh: `客户端 ID：    ${idp.clientId}\n`,
        }),
      )
      if (idp.callbackPort !== undefined) {
        process.stdout.write(
          getLocalizedText({
            en: `Callback port: ${idp.callbackPort}\n`,
            zh: `回调端口：     ${idp.callbackPort}\n`,
          }),
        )
      }
      process.stdout.write(
        getLocalizedText({
          en: `Client secret: ${hasSecret ? '(stored in keychain)' : '(not set — PKCE-only)'}\n`,
          zh: `客户端密钥：   ${hasSecret ? '（已存入钥匙串）' : '（未设置 —— 仅 PKCE）'}\n`,
        }),
      )
      process.stdout.write(
        `${getLocalizedText({
          en: 'Logged in:     ',
          zh: '已登录：       ',
        })}${
          hasIdToken
            ? getLocalizedText({
                en: 'yes (id_token cached)',
                zh: '是（已缓存 id_token）',
              })
            : getLocalizedText({
                en: `no — run '${getProductCliName()} mcp xaa login'`,
                zh: `否 —— 请运行 '${getProductCliName()} mcp xaa login'`,
              })
        }\n`,
      )
      cliOk()
    })

  xaaIdp
    .command('clear')
    .description(
      getLocalizedText({
        en: 'Clear the IdP connection config and cached id_token',
        zh: '清除 IdP 连接配置与缓存的 id_token',
      }),
    )
    .action(() => {
      // Read issuer first so we can clear the right keychain slots.
      const idp = getXaaIdpSettings()
      // updateSettingsForSource uses mergeWith: set to undefined (not delete)
      // to signal key removal.
      const { error } = updateSettingsForSource('userSettings', {
        xaaIdp: undefined,
      })
      if (error) {
        return cliError(
          getLocalizedText({
            en: `Error writing settings: ${error.message}`,
            zh: `写入设置失败：${error.message}`,
          }),
        )
      }
      // Clear keychain only after settings write succeeded — otherwise a
      // write failure leaves settings pointing at the IdP with its secrets
      // already gone (same pattern as `setup`'s old-issuer cleanup).
      if (idp) {
        clearIdpIdToken(idp.issuer)
        clearIdpClientSecret(idp.issuer)
      }
      cliOk(
        getLocalizedText({
          en: 'XAA IdP connection cleared',
          zh: '已清除 XAA IdP 连接',
        }),
      )
    })
}

function readIdTokenFromStdin(): string | Error {
  if (process.stdin.isTTY) {
    return new Error('--id-token-stdin requires piped stdin')
  }
  const token = readFileSync(0, 'utf8').trim()
  if (!token) {
    return new Error('--id-token-stdin received empty stdin')
  }
  return token
}
