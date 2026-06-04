export type MemoryRedactionResult = {
  text: string
  applied: boolean
  notes: string[]
}

const REDACTION_VERSION = 2
const SECRET_REPLACEMENT = '[REDACTED_SECRET]'
const EMAIL_REPLACEMENT = '[REDACTED_EMAIL]'
const PRIVATE_KEY_REPLACEMENT = '[REDACTED_PRIVATE_KEY]'

type RedactionRule = {
  note: string
  pattern: RegExp
  replace: (match: string, ...groups: string[]) => string
}

const redactTrailingSecret = (match: string, prefix: string): string =>
  `${prefix}${SECRET_REPLACEMENT}`

const redactNamedSecret = (
  match: string,
  prefix: string,
  quote: string | undefined,
  _secret: string,
  closingQuote: string | undefined,
): string => `${prefix}${quote ?? ''}${SECRET_REPLACEMENT}${closingQuote ?? ''}`

const rules: RedactionRule[] = [
  {
    note: 'redacted authorization bearer token',
    pattern: /\b(Authorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+/=-]{12,})/gi,
    replace: redactTrailingSecret,
  },
  {
    note: 'redacted bearer token',
    pattern: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{20,})\b/gi,
    replace: redactTrailingSecret,
  },
  {
    note: 'redacted OpenAI-style API key',
    pattern: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
    replace: () => SECRET_REPLACEMENT,
  },
  {
    note: 'redacted GitHub token',
    pattern: /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
    replace: () => SECRET_REPLACEMENT,
  },
  {
    note: 'redacted AWS access key id',
    pattern: /\b(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})\b/g,
    replace: () => SECRET_REPLACEMENT,
  },
  {
    note: 'redacted private key block',
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: () => PRIVATE_KEY_REPLACEMENT,
  },
  {
    note: 'redacted email address',
    pattern:
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi,
    replace: () => EMAIL_REPLACEMENT,
  },
  {
    note: 'redacted secret-like environment assignment',
    pattern:
      /\b((?:export\s+)?[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|PASSWORD|PASSWD|AUTH|CREDENTIAL|WEBHOOK)[A-Z0-9_]*\s*=\s*)(["']?)([^\s"']{8,})(\2)/g,
    replace: redactNamedSecret,
  },
  {
    note: 'redacted secret-like key value',
    pattern:
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd)\s*[:=]\s*)(["']?)([^\s"',}]{8,})(\2)/gi,
    replace: redactNamedSecret,
  },
  {
    note: 'redacted secret-like CLI argument',
    pattern:
      /((?:^|\s)--(?:api-key|token|access-token|refresh-token|client-secret|password|private-key)\s+)([^\s]{8,})/gi,
    replace: redactTrailingSecret,
  },
]

export function getMemoryRedactionVersion(): number {
  return REDACTION_VERSION
}

export function redactMemoryText(text: string): MemoryRedactionResult {
  const notes = new Set<string>()
  let redacted = text

  for (const rule of rules) {
    redacted = redacted.replace(rule.pattern, (...args: string[]) => {
      notes.add(rule.note)
      const [match, ...groups] = args
      return rule.replace(match, ...groups)
    })
  }

  return {
    text: redacted,
    applied: notes.size > 0,
    notes: Array.from(notes),
  }
}
