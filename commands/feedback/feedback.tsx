import * as React from 'react';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Feedback } from '../../components/Feedback.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { hasConfiguredFeedbackUrls } from '../../utils/customBackend.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';

// Shared function to render the Feedback component
export function renderFeedbackComponent(onDone: (result?: string, options?: {
  display?: CommandResultDisplay;
}) => void, abortSignal: AbortSignal, messages: Message[], initialDescription: string = '', backgroundTasks: {
  [taskId: string]: {
    type: string;
    identity?: {
      agentId: string;
    };
    messages?: Message[];
  };
} = {}): React.ReactNode {
  return <Feedback abortSignal={abortSignal} messages={messages} initialDescription={initialDescription} onDone={onDone} backgroundTasks={backgroundTasks} />;
}
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext, args?: string): Promise<React.ReactNode> {
  if (!hasConfiguredFeedbackUrls()) {
    onDone(getLocalizedText({
      en: 'Feedback is not configured for this personal build. Set MOSSEN_CODE_PLATFORM_FEEDBACK_URL or MOSSEN_CODE_PLATFORM_ISSUES_URL to enable it.',
      zh: '此个人版未配置反馈端点。设置 MOSSEN_CODE_PLATFORM_FEEDBACK_URL 或 MOSSEN_CODE_PLATFORM_ISSUES_URL 后即可启用。',
    }), {
      display: 'system'
    });
    return null;
  }

  const initialDescription = args || '';
  return renderFeedbackComponent(onDone, context.abortController.signal, context.messages, initialDescription);
}
