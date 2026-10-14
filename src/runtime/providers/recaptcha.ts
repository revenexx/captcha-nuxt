import { defineCaptchaProvider } from '../define'
import { fail, record } from '../result'
import type { CaptchaClientContext, CaptchaError, CaptchaResult, CaptchaWidgetEvents } from '../types'

/**
 * Google reCAPTCHA v2 (checkbox and invisible) and v3 (score), the classic
 * keys verified at www.google.com. reCAPTCHA Enterprise is a different API and
 * not supported by this provider.
 *
 * v2, client: https://www.google.com/recaptcha/api.js?render=explicit, loaded
 * through @nuxt/scripts; `grecaptcha.render(el, { sitekey, theme, size,
 * callback, 'expired-callback', 'error-callback' })`, invisible with
 * `size: 'invisible'` (and `badge`) plus `grecaptcha.execute(widgetId)`,
 * `grecaptcha.reset(widgetId)`.
 * https://developers.google.com/recaptcha/docs/display
 * https://developers.google.com/recaptcha/docs/invisible
 *
 * v3, client: https://www.google.com/recaptcha/api.js?render=<siteKey>; no
 * widget, `grecaptcha.execute(siteKey, { action })` resolves with a token. A
 * token expires after two minutes. Actions may contain only letters, digits,
 * slashes and underscores.
 * https://developers.google.com/recaptcha/docs/v3
 *
 * The badge may be hidden only when the user flow visibly says "This site is
 * protected by reCAPTCHA."; Google asks to hide it with
 * `.grecaptcha-badge { visibility: hidden; }`.
 * https://developers.google.com/recaptcha/docs/faq
 *
 * Server: POST https://www.google.com/recaptcha/api/siteverify, form-encoded
 * `secret`, `response`, optional `remoteip`. The answer carries `success`,
 * `error-codes` and, for v3, `score` (0.0 to 1.0, higher is more likely human)
 * and `action`. Google's default threshold is 0.5.
 * https://developers.google.com/recaptcha/docs/verify
 */
export interface RecaptchaProviderOptions {
  siteKey: string
  /** `'v2'` (default): the checkbox, or invisible with `useCaptcha()` / `invisible`. `'v3'`: a score, no widget. */
  version?: 'v2' | 'v3'
  /** v2 checkbox: `'light'` (default) or `'dark'`. */
  theme?: 'light' | 'dark'
  /** v2 checkbox: `'normal'` (default) or `'compact'`. */
  size?: 'normal' | 'compact'
  /** v2 invisible: where the badge sits, `'bottomright'` (default), `'bottomleft'` or `'inline'`. */
  badge?: 'bottomright' | 'bottomleft' | 'inline'
  /**
   * Hide the badge (`.grecaptcha-badge { visibility: hidden; }`). Google allows
   * it only when the form visibly says the site is protected by reCAPTCHA: the
   * component then shows `labels.recaptchaNotice`; with `useCaptcha()` your page
   * has to show it.
   */
  hideBadge?: boolean
  /** Widget language (`hl`); default: the visitor's. */
  language?: string
  /** v3: refuse a score below this (0..1) as `low_score`. Default 0.5; `verifyCaptcha`'s `minScore` wins. */
  minScore?: number
}

interface RecaptchaApi {
  ready?: (cb: () => void) => void
  render?: (el: HTMLElement, options: Record<string, unknown>) => number
  execute?: ((widgetId: number) => void) & ((siteKey: string, options: { action?: string }) => Promise<string>)
  reset?: (widgetId: number) => void
}

interface RecaptchaHandle {
  version: 'v2' | 'v3'
  /** The v2 widget id (0 is a valid id). */
  id: number | null
  el: HTMLElement
  notice: HTMLElement | null
  events: CaptchaWidgetEvents
  ctx: CaptchaClientContext<RecaptchaProviderOptions>
  timer?: ReturnType<typeof setTimeout>
  alive: boolean
}

export const RECAPTCHA_SCRIPT = 'https://www.google.com/recaptcha/api.js'
export const RECAPTCHA_SITEVERIFY = 'https://www.google.com/recaptcha/api/siteverify'
export const RECAPTCHA_DEFAULT_MIN_SCORE = 0.5
/** v3 tokens expire after 120 s: a shown captcha fetches a new one before that, an invisible one reports expiry. */
export const RECAPTCHA_V3_REFRESH_MS = 90_000
export const RECAPTCHA_V3_EXPIRY_MS = 110_000
const READY_TIMEOUT = 10_000
const BADGE_STYLE_ID = 'rvx-captcha-recaptcha-badge'

