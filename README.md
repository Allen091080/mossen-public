# Mossen

Mossen is a multi-model, memory-aware software-engineering CLI for developers
who want their coding assistant to stay local-first, workflow-driven, and easy
to adapt to different LLM providers.

Use Mossen when you want one terminal workspace that can switch models, keep
project memory, run repeatable workflows, track goals, call tools, and stay
under your control.

## Why Mossen

- Multi-model by design: create named profiles for OpenAI-compatible endpoints,
  including OpenAI, Qwen/DashScope, GLM, MiniMax, and private gateways.
- Goal-driven development: keep long tasks anchored to an explicit objective
  instead of letting multi-step coding sessions drift.
- Workflow commands: turn repeatable engineering flows into commands for
  planning, review, memory operations, project tasks, sessions, and automation.
- Sidecar memory system: index project knowledge outside the chat transcript,
  recall relevant context, review memory entries, and export memory data.
- MCP and plugin expansion: connect Mossen to external tools, resources,
  authenticated services, skills, and project-specific extensions.
- Local-first safety: keep API keys in environment variables, keychain, or your
  own secret manager; generated public exports omit local state and secrets.
- Practical coding loop: inspect files, edit code, run shell commands, manage
  git workflows, and use permissions for sensitive actions.

## Core Capabilities

- Interactive terminal coding sessions with project-aware context.
- File reading, editing, shell execution, and git-aware development flows.
- Model profile management with per-profile base URL, model ID, API key env var,
  protocol, and optional token limits.
- `/goal` flows for objective tracking and completion status.
- `/model`, `/workflow`, `/memory`, `/memory-sidecar`, `/mcp`, `/plugin`,
  `/tasks`, `/session`, and other command surfaces.
- Memory-sidecar capture, indexing, retrieval, review, LLM-assisted
  classification, and export workflows.
- Plan mode, permission controls, sandbox-aware command handling, and explicit
  confirmation for sensitive operations.

## Quick Start

```bash
bun install --frozen-lockfile
npm link
mossen
```

Useful checks:

```bash
mossen --help
mossen --version
bun run typecheck
```

## Model Provider Setup

Mossen stores model profiles in user settings and stores real secret values
outside the repository. Pass the environment variable name with `--apiKeyEnv`;
do not paste real API keys into source files.

```bash
export OPENAI_API_KEY="your-openai-key"
/model add openai --baseURL https://api.openai.com/v1 --model gpt-4.1 --apiKeyEnv OPENAI_API_KEY --activate
```

Other OpenAI-compatible examples:

```bash
export QWEN_API_KEY="your-dashscope-key"
/model add qwen --baseURL https://coding.dashscope.aliyuncs.com/v1 --model qwen3.6-plus --apiKeyEnv QWEN_API_KEY --activate

export GLM_API_KEY="your-bigmodel-key"
/model add glm --baseURL https://open.bigmodel.cn/api/coding/paas/v4 --model glm-5.1 --apiKeyEnv GLM_API_KEY --activate

export MMX_API_KEY="your-minimax-key"
/model add minimax --baseURL https://api.minimax.chat/v1 --model <model-id> --apiKeyEnv MMX_API_KEY --activate
```

## Public Export Policy

This repository is generated from the private Mossen development repository.
Local state, private release machinery, internal cleanup notes, closed-source
native binary experiments, `.env` files, and secret-bearing config are
intentionally omitted.

Protocol compatibility constants may remain when they are required wire-format
identifiers at an API boundary.

---

# Mossen 中文说明

Mossen 是一个面向开发者的多模型、目标驱动、带旁路记忆系统的软件工程 CLI。
它不是单纯的聊天壳，而是把模型切换、项目上下文、工作流、Goal、工具调用和
本地记忆组织到同一个终端工作台里。

如果你希望编码助手不依赖单一模型、不丢项目长期上下文、能沉淀工作流，还能把
API key 和本地配置留在自己机器上，Mossen 就是为这个场景设计的。

## 为什么选择 Mossen

- 多模型能力：用 profile 管理 OpenAI-compatible endpoint，可接 OpenAI、
  Qwen/DashScope、GLM、MiniMax 和私有网关。
- Goal 驱动：长任务先绑定目标，过程中持续围绕目标推进，减少多轮编码跑偏。
- 工作流系统：把常用工程流程沉淀成命令，覆盖规划、审查、记忆、任务、会话和自动化。
- 旁路记忆系统：把项目知识放在聊天记录之外独立索引、召回、审查和导出，避免上下文越聊越乱。
- MCP 和插件扩展：接入外部工具、资源、认证服务、技能和项目级扩展。
- 本地优先安全边界：真实 API key 保留在环境变量、钥匙串或你自己的密钥管理系统中。
- 实用编码闭环：读文件、改代码、跑命令、处理 git、规划任务、做权限确认，都在终端里完成。

## 核心能力

- 项目感知的交互式终端编码会话。
- 文件读取、代码编辑、shell 执行和 git-aware 工作流。
- 模型 profile 管理：base URL、model ID、API key 环境变量名、协议和 token 限制。
- `/goal` 目标管理，用于追踪任务目标和完成状态。
- `/model`、`/workflow`、`/memory`、`/memory-sidecar`、`/mcp`、`/plugin`、
  `/tasks`、`/session` 等命令入口。
- 旁路记忆捕获、索引、召回、审查、LLM 辅助分类和导出。
- Plan mode、权限控制、沙箱感知命令处理，以及敏感操作显式确认。

## 快速开始

```bash
bun install --frozen-lockfile
npm link
mossen
```

常用检查：

```bash
mossen --help
mossen --version
bun run typecheck
```

## 多模型配置

Mossen 的模型配置通过 profile 管理。真实 API key 不进仓库，只在 profile
里保存环境变量名。

```bash
export OPENAI_API_KEY="your-openai-key"
/model add openai --baseURL https://api.openai.com/v1 --model gpt-4.1 --apiKeyEnv OPENAI_API_KEY --activate
```

其他 OpenAI-compatible 示例：

```bash
export QWEN_API_KEY="your-dashscope-key"
/model add qwen --baseURL https://coding.dashscope.aliyuncs.com/v1 --model qwen3.6-plus --apiKeyEnv QWEN_API_KEY --activate

export GLM_API_KEY="your-bigmodel-key"
/model add glm --baseURL https://open.bigmodel.cn/api/coding/paas/v4 --model glm-5.1 --apiKeyEnv GLM_API_KEY --activate

export MMX_API_KEY="your-minimax-key"
/model add minimax --baseURL https://api.minimax.chat/v1 --model <model-id> --apiKeyEnv MMX_API_KEY --activate
```

## 公开导出说明

这个仓库由 Mossen 私有开发仓生成。公开导出会排除本地状态、私有发布流程、
内部清理记录、闭源原生二进制实验、`.env` 文件和含密钥的配置。

少量协议兼容字面量如果是 API 边界必须的 wire-format 标识，可能会保留。
