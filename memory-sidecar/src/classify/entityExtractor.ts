/**
 * W143-A — entity extraction for memory-sidecar.
 *
 * Pulls high-signal tokens out of user/assistant text so they survive into
 * `Observation.tags` and can be retrieved by exact substring queries
 * (e.g. `rust-analyzer`, `mac.rs`, `1.92.0-aarch64-apple-darwin`,
 * `app/src/app_services/mac.rs`).
 *
 * Ground rules (Allen's W143 hard line):
 *  1. Pure string matching — no network, no LLM, no shell.
 *  2. NEVER stores API keys, JWTs, or other secret-shaped tokens.
 *  3. NEVER stores long tool stdout — extractor caps each entity at 96
 *     characters and the total at 24 entities per text.
 *  4. Backwards compatible — entities are surfaced as
 *     `tag` strings with namespaced prefixes (`entity:`, `file:`,
 *     `path:`, `version:`, `command:`); no Observation schema change.
 *
 * Tag prefixes:
 *   - `entity:<name>`   → tool/service/binary names (rust-analyzer, cargo, …)
 *   - `file:<basename>` → file basename (mac.rs, package.json)
 *   - `path:<rel-path>` → multi-segment relative path (app/src/app_services/mac.rs)
 *   - `version:<v>`     → semantic versions, target triples, toolchain ids
 *   - `command:<cmd>`   → command phrases (cargo run, rustup component add)
 *
 * The same lower-cased token may appear under more than one prefix when
 * unambiguous classification is impossible — e.g. `mac.rs` is both a
 * `file:` and could be a `path:` segment depending on context. We bias
 * toward `file:` for single segments and `path:` for those containing a
 * separator.
 */

const MAX_ENTITY_LEN = 96
const MAX_ENTITIES_PER_TEXT = 24
const MAX_TEXT_SCAN_LEN = 8000

// Known tool / language-server / build-system / system service names.
// Multi-word phrases (e.g. "rust-analyzer") are listed as canonical.
// Case-insensitive at match time, lower-cased at output time.
const KNOWN_TOOLS = [
  'rust-analyzer',
  'typescript-language-server',
  'pyright',
  'gopls',
  'clangd',
  'rustup',
  'cargo',
  'rustc',
  'protoc',
  'tsc',
  'eslint',
  'prettier',
  'biome',
  'bun',
  'pnpm',
  'yarn',
  'docker',
  'kubectl',
  'terraform',
  'ansible',
  'sqlite3',
  'curl',
  'jq',
  'rg',
  'fd',
  'ripgrep',
  'sentry',
  'datadog',
  'grafana',
  'prometheus',
  'opentelemetry',
  'otel',
  'mossen',
  'openai',
  'minimax',
  'glm',
]
const KNOWN_TOOLS_LOWER = new Set(KNOWN_TOOLS.map(t => t.toLowerCase()))

// Command verbs we recognise as the head of a command phrase. The phrase
// is captured up to a small token budget so we don't store full lines.
const COMMAND_HEADS = [
  'cargo',
  'rustup',
  'bun',
  'npm',
  'pnpm',
  'yarn',
  'docker',
  'kubectl',
  'git',
  'tsc',
  'eslint',
  'prettier',
  'protoc',
  'curl',
  'mossen',
]

// File extensions worth retaining. We index basenames + paths.
const FILE_EXTS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'rs', 'go', 'py', 'java', 'kt', 'rb', 'cs', 'cpp', 'c', 'h', 'hpp', 'mm',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'lock',
  'md', 'mdx',
  'css', 'scss', 'sass', 'html',
  'sql',
  'sh', 'bash', 'zsh', 'fish',
  'tf', 'tfvars',
  'proto',
]
const FILE_EXT_PATTERN = FILE_EXTS.join('|')

// Match repeated-segment paths like `app/src/app_services/mac.rs`. The
// terminal segment must end with a known extension.
const PATH_PATTERN = new RegExp(
  `(?:^|[\\s\\(\\[\`'"])((?:[\\w][\\w.\\-]*\\/){1,8}[\\w.\\-]+\\.(?:${FILE_EXT_PATTERN}))\\b`,
  'g',
)

