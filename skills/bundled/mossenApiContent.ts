// Content for the Mossen API bundled skill.
// Keep this bundle self-contained so Mossen's skill protocol is independent
// from third-party SDK doc tree names.

const MOSSEN_MODEL_PREFIX = 'mossen'

function mossenModelId(...parts: string[]): string {
  return [MOSSEN_MODEL_PREFIX, ...parts].join('-')
}

// @[MODEL LAUNCH]: Update the model IDs/names below. These are substituted into {{VAR}}
// placeholders at runtime before the skill prompt is sent.
export const SKILL_MODEL_VARS = {
  LARGE_ID: mossenModelId('large'),
  LARGE_NAME: 'Mossen Large',
  BALANCED_ID: mossenModelId('balanced'),
  BALANCED_NAME: 'Mossen Balanced',
  FAST_ID: mossenModelId('fast'),
  FAST_NAME: 'Mossen Fast',
} satisfies Record<string, string>

export const SKILL_PROMPT = `# Mossen API

Use this skill when the user is building against the Mossen API, Mossen-compatible SDKs, or OpenAI-compatible endpoints from inside Mossen. Keep the product boundary clear:

- Mossen is the runtime, CLI, and user-facing agent surface.
- Mossen API is the runtime-owned API surface for app integrations.
- Use OpenAI-compatible request shapes when integrating generic SDKs.
- Do not rename Mossen protocols, config files, hooks, or user-facing commands after third-party SDKs.
- Use exact model IDs only at the request adapter boundary.

Current default model IDs:

- Large: {{LARGE_ID}} ({{LARGE_NAME}})
- Balanced: {{BALANCED_ID}} ({{BALANCED_NAME}})
- Fast: {{FAST_ID}} ({{FAST_NAME}})

Read the language-specific snippets below before editing code. Prefer the user's existing SDK and project style.`

const sharedModels = `# Models

Use the newest available model that matches the task:

- {{LARGE_ID}}: highest-capability work.
- {{BALANCED_ID}}: balanced coding, agent, and production app work.
- {{FAST_ID}}: low-latency or cost-sensitive work.

Treat these IDs as Mossen API wire values. Mossen-facing code should keep Mossen naming and route through an adapter instead of exposing model IDs as product names.`

const sharedPromptCaching = `# Prompt Caching

Cache stable, repeated context such as system instructions, tool definitions, schemas, and large reference documents. Keep volatile user messages and one-off data outside cached blocks.

When cache hit rate is poor, check that repeated text is byte-identical, ordered consistently, and placed before request-specific content.`

const sharedToolUseConcepts = `# Tool Use Concepts

Define tools with clear names, concise descriptions, and strict JSON schemas. Validate tool inputs before side effects, return compact structured results, and let the model decide when another tool call is needed.

For Mossen integrations, keep hook and tool protocol names Mossen-owned. API tool-call payloads should be translated at the adapter boundary.`

const sharedErrorCodes = `# Error Handling

Handle Mossen API errors by category:

- Authentication: missing or invalid Mossen API credentials.
- Rate limiting: retry with backoff or surface a useful user action.
- Invalid request: inspect model ID, messages, tool schema, and token limits.
- Overloaded or transient failures: retry idempotent requests with jitter.

Do not ask the user to log into a hosted account flow when the app only needs a Mossen API key.`

const sharedLiveSources = `# Live Sources

Mossen API and OpenAI-compatible SDKs change. If the user needs exact current pricing, model availability, beta headers, or SDK method names, verify against the official docs before making claims.`

const pythonReadme = `# Python Mossen API

Use a thin HTTP adapter or your project's existing OpenAI-compatible SDK. This example avoids introducing a new package dependency.

\`\`\`python
import json
import os

import urllib.request

base_url = os.environ["MOSSEN_CODE_CUSTOM_BASE_URL"].rstrip("/")
request = urllib.request.Request(
    f"{base_url}/chat/completions",
    data=json.dumps({
        "model": "{{BALANCED_ID}}",
        "messages": [{"role": "user", "content": "Summarize this project."}],
    }).encode("utf-8"),
    headers={
        "authorization": f"Bearer {os.environ['MOSSEN_CODE_CUSTOM_API_KEY']}",
        "content-type": "application/json",
    },
)
with urllib.request.urlopen(request) as response:
    print(json.load(response)["choices"][0]["message"]["content"])
\`\`\`

Keep Mossen product names in your own UI. The model ID belongs only in the outbound API call.`

const pythonStreaming = `# Python Streaming

Use streaming for chat UIs and long responses. Accumulate deltas carefully and make cancellation explicit in the caller.

\`\`\`python
stream = client.chat.completions.create(
    model="{{BALANCED_ID}}",
    messages=[{"role": "user", "content": "Write a concise changelog."}],
    stream=True,
)
for chunk in stream:
    text = chunk.choices[0].delta.content
    if text:
        print(text, end="", flush=True)
\`\`\``

const pythonToolUse = `# Python Tool Use

Describe tools with JSON schemas, execute validated tool calls in your application, then send tool results back through the Mossen API. Keep side effects outside the model response parser.`

const pythonBatches = `# Python Batches

Use batches for non-latency-sensitive workloads such as offline classification, extraction, or large-scale evals. Persist request IDs so retries do not duplicate work.`

