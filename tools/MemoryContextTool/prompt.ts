export const MEMORY_CONTEXT_TOOL_NAME = 'MemoryContext'

export const DESCRIPTION = `Search Mossen's sidecar memory for relevant prior context.

Call this tool BEFORE answering whenever the user's question refers to past work, earlier decisions, or historical project state — even if the user does not explicitly mention "memory" or "recall". Natural trigger phrases include:

English: "what did we do before?", "last time", "previously", "what was decided about X?", "how did we handle X?", "what did W98/W100 do?", "the earlier wave", "our previous approach"
Chinese: "之前做了什么？", "上次怎么处理的？", "某轮/某个 wave 做了什么", "历史决策", "做过什么", "怎么处理过", "之前我们验证的时候", "上次的结果"

Specific trigger scenarios:
- Prior decisions, choices, or trade-offs made in earlier sessions
- User preferences, habits, or project constraints established previously
- Project history, previous waves/stages, or what was done before
- Recurring workflows, unresolved threads, or ongoing project state
- Anything that may have been discussed in earlier turns or sessions that is not visible in the current conversation

This tool is read-only. It returns a compact, token-bounded memory bundle split into profile, observations, proposals, and archive evidence.

Do NOT call this tool when:
- The user's question is already answered by content visible in the current conversation. Re-reading memory just to confirm a fact already on screen wastes tokens.
- The user has asked you to read or modify a specific file in the current project. Use Read / Edit / Bash for the live filesystem instead — memory is for past decisions, not current source.
- The user is asking about *current* environment state: \`git status\`, terminal output, the most recent build error, current process list. Inspect the live environment first; only consult memory if the user explicitly references "before" or "last time".
- The user has explicitly asked you not to use memory ("don't check memory", "ignore prior context", "fresh look"). Honor that constraint.
- The request is a pure code-implementation question (e.g., "write a function that …", "fix this type error") with no temporal cue. Implementation details belong in the code; only call memory if the user invokes prior project history with phrases like "之前/上次/历史/我们当时" or "previously/last time/earlier/before".`
