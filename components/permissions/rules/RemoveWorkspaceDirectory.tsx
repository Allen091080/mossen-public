import * as React from 'react';
import { Select } from '../../../components/CustomSelect/select.js';
import { getProductAssistantName } from '../../../constants/product.js';
import { Box, Text } from '../../../ink.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import { applyPermissionUpdate } from '../../../utils/permissions/PermissionUpdate.js';
import { getLocalizedText } from '../../../utils/uiLanguage.js';
import { Dialog } from '../../design-system/Dialog.js';

type Props = {
  directoryPath: string;
  onRemove: () => void;
  onCancel: () => void;
  permissionContext: ToolPermissionContext;
  setPermissionContext: (context: ToolPermissionContext) => void;
};

export function RemoveWorkspaceDirectory({
  directoryPath,
  onRemove,
  onCancel,
  permissionContext,
  setPermissionContext,
}: Props) {
  const handleRemove = () => {
    const updatedContext = applyPermissionUpdate(permissionContext, {
      type: 'removeDirectories',
      directories: [directoryPath],
      destination: 'session',
    });
    setPermissionContext(updatedContext);
    onRemove();
  };

  const handleSelect = (value: string) => {
    if (value === 'yes') {
      handleRemove();
    } else {
      onCancel();
    }
  };

  return (
    <Dialog
      title={getLocalizedText({
        en: 'Remove directory from workspace?',
        zh: '要从工作区移除此目录吗？',
      })}
      onCancel={onCancel}
      color="permission"
    >
      <Box flexDirection="column">
        <Box marginX={2} flexDirection="column">
          <Text bold>{directoryPath}</Text>
        </Box>
        <Text>
          {getLocalizedText({
            en: `${getProductAssistantName()} will no longer have access to files in this directory.`,
            zh: `${getProductAssistantName()} 将不再能访问此目录中的文件。`,
          })}
        </Text>
        <Select
          onChange={handleSelect}
          onCancel={onCancel}
          options={[
            {
              label: getLocalizedText({
                en: 'Yes',
                zh: '是',
              }),
              value: 'yes',
            },
            {
              label: getLocalizedText({
                en: 'No',
                zh: '否',
              }),
              value: 'no',
            },
          ]}
        />
      </Box>
    </Dialog>
  );
}
