/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import figures from 'figures';
import React, { useCallback, useState } from 'react';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question, QuestionOption } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { PastedContent } from '../../../utils/config.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import type { ImageDimensions } from '../../../utils/imageResizer.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
import { type OptionWithDescription, Select, SelectMulti } from '../../CustomSelect/index.js';
import { Divider } from '../../design-system/Divider.js';
import { FilePathLink } from '../../FilePathLink.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PreviewQuestionView } from './PreviewQuestionView.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import type { QuestionState } from './use-multiple-choice-state.js';
type Props = {
  question: Question;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  planFilePath?: string;
  pastedContents?: Record<number, PastedContent>;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToMossen: () => void;
  onFinishPlanInterview: () => void;
  onImagePaste?: (base64Image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, sourcePath?: string) => void;
  onRemoveImage?: (id: number) => void;
};
export function QuestionView(t0) {
  const $ = _c(114);
  const {
    question,
    questions,
    currentQuestionIndex,
    answers,
    questionStates,
    hideSubmitTab: t1,
    planFilePath,
    minContentHeight,
    minContentWidth,
    onUpdateQuestionState,
    onAnswer,
    onTextInputFocus,
    onCancel,
    onSubmit,
    onTabPrev,
    onTabNext,
    onRespondToMossen,
    onFinishPlanInterview,
    onImagePaste,
    pastedContents,
    onRemoveImage
  } = t0;
  const hideSubmitTab = t1 === undefined ? false : t1;
  const isInPlanMode = useAppState(_temp) === "plan";
  const otherLabel = getLocalizedText({
    en: 'Other',
    zh: '其他'
  });
  const multiSelectPlaceholder = getLocalizedText({
    en: 'Type something',
    zh: '请输入内容'
  });
  const singleSelectPlaceholder = getLocalizedText({
    en: 'Type something.',
    zh: '请输入内容。'
  });
  const submitLabel = getLocalizedText({
    en: 'Submit',
    zh: '提交'
  });
  const nextLabel = getLocalizedText({
    en: 'Next',
    zh: '下一步'
  });
  const planningLabel = getLocalizedText({
    en: 'Planning:',
    zh: '规划文件：'
  });
  const chatAboutThisLabel = getLocalizedText({
    en: 'Chat about this',
    zh: '聊聊这个'
  });
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [footerIndex, setFooterIndex] = useState(0);
  const [isOtherFocused, setIsOtherFocused] = useState(false);
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    const editor = getExternalEditor();
    t2 = editor ? toIDEDisplayName(editor) : null;
    $[0] = t2;
  } else {
    t2 = $[0];
  }
  const editorName = t2;
  let t3;
  if ($[1] !== onTextInputFocus) {
    t3 = value => {
      const isOther = value === "__other__";
      setIsOtherFocused(isOther);
      onTextInputFocus(isOther);
    };
    $[1] = onTextInputFocus;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  const handleFocus = t3;
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = () => {
      setIsFooterFocused(true);
    };
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const handleDownFromLastItem = t4;
  let t5;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = () => {
      setIsFooterFocused(false);
    };
    $[4] = t5;
  } else {
    t5 = $[4];
  }
  const handleUpFromFooter = t5;
  let t6;
  if ($[5] !== footerIndex || $[6] !== isFooterFocused || $[7] !== isInPlanMode || $[8] !== onCancel || $[9] !== onFinishPlanInterview || $[10] !== onRespondToMossen) {
    t6 = e => {
      if (!isFooterFocused) {
        return;
      }
      if (e.key === "up" || e.ctrl && e.key === "p") {
        e.preventDefault();
        if (footerIndex === 0) {
          handleUpFromFooter();
        } else {
          setFooterIndex(0);
        }
        return;
      }
      if (e.key === "down" || e.ctrl && e.key === "n") {
        e.preventDefault();
        if (isInPlanMode && footerIndex === 0) {
          setFooterIndex(1);
        }
        return;
      }
      if (e.key === "return") {
        e.preventDefault();
        if (footerIndex === 0) {
          onRespondToMossen();
        } else {
          onFinishPlanInterview();
        }
        return;
      }
      if (e.key === "escape") {
        e.preventDefault();
        onCancel();
      }
    };
    $[5] = footerIndex;
    $[6] = isFooterFocused;
    $[7] = isInPlanMode;
    $[8] = onCancel;
    $[9] = onFinishPlanInterview;
    $[10] = onRespondToMossen;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  const handleKeyDown = t6;
  let handleOpenEditor;
  let questionText;
  let t7;
  if ($[12] !== onUpdateQuestionState || $[13] !== question || $[14] !== questionStates) {
    const textOptions = question.options.map(_temp2);
    questionText = question.question;
    const questionState = questionStates[questionText];
    let t8;
    if ($[18] !== onUpdateQuestionState || $[19] !== question.multiSelect || $[20] !== questionText) {
      t8 = async (currentValue, setValue) => {
        const result = await editPromptInEditor(currentValue);
        if (result.content !== null && result.content !== currentValue) {
          setValue(result.content);
          onUpdateQuestionState(questionText, {
            textInputValue: result.content
          }, question.multiSelect ?? false);
        }
      };
      $[18] = onUpdateQuestionState;
      $[19] = question.multiSelect;
      $[20] = questionText;
      $[21] = t8;
    } else {
      t8 = $[21];
    }
    handleOpenEditor = t8;
    const t9 = question.multiSelect ? multiSelectPlaceholder : singleSelectPlaceholder;
    const t10 = questionState?.textInputValue ?? "";
    let t11;
    if ($[22] !== onUpdateQuestionState || $[23] !== question.multiSelect || $[24] !== questionText) {
      t11 = value_0 => {
        onUpdateQuestionState(questionText, {
          textInputValue: value_0
        }, question.multiSelect ?? false);
      };
      $[22] = onUpdateQuestionState;
      $[23] = question.multiSelect;
      $[24] = questionText;
      $[25] = t11;
    } else {
      t11 = $[25];
    }
    let t12;
    if ($[26] !== t10 || $[27] !== t11 || $[28] !== t9) {
      t12 = {
        type: "input" as const,
        value: "__other__",
        label: otherLabel,
        placeholder: t9,
        initialValue: t10,
        onChange: t11
      };
      $[26] = t10;
      $[27] = t11;
      $[28] = t9;
      $[29] = t12;
    } else {
      t12 = $[29];
    }
    const otherOption = t12;
    t7 = [...textOptions, otherOption];
    $[12] = onUpdateQuestionState;
    $[13] = question;
    $[14] = questionStates;
    $[15] = handleOpenEditor;
    $[16] = questionText;
    $[17] = t7;
  } else {
    handleOpenEditor = $[15];
    questionText = $[16];
    t7 = $[17];
  }
  const options = t7;
  const hasAnyPreview = !question.multiSelect && question.options.some(_temp3);
  if (hasAnyPreview) {
    let t8;
    if ($[30] !== answers || $[31] !== currentQuestionIndex || $[32] !== hideSubmitTab || $[33] !== minContentHeight || $[34] !== minContentWidth || $[35] !== onAnswer || $[36] !== onCancel || $[37] !== onFinishPlanInterview || $[38] !== onRespondToMossen || $[39] !== onTabNext || $[40] !== onTabPrev || $[41] !== onTextInputFocus || $[42] !== onUpdateQuestionState || $[43] !== question || $[44] !== questionStates || $[45] !== questions) {
      t8 = <PreviewQuestionView question={question} questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} questionStates={questionStates} hideSubmitTab={hideSubmitTab} minContentHeight={minContentHeight} minContentWidth={minContentWidth} onUpdateQuestionState={onUpdateQuestionState} onAnswer={onAnswer} onTextInputFocus={onTextInputFocus} onCancel={onCancel} onTabPrev={onTabPrev} onTabNext={onTabNext} onRespondToMossen={onRespondToMossen} onFinishPlanInterview={onFinishPlanInterview} />;
      $[30] = answers;
      $[31] = currentQuestionIndex;
      $[32] = hideSubmitTab;
      $[33] = minContentHeight;
      $[34] = minContentWidth;
      $[35] = onAnswer;
      $[36] = onCancel;
      $[37] = onFinishPlanInterview;
      $[38] = onRespondToMossen;
      $[39] = onTabNext;
      $[40] = onTabPrev;
      $[41] = onTextInputFocus;
      $[42] = onUpdateQuestionState;
      $[43] = question;
      $[44] = questionStates;
      $[45] = questions;
      $[46] = t8;
    } else {
      t8 = $[46];
    }
    return t8;
  }
  let t8;
  if ($[47] !== isInPlanMode || $[48] !== planFilePath || $[49] !== planningLabel) {
    t8 = isInPlanMode && planFilePath && <Box flexDirection="column" gap={0}><Divider color="inactive" /><Text color="inactive">{planningLabel} <FilePathLink filePath={planFilePath} /></Text></Box>;
    $[47] = isInPlanMode;
    $[48] = planFilePath;
    $[49] = planningLabel;
    $[50] = t8;
  } else {
    t8 = $[50];
  }
  let t9;
  if ($[51] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = <Box marginTop={-1}><Divider color="inactive" /></Box>;
    $[51] = t9;
  } else {
    t9 = $[51];
  }
  let t10;
  if ($[52] !== answers || $[53] !== currentQuestionIndex || $[54] !== hideSubmitTab || $[55] !== questions) {
    t10 = <QuestionNavigationBar questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} hideSubmitTab={hideSubmitTab} />;
    $[52] = answers;
    $[53] = currentQuestionIndex;
    $[54] = hideSubmitTab;
    $[55] = questions;
    $[56] = t10;
  } else {
    t10 = $[56];
  }
  let t11;
  if ($[57] !== question.question) {
    t11 = <PermissionRequestTitle title={question.question} color="text" />;
    $[57] = question.question;
    $[58] = t11;
  } else {
    t11 = $[58];
  }
  let t12;
  if ($[59] !== currentQuestionIndex || $[60] !== handleFocus || $[61] !== handleOpenEditor || $[62] !== isFooterFocused || $[63] !== nextLabel || $[64] !== onAnswer || $[65] !== onCancel || $[66] !== onImagePaste || $[67] !== onRemoveImage || $[68] !== onSubmit || $[69] !== onUpdateQuestionState || $[70] !== options || $[71] !== pastedContents || $[72] !== question.multiSelect || $[73] !== question.question || $[74] !== questionStates || $[75] !== questionText || $[76] !== questions.length || $[77] !== submitLabel) {
    t12 = <Box marginTop={1}>{question.multiSelect ? <SelectMulti key={question.question} options={options} defaultValue={questionStates[question.question]?.selectedValue as string[] | undefined} onChange={values => {
        onUpdateQuestionState(questionText, {
          selectedValue: values
        }, true);
        const textInput = values.includes("__other__") ? questionStates[questionText]?.textInputValue : undefined;
        const finalValues = values.filter(_temp4).concat(textInput ? [textInput] : []);
        onAnswer(questionText, finalValues, undefined, false);
      }} onFocus={handleFocus} onCancel={onCancel} submitButtonText={currentQuestionIndex === questions.length - 1 ? submitLabel : nextLabel} onSubmit={onSubmit} onDownFromLastItem={handleDownFromLastItem} isDisabled={isFooterFocused} onOpenEditor={handleOpenEditor} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} /> : <Select key={question.question} options={options} defaultValue={questionStates[question.question]?.selectedValue as string | undefined} onChange={value_1 => {
        onUpdateQuestionState(questionText, {
          selectedValue: value_1
        }, false);
        const textInput_0 = value_1 === "__other__" ? questionStates[questionText]?.textInputValue : undefined;
        onAnswer(questionText, value_1, textInput_0);
      }} onFocus={handleFocus} onCancel={onCancel} onDownFromLastItem={handleDownFromLastItem} isDisabled={isFooterFocused} layout="compact-vertical" onOpenEditor={handleOpenEditor} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} />}</Box>;
    $[59] = currentQuestionIndex;
    $[60] = handleFocus;
    $[61] = handleOpenEditor;
    $[62] = isFooterFocused;
    $[63] = nextLabel;
    $[64] = onAnswer;
    $[65] = onCancel;
    $[66] = onImagePaste;
    $[67] = onRemoveImage;
    $[68] = onSubmit;
    $[69] = onUpdateQuestionState;
    $[70] = options;
    $[71] = pastedContents;
    $[72] = question.multiSelect;
    $[73] = question.question;
    $[74] = questionStates;
    $[75] = questionText;
    $[76] = questions.length;
    $[77] = submitLabel;
    $[78] = t12;
  } else {
    t12 = $[78];
  }
  let t13;
  if ($[79] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Divider color="inactive" />;
    $[79] = t13;
  } else {
    t13 = $[79];
  }
  let t14;
  if ($[80] !== footerIndex || $[81] !== isFooterFocused) {
    t14 = isFooterFocused && footerIndex === 0 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>;
    $[80] = footerIndex;
    $[81] = isFooterFocused;
    $[82] = t14;
  } else {
    t14 = $[82];
  }
  const t15 = isFooterFocused && footerIndex === 0 ? "suggestion" : undefined;
  const t16 = options.length + 1;
  let t17;
  if ($[83] !== chatAboutThisLabel || $[84] !== t15 || $[85] !== t16) {
    t17 = <Text color={t15}>{t16}. {chatAboutThisLabel}</Text>;
    $[83] = chatAboutThisLabel;
    $[84] = t15;
    $[85] = t16;
    $[86] = t17;
  } else {
    t17 = $[86];
  }
  let t18;
  if ($[87] !== t14 || $[88] !== t17) {
    t18 = <Box flexDirection="row" gap={1}>{t14}{t17}</Box>;
    $[87] = t14;
    $[88] = t17;
    $[89] = t18;
  } else {
    t18 = $[89];
  }
  let t19;
  if ($[90] !== footerIndex || $[91] !== isFooterFocused || $[92] !== isInPlanMode || $[93] !== options.length) {
    t19 = isInPlanMode && <Box flexDirection="row" gap={1}>{isFooterFocused && footerIndex === 1 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}<Text color={isFooterFocused && footerIndex === 1 ? "suggestion" : undefined}>{options.length + 2}. {getLocalizedText({
      en: 'Skip interview and plan immediately',
      zh: '跳过访谈并立即开始规划'
    })}</Text></Box>;
    $[90] = footerIndex;
    $[91] = isFooterFocused;
    $[92] = isInPlanMode;
    $[93] = options.length;
    $[94] = t19;
  } else {
    t19 = $[94];
  }
  let t20;
  if ($[95] !== t18 || $[96] !== t19) {
    t20 = <Box flexDirection="column">{t13}{t18}{t19}</Box>;
    $[95] = t18;
    $[96] = t19;
    $[97] = t20;
  } else {
    t20 = $[97];
  }
  let t21;
  if ($[98] !== questions.length) {
    t21 = questions.length === 1 ? <>{figures.arrowUp}/{figures.arrowDown} {getLocalizedText({
      en: 'to navigate',
      zh: '进行导航'
    })}</> : getLocalizedText({
      en: 'Tab/Arrow keys to navigate',
      zh: '按 Tab/方向键导航'
    });
    $[98] = questions.length;
    $[99] = t21;
  } else {
    t21 = $[99];
  }
  let t22;
  if ($[100] !== isOtherFocused) {
    t22 = isOtherFocused && editorName && <> · {getLocalizedText({
      en: `ctrl+x ctrl+e to edit in ${editorName}`,
      zh: `按 ctrl+x ctrl+e 在 ${editorName} 中编辑`
    })}</>;
    $[100] = isOtherFocused;
    $[101] = t22;
  } else {
    t22 = $[101];
  }
  let t23;
  if ($[102] !== t21 || $[103] !== t22) {
    t23 = <Box marginTop={1}><Text color="inactive" dimColor={true}>{getLocalizedText({
      en: 'Enter to select',
      zh: '按 Enter 选择'
    })} ·{" "}{t21}{t22}{" "}· {getLocalizedText({
      en: 'Esc to cancel',
      zh: '按 Esc 取消'
    })}</Text></Box>;
    $[102] = t21;
    $[103] = t22;
    $[104] = t23;
  } else {
    t23 = $[104];
  }
  let t24;
  if ($[105] !== minContentHeight || $[106] !== t12 || $[107] !== t20 || $[108] !== t23) {
    t24 = <Box flexDirection="column" minHeight={minContentHeight}>{t12}{t20}{t23}</Box>;
    $[105] = minContentHeight;
    $[106] = t12;
    $[107] = t20;
    $[108] = t23;
    $[109] = t24;
  } else {
    t24 = $[109];
  }
  let t25;
  if ($[110] !== t10 || $[111] !== t11 || $[112] !== t24) {
    t25 = <Box flexDirection="column" paddingTop={0}>{t10}{t11}{t24}</Box>;
    $[110] = t10;
    $[111] = t11;
    $[112] = t24;
    $[113] = t25;
  } else {
    t25 = $[113];
  }
  let t26;
  if ($[114] !== handleKeyDown || $[115] !== t25 || $[116] !== t8) {
    t26 = <Box flexDirection="column" marginTop={0} tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t8}{t9}{t25}</Box>;
    $[114] = handleKeyDown;
    $[115] = t25;
    $[116] = t8;
    $[117] = t26;
  } else {
    t26 = $[117];
  }
  return t26;
}
function _temp4(v) {
  return v !== "__other__";
}
function _temp3(opt_0) {
  return opt_0.preview;
}
function _temp2(opt) {
  return {
    type: "text" as const,
    value: opt.label,
    label: opt.label,
    description: opt.description
  };
}
function _temp(s) {
  return s.toolPermissionContext.mode;
}
