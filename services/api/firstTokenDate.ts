import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { isCustomBackendEnabled } from '../../utils/customBackend.js'
import { getAuthHeaders } from '../../utils/http.js'
import { logError } from '../../utils/log.js'
import { getMossenUserAgent } from '../../utils/userAgent.js'

/**
 * Fetch the user's first hosted-usage token date and store it in config.
 * In custom backend mode this remains a no-op because hosted usage metadata
 * is not fetched from first-party services.
 */
export async function fetchAndStoreMossenFirstTokenDate(): Promise<void> {
  if (isCustomBackendEnabled()) {
    return
  }
  try {
    const config = getGlobalConfig()

    if (config.mossenFirstTokenDate !== undefined) {
      return
    }

    const authHeaders = getAuthHeaders()
    if (authHeaders.error) {
      logError(new Error(`Failed to get auth headers: ${authHeaders.error}`))
      return
    }

    const oauthConfig = getOauthConfig()
    const url = `${oauthConfig.BASE_API_URL}/api/organization/mossen_first_token_date`

    const response = await axios.get(url, {
      headers: {
        ...authHeaders.headers,
        'User-Agent': getMossenUserAgent(),
      },
      timeout: 10000,
    })

    const firstTokenDate = response.data?.first_token_date ?? null

    // Validate the date if it's not null
    if (firstTokenDate !== null) {
      const dateTime = new Date(firstTokenDate).getTime()
      if (isNaN(dateTime)) {
        logError(
          new Error(
            `Received invalid first_token_date from API: ${firstTokenDate}`,
          ),
        )
        // Don't save invalid dates
        return
      }
    }

    saveGlobalConfig(current => ({
      ...current,
      mossenFirstTokenDate: firstTokenDate,
    }))
  } catch (error) {
    logError(error)
  }
}
