/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import chalk from 'chalk';
import * as React from 'react';
import type { SettingSource } from 'src/utils/settings/constants.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useMergedTools } from '../../hooks/useMergedTools.js';
import { Box, Text } from '../../ink.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { Tools } from '../../Tool.js';
import type { TaskState } from '../../tasks/types.js';
import {
  type ResolvedAgent,
  resolveAgentOverrides,
} from '../../tools/AgentTool/agentDisplay.js';
import {
  type AgentDefinition,
  getActiveAgentsFromList,
} from '../../tools/AgentTool/loadAgentsDir.js';
import { toError } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
import { AgentDetail } from './AgentDetail.js';
import { AgentEditor } from './AgentEditor.js';
import { AgentNavigationFooter } from './AgentNavigationFooter.js';
import { AgentsList, AgentsTabs } from './AgentsList.js';
import { deleteAgentFromFile } from './agentFileUtils.js';
import { CreateAgentWizard } from './new-agent-creation/CreateAgentWizard.js';
import type { ModeState } from './types.js';

type Props = {
  tools: Tools;
  onExit: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  initialTab?: 'running' | 'library';
};

type AgentSource = SettingSource | 'all' | 'built-in' | 'plugin';

function isRunningLocalAgentTask(task: TaskState): boolean {
  if (task.type !== 'local_agent') return false;
  if (task.status !== 'running' && task.status !== 'pending') return false;
  return task.isBackgrounded !== false;
}

function formatRunningAgentTask(task: Extract<TaskState, { type: 'local_agent' }>): string {
  const title = task.agentType || task.id;
  return `${title} · ${task.status}`;
}

function AgentsRunningPanel({
  tasks,
  onOpenLibrary,
  onExit,
}: {
  tasks: Extract<TaskState, { type: 'local_agent' }>[];
  onOpenLibrary: () => void;
  onExit: () => void;
}): React.ReactNode {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'left' || event.key === 'right') {
      event.preventDefault();
      onOpenLibrary();
      return;
    }
    if (event.key === 'escape') {
      event.preventDefault();
      onExit();
    }
  };

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <AgentsTabs active="running" />
      {tasks.length === 0 ? (
        <Text dimColor>
          {getLocalizedText({
            en: 'No subagents are currently running.',
            zh: '当前没有正在运行的子代理。',
          })}
        </Text>
      ) : (
        <Box flexDirection="column">
          {tasks.map(task => (
            <Text key={task.id}> · {formatRunningAgentTask(task)}</Text>
          ))}
        </Box>
      )}
      <Box marginTop={2}>
        <Text dimColor>
          {getLocalizedText({
            en: '←/→ to switch · ↑/↓ to navigate · Enter to select · Esc to close',
            zh: '←/→ 切换 · ↑/↓ 导航 · Enter 选择 · Esc 关闭',
          })}
        </Text>
      </Box>
    </Box>
  );
}