const ERRORS: Record<string, CaptchaError> = {
  'missing-input-secret': 'misconfigured',
  'invalid-input-secret': 'misconfigured',
  'timeout-or-duplicate': 'expired',
  'missing-input-response': 'invalid',
  'invalid-input-response': 'invalid',
  'bad-request': 'invalid',
}

type RecaptchaWindow = { grecaptcha?: RecaptchaApi, ___grecaptcha_cfg?: { fns?: Array<() => void> } }
const win = () => window as unknown as RecaptchaWindow
const api = () => win().grecaptcha

export const versionOf = (value: unknown): 'v2' | 'v3' => (value === 'v3' ? 'v3' : 'v2')

/** The script for a version: explicit rendering for v2, the site key for v3. */
export function recaptchaScript(options: Pick<RecaptchaProviderOptions, 'siteKey' | 'version' | 'language'>): string {
  const params = new URLSearchParams({ render: versionOf(options.version) === 'v3' ? options.siteKey : 'explicit' })
  if (options.language) params.set('hl', options.language)
  return `${RECAPTCHA_SCRIPT}?${params.toString()}`
}

function hideBadge() {
  if (document.getElementById(BADGE_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = BADGE_STYLE_ID
  style.textContent = '.grecaptcha-badge { visibility: hidden; }'
  document.head.appendChild(style)
}

/** The container `useCaptcha()` renders into: no notice there, the page owns it. */
const isHeadless = (el: HTMLElement) => el.hasAttribute('data-captcha-headless')

function clearTimer(handle: RecaptchaHandle) {
  if (handle.timer !== undefined) clearTimeout(handle.timer)
  handle.timer = undefined
}

/** v3: a new token from Google. */
async function token(handle: RecaptchaHandle, ctx: CaptchaClientContext<RecaptchaProviderOptions>): Promise<string> {
  const raw = await api()!.execute!(ctx.options.siteKey, { action: ctx.action ?? 'submit' })
  if (typeof raw !== 'string' || !raw) throw new Error('[captcha] recaptcha: no token')
  schedule(handle)
  return raw
}

/** v3: shown, the token is renewed before it expires; invisible, its expiry is reported. */
function schedule(handle: RecaptchaHandle) {
  clearTimer(handle)
  if (!handle.alive) return
  if (handle.ctx.invisible) {
    handle.timer = setTimeout(() => handle.alive && handle.events.expire(), RECAPTCHA_V3_EXPIRY_MS)
  }
  else {
    handle.timer = setTimeout(() => refresh(handle), RECAPTCHA_V3_REFRESH_MS)
  }
}

function refresh(handle: RecaptchaHandle) {
  if (!handle.alive) return
  token(handle, handle.ctx).then(
    raw => handle.alive && handle.events.solve(raw),
    error => handle.alive && handle.events.error(error),
  )
}

export default defineCaptchaProvider<RecaptchaProviderOptions, RecaptchaHandle>({
  name: 'recaptcha',
  meta: { consent: 'required', region: 'us', invisible: true, score: true, action: true, ui: 'widget', vendor: 'google-recaptcha' },
  client: {
    async load(ctx) {
      if (!ctx.options.siteKey) throw new Error('[captcha] recaptcha: siteKey is required')
      const v3 = versionOf(ctx.options.version) === 'v3'
      if (ctx.options.hideBadge) hideBadge()
      // The queue api.js works through once it is ready, as @nuxt/scripts' registry entry sets it up.
      const w = win()
      w.grecaptcha = w.grecaptcha || {}
      w.grecaptcha.ready = w.grecaptcha.ready || ((cb: () => void) => {
        const cfg = (w.___grecaptcha_cfg = w.___grecaptcha_cfg || {})
        cfg.fns = [...(cfg.fns || []), cb]
      })
      await ctx.loadScript(recaptchaScript(ctx.options), { key: v3 ? 'google-recaptcha-v3' : 'google-recaptcha', use: api })
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        new Promise<void>(resolve => api()!.ready!(resolve)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('[captcha] recaptcha: the script did not get ready')), READY_TIMEOUT)
        }),
      ]).finally(() => clearTimeout(timer))
      if (typeof api()?.execute !== 'function' || (!v3 && typeof api()?.render !== 'function')) {
        throw new Error('[captcha] recaptcha: the script did not load')
      }
    },
    render(ctx, el, events) {
      const version = versionOf(ctx.options.version)
      const handle: RecaptchaHandle = { version, id: null, el, notice: null, events, ctx, alive: true }
      // Google's terms: without a visible badge the form has to say it is protected by reCAPTCHA.
      const needsNotice = version === 'v3' || (ctx.invisible && ctx.options.hideBadge === true)
      if (needsNotice && !isHeadless(el)) {
        const notice = document.createElement('p')
        notice.className = 'rvx-captcha__notice rvx-captcha__recaptcha-notice'
        notice.setAttribute('data-captcha-recaptcha-notice', '')
        notice.textContent = ctx.labels.recaptchaNotice
        el.appendChild(notice)
        handle.notice = notice
      }
      if (version === 'v3') {
        // Shown on the page, the captcha holds a token at all times; invisible, it asks on execute().
        if (!ctx.invisible) refresh(handle)
        return handle
      }
      const host = document.createElement('div')
      el.appendChild(host)
      const params: Record<string, unknown> = {
        'sitekey': ctx.options.siteKey,
        'size': ctx.invisible ? 'invisible' : (ctx.options.size ?? 'normal'),
        'callback': (raw: string) => events.solve(raw),
        'expired-callback': () => events.expire(),
        'error-callback': () => events.error(new Error('recaptcha: error')),
      }
      if (ctx.options.theme) params.theme = ctx.options.theme
      if (ctx.invisible) params.badge = ctx.options.badge ?? 'bottomright'
      const id = api()!.render!(host, params)
      if (typeof id !== 'number') throw new Error('[captcha] recaptcha: render failed')
      handle.id = id
      return handle
    },
    execute(handle, ctx) {
      if (handle.version === 'v3') return token(handle, ctx)
      if (handle.id !== null) api()?.execute!(handle.id)
    },
    reset(handle) {
      clearTimer(handle)
      if (handle.version === 'v3') {
        if (!handle.ctx.invisible) refresh(handle)
        return
      }
      if (handle.id !== null) api()?.reset?.(handle.id)
    },
    destroy(handle) {
      handle.alive = false
      clearTimer(handle)
      handle.notice?.remove()
      // reCAPTCHA has no remove(); the widget goes with its container.
      handle.el.replaceChildren()
    },
  },
  server: {
    async verify(ctx, input) {
      const secret = ctx.secrets.secret ?? ''
      if (!secret) return fail('recaptcha', 'misconfigured', input.action)
      const body: Record<string, string> = { secret, response: input.token }
      if (input.remoteip) body.remoteip = input.remoteip
      let res: { status: number, data: unknown }
      try {
        res = await ctx.fetch(RECAPTCHA_SITEVERIFY, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          timeout: ctx.timeout,
        })
      }
      catch {
        return fail('recaptcha', 'provider_unavailable', input.action)
      }
      if (res.status >= 500) return fail('recaptcha', 'provider_unavailable', input.action)
      const data = record(res.data)
      // v3 answers with the action the token was made for and a score; v2 with neither.
      const action = typeof data.action === 'string' && data.action ? data.action : undefined
      const score = typeof data.score === 'number' && Number.isFinite(data.score) ? data.score : undefined
      if (data.success !== true) {
        const codes = Array.isArray(data['error-codes']) ? (data['error-codes'] as unknown[]).map(String) : []
        const errors = [...new Set(codes.map(code => ERRORS[code] ?? 'invalid'))]
        return fail('recaptcha', errors.length ? errors : ['invalid'], action ?? input.action)
      }
      const errors: CaptchaError[] = []
      if (input.action && action !== undefined && action !== input.action) errors.push('action_mismatch')
      if (score !== undefined) {
        const configured = Number(ctx.options.minScore)
        const threshold = input.minScore ?? (ctx.options.minScore !== undefined && Number.isFinite(configured) ? configured : RECAPTCHA_DEFAULT_MIN_SCORE)
        if (score < threshold) errors.push('low_score')
      }
      const result: CaptchaResult = { success: errors.length === 0, provider: 'recaptcha', errors }
      const confirmed = action ?? input.action
      if (confirmed !== undefined) result.action = confirmed
      if (score !== undefined) result.score = score
      return result
    },
  },
})