// Bare filename: a token that has the shape `name.ext` where ext is
// known. Excludes path forms (those go through PATH_PATTERN).
const FILE_PATTERN = new RegExp(
  `(?:^|[\\s\\(\\[\`'":,;])((?:[\\w][\\w.\\-]{0,63})\\.(?:${FILE_EXT_PATTERN}))(?=$|[\\s\\)\\]\`'":,;.])`,
  'g',
)

// Toolchain target triples like `aarch64-apple-darwin`,
// `x86_64-unknown-linux-gnu`. Case-insensitive but lower-cased at output.
const TARGET_TRIPLE_PATTERN = /\b([a-z0-9_]+-[a-z0-9_]+-[a-z0-9_]+(?:-[a-z0-9_]+)?)\b/gi

// Semantic version tokens (1.92.0, 5.1.3, 1.3.13). Optional pre-release
// suffix like `-rc.1`. Avoids matching IPv4 addresses by requiring at
// least one dot AND fewer than 4 octets ≥ 256 (handled at filter step).
const SEMVER_PATTERN = /\b(\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.\-]+)?)\b/g

// Versioned toolchain id like `1.92.0-aarch64-apple-darwin`: a semver
// followed by a target triple, joined with `-`. The token is treated as
// a single `version:` entity, not split.
const VERSIONED_TOOLCHAIN_PATTERN = /\b(\d+\.\d+\.\d+-[a-z0-9_]+-[a-z0-9_]+-[a-z0-9_]+)\b/gi

// Identifier-shape tokens: alphanumeric + `_` only, length 4–48. These
// are the cheapest to extract and surface things like `app_services`
// that are neither files nor commands.
const IDENT_PATTERN = /\b([A-Za-z][A-Za-z0-9_]{3,47})\b/g

