import { stringWidth } from '../ink/stringWidth.js'
import {
  truncatePathMiddle,
  truncateStartToWidth,
  truncateToWidth,
  truncateToWidthNoEllipsis,
} from './truncate.js'

export function visualWidth(text: string): number {
  return stringWidth(text)
}

export function fitsVisualWidth(text: string, maxWidth: number): boolean {
  return visualWidth(text) <= maxWidth
}

export function truncateVisual(text: string, maxWidth: number): string {
  return truncateToWidth(text, maxWidth)
}

export function truncateVisualStart(text: string, maxWidth: number): string {
  return truncateStartToWidth(text, maxWidth)
}

export function truncateVisualNoEllipsis(
  text: string,
  maxWidth: number,
): string {
  return truncateToWidthNoEllipsis(text, maxWidth)
}

export function truncateVisualPathMiddle(
  path: string,
  maxWidth: number,
): string {
  return truncatePathMiddle(path, maxWidth)
}
