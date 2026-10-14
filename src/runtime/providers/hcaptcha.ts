import { defineCaptchaProvider } from '../define'
import { fail, ok, record } from '../result'
import type { CaptchaError } from '../types'

/**
 * hCaptcha, rendered explicitly.
 *
 * Client: https://js.hcaptcha.com/1/api.js?render=explicit, loaded through
 * @nuxt/scripts, with `onload` (hCaptcha asks not to call `render` before it
 * fired) and `recaptchacompat=off` (no `window.grecaptcha` shim that would
 * collide with the recaptcha provider). `hcaptcha.render(el, params)`,
 * `hcaptcha.execute(id)` for `size: 'invisible'`, `hcaptcha.reset(id)`,
 * `hcaptcha.remove(id)`.
 * https://docs.hcaptcha.com/configuration
 * https://docs.hcaptcha.com/invisible
 *
 * Server: POST https://api.hcaptcha.com/siteverify, form-encoded `secret`,
 * `response`, optional `remoteip` and `sitekey`. The answer carries `success`,
 * `error-codes` and, on hCaptcha Enterprise only, `score` ("a score denoting
 * malicious activity", so higher means more likely a bot). A token is valid for
 * 120 s and once.
 * https://docs.hcaptcha.com/ ("Verify the User Response Server Side")
 */
export interface HcaptchaProviderOptions {
  siteKey: string
  theme?: 'light' | 'dark'
  size?: 'normal' | 'compact'
  /** Widget language (`hl`); default: the visitor's. */
  language?: string
}

interface HcaptchaApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string | undefined
  execute: (id: string) => void
  reset: (id: string) => void
  remove: (id: string) => void
}

/** The global the script calls once it is ready (`onload`). */
export const HCAPTCHA_ONLOAD = '__rvxCaptchaHcaptchaOnload'
export const HCAPTCHA_SCRIPT = `https://js.hcaptcha.com/1/api.js?render=explicit&recaptchacompat=off&onload=${HCAPTCHA_ONLOAD}`
export const HCAPTCHA_SITEVERIFY = 'https://api.hcaptcha.com/siteverify'
/** How long the script may take after it loaded until it reports ready. */
const READY_TIMEOUT = 10_000

const ERRORS: Record<string, CaptchaError> = {
  'missing-input-secret': 'misconfigured',
  'invalid-input-secret': 'misconfigured',
  'sitekey-secret-mismatch': 'misconfigured',
  'not-using-dummy-passcode': 'misconfigured',
  'expired-input-response': 'expired',
  'already-seen-response': 'replayed',
  'missing-input-response': 'invalid',
  'invalid-input-response': 'invalid',
  'bad-request': 'invalid',
}

type HcaptchaWindow = Record<string, unknown> & { hcaptcha?: HcaptchaApi }
const win = () => window as unknown as HcaptchaWindow
const api = () => win().hcaptcha

let ready: Promise<void> | null = null
let isReady = false

export default defineCaptchaProvider<HcaptchaProviderOptions, { id: string }>({
  name: 'hcaptcha',
  meta: { consent: 'required', region: 'us', invisible: true, score: false, action: false, ui: 'widget', vendor: 'hcaptcha' },
  client: {
    async load(ctx) {
      if (!ctx.options.siteKey) throw new Error('[captcha] hcaptcha: siteKey is required')
      if (isReady && api()) return
      ready ||= new Promise<void>((resolve) => {
        win()[HCAPTCHA_ONLOAD] = () => {
          isReady = true
          resolve()
        }
      })
      try {
        await ctx.loadScript(HCAPTCHA_SCRIPT, { key: 'hcaptcha', use: api })
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          ready,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('[captcha] hcaptcha: the script did not get ready')), READY_TIMEOUT)
          }),
        ]).finally(() => clearTimeout(timer))
      }
      catch (error) {
        if (!isReady) ready = null
        throw error
      }
      if (!api()) throw new Error('[captcha] hcaptcha: the script did not load')
    },
    render(ctx, el, events) {
      const params: Record<string, unknown> = {
        'sitekey': ctx.options.siteKey,
        'size': ctx.invisible ? 'invisible' : (ctx.options.size ?? 'normal'),
        'callback': (token: string) => events.solve(token),
        'expired-callback': () => events.expire(),
        'chalexpired-callback': () => events.error(new Error('hcaptcha: challenge-expired')),
        'error-callback': (code: unknown) => events.error(new Error(`hcaptcha: ${String(code)}`)),
      }
      // Closing the challenge of an invisible run ends that run; the visible checkbox simply stays unticked.
      if (ctx.invisible) params['close-callback'] = () => events.error(new Error('hcaptcha: challenge-closed'))
      if (ctx.options.theme) params.theme = ctx.options.theme
      if (ctx.options.language) params.hl = ctx.options.language
      const id = api()!.render(el, params)
      if (id === undefined || id === null) throw new Error('[captcha] hcaptcha: render failed')
      return { id: String(id) }
    },
    execute(handle) {
      api()?.execute(handle.id)
    },
    reset(handle) {
      api()?.reset(handle.id)
    },
    destroy(handle) {
      api()?.remove(handle.id)
    },
  },
  server: {
    async verify(ctx, input) {
      const secret = ctx.secrets.secret ?? ''
      if (!secret) return fail('hcaptcha', 'misconfigured', input.action)
      const body: Record<string, string> = { secret, response: input.token }
      if (input.remoteip) body.remoteip = input.remoteip
      if (ctx.options.siteKey) body.sitekey = ctx.options.siteKey
      let res: { status: number, data: unknown }
      try {
        res = await ctx.fetch(HCAPTCHA_SITEVERIFY, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          timeout: ctx.timeout,
        })
      }
      catch {
        return fail('hcaptcha', 'provider_unavailable', input.action)
      }
      if (res.status >= 500) return fail('hcaptcha', 'provider_unavailable', input.action)
      const data = record(res.data)
      if (data.success === true) {
        // hCaptcha binds no action; the expected one is what it confirms. The
        // Enterprise score rates malicious activity, CaptchaResult.score rates
        // how human a visitor is, so it is reported inverted.
        const raw = typeof data.score === 'number' && Number.isFinite(data.score) ? data.score : undefined
        return ok('hcaptcha', input.action, raw === undefined ? undefined : Math.min(1, Math.max(0, 1 - raw)))
      }
      const codes = Array.isArray(data['error-codes']) ? (data['error-codes'] as unknown[]).map(String) : []
      const errors = [...new Set(codes.map(code => ERRORS[code] ?? 'invalid'))]
      return fail('hcaptcha', errors.length ? errors : ['invalid'], input.action)
    },
  },
})
