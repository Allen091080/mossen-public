import { registerBundledSkill } from '../bundledSkills.js'

type CoreSkill = {
  name: string
  description: string
  whenToUse: string
  body: string
  argumentHint?: string
  disableModelInvocation?: boolean
}

const CORE_SKILLS: CoreSkill[] = [
  {
    name: 'skill-creator',
    description:
      'Create, refine, and evaluate Mossen skills with narrow triggers and safe frontmatter.',
    argumentHint: '[skill goal or existing skill path]',
    whenToUse:
      'Use when the user wants to create a new Mossen skill, improve an existing skill, tune trigger descriptions, or define a reusable workflow as SKILL.md.',
    body: `# Mossen Skill Creator

Use this process to create or refine a Mossen skill.

## Rules
- Keep triggers narrow. A skill should activate for a specific workflow, not a broad topic.
- Prefer project skills in \`.mossen/skills/<name>/SKILL.md\` for repo-specific workflows.
- Prefer user skills in \`~/.mossen/skills/<name>/SKILL.md\` for cross-project workflows.
- Do not grant broad tools by default. Use the smallest \`allowed-tools\` patterns that satisfy the workflow.
- If the skill has side effects, set \`disable-model-invocation: true\` unless automatic invocation is clearly safe.
- Include success criteria for each step.

## Output
Produce a complete SKILL.md proposal with frontmatter and implementation notes. Ask before writing files unless the user explicitly told you to implement.`,
  },
  {
    name: 'mcp-builder',
    description:
      'Design and build MCP servers and tool schemas that fit Mossen permission and local-first constraints.',
    argumentHint: '[MCP server goal]',
    whenToUse:
      'Use when the user wants to build, debug, review, or integrate an MCP server for Mossen.',
    body: `# Mossen MCP Builder

Use this skill for MCP server design and implementation.

## Mossen constraints
- Prefer local, explicit, least-privilege MCP servers.
- Do not default-enable network, credential, shell, or remote-account MCP servers.
- Clearly describe each tool's side effects.
- Keep read-only tools separate from mutation tools.
- Validate inputs and return bounded outputs.
- Never embed tokens or credentials in templates.

## Delivery checklist
- Tool list and schemas.
- Transport choice.
- Permission and approval behavior.
- Failure modes and bounded output policy.
- Smoke tests or manual verification steps.`,
  },
  {
    name: 'doc-coauthoring',
    description:
      'Draft Mossen technical specs, upgrade plans, execution packages, and closeout reports.',
    argumentHint: '[document goal]',
    whenToUse:
      'Use when the user asks to write or refine a Mossen technical document, upgrade plan, execution package, decision note, or closeout report.',
    body: `# Mossen Documentation Coauthoring

Use this skill to write concise, actionable Mossen engineering documents.

## Preferred structure
- Context and goal.
- Scope and non-goals.
- REAL / SCHEMA-BLOCKED / STOP table when risk is non-trivial.
- Execution slices.
- Validation plan.
- Red lines.
- Closeout format.

## Style
- Make decisions explicit.
- Keep instructions copyable.
- Avoid filler audit language when the path is already clear.
- Record deferrals with concrete reasons.`,
  },
  {
    name: 'mossen-upgrade-planning',
    description:
      'Plan Mossen upgrade waves with scope control, red lines, verification, and closeout requirements.',
    argumentHint: '[upgrade target or wave]',
    whenToUse:
      'Use when planning Mossen upgrade waves, prioritizing official upgrade points, or writing implementation instructions for another agent.',
    body: `# Mossen Upgrade Planning

Use this skill to turn upgrade ideas into safe Mossen waves.

## Required decisions
- What is in scope?
- What is deferred?
- Does this touch mutation, protocol union, query loop, permissions, config, memory, install, auth, or filesystem deletion?
- What must be confirmed by Allen before code?

## Standard wave shape
- Preflight.
- Implementation.
- Focused smoke.
- Full smoke where needed.
- Commit split: feat / test / docs.
- No push unless Allen explicitly authorizes.

## Red lines
- Do not touch GitHub remote.
- Do not push tags.
- Do not touch \`commands/insights.ts\`.
- Do not create fake capability surfaces.`,
  },
  {
    name: 'mossen-protocol-development',
    description:
      'Develop Mossen stream-json, control_request, capability manifest, schema, docs, and smoke changes safely.',
    argumentHint: '[protocol change]',
    whenToUse:
      'Use when changing Mossen CLI/Core protocols, stream-json contracts, control_request subtypes, capability manifests, or Workbench-facing protocol surfaces.',
    body: `# Mossen Protocol Development

Use this skill for protocol-facing changes.

## Invariants
- Main repo is the source of truth for capabilities.
- Protocol changes must update schema, whitelist/contract tests, docs, and focused smoke in the same wave.
- Do not add writer paths casually.
- Keep blocked capabilities explicit rather than fake-enabled.

## Checklist
- Request shape.
- Response shape.
- Error tags.
- Backward compatibility.
- Smoke coverage.
- Workbench consumption notes if applicable.`,
  },
  {
    name: 'mossen-plugin-development',
    description:
      'Design Mossen plugins, bundled skills, commands, hooks, MCP integration, settings, and safety boundaries.',
    argumentHint: '[plugin or extension goal]',
    whenToUse:
      'Use when building or reviewing Mossen plugin, extension, bundled skill, hook, command, MCP, or agent development work.',
    body: `# Mossen Plugin Development

Use this skill for Mossen plugin and extension work.

## Existing systems to reuse
- \`skills/bundled/*\` for always-available bundled skills.
- \`plugins/builtinPlugins.ts\` for user-toggleable built-in plugins.
- \`utils/plugins/*\` for plugin discovery, validation, install, status, and cache behavior.
- \`services/mcp/*\` for MCP runtime and config.

## Safety
- Extensions do not bypass permissions.
- Hooks are not high-risk auto-execution by default.
- MCP servers are not connected by default unless explicitly enabled.
- GitHub or remote install must be dry-run + confirm + pinned.`,
  },
  {
    name: 'mossen-permission-safety',
    description:
      'Work on Mossen permission, bypass-immune, Auto Mode, and safety-sensitive behavior without weakening safeguards.',
    argumentHint: '[permission or safety task]',
    whenToUse:
      'Use when changing Mossen permission prompts, bypass-immune rules, Auto Mode, dangerous path handling, or local safety policy.',
    body: `# Mossen Permission Safety

Use this skill for permission-sensitive work.

## Rules
- Prefer explainable allow / ask / deny decisions.
- Never weaken bypass-immune paths without explicit approval.
- For mutation or deletion, require dry-run and confirm-token when practical.
- Redact secrets in logs and reports.
- Do not tune Auto Mode without an eval set or audit evidence.

## Outputs
- Risk table.
- Caller list.
- Test matrix.
- Rollback plan.`,
  },
  {
    name: 'mossen-memory-development',
    description:
      'Develop Mossen auto memory, team memory, session memory, compact, and memory diagnostics safely.',
    argumentHint: '[memory task]',
    whenToUse:
      'Use when changing Mossen memory behavior, team memory gates, session memory, compact boundaries, or memory diagnostics.',
    body: `# Mossen Memory Development

Use this skill for memory and compact-adjacent work.

## Rules
- Do not disable auto memory to solve team memory issues.
- Team memory must have its own explicit gate.
- Do not read or display memory contents when only metadata is required.
- Compact execution must use real query-loop context; never fake ToolUseContext.
- Treat memory deletion as high-risk mutation.`,
  },
  {
    name: 'mossen-release-maintenance',
    description:
      'Prepare Mossen commits, validation reports, push instructions, and release-safe maintenance summaries.',
    argumentHint: '[release or closeout task]',
    disableModelInvocation: true,
    whenToUse:
      'Use when preparing Mossen closeout reports, push instructions, validation summaries, or release maintenance tasks.',
    body: `# Mossen Release Maintenance

Use this skill for closeout and release-safe maintenance.

## Required closeout fields
- STOP/GO.
- Commit hashes.
- Changed files.
- Validation results.
- git status.
- Whether push/tags/GitHub were touched.

## Red lines
- Never push without Allen approval.
- Never push tags unless explicitly requested.
- Never push GitHub mirror unless explicitly requested.
- Avoid \`git add .\`; protect unrelated files and \`commands/insights.ts\`.`,
  },
]

export function registerMossenCoreSkills(): void {
  for (const skill of CORE_SKILLS) {
    registerBundledSkill({
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      argumentHint: skill.argumentHint,
      disableModelInvocation: skill.disableModelInvocation ?? false,
      userInvocable: true,
      async getPromptForCommand(args) {
        const text = args
          ? `${skill.body}\n\n## User Request\n\n${args}`
          : skill.body
        return [{ type: 'text', text }]
      },
    })
  }
}
