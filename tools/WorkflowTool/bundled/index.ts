import { isWebSearchAvailable } from '../../WebSearchTool/availability.js'

export type BundledWorkflowDefinition = {
  name: string
  description: string
  source: string
  isEnabled?: () => boolean
}

const DEEP_RESEARCH_SOURCE = `export const meta = {
  name: 'deep-research',
  description: 'Investigate a question across multiple search angles, cross-check claims, and return a cited report.',
  whenToUse: 'Use for research questions that need broad web coverage, source reading, and claim verification before synthesis.',
	  phases: [
	    { title: 'Plan searches', detail: 'Break the question into distinct search angles and source types.' },
	    { title: 'Search web', detail: 'Run independent web searches across the planned angles.' },
	    { title: 'Read sources', detail: 'Fetch and summarize the strongest sources found.' },
	    { title: 'Cross-check claims', detail: 'Vote on each candidate claim against cited sources and note conflicts.' },
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

	const CLAIM_VOTE_SCHEMA = {
	  type: 'object',
	  required: ['supported', 'citations', 'reason'],
	  additionalProperties: false,
	  properties: {
	    supported: { type: 'boolean' },
	    citations: { type: 'array', items: { type: 'string' } },
	    reason: { type: 'string' },
	  },
	}

	const CONFLICT_SCAN_SCHEMA = {
	  type: 'object',
	  required: ['conflicts'],
	  additionalProperties: false,
	  properties: {
	    conflicts: {
	      type: 'array',
	      items: {
	        type: 'object',
	        required: ['claim', 'reason', 'citations'],
	        additionalProperties: false,
	        properties: {
	          claim: { type: 'string' },
	          reason: { type: 'string' },
	          citations: { type: 'array', items: { type: 'string' } },
	        },
	      },
	    },
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

	const claimItems = []
	const seenClaims = new Set()
	for (const source of sources) {
	  for (const claim of source.claims ?? []) {
	    const normalized = String(claim).replace(/\\s+/g, ' ').trim()
	    if (!normalized) continue
	    const key = normalized.toLowerCase()
	    if (seenClaims.has(key)) continue
	    seenClaims.add(key)
	    claimItems.push({
	      claim: normalized,
	      sourceTitle: source.title,
	      sourceUrl: source.url,
	    })
	  }
	}

	const candidateClaims = claimItems.slice(0, 30)
	if (candidateClaims.length === 0) {
	  throw new Error('deep-research could not extract candidate claims to verify.')
	}

	phase('Cross-check claims')
	const claimVotes = await parallel(
	  candidateClaims.map((item, index) => async () => {
	    const votes = await parallel(
	      [0, 1, 2].map(voter => () =>
	        agent(
	          'Vote independently on whether this claim is directly supported by the source notes for the research question. Default to supported=false if the source notes are ambiguous or only indirectly related. Question: ' +
	            question +
	            '\\nClaim: ' +
	            item.claim +
	            '\\nOriginal source URL: ' +
	            item.sourceUrl +
	            '\\nSource notes JSON: ' +
	            JSON.stringify(sources),
	          { label: 'Vote claim ' + (index + 1) + '.' + (voter + 1), schema: CLAIM_VOTE_SCHEMA },
	        )),
	    )
	    const usableVotes = votes.filter(Boolean)
	    const supportedVotes = usableVotes.filter(vote => vote.supported)
	    const citations = Array.from(new Set(
	      supportedVotes
	        .flatMap(vote => Array.isArray(vote.citations) ? vote.citations : [])
	        .filter(Boolean),
	    ))
	    return {
	      claim: item.claim,
	      sourceUrl: item.sourceUrl,
	      votes: usableVotes,
	      supportedVotes: supportedVotes.length,
	      passed: supportedVotes.length >= 2,
	      citations: citations.length ? citations : [item.sourceUrl].filter(Boolean),
	    }
	  }),
	)

	const supportedClaims = claimVotes
	  .filter(vote => vote?.passed)
	  .map(vote => ({
	    claim: vote.claim,
	    citations: vote.citations,
	    supportVotes: vote.supportedVotes,
	  }))
	const weakClaims = claimVotes
	  .filter(vote => vote && !vote.passed)
	  .map(vote => ({
	    claim: vote.claim,
	    supportVotes: vote.supportedVotes,
	    votes: vote.votes,
	  }))
	const conflictScan = await agent(
	  'Review the source notes and voted claim outcomes for conflicts or unresolved disagreements. Report only conflicts relevant to the question. Question: ' +
	    question +
	    '\\nSupported claims JSON: ' +
	    JSON.stringify(supportedClaims) +
	    '\\nWeak claims JSON: ' +
	    JSON.stringify(weakClaims) +
	    '\\nSource notes JSON: ' +
	    JSON.stringify(sources),
	  { label: 'Find claim conflicts', schema: CONFLICT_SCAN_SCHEMA },
	)
	const verification = {
	  supportedClaims,
	  weakClaims,
	  conflicts: conflictScan?.conflicts ?? [],
	}

	phase('Synthesize report')
	const report = await agent(
	  'Write the final deep research report. Answer the question directly, cite source URLs inline for each important claim, exclude claims that did not pass majority support, and mention conflicts or uncertainty. Question: ' +
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
      isEnabled: isWebSearchAvailable,
    },
  ]
}

export function initBundledWorkflows(): void {
  // Bundled workflows are registered lazily through loadBundledWorkflows().
}
