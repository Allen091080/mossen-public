import { registerBuiltinPlugin } from '../builtinPlugins.js'

function prompt(body: string): (args: string) => Promise<Array<{ type: 'text'; text: string }>> {
  return async args => [
    {
      type: 'text',
      text: args.trim()
        ? `${body}\n\n## User Request\n${args.trim()}`
        : body,
    },
  ]
}

export function registerMossenPluginDevPlugin(): void {
  registerBuiltinPlugin({
    name: 'mossen-plugin-dev',
    description:
      'Mossen extension development pack: plugins, skills, commands, hooks, MCP servers, settings, and agents.',
    version: '0.1.0',
    defaultEnabled: true,
    skills: [
      {
        name: 'plugin-structure',
        description:
          'Design a Mossen plugin layout, manifest, component folders, and review checklist.',
        argumentHint: '[plugin goal]',
        whenToUse:
          'Use when the user wants to create or review a Mossen plugin package structure.',
        getPromptForCommand: prompt(`# Mossen Plugin Structure

Design the plugin using Mossen's existing plugin systems. Reuse manifest loading, installed plugin registry, cache behavior, and built-in plugin patterns.

## Required output
- Recommended plugin directory tree.
- Manifest fields.
- Skills, commands, hooks, MCP servers, agents, or settings included.
- Default enabled/disabled behavior.
- Safety boundaries and validation plan.

Do not invent a second plugin system.`),
      },
      {
        name: 'skill-development',
        description:
          'Create or refine a Mossen skill with narrow trigger text and safe allowed-tools policy.',
        argumentHint: '[skill goal]',
        whenToUse:
          'Use when implementing a SKILL.md, bundled skill, or plugin-provided skill.',
        getPromptForCommand: prompt(`# Mossen Skill Development

Build skills as small workflow capsules.

## Checklist
- Narrow name and description.
- Clear when-to-use trigger.
- Minimal allowed tools.
- No broad auto-execution for mutation.
- References live under the skill directory when needed.
- Tests or smoke coverage when the skill is built into Mossen.

Prefer existing bundled skill and plugin skill loaders over custom dispatch.`),
      },
      {
        name: 'command-development',
        description:
          'Add or review a Mossen slash command while preserving parser, router, smoke, and docs conventions.',
        argumentHint: '[/command goal]',
        whenToUse:
          'Use when adding or modifying a Mossen slash command.',
        getPromptForCommand: prompt(`# Mossen Command Development

Use the existing command registry and local JSX command patterns.

## Checklist
- Parse arguments once at the command boundary.
- Keep router thin.
- Use dry-run + confirm for mutation or deletion.
- Add focused smoke.
- Do not touch query loop unless explicitly approved.
- Do not create fake protocol surfaces.

If the command exposes existing runtime state, prefer read-only helpers.`),
      },
      {
        name: 'hook-development',
        description:
          'Design Mossen hooks with safe event scope, disabled-by-default risk posture, and observable failure behavior.',
        argumentHint: '[hook goal]',
        whenToUse:
          'Use when building or reviewing plugin hooks or hook settings.',
        getPromptForCommand: prompt(`# Mossen Hook Development

Hooks must be explicit and predictable.

## Safety rules
- Keep mutation hooks disabled by default unless the user explicitly enables them.
- Document event names and side effects.
- Bound output and timeout behavior.
- Do not hide failures.
- Do not bypass permissions.

Reuse existing hook settings and plugin loading code.`),
      },
      {
        name: 'mcp-integration',
        description:
          'Design MCP server integration for Mossen plugins without default auto-connect or hidden credentials.',
        argumentHint: '[MCP integration goal]',
        whenToUse:
          'Use when adding MCP servers to a plugin or designing MCP templates.',
        getPromptForCommand: prompt(`# Mossen MCP Integration

Design MCP integration as local-first and least-privilege.

## Checklist
- Read-only and mutation tools separated.
- Credentials are never embedded in templates.
- Network servers require explicit setup.
- Servers are not auto-connected by surprise.
- Tool schemas describe side effects.
- Config uses Mossen's existing MCP runtime and plugin MCP integration.

Prefer templates and user confirmation before enabling servers.`),
      },
      {
        name: 'plugin-settings',
        description:
          'Plan plugin settings, defaults, migrations, and user-visible toggles safely.',
        argumentHint: '[settings goal]',
        whenToUse:
          'Use when adding settings to a Mossen plugin or built-in extension.',
        getPromptForCommand: prompt(`# Mossen Plugin Settings

Settings must be stable, reversible, and user-visible.

## Checklist
- Defaults are safe.
- Sensitive values are not printed.
- Migration path is explicit.
- Settings are scoped: user, project, local, or plugin.
- Validation errors are readable.
- Feature gates do not accidentally enable unrelated systems.`),
      },
      {
        name: 'agent-development',
        description:
          'Design plugin-provided agents with bounded scope, clear prompts, and permission-safe tool access.',
        argumentHint: '[agent goal]',
        whenToUse:
          'Use when creating or reviewing a Mossen plugin-provided agent.',
        getPromptForCommand: prompt(`# Mossen Agent Development

Agents should be small, named responsibilities, not broad replacements for the main assistant.

## Checklist
- Specific job description.
- Clear handoff boundary.
- Minimal tools.
- No hidden mutation.
- Explicit output contract.
- Smoke or fixture coverage for critical behavior.

Prefer plugin-provided agents only when they materially simplify repeated workflows.`),
      },
    ],
  })
}
