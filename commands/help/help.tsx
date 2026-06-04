import * as React from 'react';
import { HelpV2 } from '../../components/HelpV2/HelpV2.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { LocalDocsDialog } from '../docs/docs.js';
export const call: LocalJSXCommandCall = async (onDone, {
  options: {
    commands
  }
}, args) => {
  const topic = args?.trim();
  if (topic) {
    return <LocalDocsDialog topicQuery={topic} onDone={onDone} />;
  }
  return <HelpV2 commands={commands} onClose={onDone} />;
};
