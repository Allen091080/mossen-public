import figures from 'figures';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useDebounceCallback } from 'usehooks-ts';
import {
  addDirHelpMessage,
  validateDirectoryForWorkspace,
} from '../../../commands/add-dir/validation.js';
import TextInput from '../../../components/TextInput.js';
import { getProductAssistantName } from '../../../constants/product.js';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import { getDirectoryCompletions } from '../../../utils/suggestions/directoryCompletion.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
import { ConfigurableShortcutHint } from '../../ConfigurableShortcutHint.js';
import { Select } from '../../CustomSelect/select.js';
import { Byline } from '../../design-system/Byline.js';
import { Dialog } from '../../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../../design-system/KeyboardShortcutHint.js';
import {
  PromptInputFooterSuggestions,
  type SuggestionItem,
} from '../../PromptInput/PromptInputFooterSuggestions.js';

type Props = {
  onAddDirectory: (path: string, remember?: boolean) => void;
  onCancel: () => void;
  permissionContext: ToolPermissionContext;
  directoryPath?: string;
};

type RememberDirectoryOption = 'yes-session' | 'yes-remember' | 'no';

function PermissionDescription() {
  return (
    <Text dimColor>
      {getLocalizedText({
        en: `${getProductAssistantName()} will be able to read files in this directory and make edits when auto-accept edits is on.`,
        zh: `${getProductAssistantName()} 将能够读取此目录中的文件，并在自动接受编辑开启时进行修改。`,
      })}
    </Text>
  );
}

function DirectoryDisplay({ path }: { path: string }) {
  return (
    <Box flexDirection="column" paddingX={2} gap={1}>
      <Text color="permission">{path}</Text>
      <PermissionDescription />
    </Box>
  );
}

function DirectoryInput({
  value,
  onChange,
  onSubmit,
  error,
  suggestions,
  selectedSuggestion,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  error: string | null;
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
}) {
  return (
    <Box flexDirection="column">
      <Text>
        {getLocalizedText({
          en: 'Enter the path to the directory:',
          zh: '输入目录路径：',
        })}
      </Text>
      <Box borderDimColor borderStyle="round" marginY={1} paddingLeft={1}>
        <TextInput
          showCursor
          placeholder={`${getLocalizedText({
            en: 'Directory path',
            zh: '目录路径',
          })}${figures.ellipsis}`}
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          columns={80}
          cursorOffset={value.length}
          onChangeCursorOffset={noop}
        />
      </Box>
      {suggestions.length > 0 && (
        <Box marginBottom={1}>
          <PromptInputFooterSuggestions
            suggestions={suggestions}
            selectedSuggestion={selectedSuggestion}
          />
        </Box>
      )}
      {error && <Text color="error">{error}</Text>}
    </Box>
  );
}

function noop() {}

