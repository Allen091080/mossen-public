import { formatTotalCost } from '../../cost-tracker.js'
import { getProductDisplayName } from '../../constants/product.js'
import { currentLimits } from '../../services/hostedLimits.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isHostedAuthAdapterEnabled, isHostedSubscriber } from '../../utils/auth.js'
import { getUserType } from '../../utils/userType.js'

export const call: LocalCommandCall = async () => {
  if (isHostedAuthAdapterEnabled() && isHostedSubscriber()) {
    let value: string

    if (currentLimits.isUsingOverage) {
      value =
        `You are currently using hosted overage capacity for ${getProductDisplayName()}. It will automatically switch back to your included limits when they reset.`
    } else {
      value =
        `You are currently using your included hosted limits for ${getProductDisplayName()}.`
    }

    if (getUserType() === 'internal') {
      value += `\n\n[MOSSEN INTERNAL] Showing the session estimate anyway:\n ${formatTotalCost()}`
    }
    return { type: 'text', value }
  }
  return { type: 'text', value: formatTotalCost() }
}
