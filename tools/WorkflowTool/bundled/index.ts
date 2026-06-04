// W446 build stub — bundled workflows are internal-only / feature-gated.
// Stub exists so `bun build --compile` can resolve the conditional require
// in tools.ts; runtime always skips initialization because the gate is
// never true in external builds.
export function initBundledWorkflows(): void {
  // intentional no-op
}