export function AgentsMenu({ tools, onExit, initialTab = 'running' }: Props): React.ReactNode {
  const [modeState, setModeState] = React.useState<ModeState>(
    initialTab === 'library' ? { mode: 'list-agents', source: 'all' } : { mode: 'main-menu' },
  );
  const [changes, setChanges] = React.useState<string[]>([]);
  const agentDefinitions = useAppState(state => state.agentDefinitions);
  const mcpTools = useAppState(state => state.mcp.tools);
  const toolPermissionContext = useAppState(state => state.toolPermissionContext);
  const tasks = useAppState(state => state.tasks);
  const setAppState = useSetAppState();
  const mergedTools = useMergedTools(tools, mcpTools, toolPermissionContext);
  useExitOnCtrlCDWithKeybindings();

  const { allAgents, activeAgents: agents } = agentDefinitions;
  const runningAgentTasks = React.useMemo(
    () => Object.values(tasks).filter(isRunningLocalAgentTask),
    [tasks],
  );

  const agentsBySource = React.useMemo<Record<AgentSource, AgentDefinition[]>>(
    () => ({
      'built-in': allAgents.filter(agent => agent.source === 'built-in'),
      userSettings: allAgents.filter(agent => agent.source === 'userSettings'),
      projectSettings: allAgents.filter(agent => agent.source === 'projectSettings'),
      policySettings: allAgents.filter(agent => agent.source === 'policySettings'),
      localSettings: allAgents.filter(agent => agent.source === 'localSettings'),
      flagSettings: allAgents.filter(agent => agent.source === 'flagSettings'),
      plugin: allAgents.filter(agent => agent.source === 'plugin'),
      all: allAgents,
    }),
    [allAgents],
  );

  const closeAgentsMenu = React.useCallback(() => {
    const exitMessage = changes.length > 0 ? `Agent changes:\n${changes.join('\n')}` : undefined;
    onExit(
      exitMessage ??
        getLocalizedText({
          en: 'Agents dialog dismissed',
          zh: 'agents 对话框已关闭',
        }),
      { display: changes.length === 0 ? 'system' : undefined },
    );
  }, [changes, onExit]);

  const openRunning = React.useCallback(() => {
    setModeState({ mode: 'main-menu' });
  }, []);

  const openLibrary = React.useCallback(() => {
    setModeState({ mode: 'list-agents', source: 'all' });
  }, []);

  const handleAgentCreated = React.useCallback((message: string) => {
    setChanges(prev => [...prev, message]);
    setModeState({ mode: 'list-agents', source: 'all' });
  }, []);

  const handleAgentDeleted = React.useCallback(
    async (agent: AgentDefinition) => {
      try {
        await deleteAgentFromFile(agent);
        setAppState(state => {
          const nextAllAgents = state.agentDefinitions.allAgents.filter(
            candidate => !(candidate.agentType === agent.agentType && candidate.source === agent.source),
          );
          return {
            ...state,
            agentDefinitions: {
              ...state.agentDefinitions,
              allAgents: nextAllAgents,
              activeAgents: getActiveAgentsFromList(nextAllAgents),
            },
          };
        });
        setChanges(prev => [
          ...prev,
          getLocalizedText({
            en: `Deleted agent: ${chalk.bold(agent.agentType)}`,
            zh: `已删除 agent：${chalk.bold(agent.agentType)}`,
          }),
        ]);
        setModeState({ mode: 'list-agents', source: 'all' });
      } catch (error) {
        logError(toError(error));
      }
    },
    [setAppState],
  );

  if (modeState.mode === 'main-menu') {
    return (
      <AgentsRunningPanel
        tasks={runningAgentTasks}
        onOpenLibrary={openLibrary}
        onExit={closeAgentsMenu}
      />
    );
  }

  if (modeState.mode === 'list-agents') {
    const agentsToShow =
      modeState.source === 'all'
        ? [
            ...agentsBySource['built-in'],
            ...agentsBySource.userSettings,
            ...agentsBySource.projectSettings,
            ...agentsBySource.localSettings,
            ...agentsBySource.policySettings,
            ...agentsBySource.flagSettings,
            ...agentsBySource.plugin,
          ]
        : agentsBySource[modeState.source];
    const resolvedAgents: ResolvedAgent[] = resolveAgentOverrides(agentsToShow, agents);
    return (
      <>
        <AgentsList
          source={modeState.source}
          agents={resolvedAgents}
          onBack={openRunning}
          onOpenRunning={openRunning}
          onSelect={agent => setModeState({ mode: 'agent-menu', agent, previousMode: modeState })}
          onCreateNew={() => setModeState({ mode: 'create-agent' })}
          changes={changes}
        />
        <AgentNavigationFooter
          instructions={getLocalizedText({
            en: '←/→ to switch tabs · ↑/↓ to navigate · Enter to select · Esc to go back',
            zh: '←/→ 切换标签 · ↑/↓ 导航 · Enter 选择 · Esc 返回',
          })}
        />
      </>
    );
  }

  if (modeState.mode === 'create-agent') {
    return (
      <CreateAgentWizard
        tools={mergedTools}
        existingAgents={agents}
        onComplete={handleAgentCreated}
        onCancel={() => setModeState({ mode: 'list-agents', source: 'all' })}
      />
    );
  }

  if (modeState.mode === 'agent-menu') {
    const freshAgent = allAgents.find(
      agent => agent.agentType === modeState.agent.agentType && agent.source === modeState.agent.source,
    );
    const agentToUse = freshAgent ?? modeState.agent;
    const isEditable =
      agentToUse.source !== 'built-in' &&
      agentToUse.source !== 'plugin' &&
      agentToUse.source !== 'flagSettings';
    const menuItems = [
      { label: getLocalizedText({ en: 'View agent', zh: '查看 agent' }), value: 'view' },
      ...(isEditable
        ? [
            { label: getLocalizedText({ en: 'Edit agent', zh: '编辑 agent' }), value: 'edit' },
            { label: getLocalizedText({ en: 'Delete agent', zh: '删除 agent' }), value: 'delete' },
          ]
        : []),
      { label: getLocalizedText({ en: 'Back', zh: '返回' }), value: 'back' },
    ];
    const goBack = () => setModeState(modeState.previousMode);
    return (
      <>
        <Dialog title={agentToUse.agentType} onCancel={goBack} hideInputGuide>
          <Box flexDirection="column">
            <Select
              options={menuItems}
              onChange={value => {
                if (value === 'view') {
                  setModeState({ mode: 'view-agent', agent: agentToUse, previousMode: modeState.previousMode });
                } else if (value === 'edit') {
                  setModeState({ mode: 'edit-agent', agent: agentToUse, previousMode: modeState });
                } else if (value === 'delete') {
                  setModeState({ mode: 'delete-confirm', agent: agentToUse, previousMode: modeState });
                } else {
                  goBack();
                }
              }}
              onCancel={goBack}
            />
            {changes.length > 0 ? (
              <Box marginTop={1}>
                <Text dimColor>{changes[changes.length - 1]}</Text>
              </Box>
            ) : null}
          </Box>
        </Dialog>
        <AgentNavigationFooter />
      </>
    );
  }

  if (modeState.mode === 'view-agent') {
    const freshAgent = allAgents.find(
      agent => agent.agentType === modeState.agent.agentType && agent.source === modeState.agent.source,
    );
    const agentToDisplay = freshAgent ?? modeState.agent;
    const backToAgentMenu = () =>
      setModeState({
        mode: 'agent-menu',
        agent: agentToDisplay,
        previousMode: modeState.previousMode,
      });
    return (
      <>
        <Dialog title={agentToDisplay.agentType} onCancel={backToAgentMenu} hideInputGuide>
          <AgentDetail
            agent={agentToDisplay}
            tools={mergedTools}
            allAgents={allAgents}
            onBack={backToAgentMenu}
          />
        </Dialog>
        <AgentNavigationFooter
          instructions={getLocalizedText({
            en: 'Press Enter or Esc to go back',
            zh: '按 Enter 或 Esc 返回',
          })}
        />
      </>
    );
  }

  if (modeState.mode === 'delete-confirm') {
    const goBack = () => setModeState(modeState.previousMode);
    return (
      <>
        <Dialog
          title={getLocalizedText({ en: 'Delete agent', zh: '删除 agent' })}
          onCancel={goBack}
          color="error"
        >
          <Text>
            {getLocalizedText({
              en: 'Are you sure you want to delete the agent',
              zh: '你确定要删除这个 agent 吗',
            })}{' '}
            <Text bold>{modeState.agent.agentType}</Text>?
          </Text>
          <Box marginTop={1}>
            <Text dimColor>
              {getLocalizedText({ en: 'Source', zh: '来源' })}: {modeState.agent.source}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Select
              options={[
                { label: getLocalizedText({ en: 'Yes, delete', zh: '是，删除' }), value: 'yes' },
                { label: getLocalizedText({ en: 'No, cancel', zh: '否，取消' }), value: 'no' },
              ]}
              onChange={value => {
                if (value === 'yes') void handleAgentDeleted(modeState.agent);
                else goBack();
              }}
              onCancel={goBack}
            />
          </Box>
        </Dialog>
        <AgentNavigationFooter
          instructions={getLocalizedText({
            en: 'Press ↑↓ to navigate, Enter to select, Esc to cancel',
            zh: '按 ↑↓ 导航，按 Enter 选择，按 Esc 取消',
          })}
        />
      </>
    );
  }

  if (modeState.mode === 'edit-agent') {
    const freshAgent = allAgents.find(
      agent => agent.agentType === modeState.agent.agentType && agent.source === modeState.agent.source,
    );
    const agentToEdit = freshAgent ?? modeState.agent;
    const goBack = () => setModeState(modeState.previousMode);
    return (
      <>
        <Dialog
          title={getLocalizedText({
            en: `Edit agent: ${agentToEdit.agentType}`,
            zh: `编辑 agent：${agentToEdit.agentType}`,
          })}
          onCancel={goBack}
          hideInputGuide
        >
          <AgentEditor
            agent={agentToEdit}
            tools={mergedTools}
            onSaved={message => {
              handleAgentCreated(message);
              setModeState(modeState.previousMode);
            }}
            onBack={goBack}
          />
        </Dialog>
        <AgentNavigationFooter />
      </>
    );
  }

  return null;
}
