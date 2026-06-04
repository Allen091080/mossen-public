import * as React from 'react'
import { Box, Text } from 'ink'
import { logError } from '../utils/log.js'
import { toError } from '../utils/errors.js'

interface Props {
  children: React.ReactNode
  // Optional: human-readable label shown in fallback ("TaskList" / "PermissionDialog" 等)
  label?: string
  // Optional: render a custom fallback. Default = compact warning row.
  fallback?: (error: Error, label: string | undefined) => React.ReactNode
  // Default true. Set false if a parent should bubble (rare).
  silent?: boolean
}

interface State {
  error: Error | null
}

/**
 * MossenErrorBoundary — catches React render-time exceptions, logs them via
 * `logError` to ~/.mossen/logs, and renders a compact visible fallback so
 * the rest of the TUI continues to work.
 *
 * 区别于上游 SentryErrorBoundary：那个静默 return null（bridge 删除两次崩都被它
 * 静默吞了，看起来是整 tree unmount 实际只是子组件挂）。
 *
 * 用法：
 *   <MossenErrorBoundary label="TaskList">
 *     <TaskListV2 />
 *   </MossenErrorBoundary>
 */
export class MossenErrorBoundary extends React.Component<Props, State> {
  declare readonly props: Props
  declare state: State

  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: unknown): State {
    return { error: toError(error) }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const err = toError(error)
    const label = this.props.label ?? 'unlabeled'
    logError(
      `[MossenErrorBoundary:${label}] ${err.message}\n` +
      (err.stack ? `${err.stack}\n` : '') +
      (info.componentStack ? `componentStack:${info.componentStack}\n` : '')
    )
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (error) {
      // silent: don't render any fallback UI (still logs via componentDidCatch)
      if (this.props.silent) return null
      if (this.props.fallback) return this.props.fallback(error, this.props.label)
      const label = this.props.label ?? 'component'
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="yellow">⚠ {label} 渲染失败（已记入日志）：{error.message}</Text>
        </Box>
      )
    }
    return this.props.children
  }
}

/**
 * HOC: 把组件包成自带 ErrorBoundary 的版本。
 *
 * 用法：
 *   const SafeTaskListV2 = withErrorBoundary(TaskListV2, 'TaskListV2')
 *   export default SafeTaskListV2
 *
 * 或在 component 文件末尾：
 *   export default withErrorBoundary(MyDialog, 'MyDialog')
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  label: string,
): React.FC<P> {
  const Wrapped: React.FC<P> = (props) => (
    <MossenErrorBoundary label={label}>
      <InjectionThrower label={label} />
      <Component {...props} />
    </MossenErrorBoundary>
  )
  Wrapped.displayName = `withErrorBoundary(${label})`
  return Wrapped
}

/**
 * Test-only injection hook. When MOSSEN_INJECT_THROW=<label> is set, the
 * boundary's wrapped component will be replaced with a thrower at first render.
 * Used by the L8 异常注入 smoke (P1-2 slice 4).
 *
 * Production-safe: zero overhead when env var is unset.
 */
export function shouldInjectThrow(label: string): boolean {
  const target = process.env.MOSSEN_INJECT_THROW
  if (!target) return false
  return target === label || target === '*'
}

export function InjectionThrower({ label }: { label: string }): React.ReactNode {
  if (shouldInjectThrow(label)) {
    throw new Error(`[MOSSEN_INJECT_THROW=${label}] simulated render-time crash`)
  }
  return null
}
