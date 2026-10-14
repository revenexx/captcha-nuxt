import { createCapProvider } from './cap-core'

/**
 * RevenexxCaptcha: Cap, operated by revenexx at https://captcha.revenexx.com.
 * The same provider as `cap` with the revenexx endpoint. The box carries no
 * brand line: it belongs to the shop, not to the service behind it.
 */
export default createCapProvider('revenexx', { brand: false, region: 'eu' })
