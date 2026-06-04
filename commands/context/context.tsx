import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ContextVisualization } from '../../components/ContextVisualization.js';
import {
  collectContextData,
  getContextObservabilityItems,
} from './context-noninteractive.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { renderToAnsiString } from '../../utils/staticRender.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  const data = await collectContextData(context);

  // Render to ANSI string to preserve colors and pass to onDone like local commands do
  const output = await renderToAnsiString(<ContextVisualization data={data} />);
  const observabilityOutput = getContextObservabilityItems(data).map(item => `${item.label}: ${item.value}`).join('\n');
  onDone(observabilityOutput ? `${output}\n${observabilityOutput}` : output);
  return null;
}
