export type SystemTheme = 'light' | 'dark' | 'unknown'

export function getSystemTheme(): SystemTheme {
  return 'unknown'
}

export function subscribeToSystemTheme(_callback: (theme: SystemTheme) => void): () => void {
  return () => {}
}

export function watchSystemTheme(
  _internalQuerier: unknown,
  _callback: (theme: SystemTheme) => void,
): () => void {
  return () => {}
}
