// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .mossen/ folder
export const MOSSEN_FOLDER_PERMISSION_PATTERN = '/.mossen/**'

// Permission pattern for granting session-level access to the global ~/.mossen/ folder
export const GLOBAL_MOSSEN_FOLDER_PERMISSION_PATTERN = '~/.mossen/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