const pythonFilesApi = `# Python Files API

Use Mossen file APIs for reusable large inputs when supported. For Mossen-owned files, keep local paths and permission decisions in Mossen code, then upload only the intended content at the API adapter boundary.`

const typescriptReadme = `# TypeScript Mossen API

Use a thin HTTP adapter or your project's existing OpenAI-compatible SDK. This example avoids introducing a new package dependency.

\`\`\`ts
const baseURL = process.env.MOSSEN_CODE_CUSTOM_BASE_URL
if (!baseURL) throw new Error('MOSSEN_CODE_CUSTOM_BASE_URL is required')
const response = await fetch(baseURL.replace(/\\/$/, '') + '/chat/completions', {
  method: 'POST',
  headers: {
    authorization: 'Bearer ' + process.env.MOSSEN_CODE_CUSTOM_API_KEY,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
  model: '{{BALANCED_ID}}',
  messages: [{ role: 'user', content: 'Summarize this project.' }],
  }),
})
const data = await response.json()
console.log(data.choices[0]?.message?.content)
\`\`\`

Keep Mossen product names in your own UI. The model ID belongs only in the outbound API call.`

const typescriptStreaming = `# TypeScript Streaming

Use streaming for chat UIs and long responses. Accumulate deltas carefully and make cancellation explicit in the caller.

\`\`\`ts
const stream = await client.chat.completions.create({
  model: '{{BALANCED_ID}}',
  messages: [{ role: 'user', content: 'Write a concise changelog.' }],
  stream: true,
})

for await (const chunk of stream) {
  const text = chunk.choices[0]?.delta?.content
  if (text) process.stdout.write(text)
}
\`\`\``

const typescriptToolUse = `# TypeScript Tool Use

Describe tools with JSON schemas, execute validated tool calls in your application, then send tool results back through the Mossen API. Keep side effects outside the model response parser.`

const typescriptBatches = `# TypeScript Batches

Use batches for non-latency-sensitive workloads such as offline classification, extraction, or large-scale evals. Persist request IDs so retries do not duplicate work.`

const typescriptFilesApi = `# TypeScript Files API

Use Mossen file APIs for reusable large inputs when supported. For Mossen-owned files, keep local paths and permission decisions in Mossen code, then upload only the intended content at the API adapter boundary.`

const agentSdkReadme = `# Agent SDK

Use a Mossen-compatible agent SDK only when the user explicitly needs SDK-managed agent behavior. For Mossen-native hooks, plugins, tools, and sessions, keep the Mossen protocol and translate SDK-specific payloads at the boundary.`

const agentSdkPatterns = `# Agent SDK Patterns

- Keep credentials out of source.
- Make tool side effects explicit and auditable.
- Use small, typed result payloads.
- Preserve Mossen-owned command names and hook protocol names in the host app.`

const csharpMossenApi = `# C# Mossen API

Use an OpenAI-compatible SDK or a thin HTTP adapter. Put the model ID in the request payload and keep Mossen naming in your application layer.`

const goMossenApi = `# Go Mossen API

Use an OpenAI-compatible SDK or a thin HTTP adapter. Keep context cancellation and retry behavior explicit.`

const javaMossenApi = `# Java Mossen API

Use an OpenAI-compatible SDK or a thin HTTP adapter. Validate configuration at startup and keep Mossen API credentials outside source.`

const phpMossenApi = `# PHP Mossen API

Use an OpenAI-compatible SDK or a thin HTTP adapter. Keep API request construction isolated from Mossen-facing routes and templates.`

const rubyMossenApi = `# Ruby Mossen API

Use an OpenAI-compatible SDK or a thin HTTP adapter. Keep API request construction isolated from Mossen-facing routes and templates.`

const curlExamples = `# cURL Examples

\`\`\`sh
curl "$MOSSEN_CODE_CUSTOM_BASE_URL/chat/completions" \\
  -H "authorization: Bearer $MOSSEN_CODE_CUSTOM_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "{{BALANCED_ID}}",
    "messages": [{"role": "user", "content": "Summarize this project."}]
  }'
\`\`\``

export const SKILL_FILES: Record<string, string> = {
  'csharp/mossen-api.md': csharpMossenApi,
  'curl/examples.md': curlExamples,
  'go/mossen-api.md': goMossenApi,
  'java/mossen-api.md': javaMossenApi,
  'php/mossen-api.md': phpMossenApi,
  'python/agent-sdk/README.md': agentSdkReadme,
  'python/agent-sdk/patterns.md': agentSdkPatterns,
  'python/mossen-api/README.md': pythonReadme,
  'python/mossen-api/batches.md': pythonBatches,
  'python/mossen-api/files-api.md': pythonFilesApi,
  'python/mossen-api/streaming.md': pythonStreaming,
  'python/mossen-api/tool-use.md': pythonToolUse,
  'ruby/mossen-api.md': rubyMossenApi,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/models.md': sharedModels,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/agent-sdk/README.md': agentSdkReadme,
  'typescript/agent-sdk/patterns.md': agentSdkPatterns,
  'typescript/mossen-api/README.md': typescriptReadme,
  'typescript/mossen-api/batches.md': typescriptBatches,
  'typescript/mossen-api/files-api.md': typescriptFilesApi,
  'typescript/mossen-api/streaming.md': typescriptStreaming,
  'typescript/mossen-api/tool-use.md': typescriptToolUse,
}
