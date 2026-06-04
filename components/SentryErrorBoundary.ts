import * as React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
}

export class SentryErrorBoundary extends React.Component<Props, State> {
  declare readonly props: Props
  declare state: State

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return null
    }

    return this.props.children
  }
}
