import { defineCaptchaProvider } from '../define'
import { fail, ok, record } from '../result'
import type { CaptchaError } from '../types'

/**
 * Friendly Captcha v2. The browser part is the official SDK
 * (`@friendlycaptcha/sdk`, MPL-2.0), imported on demand from the shop's own
 * bundle; it talks to the EU or the global API endpoint only.
 *
 * Server: POST https://{eu|global}.frcapi.com/api/v2/captcha/siteverify with
 * `X-API-Key` and JSON `{ response, sitekey }`. A 200 does not mean valid; the
 * `success` field does, and errors arrive as `{ success: false, error: { error_code } }`.
 * https://developer.friendlycaptcha.com/docs/v2/api/siteverify
 */
export interface FriendlyProviderOptions {
  siteKey: string
  /** `'eu'` (default, EU-only processing) or `'global'`. */
  region?: 'eu' | 'global'
  /** Widget language; default `'de'`. */
  language?: string
  /** When the solver starts in visible mode: `'focus'` (default), `'auto'` or `'none'`. */
  startMode?: 'focus' | 'auto' | 'none'
  theme?: 'light' | 'dark' | 'auto'
}

interface FriendlyWidget {
  addEventListener: (type: string, listener: (event: CustomEvent<{ response?: string, error?: unknown }>) => void) => void
  start: () => void
  reset: () => void
  destroy: () => void
}
interface FriendlySdk { createWidget: (options: Record<string, unknown>) => FriendlyWidget }

const sdks = new Map<string, FriendlySdk>()

const ERRORS: Record<string, CaptchaError> = {
  auth_required: 'misconfigured',
  auth_invalid: 'misconfigured',
  sitekey_invalid: 'misconfigured',
  response_missing: 'missing',
  response_invalid: 'invalid',
  response_timeout: 'expired',
  response_duplicate: 'replayed',
  bad_request: 'invalid',
}

const regionOf = (value: unknown): 'eu' | 'global' => (value === 'global' ? 'global' : 'eu')

export default defineCaptchaProvider<FriendlyProviderOptions, FriendlyWidget>({
  name: 'friendly',
  meta: { consent: 'none', region: 'eu', invisible: false, score: false, action: false, ui: 'widget', vendor: 'friendly-captcha' },
  client: {
    async load(ctx) {
      if (!ctx.options.siteKey) throw new Error('[captcha] friendly: siteKey is required')
      const region = regionOf(ctx.options.region)
      if (!sdks.has(region)) {
        const { FriendlyCaptchaSDK } = await import('@friendlycaptcha/sdk')
        sdks.set(region, new FriendlyCaptchaSDK({ apiEndpoint: region }) as unknown as FriendlySdk)
      }
    },
    render(ctx, el, events) {
      const sdk = sdks.get(regionOf(ctx.options.region))!
      const widget = sdk.createWidget({
        element: el,
        sitekey: ctx.options.siteKey,
        apiEndpoint: regionOf(ctx.options.region),
        language: ctx.options.language ?? 'de',
        startMode: ctx.invisible ? 'none' : (ctx.options.startMode ?? 'focus'),
        theme: ctx.options.theme ?? 'auto',
        // The module writes its own hidden field, with the envelope.
        formFieldName: null,
      })
      widget.addEventListener('frc:widget.complete', event => events.solve(String(event.detail?.response ?? '')))
      widget.addEventListener('frc:widget.error', event => events.error(event.detail?.error ?? new Error('friendly: error')))
      widget.addEventListener('frc:widget.expire', () => events.expire())
      return widget
    },
    execute(widget) {
      widget.start()
    },
    reset(widget) {
      widget.reset()
    },
    destroy(widget) {
      widget.destroy()
    },
  },
  server: {
    async verify(ctx, input) {
      const apiKey = ctx.secrets.apiKey ?? ''
      if (!apiKey || !ctx.options.siteKey) return fail('friendly', 'misconfigured', input.action)
      let res: { status: number, data: unknown }
      try {
        res = await ctx.fetch(`https://${regionOf(ctx.options.region)}.frcapi.com/api/v2/captcha/siteverify`, {
          method: 'POST',
          headers: { 'X-API-Key': apiKey },
          body: { response: input.token, sitekey: ctx.options.siteKey },
          timeout: ctx.timeout,
        })
      }
      catch {
        return fail('friendly', 'provider_unavailable', input.action)
      }
      const body = record(res.data)
      // Friendly Captcha binds no action; the expected one is what it confirms.
      if (res.status === 200 && body.success === true) return ok('friendly', input.action)
      if (res.status >= 500) return fail('friendly', 'provider_unavailable', input.action)
      const code = String(record(body.error).error_code ?? '')
      if (ERRORS[code]) return fail('friendly', ERRORS[code], input.action)
      if (res.status === 401) return fail('friendly', 'misconfigured', input.action)
      return fail('friendly', 'invalid', input.action)
    },
  },
})
