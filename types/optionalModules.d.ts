declare module 'image-processor-napi' {
  import type { Buffer } from 'buffer'

  type SharpInstance = {
    metadata(): Promise<{ width: number; height: number; format: string }>
    resize(
      width: number,
      height: number,
      options?: { fit?: string; withoutEnlargement?: boolean },
    ): SharpInstance
    jpeg(options?: { quality?: number }): SharpInstance
    png(options?: {
      compressionLevel?: number
      palette?: boolean
      colors?: number
    }): SharpInstance
    webp(options?: { quality?: number }): SharpInstance
    toBuffer(): Promise<Buffer>
  }

  type SharpFunction = (input: Buffer) => SharpInstance

  type NativeClipboardImage = {
    png: Buffer
    width: number
    height: number
    originalWidth: number
    originalHeight: number
  }

  type NativeModule = {
    hasClipboardImage?: () => boolean
    readClipboardImage?: (
      maxWidth: number,
      maxHeight: number,
    ) => NativeClipboardImage | null
  }

  export const sharp: SharpFunction
  export default sharp
  export function getNativeModule(): NativeModule | undefined
}

declare module '*.md' {
  const content: string
  export default content
}

declare module 'url-handler-napi' {
  export function waitForUrlEvent(timeoutMs?: number): string | null
}
