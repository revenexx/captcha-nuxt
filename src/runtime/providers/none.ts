import { defineCaptchaProvider } from '../define'
import { fail, ok } from '../result'

/**
 * No captcha: every token is valid. For local development and for forms that
 * are protected elsewhere. Refused when the server runs with NODE_ENV=production.
 */
export default defineCaptchaProvider<Record<string, never>, null>({
  name: 'none',
  meta: { consent: 'none', region: 'local', invisible: true, score: false, action: false, ui: 'none', production: false },
  client: {
    load() {},
    render() {
      return null
    },
    execute() {
      return 'none'
    },
    reset() {},
  },
  server: {
    async verify(ctx, input) {
      if (ctx.production) return fail('none', 'misconfigured', input.action)
      return ok('none', input.action)
    },
  },
})
