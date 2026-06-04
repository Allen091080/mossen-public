// W446 build stub — this tool is internal-only (gated on the legacy
// upstream user-type check, see tools.ts) or feature-gated, and not part
// of the external mossen build. Stub exists so `bun build --compile` can
// resolve the conditional require path; runtime always sees null because
// the gate is never true in external builds. Do NOT depend on this symbol
// — replace stub with the real tool only if internal-only tooling is
// reintroduced.
export const REPLTool = null
