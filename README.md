# Mossen

Mossen is a personal software-engineering AI CLI designed for local use,
configurable model providers, tool use, project memory, and scriptable
developer workflows.

## Supported Capabilities

- Interactive coding sessions in the terminal, including project-aware chat,
  file inspection, file editing, shell commands, and git-aware workflows.
- OpenAI-compatible model profiles with per-profile base URL, model ID, API key
  environment variable, and optional max input token settings.
- Provider examples for OpenAI, Qwen/DashScope, GLM, MiniMax, and other
  OpenAI-compatible gateways.
- MCP server integration for extending Mossen with external tools, resources,
  and authenticated services.
- Project memory and memory-sidecar workflows for local recall, indexing,
  review, and export of project knowledge.
- Permission controls, plan mode, sandbox-aware command handling, and explicit
  user confirmation for sensitive actions.
- Plugin, skill, task, session, workflow, and background-agent commands for
  larger development flows.
- Local-first configuration with user and project settings; generated public
  exports intentionally omit local state and secret-bearing files.

## Quick Start

```bash
bun install --frozen-lockfile
npm link
mossen
```

## Common Commands

```bash
mossen --help
mossen --version
bun run typecheck
```

## Model Provider Configuration

Mossen supports OpenAI-compatible model profiles. Store real API keys outside
the repository and point Mossen at the environment variable name.

```bash
export OPENAI_API_KEY="your-openai-key"
/model add openai --baseURL https://api.openai.com/v1 --model gpt-4.1 --apiKeyEnv OPENAI_API_KEY --activate
```

Examples for other OpenAI-compatible providers:

```bash
export QWEN_API_KEY="your-dashscope-key"
/model add qwen --baseURL https://coding.dashscope.aliyuncs.com/v1 --model qwen3.6-plus --apiKeyEnv QWEN_API_KEY --activate

export GLM_API_KEY="your-bigmodel-key"
/model add glm --baseURL https://open.bigmodel.cn/api/coding/paas/v4 --model glm-5.1 --apiKeyEnv GLM_API_KEY --activate

export MMX_API_KEY="your-minimax-key"
/model add minimax --baseURL https://api.minimax.chat/v1 --model <model-id> --apiKeyEnv MMX_API_KEY --activate
```

The profile is stored in the user's Mossen settings. The secret value should
remain in the user's shell, keychain, or secret manager; do not commit real API
keys, `.env` files, or local `~/.mossen` state into this repository.

## Public Export Policy

This repository is generated from the private Mossen development repository.
Local state, private release machinery, historical cleanup notes, closed-source
native binaries, and internal validation archives are intentionally omitted.

Protocol compatibility constants may remain when they are required wire-format
identifiers at an API boundary.
