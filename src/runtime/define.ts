import type { CaptchaProviderDefinition } from './types'

/**
 * Declares a captcha provider. The built-in providers use it too, so a custom
 * provider has exactly their capabilities:
 *
 *   export default defineCaptchaProvider<{ siteKey: string }>({
 *     name: 'my-provider',
 *     meta: { consent: 'none', region: 'eu', invisible: false, score: false, action: false },
 *     client: { load, render, execute, reset },
 *     server: { verify },
 *   })
 *
 * Client code runs only in the browser; load SDKs with a dynamic `import()`
 * inside `client.load` so the server never evaluates them.
 */
export function defineCaptchaProvider<Options = Record<string, unknown>, Handle = unknown>(
  definition: CaptchaProviderDefinition<Options, Handle>,
): CaptchaProviderDefinition<Options, Handle> {
  return definition
}
