/* eslint-disable @typescript-eslint/no-unused-vars -- React Compiler output preserves source-level type aliases and helper bindings that can be unused after transformation. */
import { c as _c } from "react/compiler-runtime";
import chalk from 'chalk';
import * as path from 'path';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logMossenEvent } from 'src/services/analytics/mossenEventLogger.js';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Select } from '../../components/CustomSelect/index.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { IdeAutoConnectDialog, IdeDisableAutoConnectDialog, shouldShowAutoConnectDialog, shouldShowDisableAutoConnectDialog } from '../../components/IdeAutoConnectDialog.js';
import { getProductAssistantName, getProductDisplayName } from '../../constants/product.js';
import { Box, Text } from '../../ink.js';
import { clearServerCache } from '../../services/mcp/client.js';
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getCwd } from '../../utils/cwd.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import { type DetectedIDEInfo, detectIDEs, detectRunningIDEs, type IdeType, isJetBrainsIde, isSupportedJetBrainsTerminal, isSupportedTerminal, toIDEDisplayName } from '../../utils/ide.js';
import { getLocalizedText } from '../../utils/uiLanguage.js';
import { getCurrentWorktreeDevTargetSnapshot, getCurrentWorktreeIdeTargetSnapshot, type WorktreeIdeTargetSnapshot } from '../../utils/worktree.js';
type IDEScreenProps = {
  availableIDEs: DetectedIDEInfo[];
  unavailableIDEs: DetectedIDEInfo[];
  selectedIDE?: DetectedIDEInfo | null;
  onClose: () => void;
  onSelect: (ide?: DetectedIDEInfo) => void;
};
function IDEScreen(t0) {
  const $ = _c(39);
  const {
    availableIDEs,
    unavailableIDEs,
    selectedIDE,
    onClose,
    onSelect
  } = t0;
  let t1;
  if ($[0] !== selectedIDE?.port) {
    t1 = selectedIDE?.port?.toString() ?? "None";
    $[0] = selectedIDE?.port;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const [selectedValue, setSelectedValue] = useState(t1);
  const [showAutoConnectDialog, setShowAutoConnectDialog] = useState(false);
  const [showDisableAutoConnectDialog, setShowDisableAutoConnectDialog] = useState(false);
  let t2;
  if ($[2] !== availableIDEs || $[3] !== onSelect) {
    t2 = value => {
      if (value !== "None" && shouldShowAutoConnectDialog()) {
        setShowAutoConnectDialog(true);
      } else {
        if (value === "None" && shouldShowDisableAutoConnectDialog()) {
          setShowDisableAutoConnectDialog(true);
        } else {
          onSelect(availableIDEs.find(ide => ide.port === parseInt(value)));
        }
      }
    };
    $[2] = availableIDEs;
    $[3] = onSelect;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const handleSelectIDE = t2;
  let t3;
  if ($[5] !== availableIDEs) {
    t3 = availableIDEs.reduce(_temp, {});
    $[5] = availableIDEs;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const ideCounts = t3;
  let t4;
  if ($[7] !== availableIDEs || $[8] !== ideCounts) {
    let t5;
    if ($[10] !== ideCounts) {
      t5 = ide_1 => {
        const hasMultipleInstances = (ideCounts[ide_1.name] || 0) > 1;
        const showWorkspace = hasMultipleInstances && ide_1.workspaceFolders.length > 0;
        return {
          label: ide_1.name,
          value: ide_1.port.toString(),
          description: showWorkspace ? formatWorkspaceFolders(ide_1.workspaceFolders) : undefined
        };
      };
      $[10] = ideCounts;
      $[11] = t5;
    } else {
      t5 = $[11];
    }
    t4 = availableIDEs.map(t5).concat([{
      label: "None",
      value: "None",
      description: undefined
    }]);
    $[7] = availableIDEs;
    $[8] = ideCounts;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const options = t4;
  if (showAutoConnectDialog) {
    let t5;
    if ($[12] !== handleSelectIDE || $[13] !== selectedValue) {
      t5 = <IdeAutoConnectDialog onComplete={() => handleSelectIDE(selectedValue)} />;
      $[12] = handleSelectIDE;
      $[13] = selectedValue;
      $[14] = t5;
    } else {
      t5 = $[14];
    }
    return t5;
  }
  if (showDisableAutoConnectDialog) {
    let t5;
    if ($[15] !== onSelect) {
      t5 = <IdeDisableAutoConnectDialog onComplete={() => {
        onSelect(undefined);
      }} />;
      $[15] = onSelect;
      $[16] = t5;
    } else {
      t5 = $[16];
    }
    return t5;
  }
  let t5;
  if ($[17] !== availableIDEs.length) {
    t5 = availableIDEs.length === 0 && <Text dimColor={true}>{isSupportedJetBrainsTerminal() ? getLocalizedText({
      en: 'No available IDEs detected. Please install the plugin and restart your IDE.',
      zh: '未检测到可用 IDE。请安装插件并重启你的 IDE。'
    }) : getLocalizedText({
      en: `No available IDEs detected. Make sure your IDE has the ${getProductDisplayName()} extension or plugin installed and is running.`,
      zh: `未检测到可用 IDE。请确认你的 IDE 已安装并启用 ${getProductDisplayName()} 扩展或插件。`
    })}</Text>;
    $[17] = availableIDEs.length;
    $[18] = t5;
  } else {
    t5 = $[18];
  }
  let t6;
  if ($[19] !== availableIDEs.length || $[20] !== handleSelectIDE || $[21] !== options || $[22] !== selectedValue) {
    t6 = availableIDEs.length !== 0 && <Select defaultValue={selectedValue} defaultFocusValue={selectedValue} options={options} onChange={value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    }} />;
    $[19] = availableIDEs.length;
    $[20] = handleSelectIDE;
    $[21] = options;
    $[22] = selectedValue;
    $[23] = t6;
  } else {
    t6 = $[23];
  }
  let t7;
  if ($[24] !== availableIDEs) {
    t7 = availableIDEs.length !== 0 && availableIDEs.some(_temp2) && <Box marginTop={1}><Text color="warning">{getLocalizedText({
      en: `Note: Only one ${getProductAssistantName()} instance can be connected to VS Code at a time.`,
      zh: `注意：同一时间只能有一个 ${getProductAssistantName()} 实例连接到 VS Code。`
    })}</Text></Box>;
    $[24] = availableIDEs;
    $[25] = t7;
  } else {
    t7 = $[25];
  }
  let t8;
  if ($[26] !== availableIDEs.length) {
    t8 = availableIDEs.length !== 0 && !isSupportedTerminal() && <Box marginTop={1}><Text dimColor={true}>{getLocalizedText({
      en: 'Tip: You can enable auto-connect to IDE in /config or with the --ide flag',
      zh: '提示：你可以在 /config 中启用自动连接 IDE，或使用 --ide 参数。'
    })}</Text></Box>;
    $[26] = availableIDEs.length;
    $[27] = t8;
  } else {
    t8 = $[27];
  }
  let t9;
  if ($[28] !== unavailableIDEs) {
    t9 = unavailableIDEs.length > 0 && <Box marginTop={1} flexDirection="column"><Text dimColor={true}>{getLocalizedText({
      en: `Found ${unavailableIDEs.length} other running IDE(s). However, their workspace/project directories do not match the current cwd.`,
      zh: `发现另外 ${unavailableIDEs.length} 个正在运行的 IDE，但它们的工作区/项目目录与当前 cwd 不匹配。`
    })}</Text><Box marginTop={1} flexDirection="column">{unavailableIDEs.map(_temp3)}</Box></Box>;
    $[28] = unavailableIDEs;
    $[29] = t9;
  } else {
    t9 = $[29];
  }
  let t10;
  if ($[30] !== t5 || $[31] !== t6 || $[32] !== t7 || $[33] !== t8 || $[34] !== t9) {
    t10 = <Box flexDirection="column">{t5}{t6}{t7}{t8}{t9}</Box>;
    $[30] = t5;
    $[31] = t6;
    $[32] = t7;
    $[33] = t8;
    $[34] = t9;
    $[35] = t10;
  } else {
    t10 = $[35];
  }
  let t11;
  if ($[36] !== onClose || $[37] !== t10) {
    t11 = <Dialog title={getLocalizedText({
      en: 'Select IDE',
      zh: '选择 IDE'
    })} subtitle={getLocalizedText({
      en: 'Connect to an IDE for integrated development features.',
      zh: '连接到 IDE 以获得集成开发能力。'
    })} onCancel={onClose} color="ide">{t10}</Dialog>;
    $[36] = onClose;
    $[37] = t10;
    $[38] = t11;
  } else {
    t11 = $[38];
  }
  return t11;
}
function _temp3(ide_3, index) {
  return <Box key={index} paddingLeft={3}><Text dimColor={true}>• {ide_3.name}: {formatWorkspaceFolders(ide_3.workspaceFolders)}</Text></Box>;
}
function _temp2(ide_2) {
  return ide_2.name === "VS Code" || ide_2.name === "Visual Studio Code";
}
function _temp(acc, ide_0) {
  acc[ide_0.name] = (acc[ide_0.name] || 0) + 1;
  return acc;
}
async function findCurrentIDE(availableIDEs: DetectedIDEInfo[], dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>): Promise<DetectedIDEInfo | null> {
  const currentConfig = dynamicMcpConfig?.ide;
  if (!currentConfig || currentConfig.type !== 'sse-ide' && currentConfig.type !== 'ws-ide') {
    return null;
  }
  for (const ide of availableIDEs) {
    if (ide.url === currentConfig.url) {
      return ide;
    }
  }
  return null;
}
type IDEOpenSelectionProps = {
  availableIDEs: DetectedIDEInfo[];
  target: WorktreeIdeTargetSnapshot;
  onSelectIDE: (ide?: DetectedIDEInfo) => void;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
function IDEOpenSelection(t0) {
  const $ = _c(22);
  const {
    availableIDEs,
    target,
    onSelectIDE,
    onDone
  } = t0;
  let t1;
  if ($[0] !== availableIDEs[0]?.port) {
    t1 = availableIDEs[0]?.port?.toString() ?? "";
    $[0] = availableIDEs[0]?.port;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const [selectedValue, setSelectedValue] = useState(t1);
  let t2;
  if ($[2] !== availableIDEs || $[3] !== onSelectIDE) {
    t2 = value => {
      const selectedIDE = availableIDEs.find(ide => ide.port === parseInt(value));
      onSelectIDE(selectedIDE);
    };
    $[2] = availableIDEs;
    $[3] = onSelectIDE;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const handleSelectIDE = t2;
  let t3;
  if ($[5] !== availableIDEs) {
    t3 = availableIDEs.map(_temp4);
    $[5] = availableIDEs;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const options = t3;
  let t4;
  if ($[7] !== onDone) {
    t4 = function handleCancel() {
      onDone(getLocalizedText({
        en: 'IDE selection cancelled',
        zh: '已取消 IDE 选择'
      }), {
        display: "system"
      });
    };
    $[7] = onDone;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const handleCancel = t4;
  let t5;
  if ($[9] !== handleSelectIDE) {
    t5 = value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    };
    $[9] = handleSelectIDE;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== options || $[12] !== selectedValue || $[13] !== t5) {
    t6 = <Select defaultValue={selectedValue} defaultFocusValue={selectedValue} options={options} onChange={t5} />;
    $[11] = options;
    $[12] = selectedValue;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  let t7;
  if ($[15] !== target) {
    t7 = target.kind === 'worktree' ? <Box marginBottom={1} flexDirection="column"><Text dimColor={true}>{getLocalizedText({
      en: 'Current worktree',
      zh: '当前工作树'
    })}: {target.displayName}{target.branch ? ` · ${target.branch}` : ''}</Text><Text dimColor={true}>{getLocalizedText({
      en: 'Worktree path',
      zh: '工作树路径'
    })}: {target.path}</Text>{target.originalCwd && <Text dimColor={true}>{getLocalizedText({
      en: 'Original repo',
      zh: '原始仓库'
    })}: {target.originalCwd}</Text>}</Box> : <Box marginBottom={1}><Text dimColor={true}>{getLocalizedText({
      en: 'Project path',
      zh: '项目路径'
    })}: {target.path}</Text></Box>;
    $[15] = target;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
  if ($[17] !== handleCancel || $[18] !== t6 || $[19] !== t7 || $[20] !== target.kind) {
    t8 = <Dialog title={getLocalizedText({
      en: target.kind === 'worktree' ? 'Select an IDE to open the current worktree' : 'Select an IDE to open the project',
      zh: target.kind === 'worktree' ? '选择用于打开当前工作树的 IDE' : '选择用于打开项目的 IDE'
    })} onCancel={handleCancel} color="ide"><Box flexDirection="column">{t7}{t6}</Box></Dialog>;
    $[17] = handleCancel;
    $[18] = t6;
    $[19] = t7;
    $[20] = target.kind;
    $[21] = t8;
  } else {
    t8 = $[21];
  }
  return t8;
}

function getIdeOpenTargetDisplayName(target: WorktreeIdeTargetSnapshot): string {
  if (target.kind === 'worktree') {
    return target.branch ? `${target.displayName} (${target.branch})` : target.displayName;
  }
  return target.displayName;
}

function getIdeOpenTargetNoun(target: WorktreeIdeTargetSnapshot): string {
  return target.kind === 'worktree' ? 'worktree' : 'project';
}

function getLocalizedIdeOpenResult(target: WorktreeIdeTargetSnapshot, ideName: string): string {
  const targetName = getIdeOpenTargetDisplayName(target);
  return getLocalizedText({
    en: `Opened ${getIdeOpenTargetNoun(target)} ${targetName} in ${chalk.bold(ideName)}: ${target.path}`,
    zh: `已在 ${chalk.bold(ideName)} 中打开${target.kind === 'worktree' ? `工作树 ${targetName}` : `项目 ${targetName}`}：${target.path}`
  });
}

function getLocalizedIdeOpenManualFallback(target: WorktreeIdeTargetSnapshot, ideName: string): string {
  const targetName = getIdeOpenTargetDisplayName(target);
  return getLocalizedText({
    en: `Please open the ${getIdeOpenTargetNoun(target)} ${targetName} manually in ${chalk.bold(ideName)}: ${target.path}${target.originalCwd ? `\nOriginal repo: ${target.originalCwd}` : ''}`,
    zh: `请在 ${chalk.bold(ideName)} 中手动打开${target.kind === 'worktree' ? `工作树 ${targetName}` : `项目 ${targetName}`}：${target.path}${target.originalCwd ? `\n原始仓库：${target.originalCwd}` : ''}`
  });
}

function getLocalizedIdeOpenFailure(target: WorktreeIdeTargetSnapshot, ideName: string): string {
  return getLocalizedText({
    en: `Failed to open ${getIdeOpenTargetNoun(target)} in ${ideName}. Try opening manually: ${target.path}`,
    zh: `无法在 ${ideName} 中打开${target.kind === 'worktree' ? '工作树' : '项目'}。请尝试手动打开：${target.path}`
  });
}

function getLocalizedIdeConnectionTargetName(target: WorktreeIdeTargetSnapshot): string {
  return target.branch ? `${target.displayName} (${target.branch})` : target.displayName;
}

function getLocalizedIdeConnectionResult(target: WorktreeIdeTargetSnapshot, ideName: string, state: 'connected' | 'failed' | 'timed-out' | 'disconnected'): string {
  const targetName = getLocalizedIdeConnectionTargetName(target);
  const targetNoun = target.kind === 'worktree' ? {
    en: 'worktree',
    zh: '工作树'
  } : {
    en: 'project',
    zh: '项目'
  };
  switch (state) {
    case 'connected':
      return getLocalizedText({
        en: `Connected to ${ideName} for ${targetNoun.en} ${targetName}.`,
        zh: `已连接到 ${ideName}，目标${targetNoun.zh}为 ${targetName}。`
      });
    case 'failed':
      return getLocalizedText({
        en: `Failed to connect to ${ideName} for ${targetNoun.en} ${targetName}.`,
        zh: `连接到 ${ideName} 失败，目标${targetNoun.zh}为 ${targetName}。`
      });
    case 'timed-out':
      return getLocalizedText({
        en: `Connection to ${ideName} for ${targetNoun.en} ${targetName} timed out.`,
        zh: `连接到 ${ideName} 超时，目标${targetNoun.zh}为 ${targetName}。`
      });
    case 'disconnected':
      return getLocalizedText({
        en: `Disconnected from ${ideName} for ${targetNoun.en} ${targetName}.`,
        zh: `已断开与 ${ideName} 的连接，目标${targetNoun.zh}为 ${targetName}。`
      });
  }
}

function _temp4(ide_0) {
  return {
    label: ide_0.name,
    value: ide_0.port.toString()
  };
}
function RunningIDESelector(t0) {
  const $ = _c(15);
  const {
    runningIDEs,
    onSelectIDE,
    onDone
  } = t0;
  const [selectedValue, setSelectedValue] = useState(runningIDEs[0] ?? "");
  let t1;
  if ($[0] !== onSelectIDE) {
    t1 = value => {
      onSelectIDE(value as IdeType);
    };
    $[0] = onSelectIDE;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleSelectIDE = t1;
  let t2;
  if ($[2] !== runningIDEs) {
    t2 = runningIDEs.map(_temp5);
    $[2] = runningIDEs;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const options = t2;
  let t3;
  if ($[4] !== onDone) {
    t3 = function handleCancel() {
      onDone(getLocalizedText({
        en: 'IDE selection cancelled',
        zh: '已取消 IDE 选择'
      }), {
        display: "system"
      });
    };
    $[4] = onDone;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const handleCancel = t3;
  let t4;
  if ($[6] !== handleSelectIDE) {
    t4 = value_0 => {
      setSelectedValue(value_0);
      handleSelectIDE(value_0);
    };
    $[6] = handleSelectIDE;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== options || $[9] !== selectedValue || $[10] !== t4) {
    t5 = <Select defaultFocusValue={selectedValue} options={options} onChange={t4} />;
    $[8] = options;
    $[9] = selectedValue;
    $[10] = t4;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] !== handleCancel || $[13] !== t5) {
    t6 = <Dialog title={getLocalizedText({
      en: 'Select IDE to install extension',
      zh: '选择要安装扩展的 IDE'
    })} onCancel={handleCancel} color="ide">{t5}</Dialog>;
    $[12] = handleCancel;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
function _temp5(ide) {
  return {
    label: toIDEDisplayName(ide),
    value: ide
  };
}
function InstallOnMount(t0) {
  const $ = _c(4);
  const {
    ide,
    onInstall
  } = t0;
  let t1;
  let t2;
  if ($[0] !== ide || $[1] !== onInstall) {
    t1 = () => {
      onInstall(ide);
    };
    t2 = [ide, onInstall];
    $[0] = ide;
    $[1] = onInstall;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  return null;
}
export async function call(onDone: (result?: string, options?: {
  display?: CommandResultDisplay;
}) => void, context: LocalJSXCommandContext, args: string): Promise<React.ReactNode | null> {
  logMossenEvent('mossen.ide.commandOpened', {});
  const {
    options: {
      dynamicMcpConfig
    },
    onChangeDynamicMcpConfig
  } = context;

  // Handle 'open' argument
  if (args?.trim() === 'open') {
    const ideTarget = getCurrentWorktreeIdeTargetSnapshot(getCwd());

    // Detect available IDEs
    const detectedIDEs = await detectIDEs(true);
    const availableIDEs = detectedIDEs.filter(ide => ide.isValid);
    if (availableIDEs.length === 0) {
      onDone(getLocalizedText({
        en: `No IDEs with the ${getProductDisplayName()} extension detected to open the current ${ideTarget.kind}.`,
        zh: `未检测到安装了 ${getProductDisplayName()} 扩展、可用于打开当前${ideTarget.kind === 'worktree' ? '工作树' : '项目'}的 IDE。`
      }));
      return null;
    }

    // Return IDE selection component
    return <IDEOpenSelection availableIDEs={availableIDEs} target={ideTarget} onSelectIDE={async (selectedIDE?: DetectedIDEInfo) => {
      if (!selectedIDE) {
        onDone(getLocalizedText({
          en: 'No IDE selected.',
          zh: '未选择 IDE。'
        }));
        return;
      }

      // Try to open the project in the selected IDE
      if (selectedIDE.name.toLowerCase().includes('vscode') || selectedIDE.name.toLowerCase().includes('cursor') || selectedIDE.name.toLowerCase().includes('windsurf')) {
        // VS Code-based IDEs
        const {
          code
        } = await execFileNoThrow('code', [ideTarget.path]);
        if (code === 0) {
          onDone(getLocalizedIdeOpenResult(ideTarget, selectedIDE.name));
        } else {
          onDone(getLocalizedIdeOpenFailure(ideTarget, selectedIDE.name));
        }
      } else if (isSupportedJetBrainsTerminal()) {
        // JetBrains IDEs - they usually open via their CLI tools
        onDone(getLocalizedIdeOpenManualFallback(ideTarget, selectedIDE.name));
      } else {
        onDone(getLocalizedIdeOpenManualFallback(ideTarget, selectedIDE.name));
      }
    }} onDone={() => {
      onDone(getLocalizedText({
        en: 'Exited without opening IDE',
        zh: '已退出，未打开 IDE'
      }), {
        display: 'system'
      });
    }} />;
  }
  const detectedIDEs = await detectIDEs(true);

  // If no IDEs with extensions detected, check for running IDEs and offer to install
  if (detectedIDEs.length === 0 && context.onInstallIDEExtension && !isSupportedTerminal()) {
    const runningIDEs = await detectRunningIDEs();
    const onInstall = (ide: IdeType) => {
      if (context.onInstallIDEExtension) {
        context.onInstallIDEExtension(ide);
        // The completion message will be shown after installation
        if (isJetBrainsIde(ide)) {
          onDone(getLocalizedText({
            en: `Installed plugin to ${chalk.bold(toIDEDisplayName(ide))}\nPlease ${chalk.bold('restart your IDE')} completely for it to take effect`,
            zh: `已将插件安装到 ${chalk.bold(toIDEDisplayName(ide))}\n请${chalk.bold('完全重启你的 IDE')}以使其生效`
          }));
        } else {
          onDone(getLocalizedText({
            en: `Installed extension to ${chalk.bold(toIDEDisplayName(ide))}`,
            zh: `已将扩展安装到 ${chalk.bold(toIDEDisplayName(ide))}`
          }));
        }
      }
    };
    if (runningIDEs.length > 1) {
      // Show selector when multiple IDEs are running
      return <RunningIDESelector runningIDEs={runningIDEs} onSelectIDE={onInstall} onDone={() => {
        onDone(getLocalizedText({
          en: 'No IDE selected.',
          zh: '未选择 IDE。'
        }), {
          display: 'system'
        });
      }} />;
    } else if (runningIDEs.length === 1) {
      return <InstallOnMount ide={runningIDEs[0]!} onInstall={onInstall} />;
    }
  }
  const availableIDEs = detectedIDEs.filter(ide => ide.isValid);
  const unavailableIDEs = detectedIDEs.filter(ide => !ide.isValid);
  const currentIDE = await findCurrentIDE(availableIDEs, dynamicMcpConfig);
  return <IDECommandFlow availableIDEs={availableIDEs} unavailableIDEs={unavailableIDEs} currentIDE={currentIDE} dynamicMcpConfig={dynamicMcpConfig} onChangeDynamicMcpConfig={onChangeDynamicMcpConfig} onDone={onDone} />;
}

// Connection timeout slightly longer than the 30s MCP connection timeout
const IDE_CONNECTION_TIMEOUT_MS = 35000;
type IDECommandFlowProps = {
  availableIDEs: DetectedIDEInfo[];
  unavailableIDEs: DetectedIDEInfo[];
  currentIDE: DetectedIDEInfo | null;
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  onChangeDynamicMcpConfig?: (config: Record<string, ScopedMcpServerConfig>) => void;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
function IDECommandFlow({
  availableIDEs,
  unavailableIDEs,
  currentIDE,
  dynamicMcpConfig,
  onChangeDynamicMcpConfig,
  onDone
}: IDECommandFlowProps): React.ReactNode {
  const [connectingIDE, setConnectingIDE] = useState<DetectedIDEInfo | null>(null);
  const currentTarget = getCurrentWorktreeDevTargetSnapshot(getCwd());
  const ideClient = useAppState(s => s.mcp.clients.find(c => c.name === 'ide'));
  const setAppState = useSetAppState();
  const isFirstCheckRef = useRef(true);

  // Watch for connection result
  useEffect(() => {
    if (!connectingIDE) return;
    // Skip the first check — it reflects stale state from before the
    // config change was dispatched
    if (isFirstCheckRef.current) {
      isFirstCheckRef.current = false;
      return;
    }
    if (!ideClient || ideClient.type === 'pending') return;
    if (ideClient.type === 'connected') {
      onDone(getLocalizedIdeConnectionResult(currentTarget, connectingIDE.name, 'connected'));
    } else if (ideClient.type === 'failed') {
      onDone(getLocalizedIdeConnectionResult(currentTarget, connectingIDE.name, 'failed'));
    }
  }, [currentTarget, ideClient, connectingIDE, onDone]);

  // Timeout fallback
  useEffect(() => {
    if (!connectingIDE) return;
    const timer = setTimeout(onDone, IDE_CONNECTION_TIMEOUT_MS, getLocalizedIdeConnectionResult(currentTarget, connectingIDE.name, 'timed-out'));
    return () => clearTimeout(timer);
  }, [currentTarget, connectingIDE, onDone]);
  const handleSelectIDE = useCallback((selectedIDE?: DetectedIDEInfo) => {
    if (!onChangeDynamicMcpConfig) {
      onDone(getLocalizedText({
        en: 'Error connecting to IDE.',
        zh: '连接 IDE 时出错。'
      }));
      return;
    }
    const newConfig = {
      ...(dynamicMcpConfig || {})
    };
    if (currentIDE) {
      delete newConfig.ide;
    }
    if (!selectedIDE) {
      // Close the MCP transport and remove the client from state
      if (ideClient && ideClient.type === 'connected' && currentIDE) {
        // Null out onclose to prevent auto-reconnection
        ideClient.client.onclose = () => {};
        void clearServerCache('ide', ideClient.config);
        setAppState(prev => ({
          ...prev,
          mcp: {
            ...prev.mcp,
            clients: prev.mcp.clients.filter(c_0 => c_0.name !== 'ide'),
            tools: prev.mcp.tools.filter(t => !t.name?.startsWith('mcp__ide__')),
            commands: prev.mcp.commands.filter(c_1 => !c_1.name?.startsWith('mcp__ide__'))
          }
        }));
      }
      onChangeDynamicMcpConfig(newConfig);
      onDone(currentIDE ? getLocalizedIdeConnectionResult(currentTarget, currentIDE.name, 'disconnected') : getLocalizedText({
        en: 'No IDE selected.',
        zh: '未选择 IDE。'
      }));
      return;
    }
    const url = selectedIDE.url;
    newConfig.ide = {
      type: url.startsWith('ws:') ? 'ws-ide' : 'sse-ide',
      url: url,
      ideName: selectedIDE.name,
      authToken: selectedIDE.authToken,
      ideRunningInWindows: selectedIDE.ideRunningInWindows,
      scope: 'dynamic' as const
    } as ScopedMcpServerConfig;
    isFirstCheckRef.current = true;
    setConnectingIDE(selectedIDE);
    onChangeDynamicMcpConfig(newConfig);
  }, [currentTarget, dynamicMcpConfig, currentIDE, ideClient, setAppState, onChangeDynamicMcpConfig, onDone]);
  if (connectingIDE) {
    return <Text dimColor>{getLocalizedText({
      en: `Connecting to ${connectingIDE.name}…`,
      zh: `正在连接到 ${connectingIDE.name}…`
    })}</Text>;
  }
  return <IDEScreen availableIDEs={availableIDEs} unavailableIDEs={unavailableIDEs} selectedIDE={currentIDE} onClose={() => onDone(getLocalizedText({
    en: 'IDE selection cancelled',
    zh: '已取消 IDE 选择'
  }), {
    display: 'system'
  })} onSelect={handleSelectIDE} />;
}

/**
 * Formats workspace folders for display, stripping cwd and showing tail end of paths
 * @param folders Array of folder paths
 * @param maxLength Maximum total length of the formatted string
 * @returns Formatted string with folder paths
 */
export function formatWorkspaceFolders(folders: string[], maxLength: number = 100): string {
  if (folders.length === 0) return '';
  const cwd = getCwd();

  // Only show first 2 workspaces
  const foldersToShow = folders.slice(0, 2);
  const hasMore = folders.length > 2;

  // Account for ", …" if there are more folders
  const ellipsisOverhead = hasMore ? 3 : 0; // ", …"

  // Account for commas and spaces between paths (", " = 2 chars per separator)
  const separatorOverhead = (foldersToShow.length - 1) * 2;
  const availableLength = maxLength - separatorOverhead - ellipsisOverhead;
  const maxLengthPerPath = Math.floor(availableLength / foldersToShow.length);
  const cwdNFC = cwd.normalize('NFC');
  const formattedFolders = foldersToShow.map(folder => {
    // Strip cwd from the beginning if present
    // Normalize both to NFC for consistent comparison (macOS uses NFD paths)
    const folderNFC = folder.normalize('NFC');
    if (folderNFC.startsWith(cwdNFC + path.sep)) {
      folder = folderNFC.slice(cwdNFC.length + 1);
    }
    if (folder.length <= maxLengthPerPath) {
      return folder;
    }
    return '…' + folder.slice(-(maxLengthPerPath - 1));
  });
  let result = formattedFolders.join(', ');
  if (hasMore) {
    result += ', …';
  }
  return result;
}
