import { defineCaptchaProvider } from '../define'
import { fail, ok } from '../result'

/**
 * A deterministic provider for tests: the token `pass` is valid, `fail` (and
 * anything else) is invalid. The box hands out `options.token` (default
 * `pass`). Refused when the server runs with NODE_ENV=production.
 */
export interface TestProviderOptions {
  /** The raw token the box hands out. Default `'pass'`. */
  token?: string
  /** Milliseconds the box pretends to work. Default 0. */
  delay?: number
}

export default defineCaptchaProvider<TestProviderOptions, null>({
  name: 'test',
  meta: { consent: 'none', region: 'local', invisible: true, score: false, action: false, ui: 'own', production: false },
  client: {
    load() {},
    render() {
      return null
    },
    async execute(_handle, ctx) {
      const delay = Number(ctx.options.delay ?? 0)
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      return String(ctx.options.token ?? 'pass')
    },
    reset() {},
  },
  server: {
    async verify(ctx, input) {
      if (ctx.production) return fail('test', 'misconfigured', input.action)
      if (input.token === 'pass') return ok('test', input.action)
      return fail('test', 'invalid', input.action)
    },
  },
})
