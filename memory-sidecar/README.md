# Mossen Memory Sidecar

Stage 1 is an independent memory sidecar. It stores, indexes, and retrieves
archive events without wiring into Mossen core, the query loop, Workbench, slash
commands, or `MEMORY.md`.

## Defaults

The sidecar is safe-by-default:

```json
{
  "enabled": false,
  "capture": { "enabled": false },
  "index": { "sqlite": true, "fts": true, "vector": false },
  "classification": { "ruleBased": true, "llm": false },
  "retrieval": { "mcp": false },
  "team": { "enabled": false }
}
```

Data lives under `<home>/memory-sidecar/` when `--home <path>` is supplied.

## CLI

Run from this repository with Bun:

```bash
bun memory-sidecar/src/cli/index.ts status --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts init --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts enable --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts disable --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts import-fixture --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts recent --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts search "project phoenix" --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts get evt_fixture_architecture --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts rebuild --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts stats --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts verify --dry-run --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts repair --dry-run --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts observations --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts vector-status --home /tmp/mossen-home
bun memory-sidecar/src/cli/index.ts benchmark-fixture 1000 --home /tmp/mossen-home
```

The package bin is `mossen-memory`, so a linked or packaged install can use the
same commands as `mossen-memory <command> --home <path>`.

### Management Commands

- `stats` reports archive manifest counts including files, events, bad JSONL
  lines, and last event time.
- `verify --dry-run` scans JSONL without mutating data. Bad archive lines are reported
  instead of crashing the store.
- `repair --dry-run` prints planned corrupt-line quarantine actions. Stage 1
  intentionally rejects non-dry-run repair.
- `observations` runs the rule classifier and persists missing observations to
  `<home>/memory-sidecar/projects/project-phoenix/memory/observations.jsonl`.
- `vector-status` makes the stage 1 vector boundary explicit: vector indexing is
  disabled by default in this phase.
- `benchmark-fixture <count>` imports disposable local events and rebuilds
  SQLite FTS for scale checks.

## Stage 1 Boundaries

- No automatic capture from Mossen sessions.
- No vector index.
- No LLM classification.
- No team sharing.
- No writes to `MEMORY.md`.
- No dependency on Mossen core runtime paths.
