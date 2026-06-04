import {
  API_IMAGE_MAX_BASE64_SIZE,
  API_MAX_MEDIA_PER_REQUEST,
} from '../../constants/apiLimits.js'
import { formatFileSize } from '../../utils/format.js'
import { MossenAPIError } from './mossenSdk.js'

const DEFAULT_OPENAI_COMPAT_TOTAL_IMAGE_BASE64_BYTES = 20 * 1024 * 1024

export type OpenAICompatibleVisionRequestLimits = {
  maxImageBase64Bytes: number
  maxImages: number
  maxTotalImageBase64Bytes: number
}

export type OpenAICompatibleVisionValidationState = {
  imageCount: number
  totalImageBase64Bytes: number
}

export type OpenAICompatibleVisionImagePart = {
  base64Data: string
  mediaType: string
}

export type OpenAICompatibleVisionValidationResult =
  | {
      ok: true
      state: OpenAICompatibleVisionValidationState
    }
  | {
      ok: false
      reason: string
    }

function positiveIntegerFromEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

export function getOpenAICompatibleVisionRequestLimits(
  env: NodeJS.ProcessEnv = process.env,
): OpenAICompatibleVisionRequestLimits {
  return {
    maxImageBase64Bytes: positiveIntegerFromEnv(
      env,
      'MOSSEN_CODE_OPENAI_COMPAT_MAX_IMAGE_BASE64_BYTES',
      API_IMAGE_MAX_BASE64_SIZE,
    ),
    maxImages: positiveIntegerFromEnv(
      env,
      'MOSSEN_CODE_OPENAI_COMPAT_MAX_IMAGES',
      API_MAX_MEDIA_PER_REQUEST,
    ),
    maxTotalImageBase64Bytes: positiveIntegerFromEnv(
      env,
      'MOSSEN_CODE_OPENAI_COMPAT_MAX_TOTAL_IMAGE_BASE64_BYTES',
      DEFAULT_OPENAI_COMPAT_TOTAL_IMAGE_BASE64_BYTES,
    ),
  }
}

export function createOpenAICompatibleVisionValidationState(): OpenAICompatibleVisionValidationState {
  return {
    imageCount: 0,
    totalImageBase64Bytes: 0,
  }
}

export function validateOpenAICompatibleVisionImagePart(
  image: OpenAICompatibleVisionImagePart,
  state: OpenAICompatibleVisionValidationState,
  limits: OpenAICompatibleVisionRequestLimits = getOpenAICompatibleVisionRequestLimits(),
): OpenAICompatibleVisionValidationResult {
  const imageNumber = state.imageCount + 1
  const base64Length = image.base64Data.length
  if (!image.base64Data.trim()) {
    return {
      ok: false,
      reason:
        `OpenAI-compatible vision request rejected before network: image #${imageNumber} is empty. ` +
        'Paste or read a valid image and retry.',
    }
  }
  const mediaType = image.mediaType.trim().toLowerCase()
  if (!mediaType.startsWith('image/')) {
    return {
      ok: false,
      reason:
        `OpenAI-compatible vision request rejected before network: image #${imageNumber} has unsupported media type "${image.mediaType}". ` +
        'Use a standard image type such as PNG, JPEG, GIF, or WebP.',
    }
  }
  if (imageNumber > limits.maxImages) {
    return {
      ok: false,
      reason:
        `OpenAI-compatible vision request rejected before network: ${imageNumber} images exceed the configured limit of ${limits.maxImages}. ` +
        'Send fewer images or raise MOSSEN_CODE_OPENAI_COMPAT_MAX_IMAGES if your provider supports it.',
    }
  }
  if (base64Length > limits.maxImageBase64Bytes) {
    return {
      ok: false,
      reason:
        `OpenAI-compatible vision request rejected before network: image #${imageNumber} is ${formatFileSize(base64Length)} base64, ` +
        `above the per-image limit ${formatFileSize(limits.maxImageBase64Bytes)}. ` +
        'Resize or compress the image before sending.',
    }
  }
  const totalImageBase64Bytes = state.totalImageBase64Bytes + base64Length
  if (totalImageBase64Bytes > limits.maxTotalImageBase64Bytes) {
    return {
      ok: false,
      reason:
        `OpenAI-compatible vision request rejected before network: total image payload is ${formatFileSize(totalImageBase64Bytes)} base64, ` +
        `above the request limit ${formatFileSize(limits.maxTotalImageBase64Bytes)}. ` +
        'Send fewer images or split the request.',
    }
  }
  return {
    ok: true,
    state: {
      imageCount: imageNumber,
      totalImageBase64Bytes,
    },
  }
}

export function createOpenAICompatibleVisionRequestError(
  reason: string,
): MossenAPIError {
  return MossenAPIError.generate(
    400,
    {
      error: {
        code: 'mossen_openai_compatible_vision_validation_failed',
        message: reason,
        type: 'invalid_request_error',
      },
    },
    reason,
  )
}