// Hyphenated identifier shape (rust-analyzer, typescript-language-server,
// my-package-name). Length 4–48.
const HYPHEN_IDENT_PATTERN = /(?:^|[\s\(\[`'":,;])([a-z][a-z0-9_]*(?:-[a-z0-9_]+){1,4})(?=$|[\s\)\]`'":,;.])/g

// Stopword-style identifiers that are too generic to be helpful as
// entity tags. Filtered after extraction so they never reach storage.
const IDENT_STOPWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'none',
  'function', 'return', 'await', 'async', 'const', 'let', 'var',
  'import', 'export', 'default', 'class', 'extends', 'implements',
  'interface', 'type', 'enum', 'namespace', 'module',
  'string', 'number', 'boolean', 'object', 'array',
  'console', 'process', 'window', 'document', 'global',
  'this', 'self', 'super',
  'todo', 'fixme', 'xxx', 'note',
  'http', 'https', 'localhost',
  'unknown', 'error', 'success', 'failed', 'pending', 'running',
  'message', 'response', 'request', 'context', 'options', 'config',
  'value', 'values', 'result', 'results', 'data', 'info',
  'true_', 'false_',
])

// Anything that looks like a secret — even a partial match — is
// rejected. False positives are preferable to leaking a key.
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,        // provider-style
  /key-[A-Za-z0-9_-]{16,}/i,
  /\b[A-F0-9]{32,}\b/,             // long hex (md5/sha)
  /eyJ[A-Za-z0-9_-]{16,}/,         // JWT prefix
  /AKIA[A-Z0-9]{12,}/,             // AWS access key
  /xox[abprs]-[A-Za-z0-9-]{8,}/,   // Slack tokens
]

export type ExtractedEntities = {
  entities: string[]    // tool/service/binary names
  files: string[]       // basenames
  paths: string[]       // multi-segment paths
  versions: string[]    // semvers + target triples + toolchain ids
  commands: string[]    // command phrases
}

export type EntityTag = string  // e.g. `entity:rust-analyzer`

/**
 * Extract entity tokens from a piece of free-form text.
 *
 * Returns a structured result. Use {@link entityTagsFromText} for the
 * tag-prefixed list ready to merge into `Observation.tags`.
 */
export function extractEntities(rawText: string): ExtractedEntities {
  const text = (rawText ?? '').slice(0, MAX_TEXT_SCAN_LEN)
  if (!text) {
    return { entities: [], files: [], paths: [], versions: [], commands: [] }
  }

  const entities = new Set<string>()
  const files = new Set<string>()
  const paths = new Set<string>()
  const versions = new Set<string>()
  const commands = new Set<string>()

  // Order matters: extract paths before bare filenames so we don't
  // double-record a basename that lives inside a path.
  for (const match of text.matchAll(PATH_PATTERN)) {
    const token = capEntity(match[1])
    if (token && !looksLikeSecret(token)) {
      paths.add(token.toLowerCase())
      // Also record the basename so single-segment recall works.
      const slash = token.lastIndexOf('/')
      if (slash >= 0 && slash < token.length - 1) {
        const basename = token.slice(slash + 1)
        if (basename) files.add(basename.toLowerCase())
      }
    }
  }

  for (const match of text.matchAll(FILE_PATTERN)) {
    const token = capEntity(match[1])
    if (!token || looksLikeSecret(token)) continue
    if (token.includes('/')) continue
    files.add(token.toLowerCase())
  }

  // Versioned toolchain id MUST be matched before plain semver so the
  // longer composite token wins.
  for (const match of text.matchAll(VERSIONED_TOOLCHAIN_PATTERN)) {
    const token = capEntity(match[1])
    if (token && !looksLikeSecret(token)) versions.add(token.toLowerCase())
  }

  for (const match of text.matchAll(TARGET_TRIPLE_PATTERN)) {
    const token = capEntity(match[1])
    if (!token || looksLikeSecret(token)) continue
    const lower = token.toLowerCase()
    // Avoid recording the leading prefix of a versioned toolchain we
    // already captured (e.g. when both `1.92.0-aarch64-apple-darwin`
    // and `aarch64-apple-darwin` would land separately).
    if ([...versions].some(v => v.endsWith(lower))) continue
    if (looksLikeArchTriple(lower)) versions.add(lower)
  }

  for (const match of text.matchAll(SEMVER_PATTERN)) {
    const token = capEntity(match[1])
    if (!token || looksLikeSecret(token)) continue
    if (looksLikeIPv4(token)) continue
    // Skip if it's the leading semver of an already-captured versioned
    // toolchain id.
    if ([...versions].some(v => v.startsWith(token))) continue
    versions.add(token.toLowerCase())
  }

  for (const match of text.matchAll(HYPHEN_IDENT_PATTERN)) {
    const token = capEntity(match[1])
    if (!token || looksLikeSecret(token)) continue
    const lower = token.toLowerCase()
    if (KNOWN_TOOLS_LOWER.has(lower) || isToolLike(lower)) {
      entities.add(lower)
    }
  }

  for (const match of text.matchAll(IDENT_PATTERN)) {
    const token = capEntity(match[1])
    if (!token || looksLikeSecret(token)) continue
    const lower = token.toLowerCase()
    if (IDENT_STOPWORDS.has(lower)) continue
    if (KNOWN_TOOLS_LOWER.has(lower)) {
      entities.add(lower)
      continue
    }
    // Snake_case identifier with at least one underscore is high-signal
    // (e.g. `app_services`, `task_id`).
    if (token.includes('_')) entities.add(lower)
  }

  // Command phrases: scan for known head verbs followed by 1–4
  // command-shaped tokens (alphanumeric + `_-./`). Stops at any
  // sentence-boundary or natural-language word so we don't pull
  // surrounding prose into the tag.
  // Stop tokens: punctuation, common English connectives.
  const STOP_WORDS = new Set([
    'with', 'and', 'or', 'then', 'so', 'because', 'before', 'after',
    'when', 'while', 'for', 'to', 'in', 'on', 'at', 'of', 'is', 'was',
    'will', 'would', 'should', 'could', 'has', 'have', 'had',
  ])
  for (const head of COMMAND_HEADS) {
    // [ \t]+ instead of \s+ so newlines act as command boundaries —
    // `cargo build\ncargo run` must produce two phrases, not one.
    const re = new RegExp(
      `\\b(${escapeRegex(head)}(?:[ \\t]+[A-Za-z0-9_./\\-]{1,32}){1,4})`,
      'gi',
    )
    for (const match of text.matchAll(re)) {
      const raw = match[1].trim()
      const tokens = raw.split(/\s+/)
      const cleaned: string[] = []
      let sentenceBoundaryHit = false
      for (const tok of tokens) {
        // Detect sentence-terminating punctuation BEFORE stripping —
        // `cargo run. Failed` should stop at `run`, not absorb `Failed`.
        // We allow trailing dots in identifiers (`mac.rs`) but stop on
        // a token that ends with a *sentence* punctuation mark and is
        // not itself an identifier-shaped token.
        const endsInSentencePunct = /[.,;:!?]+$/.test(tok)
        const stripped = tok.replace(/[.,;:!?]+$/, '')
        if (!stripped) break
        if (cleaned.length > 0 && STOP_WORDS.has(stripped.toLowerCase())) break
        if (cleaned.length > 0 && !/^[A-Za-z0-9_./\-]+$/.test(stripped)) break
        cleaned.push(stripped)
        if (cleaned.length >= 5) break
        // Identifier-shape tokens with a single internal `.` (mac.rs,
        // app.rs) keep their dot at strip-time; we treat the trailing
        // `.` only as a sentence boundary when the stripped form has no
        // other dots (i.e. the dot was punctuation, not file ext).
        if (endsInSentencePunct && !stripped.includes('.')) {
          sentenceBoundaryHit = true
          break
        }
      }
      if (sentenceBoundaryHit) {
        // No-op — boundary already broke the loop. Marker is here so
        // the intent is grep-able; keeps lint happy.
        void sentenceBoundaryHit
      }
      if (cleaned.length < 2) continue
      const phrase = capEntity(cleaned.join(' '))
      if (phrase && !looksLikeSecret(phrase)) commands.add(phrase.toLowerCase())
    }
  }

  return {
    entities: capList([...entities]),
    files: capList([...files]),
    paths: capList([...paths]),
    versions: capList([...versions]),
    commands: capList([...commands]),
  }
}

/**
 * Convenience wrapper: returns a flat list of namespaced tag strings
 * ready to be merged into `Observation.tags`. Caps total at
 * MAX_ENTITIES_PER_TEXT to bound observation size.
 */
export function entityTagsFromText(rawText: string): EntityTag[] {
  const e = extractEntities(rawText)
  const tags: EntityTag[] = [
    ...e.entities.map(x => `entity:${x}`),
    ...e.files.map(x => `file:${x}`),
    ...e.paths.map(x => `path:${x}`),
    ...e.versions.map(x => `version:${x}`),
    ...e.commands.map(x => `command:${x}`),
  ]
  return tags.slice(0, MAX_ENTITIES_PER_TEXT)
}

function capEntity(token: string): string | undefined {
  if (!token) return undefined
  const trimmed = token.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_ENTITY_LEN) return undefined
  return trimmed
}

