// Compatibility surface for the legacy query state machine. The concrete
// transition variants are still validated by runtime flow; this file restores
// the missing type barrel without tightening the old structural shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Continue = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Terminal = any
