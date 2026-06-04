export type BundledWorkflowDefinition = {
  name: string
  description: string
  source: string
}

const PROJECT_SCAN_SOURCE = `export const meta = {
  name: 'project-scan',
  description: 'Map a project, identify important files, and surface implementation risks before editing.',
  whenToUse: 'Use when you need a fast repository orientation or a second-pass risk scan before implementation.',
  phases: [
    { title: 'Map structure', detail: 'Identify major directories, entrypoints, and ownership boundaries.' },
    { title: 'Find risks', detail: 'Look for risky dependencies, missing tests, and likely integration points.' },
  ],
}

phase('Map structure')
const map = await agent(
  'Inspect the current project structure. Summarize key directories, entrypoints, test surfaces, and conventions that matter before implementation.',
  { label: 'Map project structure' },
)

phase('Find risks')
const risks = await agent(
  'Review the mapped project for implementation risks: shared contracts, test gaps, build or packaging constraints, and areas that need careful validation.',
  { label: 'Find implementation risks' },
)

return { map, risks }
`

const DEEP_RESEARCH_SOURCE = `export const meta = {
  name: 'deep-research',
  description: 'Investigate a question across multiple search angles, cross-check claims, and return a cited report.',
  whenToUse: 'Use for research questions that need broad web coverage, source reading, and claim verification before synthesis.',
  phases: [
    { title: 'Plan searches', detail: 'Break the question into distinct search angles and source types.' },
    { title: 'Search web', detail: 'Run independent web searches across the planned angles.' },
    { title: 'Read sources', detail: 'Fetch and summarize the strongest sources found.' },
    { title: 'Cross-check claims', detail: 'Verify claims against cited sources and note conflicts.' },
    { title: 'Synthesize report', detail: 'Write a concise answer with source-backed citations.' },
  ],
}

const question =
  typeof args === 'string'
    ? args
    : args && typeof args === 'object'
      ? JSON.stringify(args)
      : ''

if (!question.trim()) {
  throw new Error('deep-research requires a research question in args.')
}

const SEARCH_PLAN_SCHEMA = {
  type: 'object',
  required: ['angles'],
  additionalProperties: false,
  properties: {
    angles: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        required: ['name', 'query', 'purpose'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          query: { type: 'string' },
          purpose: { type: 'string' },
        },
      },
    },
  },
}

const SEARCH_RESULTS_SCHEMA = {
  type: 'object',
  required: ['results'],
  additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'url', 'snippet', 'whyUseful'],
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          snippet: { type: 'string' },
          whyUseful: { type: 'string' },
        },
      },
    },
  },
}

const SOURCE_NOTES_SCHEMA = {
  type: 'object',
  required: ['sources'],
  additionalProperties: false,
  properties: {
    sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'url', 'summary', 'claims'],
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          summary: { type: 'string' },
          claims: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const VERIFICATION_SCHEMA = {
  type: 'object',
  required: ['supportedClaims', 'weakClaims', 'conflicts'],
  additionalProperties: false,
  properties: {
    supportedClaims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'citations'],
        additionalProperties: false,
        properties: {
          claim: { type: 'string' },
          citations: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    weakClaims: { type: 'array', items: { type: 'string' } },
    conflicts: { type: 'array', items: { type: 'string' } },
  },
}

phase('Plan searches')
const plan = await agent(
  'Create a deep research search plan for this question. Return distinct angles with search queries. Question: ' + question,
  { label: 'Plan research angles', schema: SEARCH_PLAN_SCHEMA },
)

const angles = (plan && Array.isArray(plan.angles) ? plan.angles : []).slice(0, 8)
if (angles.length === 0) {
  throw new Error('deep-research could not produce a search plan.')
}

phase('Search web')
const searchBatches = await parallel(
  angles.map(angle => () =>
    agent(
      'Use WebSearch if available. Search for authoritative, recent, and primary sources for this angle. Question: ' +
        question +
        '\\nAngle: ' +
        angle.name +
        '\\nQuery: ' +
        angle.query +
        '\\nReturn the strongest results only.',
      { label: 'Search: ' + angle.name, schema: SEARCH_RESULTS_SCHEMA },
    ),
  ),
)

const seenUrls = new Set()
const candidates = []
for (const batch of searchBatches) {
  for (const result of batch?.results ?? []) {
    if (!result?.url || seenUrls.has(result.url)) continue
    seenUrls.add(result.url)
    candidates.push(result)
  }
}

const selected = candidates.slice(0, 12)
if (selected.length === 0) {
  throw new Error('deep-research found no sources to read.')
}

phase('Read sources')
const sourceNotes = await parallel(
  selected.map(source => () =>
    agent(
      'Use WebFetch if available to read this source. Extract the source summary and only claims relevant to the question. Question: ' +
        question +
        '\\nSource title: ' +
        source.title +
        '\\nURL: ' +
        source.url +
        '\\nSearch snippet: ' +
        source.snippet,
      { label: 'Read: ' + source.title, schema: SOURCE_NOTES_SCHEMA },
    ),
  ),
)

const sources = sourceNotes.flatMap(note => note?.sources ?? [])
if (sources.length === 0) {
  throw new Error('deep-research could not extract source notes.')
}

phase('Cross-check claims')
const verification = await agent(
  'Cross-check these source notes for the research question. Keep only source-backed claims, identify weak claims, and call out conflicts. Question: ' +
    question +
    '\\nSource notes JSON: ' +
    JSON.stringify(sources),
  { label: 'Verify claims', schema: VERIFICATION_SCHEMA },
)

phase('Synthesize report')
const report = await agent(
  'Write the final deep research report. Answer the question directly, cite source URLs inline for each important claim, exclude weak unsupported claims, and mention conflicts or uncertainty. Question: ' +
    question +
    '\\nVerified claims JSON: ' +
    JSON.stringify(verification) +
    '\\nSource notes JSON: ' +
    JSON.stringify(sources),
  { label: 'Synthesize cited report' },
)

return {
  question,
  angles,
  sources,
  verification,
  report,
}
`

export function loadBundledWorkflows(): BundledWorkflowDefinition[] {
  return [
    {
      name: 'deep-research',
      description:
        'Investigate a question across multiple search angles, cross-check claims, and return a cited report.',
      source: DEEP_RESEARCH_SOURCE,
    },
    {
      name: 'project-scan',
      description:
        'Map a project, identify important files, and surface implementation risks before editing.',
      source: PROJECT_SCAN_SOURCE,
    },
  ]
}

export function initBundledWorkflows(): void {
  // Bundled workflows are registered lazily through loadBundledWorkflows().
}
