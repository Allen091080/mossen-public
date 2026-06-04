import { WORKFLOW_TOOL_NAME } from './constants.js'

/** The model-facing instructions for the Workflow tool. Brand-neutral. */
export const WORKFLOW_TOOL_PROMPT = `Execute a workflow script that orchestrates multiple subagents deterministically.

A workflow is a small JavaScript program that fans work out across many subagents and combines their results. Use it to be comprehensive (decompose and cover in parallel), to be confident (independent perspectives and adversarial checks), or to take on scale a single context can't hold (migrations, audits, broad sweeps).

Provide the program inline via \`script\`. It must begin with an \`export const meta\` literal:

  export const meta = {
    name: 'find-bugs',
    description: 'Find and verify bugs in changed files',
    phases: [{ title: 'Find' }, { title: 'Verify' }],
  }
  // body below — use the injected primitives
  phase('Find')
  const found = await agent('List likely bugs in the diff.', { schema: BUGS_SCHEMA })
  ...

The \`meta\` object must be a PURE LITERAL (no variables, calls, or interpolation). Required: \`name\`, \`description\`. Optional: \`whenToUse\`, \`phases\`.

Injected surface available to the script body:
- agent(prompt, opts?): Promise<any> — run one subagent. Without a schema it returns the agent's final text. With \`opts.schema\` (a JSON Schema) it returns a validated object (the agent is re-prompted on mismatch). opts: { label?, phase?, schema?, model?, isolation?, agentType? }.
- parallel(thunks): Promise<any[]> — run thunks concurrently; BARRIER (awaits all). A thunk that throws becomes null — filter(Boolean) before use.
- pipeline(items, ...stages): Promise<any[]> — run each item through all stages independently, NO barrier between stages. Each stage receives (prevResult, originalItem, index). A throwing stage drops that item to null.
- phase(title): void — start a progress phase; later agents group under it.
- log(message): void — emit a progress line.
- args: the value passed as the tool's \`args\` input, verbatim.
- budget: { total, spent(), remaining() } — shared token budget; agent() throws once exhausted.
- workflow(nameOrRef, args?): Promise<any> — run another workflow as a sub-step (one level of nesting only).

Concurrency across all fan-out paths is capped automatically. Scripts are plain JavaScript with standard builtins EXCEPT Date.now()/Math.random()/argless new Date() (they throw, to keep resume deterministic) and no filesystem/network/process access. import/require/eval are not available — use only the injected surface.

DEFAULT TO pipeline() for multi-stage work; reach for parallel() only when a stage genuinely needs all prior results at once (dedup/merge/early-exit).

The canonical multi-stage shape — pipeline by default, so each item verifies the moment its own review completes (no waiting on slower siblings):
  const DIMENSIONS = [{ key: 'bugs', prompt: '...' }, { key: 'perf', prompt: '...' }]
  const results = await pipeline(
    DIMENSIONS,
    d => agent(d.prompt, { label: \`review:\${d.key}\`, phase: 'Review', schema: FINDINGS }),
    review => parallel(review.findings.map(f => () =>
      agent(\`Adversarially verify: \${f.title}\`, { phase: 'Verify', schema: VERDICT })
        .then(v => ({ ...f, verdict: v })))),
  )
  const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
Use a barrier (\`await parallel(...)\` between stages) ONLY when stage N needs ALL of stage N-1 at once — dedup/merge across the full set, or early-exit on zero results. Otherwise pipeline.

ORCHESTRATION PATTERNS — these are the modes to reach for; compose them from the primitives and pick by task:
- Understand: parallel readers over different subsystems, each returning a slice → combine into one structured map.
- Design: generate N independent approaches from different angles (e.g. MVP-first, risk-first, user-first), score them with parallel judges, then synthesize from the winner while grafting the best ideas of the runners-up. Beats one-attempt-iterated when the solution space is wide.
- Review: split the work into dimensions → find per dimension → adversarially verify each finding before reporting.
- Research: parallel agents each searching a DIFFERENT way (by container, by content, by entity, by time), each blind to the others → deep-read the hits → synthesize.
- Migrate: discover sites → transform each (pass \`opts.isolation: 'worktree'\` so concurrent edits don't collide) → verify each independently.

Quality patterns:
- Adversarial verify: per finding, spawn N independent skeptics each prompted to REFUTE; keep the finding only if a majority fail to refute. Kills plausible-but-wrong results.
    const votes = await parallel(Array.from({ length: 3 }, () => () =>
      agent(\`Try to refute: \${claim}. Default to refuted=true if unsure.\`, { schema: VERDICT })))
    const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
- Perspective-diverse verify: when a finding can fail in several ways, give each verifier a DISTINCT lens (correctness, security, perf, does-it-reproduce) instead of N identical skeptics — diversity catches failure modes redundancy can't.
- Judge panel: N attempts → parallel scorers → synthesize from the top-scored, folding in the best of the rest.
- Loop-until-dry: for unknown-size discovery (bugs, edge cases), keep spawning finders until K consecutive rounds surface nothing new. Dedup against EVERYTHING seen, not just what was confirmed, or rejected findings reappear and it never converges.
    const seen = new Set(); let dry = 0
    while (dry < 2) {
      const found = (await parallel(FINDERS.map(f => () => agent(f.prompt, { phase: 'Find', schema: BUGS }))))
        .filter(Boolean).flatMap(r => r.bugs)
      const fresh = found.filter(b => !seen.has(key(b)))
      if (!fresh.length) { dry++; continue }
      dry = 0; fresh.forEach(b => seen.add(key(b)))
      // ...verify the fresh findings here...
    }
- Multi-modal sweep: parallel agents, each using one search angle and blind to the rest; for when no single angle finds everything.
- Completeness critic: a final agent that asks "what's missing — a modality not run, a claim unverified, a source unread?" Its answer becomes the next round of work.
- Loop-until-count / loop-until-budget: accumulate to a target, or scale depth to the token budget. Guard on \`budget.total\` — \`remaining()\` is Infinity when no target was set, so an unguarded loop would run to the agent cap.
    while (budget.total && budget.remaining() > 50_000) { /* spawn another finder, push results */ }

Scale to the ask: a quick check → a few finders + single-vote verify; "audit thoroughly" / "be comprehensive" → a larger finder pool, a 3–5 vote adversarial pass, and a synthesis stage. If you bound coverage (top-N, sampling, no-retry), log() what was dropped — silent truncation reads as "covered everything" when it didn't.

Return a value from the script (top-level \`return\`) to surface a final result. Only use ${WORKFLOW_TOOL_NAME} for genuine multi-agent orchestration; for a single delegated task use the Agent tool instead.`