function capList(items: string[]): string[] {
  return items.slice(0, MAX_ENTITIES_PER_TEXT)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Reject anything that even partially matches a known secret shape. Run
 * before any `add(token)` call.
 */
function looksLikeSecret(token: string): boolean {
  for (const re of SECRET_PATTERNS) {
    if (re.test(token)) return true
  }
  return false
}

function looksLikeIPv4(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 4) return false
  return parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false
    const n = Number(part)
    return n >= 0 && n <= 255
  })
}

function looksLikeArchTriple(token: string): boolean {
  // We accept `arch-vendor-os` and `arch-vendor-os-env` shapes; reject
  // very short tokens that happened to match.
  if (token.length < 12) return false
  const segs = token.split('-')
  if (segs.length < 3 || segs.length > 4) return false
  return segs.every(seg => seg.length >= 2 && /^[a-z0-9_]+$/.test(seg))
}

function isToolLike(token: string): boolean {
  // Hyphenated lowercase identifier with `analyzer`, `server`, `lint`,
  // `build`, `compiler`, `formatter`, etc. as a suffix is likely a tool.
  if (token.length < 4 || token.length > MAX_ENTITY_LEN) return false
  const TOOL_SUFFIXES = [
    'analyzer', 'server', 'compiler', 'formatter', 'linter',
    'language-server', 'cli', 'kit', 'agent',
  ]
  for (const suf of TOOL_SUFFIXES) {
    if (token.endsWith(`-${suf}`) || token === suf) return true
  }
  return false
}
