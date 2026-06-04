/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Dispatch, ReactNode, SetStateAction } from 'react'

export type WizardStepComponent = () => ReactNode

export type WizardContextValue<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  currentStepIndex: number
  totalSteps: number
  wizardData: T & any
  setWizardData: Dispatch<SetStateAction<T & any>>
  updateWizardData: (updates: Partial<T> & Record<string, any>) => void
  goNext: () => void
  goBack: () => void
  goToStep: (index: number) => void
  cancel: () => void
  title?: string
  showStepCounter: boolean
}

export type WizardProviderProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  steps: WizardStepComponent[]
  initialData?: T
  onComplete: (data: T) => void
  onCancel?: () => void
  children?: ReactNode
  title?: string
  showStepCounter?: boolean
}
