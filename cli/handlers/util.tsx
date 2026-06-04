/**
 * Miscellaneous subcommand handlers extracted from main.tsx for lazy loading.
 * setup-token, doctor, install
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { cwd } from 'process'
import React from 'react'
import { useManagePlugins } from '../../hooks/useManagePlugins.js'
import type { Root } from '../../ink.js'
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js'
import { logMossenEvent } from '../../services/analytics/mossenEventLogger.js'
import { MCPConnectionManager } from '../../services/mcp/MCPConnectionManager.js'
import { AppStateProvider } from '../../state/AppState.js'
import {
  getCustomBackendName,
  hasCustomBackendAuth,
  isCustomBackendEnabled,
} from '../../utils/customBackend.js'
import {
  buildDesktopSdkContractFromDiagnostic,
  type DesktopSdkContract,
} from '../../utils/desktopSdkContract.js'
import { getDoctorDiagnostic } from '../../utils/doctorDiagnostic.js'

export async function setupTokenHandler(root: Root): Promise<void> {
  logMossenEvent('mossen.cli.setupTokenCommand', {})

  if (isCustomBackendEnabled()) {
    const backendName = getCustomBackendName()
    const credentialState = hasCustomBackendAuth()
      ? `${backendName} credentials are already configured.`
      : `No reusable ${backendName} credentials are configured yet.`
    root.unmount()
    process.stdout.write(
      `Custom backend mode is enabled.\n${credentialState}\nConfigure reusable credentials with MOSSEN_CODE_CUSTOM_API_KEY, MOSSEN_CODE_CUSTOM_AUTH_TOKEN, or MOSSEN_CODE_CUSTOM_HEADERS.\n`,
    )
    process.exit(0)
  }

  root.unmount()
  process.stdout.write(
    'Built-in account token setup is disabled in Mossen mainline.\n' +
      'Configure reusable backend credentials with MOSSEN_CODE_CUSTOM_BASE_URL plus MOSSEN_CODE_CUSTOM_API_KEY or MOSSEN_CODE_CUSTOM_AUTH_TOKEN.\n' +
      'If you intentionally wrap an external hosted service, enable that Mossen adapter explicitly with MOSSEN_CODE_ENABLE_HOSTED_AUTH_ADAPTER=1 and inject credentials there.\n',
  )
  process.exit(1)
}

const DoctorLazy = React.lazy(() =>
  import('../../screens/Doctor.js').then(m => ({ default: m.Doctor })),
)

function DoctorWithPlugins({
  onDone,
}: {
  onDone: () => void
}): React.ReactNode {
  useManagePlugins()
  return (
    <React.Suspense fallback={null}>
      <DoctorLazy onDone={onDone} />
    </React.Suspense>
  )
}

export async function doctorHandler(root: Root): Promise<void> {
  logMossenEvent('mossen.cli.doctorCommand', {})

  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider>
        <KeybindingSetup>
          <MCPConnectionManager
            dynamicMcpConfig={undefined}
            isStrictMcpConfig={false}
          >
            <DoctorWithPlugins
              onDone={() => {
                void resolve()
              }}
            />
          </MCPConnectionManager>
        </KeybindingSetup>
      </AppStateProvider>,
    )
  })
  root.unmount()
  process.exit(0)
}

export async function doctorJsonHandler(): Promise<void> {
  const diagnostic = await getDoctorDiagnostic()
  const desktopSdk: DesktopSdkContract = buildDesktopSdkContractFromDiagnostic({
    diagnostic,
    permissionPromptTool: null,
  })
  process.stdout.write(
    `${JSON.stringify(
      {
        type: 'mossen_doctor',
        subtype: 'desktop_sdk_contract',
        desktopSdk,
      },
      null,
      2,
    )}\n`,
  )
  process.exit(0)
}

export async function installHandler(
  target: string | undefined,
  options: { force?: boolean },
): Promise<void> {
  const { setup } = await import('../../setup.js')
  await setup(cwd(), 'default', false, false, undefined, false)
  const { install } = await import('../../commands/install.js')
  await new Promise<void>(resolve => {
    const args: string[] = []
    if (target) args.push(target)
    if (options.force) args.push('--force')

    void install.call(
      result => {
        void resolve()
        process.exit(result.includes('failed') ? 1 : 0)
      },
      {},
      args,
    )
  })
}
