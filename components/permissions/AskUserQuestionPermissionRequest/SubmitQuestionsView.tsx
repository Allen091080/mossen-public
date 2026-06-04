import figures from 'figures';
import React from 'react';
import { Box, Text } from '../../../ink.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js';
import { Select } from '../../CustomSelect/index.js';
import { Divider } from '../../design-system/Divider.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';

type Props = {
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  allQuestionsAnswered: boolean;
  permissionResult: PermissionDecision;
  minContentHeight?: number;
  onFinalResponse: (value: 'submit' | 'cancel') => void;
};

export function SubmitQuestionsView({
  questions,
  currentQuestionIndex,
  answers,
  allQuestionsAnswered,
  permissionResult,
  minContentHeight,
  onFinalResponse,
}: Props) {
  const reviewTitle = getLocalizedText({
    en: 'Review your answers',
    zh: '检查你的回答',
  });
  const unansweredWarning = getLocalizedText({
    en: 'You have not answered all questions',
    zh: '你还没有回答所有问题',
  });
  const fallbackQuestionLabel = getLocalizedText({
    en: 'Question',
    zh: '问题',
  });
  const readyToSubmit = getLocalizedText({
    en: 'Ready to submit your answers?',
    zh: '准备提交你的回答吗？',
  });
  const submitAnswers = getLocalizedText({
    en: 'Submit answers',
    zh: '提交回答',
  });
  const cancelLabel = getLocalizedText({
    en: 'Cancel',
    zh: '取消',
  });

  const answeredQuestions = questions.filter(
    question => question?.question && answers[question.question],
  );

  return (
    <Box flexDirection="column" minHeight={minContentHeight}>
      <Divider color="inactive" />
      <QuestionNavigationBar
        questions={questions}
        currentQuestionIndex={currentQuestionIndex}
        answers={answers}
      />

      <PermissionRequestTitle title={reviewTitle} color="text" />

      {!allQuestionsAnswered && (
        <Box marginBottom={1}>
          <Text color="warning">
            {figures.warning} {unansweredWarning}
          </Text>
        </Box>
      )}

      {answeredQuestions.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {answeredQuestions.map(question => {
            const answer = answers[question.question];
            return (
              <Box
                key={question.question || 'answer'}
                flexDirection="column"
                marginLeft={1}
              >
                <Text>
                  {figures.bullet} {question.question || fallbackQuestionLabel}
                </Text>
                <Box marginLeft={2}>
                  <Text color="success">
                    {figures.arrowRight} {answer}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <PermissionRuleExplanation
        permissionResult={permissionResult}
        toolType="tool"
      />

      <Text>{readyToSubmit}</Text>

      <Select
        options={[
          {
            value: 'submit',
            label: submitAnswers,
          },
          {
            value: 'cancel',
            label: cancelLabel,
          },
        ]}
        onChange={value => onFinalResponse(value as 'submit' | 'cancel')}
        onCancel={() => onFinalResponse('cancel')}
      />
    </Box>
  );
}
