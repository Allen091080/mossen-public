/* eslint-disable @typescript-eslint/no-explicit-any */

// Minimal SDK control type stubs for reconstructed source builds.
export type SDKControlRequest = Record<string, unknown>
export type SDKControlResponse = Record<string, unknown>

import type { z } from 'zod/v4'
import type { SDKControlRequestInnerSchema } from './controlSchemas.js'

export type SDKControlRequestInner = z.infer<
  ReturnType<typeof SDKControlRequestInnerSchema>
>

type LooseControlRecord = any

export type StdinMessage = LooseControlRecord
export type StdoutMessage = LooseControlRecord
export type SDKPartialAssistantMessage = LooseControlRecord
export type SDKControlCancelRequest = LooseControlRecord
export type SDKControlInitializeRequest = LooseControlRecord
export type SDKControlInitializeResponse = LooseControlRecord
export type SDKControlMcpSetServersResponse = LooseControlRecord
export type SDKControlPermissionRequest = LooseControlRecord
export type SDKControlReloadPluginsResponse = LooseControlRecord
export type SDKControlReloadSkillsResponse = LooseControlRecord
