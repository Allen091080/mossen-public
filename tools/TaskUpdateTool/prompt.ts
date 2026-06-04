import { getInteractiveLanguageTag } from '../../utils/uiLanguage.js'

export const DESCRIPTION = 'Update a task in the task list'

export function getPrompt(): string {
  const isChinese = getInteractiveLanguageTag() === 'zh'

  const langRule = isChinese
    ? '【强约束】当前 UI 语言为中文。subject、description、activeForm 这些用户可见字段必须使用中文。保留英文的例外：shell 命令、slash command（如 /memory）、文件路径（如 src/foo.ts）、代码标识符（如 ToolUseContext）、协议名（如 stream-json）、package/API 名可保留英文，但整句必须是中文。示例：✅ "检查 /memory 命令路由" ✅ "审计 recall 只读边界" ❌ "Audit /memory command" ❌ "Fixing spinner language"'
    : 'The current runtime language is English. Prefer English for task subject, description, and activeForm unless the user is clearly operating in another language.'

  return `${langRule}

Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- IMPORTANT: Update task state as you work so the checklist reflects progress in real time; do not wait until your final answer
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to \`deleted\` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: \`pending\` → \`in_progress\` → \`completed\`

Use \`deleted\` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using \`TaskGet\` before updating it.

## Examples

Mark task as in progress when starting work:
\`\`\`json
{"taskId": "1", "status": "in_progress"}
\`\`\`

Mark task as completed after finishing work:
\`\`\`json
{"taskId": "1", "status": "completed"}
\`\`\`

Mark a task completed immediately after finishing that step so the UI can cross it off before you continue:
\`\`\`json
{"taskId": "2", "status": "completed"}
\`\`\`

Delete a task:
\`\`\`json
{"taskId": "1", "status": "deleted"}
\`\`\`

Claim a task by setting owner:
\`\`\`json
{"taskId": "1", "owner": "my-name"}
\`\`\`

Set up task dependencies:
\`\`\`json
{"taskId": "2", "addBlockedBy": ["1"]}
\`\`\`
`
}
