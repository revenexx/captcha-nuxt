import { defineCaptchaProvider } from '../define'
import { fail, ok, record } from '../result'
import type { CaptchaError } from '../types'

/**
 * Cloudflare Turnstile, rendered explicitly.
 *
 * Client: https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit,
 * loaded through @nuxt/scripts; `turnstile.render(el, { sitekey, action, execution })`,
 * `turnstile.execute`, `turnstile.reset`, `turnstile.remove`.
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 *
 * Server: POST https://challenges.cloudflare.com/turnstile/v0/siteverify with
 * `secret`, `response`, optional `remoteip` and `idempotency_key`. The answer
 * carries `success`, `action` and `error-codes`. A token is valid for 300 s and once.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export interface TurnstileProviderOptions {
  siteKey: string
  theme?: 'auto' | 'light' | 'dark'
  size?: 'normal' | 'flexible' | 'compact'
  /** Widget language; default `'auto'`. */
  language?: string
}

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string | undefined
  execute: (id: string) => void
  reset: (id: string) => void
  remove: (id: string) => void
}

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
export const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const ERRORS: Record<string, CaptchaError> = {
  'missing-input-secret': 'misconfigured',
  'invalid-input-secret': 'misconfigured',
  'missing-input-response': 'missing',
  'invalid-input-response': 'invalid',
  'timeout-or-duplicate': 'expired',
  'bad-request': 'invalid',
  'internal-error': 'provider_unavailable',
}

const api = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile

export default defineCaptchaProvider<TurnstileProviderOptions, { id: string }>({
  name: 'turnstile',
  meta: { consent: 'required', region: 'global', invisible: true, score: false, action: true, ui: 'widget', vendor: 'cloudflare-turnstile' },
  client: {
    async load(ctx) {
      if (!ctx.options.siteKey) throw new Error('[captcha] turnstile: siteKey is required')
      if (api()) return
      await ctx.loadScript(TURNSTILE_SCRIPT, { key: 'cloudflare-turnstile', use: api })
      if (!api()) throw new Error('[captcha] turnstile: the script did not load')
    },
    render(ctx, el, events) {
      const id = api()!.render(el, {
        'sitekey': ctx.options.siteKey,
        'action': ctx.action,
        'execution': ctx.invisible ? 'execute' : 'render',
        'appearance': ctx.invisible ? 'interaction-only' : 'always',
        'theme': ctx.options.theme ?? 'auto',
        'size': ctx.options.size ?? 'normal',
        'language': ctx.options.language ?? 'auto',
        'response-field': false,
        'callback': (token: string) => events.solve(token),
        'error-callback': (code: string) => {
          events.error(new Error(`turnstile: ${code}`))
          return true
        },
        'expired-callback': () => events.expire(),
        'timeout-callback': () => events.expire(),
      })
      if (!id) throw new Error('[captcha] turnstile: render failed')
      return { id }
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
      if (!secret) return fail('turnstile', 'misconfigured', input.action)
      const body: Record<string, unknown> = { secret, response: input.token, idempotency_key: crypto.randomUUID() }
      if (input.remoteip) body.remoteip = input.remoteip
      let res: { status: number, data: unknown }
      try {
        res = await ctx.fetch(TURNSTILE_SITEVERIFY, { method: 'POST', body, timeout: ctx.timeout })
      }
      catch {
        return fail('turnstile', 'provider_unavailable', input.action)
      }
      if (res.status >= 500) return fail('turnstile', 'provider_unavailable', input.action)
      const data = record(res.data)
      const action = typeof data.action === 'string' ? data.action : undefined
      if (data.success === true) {
        // Turnstile binds the action the widget was rendered with; another one is refused.
        if (input.action && action !== input.action) return fail('turnstile', 'action_mismatch', action)
        return ok('turnstile', action ?? input.action)
      }
      const codes = Array.isArray(data['error-codes']) ? (data['error-codes'] as unknown[]).map(String) : []
      const errors = [...new Set(codes.map(code => ERRORS[code] ?? 'invalid'))]
      return fail('turnstile', errors.length ? errors : ['invalid'], action ?? input.action)
    },
  },
})
