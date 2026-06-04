/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useMemo } from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { stringWidth } from '../../../ink/stringWidth.js';
import { Box, Text } from '../../../ink.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { truncateToWidth } from '../../../utils/format.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
type Props = {
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  hideSubmitTab?: boolean;
};
export function QuestionNavigationBar(t0) {
  const $ = _c(39);
  const {
    questions,
    currentQuestionIndex,
    answers,
    hideSubmitTab: t1
  } = t0;
  const hideSubmitTab = t1 === undefined ? false : t1;
  const {
    columns
  } = useTerminalSize();
  const submitLabel = getLocalizedText({
    en: 'Submit',
    zh: '提交'
  });
  const questionPrefix = getLocalizedText({
    en: 'Q',
    zh: '问题'
  });
  let t2;
  if ($[0] !== columns || $[1] !== currentQuestionIndex || $[2] !== hideSubmitTab || $[3] !== questions || $[4] !== questionPrefix || $[5] !== submitLabel) {
    bb0: {
      const submitText = hideSubmitTab ? "" : ` ${figures.tick} ${submitLabel} `;
      const fixedWidth = stringWidth("\u2190 ") + stringWidth(" \u2192") + stringWidth(submitText);
      const availableForTabs = columns - fixedWidth;
      if (availableForTabs <= 0) {
        let t3;
        if ($[6] !== currentQuestionIndex || $[7] !== questionPrefix || $[8] !== questions) {
          let t4;
          if ($[10] !== currentQuestionIndex || $[11] !== questionPrefix) {
            t4 = (q, index) => {
              const header = q?.header || `${questionPrefix}${index + 1}`;
              return index === currentQuestionIndex ? header.slice(0, 3) : "";
            };
            $[10] = currentQuestionIndex;
            $[11] = questionPrefix;
            $[12] = t4;
          } else {
            t4 = $[12];
          }
          t3 = questions.map(t4);
          $[6] = currentQuestionIndex;
          $[7] = questionPrefix;
          $[8] = questions;
          $[9] = t3;
        } else {
          t3 = $[9];
        }
        t2 = t3;
        break bb0;
      }
      const tabHeaders = questions.map(_temp);
      const idealWidths = tabHeaders.map(_temp2);
      const totalIdealWidth = idealWidths.reduce(_temp3, 0);
      if (totalIdealWidth <= availableForTabs) {
        t2 = tabHeaders;
        break bb0;
      }
      const currentHeader = tabHeaders[currentQuestionIndex] || "";
      const currentIdealWidth = 4 + stringWidth(currentHeader);
      const currentTabWidth = Math.min(currentIdealWidth, availableForTabs / 2);
      const remainingWidth = availableForTabs - currentTabWidth;
      const otherTabCount = questions.length - 1;
      const widthPerOtherTab = Math.max(6, Math.floor(remainingWidth / Math.max(otherTabCount, 1)));
      let t3;
      if ($[13] !== currentQuestionIndex || $[14] !== currentTabWidth || $[15] !== widthPerOtherTab) {
        t3 = (header_1, index_1) => {
          if (index_1 === currentQuestionIndex) {
            const maxTextWidth = currentTabWidth - 2 - 2;
            return truncateToWidth(header_1, maxTextWidth);
          } else {
            const maxTextWidth_0 = widthPerOtherTab - 2 - 2;
            return truncateToWidth(header_1, maxTextWidth_0);
          }
        };
        $[13] = currentQuestionIndex;
        $[14] = currentTabWidth;
        $[15] = widthPerOtherTab;
        $[16] = t3;
      } else {
        t3 = $[16];
      }
      t2 = tabHeaders.map(t3);
    }
    $[0] = columns;
    $[1] = currentQuestionIndex;
    $[2] = hideSubmitTab;
    $[3] = questions;
    $[4] = questionPrefix;
    $[5] = submitLabel;
    $[17] = t2;
  } else {
    t2 = $[17];
  }
  const tabDisplayTexts = t2;
  const hideArrows = questions.length === 1 && hideSubmitTab;
  let t3;
  if ($[18] !== currentQuestionIndex || $[19] !== hideArrows) {
    t3 = !hideArrows && <Text color={currentQuestionIndex === 0 ? "inactive" : undefined}>←{" "}</Text>;
    $[18] = currentQuestionIndex;
    $[19] = hideArrows;
    $[20] = t3;
  } else {
    t3 = $[20];
  }
  let t4;
  if ($[21] !== answers || $[22] !== currentQuestionIndex || $[23] !== questionPrefix || $[24] !== questions || $[25] !== tabDisplayTexts) {
    let t5;
    if ($[26] !== answers || $[27] !== currentQuestionIndex || $[28] !== questionPrefix || $[29] !== tabDisplayTexts) {
      t5 = (q_1, index_2) => {
        const isSelected = index_2 === currentQuestionIndex;
        const isAnswered = q_1?.question && !!answers[q_1.question];
        const checkbox = isAnswered ? figures.checkboxOn : figures.checkboxOff;
        const displayText = tabDisplayTexts[index_2] || q_1?.header || `${questionPrefix}${index_2 + 1}`;
        return <Box key={q_1?.question || `question-${index_2}`}>{isSelected ? <Text backgroundColor="permission" color="inverseText">{" "}{checkbox} {displayText}{" "}</Text> : <Text>{" "}{checkbox} {displayText}{" "}</Text>}</Box>;
      };
      $[26] = answers;
      $[27] = currentQuestionIndex;
      $[28] = questionPrefix;
      $[29] = tabDisplayTexts;
      $[30] = t5;
    } else {
      t5 = $[30];
    }
    t4 = questions.map(t5);
    $[21] = answers;
    $[22] = currentQuestionIndex;
    $[23] = questionPrefix;
    $[24] = questions;
    $[25] = tabDisplayTexts;
    $[31] = t4;
  } else {
    t4 = $[31];
  }
  let t5;
  if ($[32] !== currentQuestionIndex || $[33] !== hideSubmitTab || $[34] !== questions.length || $[35] !== submitLabel) {
    t5 = !hideSubmitTab && <Box key="submit">{currentQuestionIndex === questions.length ? <Text backgroundColor="permission" color="inverseText">{" "}{figures.tick} {submitLabel}{" "}</Text> : <Text> {figures.tick} {submitLabel} </Text>}</Box>;
    $[32] = currentQuestionIndex;
    $[33] = hideSubmitTab;
    $[34] = questions.length;
    $[35] = submitLabel;
    $[36] = t5;
  } else {
    t5 = $[36];
  }
  let t6;
  if ($[37] !== currentQuestionIndex || $[38] !== hideArrows || $[39] !== questions.length) {
    t6 = !hideArrows && <Text color={currentQuestionIndex === questions.length ? "inactive" : undefined}>{" "}→</Text>;
    $[37] = currentQuestionIndex;
    $[38] = hideArrows;
    $[39] = questions.length;
    $[40] = t6;
  } else {
    t6 = $[40];
  }
  let t7;
  if ($[41] !== t3 || $[42] !== t4 || $[43] !== t5 || $[44] !== t6) {
    t7 = <Box flexDirection="row" marginBottom={1}>{t3}{t4}{t5}{t6}</Box>;
    $[41] = t3;
    $[42] = t4;
    $[43] = t5;
    $[44] = t6;
    $[45] = t7;
  } else {
    t7 = $[45];
  }
  return t7;
}
function _temp3(sum, w) {
  return sum + w;
}
function _temp2(header_0) {
  return 4 + stringWidth(header_0);
}
function _temp(q_0, index_0) {
  return q_0?.header || `${getLocalizedText({
    en: 'Q',
    zh: '问题'
  })}${index_0 + 1}`;
}
