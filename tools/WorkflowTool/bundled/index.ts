export type BundledWorkflowDefinition = {
  name: string
  description: string
  source: string
}

const PROJECT_SCAN_SOURCE = `export const meta = {
  name: 'project-scan',
  description: 'Map a project, identify important files, and surface implementation risks before editing.',
  whenToUse: 'Use when you need a fast repository orientation or a second-pass risk scan before implementation.',
  phases: [
    { title: 'Map structure', detail: 'Identify major directories, entrypoints, and ownership boundaries.' },
    { title: 'Find risks', detail: 'Look for risky dependencies, missing tests, and likely integration points.' },
  ],
}

phase('Map structure')
const map = await agent(
  'Inspect the current project structure. Summarize key directories, entrypoints, test surfaces, and conventions that matter before implementation.',
  { label: 'Map project structure' },
)

phase('Find risks')
const risks = await agent(
  'Review the mapped project for implementation risks: shared contracts, test gaps, build or packaging constraints, and areas that need careful validation.',
  { label: 'Find implementation risks' },
)

return { map, risks }
`

export function loadBundledWorkflows(): BundledWorkflowDefinition[] {
  return [
    {
      name: 'project-scan',
      description:
        'Map a project, identify important files, and surface implementation risks before editing.',
      source: PROJECT_SCAN_SOURCE,
    },
  ]
}

export function initBundledWorkflows(): void {
  // Bundled workflows are registered lazily through loadBundledWorkflows().
}
