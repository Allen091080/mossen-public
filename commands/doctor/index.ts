import type { Command } from '../../commands.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getProductDisplayName } from '../../constants/product.js'

const doctor: Command = {
  name: 'doctor',
  description: `Diagnose and verify your ${getProductDisplayName()} installation and settings`,
  isEnabled: () => !isEnvTruthy(process.env.DISABLE_DOCTOR_COMMAND),
  type: 'local-jsx',
  load: () => import('./doctor.js'),
}

export default doctor
