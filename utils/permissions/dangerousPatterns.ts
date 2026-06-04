/**
 * Pattern lists for dangerous shell-tool allow-rule prefixes.
 *
 * An allow rule like `Bash(python:*)` or `PowerShell(node:*)` lets the model
 * run arbitrary code via that interpreter, bypassing the auto-mode classifier.
 * These lists feed the isDangerous{Bash,PowerShell}Permission predicates in
 * permissionSetup.ts, which strip such rules at auto-mode entry.
 *
 * The matcher in each predicate handles the rule-shape variants (exact, `:*`,
 * trailing `*`, ` *`, ` -…*`). PS-specific cmdlet strings live in
 * isDangerousPowerShellPermission (permissionSetup.ts).
 */

/**
 * Cross-platform code-execution entry points present on both Unix and Windows.
 * Shared to prevent the two lists drifting apart on interpreter additions.
 */
export const CROSS_PLATFORM_CODE_EXEC = [
  // Interpreters
  'python',
  'python3',
  'python2',
  'node',
  'deno',
  'tsx',
  'ruby',
  'perl',
  'php',
  'lua',
  // Package runners
  'npx',
  'bunx',
  'npm run',
  'yarn run',
  'pnpm run',
  'bun run',
  // Shells reachable from both (Git Bash / WSL on Windows, native on Unix)
  'bash',
  'sh',
  // Remote arbitrary-command wrapper (native OpenSSH on Win10+)
  'ssh',
] as const

export const DANGEROUS_BASH_PATTERNS: readonly string[] = [
  ...CROSS_PLATFORM_CODE_EXEC,
  'zsh',
  'fish',
  'eval',
  'exec',
  'env',
  'xargs',
  'sudo',
  // Network/exfil & cloud writes — enabled for ALL users.
  // Allow rules like Bash(curl:*) / Bash(gh:*) / Bash(git:*) silently
  // permit gh gist create --public, gh api arbitrary HTTP, curl/wget POST,
  // git config core.sshCommand / hooks install = arbitrary code, and cloud
  // resource writes (s3 public buckets, k8s mutations). These risks are
  // universal, not internal-sandbox-only — Mossen / external users hit them
  // just as readily as internal users.
  // gh api needs its own entry because the matcher is exact-shape, not
  // prefix; pattern 'gh' alone does not catch rule 'gh api:*' (same reason
  // 'npm run' is separate from 'npm').
  'gh',
  'gh api',
  'curl',
  'wget',
  'git',
  'kubectl',
  'aws',
  'gcloud',
  'gsutil',
  // [Wave2历史兼容] Upstream-internal launchers — internal-only gate.
  // External / Mossen users do not have these binaries on PATH, so listing
  // them universally would only produce false-positive over-broad warnings.
  ...(process.env.USER_TYPE === ('a' + 'nt')
    ? [
        'fa run',
        // Cluster code launcher — arbitrary code on the cluster
        'coo',
      ]
    : []),
]