export function AddWorkspaceDirectory({
  onAddDirectory,
  onCancel,
  permissionContext,
  directoryPath,
}: Props) {
  const [directoryInput, setDirectoryInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  const rememberDirectoryOptions: Array<{
    value: RememberDirectoryOption;
    label: string;
  }> = [
    {
      value: 'yes-session',
      label: getLocalizedText({
        en: 'Yes, for this session',
        zh: '是，本次会话有效',
      }),
    },
    {
      value: 'yes-remember',
      label: getLocalizedText({
        en: 'Yes, and remember this directory',
        zh: '是，并记住此目录',
      }),
    },
    {
      value: 'no',
      label: getLocalizedText({
        en: 'No',
        zh: '否',
      }),
    },
  ];

  const fetchSuggestions = async (path: string) => {
    if (!path) {
      setSuggestions([]);
      setSelectedSuggestion(0);
      return;
    }
    const completions = await getDirectoryCompletions(path);
    setSuggestions(completions);
    setSelectedSuggestion(0);
  };

  const debouncedFetchSuggestions = useDebounceCallback(fetchSuggestions, 100);

  useEffect(() => {
    debouncedFetchSuggestions(directoryInput);
  }, [debouncedFetchSuggestions, directoryInput]);

  const applySuggestion = (suggestion: SuggestionItem) => {
    const newPath = `${suggestion.id}/`;
    setDirectoryInput(newPath);
    setError(null);
  };

  const handleSubmit = async (newPath: string) => {
    const result = await validateDirectoryForWorkspace(
      newPath,
      permissionContext,
    );
    if (result.resultType === 'success') {
      onAddDirectory(result.absolutePath, false);
    } else {
      setError(addDirHelpMessage(result));
    }
  };

  useKeybinding('confirm:no', onCancel, { context: 'Settings' });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (suggestions.length === 0) {
      return;
    }

    if (event.key === 'tab') {
      event.preventDefault();
      const suggestion = suggestions[selectedSuggestion];
      if (suggestion) {
        applySuggestion(suggestion);
      }
      return;
    }

    if (event.key === 'return') {
      event.preventDefault();
      const suggestion = suggestions[selectedSuggestion];
      if (suggestion) {
        void handleSubmit(`${suggestion.id}/`);
      }
      return;
    }

    if (event.key === 'up' || (event.ctrl && event.key === 'p')) {
      event.preventDefault();
      setSelectedSuggestion(prev =>
        prev <= 0 ? suggestions.length - 1 : prev - 1,
      );
      return;
    }

    if (event.key === 'down' || (event.ctrl && event.key === 'n')) {
      event.preventDefault();
      setSelectedSuggestion(prev =>
        prev >= suggestions.length - 1 ? 0 : prev + 1,
      );
    }
  };

  const handleSelect = (value: string) => {
    if (!directoryPath) {
      return;
    }
    const selectionValue = value as RememberDirectoryOption;
    switch (selectionValue) {
      case 'yes-session':
        onAddDirectory(directoryPath, false);
        break;
      case 'yes-remember':
        onAddDirectory(directoryPath, true);
        break;
      case 'no':
        onCancel();
        break;
    }
  };

  const inputGuide = directoryPath
    ? undefined
    : (exitState: { pending: boolean; keyName: string }) =>
        exitState.pending ? (
          <Text>
            {getLocalizedText({
              en: `Press ${exitState.keyName} again to exit`,
              zh: `再按一次 ${exitState.keyName} 退出`,
            })}
          </Text>
        ) : (
          <Byline>
            <KeyboardShortcutHint
              shortcut="Tab"
              action={getLocalizedText({
                en: 'complete',
                zh: '补全',
              })}
            />
            <KeyboardShortcutHint
              shortcut="Enter"
              action={getLocalizedText({
                en: 'add',
                zh: '添加',
              })}
            />
            <ConfigurableShortcutHint
              action="confirm:no"
              context="Settings"
              fallback="Esc"
              description={getLocalizedText({
                en: 'cancel',
                zh: '取消',
              })}
            />
          </Byline>
        );

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title={getLocalizedText({
          en: 'Add directory to workspace',
          zh: '将目录添加到工作区',
        })}
        onCancel={onCancel}
        color="permission"
        isCancelActive={false}
        inputGuide={inputGuide}
      >
        {directoryPath ? (
          <Box flexDirection="column" gap={1}>
            <DirectoryDisplay path={directoryPath} />
            <Select
              options={rememberDirectoryOptions}
              onChange={handleSelect}
              onCancel={() => handleSelect('no')}
            />
          </Box>
        ) : (
          <Box flexDirection="column" gap={1} marginX={2}>
            <PermissionDescription />
            <DirectoryInput
              value={directoryInput}
              onChange={setDirectoryInput}
              onSubmit={value => {
                void handleSubmit(value);
              }}
              error={error}
              suggestions={suggestions}
              selectedSuggestion={selectedSuggestion}
            />
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
