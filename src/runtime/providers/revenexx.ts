import { createCapProvider } from './cap-core'

/**
 * RevenexxCaptcha: Cap, operated by revenexx at https://captcha.revenexx.com.
 * The same provider as `cap` with the revenexx endpoint and the brand line.
 */
export default createCapProvider('revenexx', { brand: true, region: 'eu' })
