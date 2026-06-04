import { MODEL_ALIASES } from './aliases.js'
import { isModelAllowed } from './modelAllowlist.js'
import { getCanonicalName } from './model.js'
import { getAPIProvider } from './providers.js'
import { isCustomBackendEnabled } from '../customBackend.js'
import { sideQuery } from '../sideQuery.js'
import {
  MossenAPIConnectionError,
  MossenAPIError,
} from 'src/services/api/mossenSdk.js'
import { getModelStrings } from './modelStrings.js'

// Cache valid models to avoid repeated API calls
const validModelCache = new Map<string, boolean>()

/**
 * Validates a model by attempting an actual API call.
 */
export async function validateModel(
  model: string,
): Promise<{ valid: boolean; error?: string }> {
  const normalizedModel = model.trim()

  // Empty model is invalid
  if (!normalizedModel) {
    return { valid: false, error: 'Model name cannot be empty' }
  }

  // Check against availableModels allowlist before any API call
  if (!isModelAllowed(normalizedModel)) {
    return {
      valid: false,
      error: `Model '${normalizedModel}' is not in the list of available models`,
    }
  }

  // Check if it's a known alias (these are always valid)
  const lowerModel = normalizedModel.toLowerCase()
  if ((MODEL_ALIASES as readonly string[]).includes(lowerModel)) {
    return { valid: true }
  }

  // Check if it matches MOSSEN_CODE_CUSTOM_MODEL_OPTION (pre-validated by the user)
  if (normalizedModel === process.env.MOSSEN_CODE_CUSTOM_MODEL_OPTION) {
    return { valid: true }
  }

  // Check cache first
  if (validModelCache.has(normalizedModel)) {
    return { valid: true }
  }

  // Try to make an actual API call with minimal parameters
  try {
    await sideQuery({
      model: normalizedModel,
      max_tokens: 1,
      maxRetries: 0,
      querySource: 'model_validation',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Hi',
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    })

    // If we got here, the model is valid
    validModelCache.set(normalizedModel, true)
    return { valid: true }
  } catch (error) {
    return handleValidationError(error, normalizedModel)
  }
}

function handleValidationError(
  error: unknown,
  modelName: string,
): { valid: boolean; error: string } {
  // 404 means the model doesn't exist
  if (error instanceof MossenAPIError && error.status === 404) {
    const fallback = get3PFallbackSuggestion(modelName)
    const suggestion = fallback ? `. Try '${fallback}' instead` : ''
    return {
      valid: false,
      error: `Model '${modelName}' not found${suggestion}`,
    }
  }

  if (error instanceof MossenAPIConnectionError) {
    return {
      valid: false,
      error: 'Network error. Please check your internet connection.',
    }
  }

  // For other API errors, provide context-specific messages
  if (error instanceof MossenAPIError) {
    if (error.status === 401) {
      return {
        valid: false,
        error: 'Authentication failed. Please check your API credentials.',
      }
    }

    // Check error body for model-specific errors
    const errorBody = error.body as unknown
    if (
      errorBody &&
      typeof errorBody === 'object' &&
      'type' in errorBody &&
      errorBody.type === 'not_found_error' &&
      'message' in errorBody &&
      typeof errorBody.message === 'string' &&
      errorBody.message.includes('model:')
    ) {
      return { valid: false, error: `Model '${modelName}' not found` }
    }

    // Generic API error
    return { valid: false, error: `API error: ${error.message}` }
  }

  // For unknown errors, be safe and reject
  const errorMessage = error instanceof Error ? error.message : String(error)
  return {
    valid: false,
    error: `Unable to validate model: ${errorMessage}`,
  }
}

// @[MODEL LAUNCH]: Add a fallback suggestion chain for the new model → previous version
/**
 * Suggest a fallback model for 3P users when the selected model is unavailable.
 */
function get3PFallbackSuggestion(model: string): string | undefined {
  if (!isCustomBackendEnabled() && getAPIProvider() === 'firstParty') {
    return undefined
  }
  const canonicalModel = getCanonicalName(
    model.toLowerCase().replaceAll('_', '-'),
  )
  if (canonicalModel.includes('mossen-opus-4-6')) {
    return getModelStrings().opus41
  }
  if (canonicalModel.includes('mossen-sonnet-4-6')) {
    return getModelStrings().sonnet45
  }
  if (canonicalModel.includes('mossen-sonnet-4-5')) {
    return getModelStrings().sonnet40
  }
  return undefined
}
