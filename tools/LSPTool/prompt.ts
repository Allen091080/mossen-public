export const LSP_TOOL_NAME = 'LSP' as const

export const DESCRIPTION = `Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

Operation argument matrix:
- Position-required (need filePath + line + character): goToDefinition, findReferences, hover, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls.
- Document-scope (need filePath only; line/character are not used): documentSymbol.
- Workspace-scope (no filePath / line / character — accept only optional query and maxResults): workspaceSymbol. The tool fans out across every managed LSP server and merges results, so do NOT pass filePath / line / character — strict validation will reject the call.

Common optional fields:
- query (workspaceSymbol only): a string filter; empty / omitted returns all symbols.
- maxResults (any operation that returns an array): positive integer cap.

line and character are 1-based (as shown in editors). The tool converts to 0-based for the LSP protocol internally.

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.`
