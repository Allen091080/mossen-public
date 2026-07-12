// @mossen/cli/sdk — single re-export entry for the Mossen SDK surface.
//
// W451 minimum-viable mode (Distribution Plan Phase 3): exposes the
// schemas, types, and runtime constants that integrators (C-class
// platform embedders) need to:
//   1. Parse the NDJSON stream emitted by `mossen --print --output-format
//      stream-json` (the surface contract is mossen-contract.json §4
//      `ndjson_message_envelope` + `system_init_fields`).
//   2. Construct strongly-typed control-protocol requests (hooks,
//      permissions, MCP server config).
//   3. Validate inbound SDK messages at runtime via zod schemas.
//
// **What this entry does NOT yet expose** (W451 stub mode):
//   - `runSession()` / `streamEvents()` high-level runtime API:
//     mossen's internal session runtime is tightly coupled to the CLI
//     entry (entrypoints/cli.tsx); extracting it as a re-usable function
//     is a separate wave (W458+) gated on actual C-class user demand.
//     Until then, integrators should spawn the `mossen` binary
//     (see scripts/build_binary.sh output or @mossen/cli's bin) and
//     pipe its NDJSON output through the parsing primitives below.
//   - Bundled `.js` output: this re-export is the TypeScript source.
//     Consumers using `import` from a TS project (with `moduleResolution:
//     "bundler"` or `nodenext`) get types out of the box. Plain-Node
//     consumers need a bundler step (esbuild/tsup) downstream. A real
//     pre-bundled npm package will land in W451-bundle (post-Phase 3
//     gating on C-class adoption).
//
// Stability contract: anything re-exported here is part of the public
// stable surface declared in dev/mossen-contract.json §4.1. Adding new
// re-exports is a minor bump; removing or renaming requires the
// deprecation protocol from `breaking_change_protocol` section.

// === Schemas (zod) ============================================================
// Runtime validation of inbound SDK messages + outbound control requests.
// All schemas are lazily-evaluated factories — call the function to get the
// concrete z.Object.
export {
  SDKSystemMessageSchema,
  SDKPartialAssistantMessageSchema,
  SDKCompactBoundaryMessageSchema,
  SDKResultMessageSchema,
  SDKStatusSchema,
  SDKUserMessageReplaySchema,
} from './coreSchemas.js'

export {
  SDKControlInitializeRequestSchema,
  SDKControlInitializeResponseSchema,
  SDKControlInterruptRequestSchema,
} from './controlSchemas.js'

// === Types ====================================================================
// All public type aliases (generated from the schemas above + manual additions).
export type {
  SDKStatus,
  SDKUserMessageReplay,
  HookEvent,
  ExitReason,
  NonNullableUsage,
  SandboxFilesystemConfig,
  SandboxIgnoreViolations,
  SandboxNetworkConfig,
  SandboxSettings,
} from './coreTypes.js'

export type {
  SDKControlRequest,
  SDKControlResponse,
  SDKControlRequestInner,
  StdinMessage,
  StdoutMessage,
} from './controlTypes.js'

export type {
  SDKSession,
  SDKSessionOptions,
  SDKSessionInfo,
  SDKUserMessage,
  SDKMessage,
  SDKResultMessage,
  SessionMessage,
  Options,
  Query,
  SdkMcpToolDefinition,
  McpSdkServerConfigWithInstance,
} from './runtimeTypes.js'

// === Constants ================================================================
// Tuple/literal-typed arrays for runtime checks (e.g. `HOOK_EVENTS.includes(name)`).
export { HOOK_EVENTS, EXIT_REASONS } from './coreTypes.js'

// === Contract metadata ========================================================
// Re-export the contract version + schema reference so consumers can pin
// their integration to a specific contract revision (matches dev/mossen-contract.json).
export const MOSSEN_CONTRACT_VERSION = '1.1.0' as const
export const MOSSEN_CONTRACT_PATH = 'dev/mossen-contract.json' as const
