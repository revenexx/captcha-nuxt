import { defineCaptchaProvider } from '../define'
import { fail, ok, record, trimUrl } from '../result'
import type { CaptchaProviderDefinition, CaptchaWidgetEvents } from '../types'

/**
 * Cap (https://github.com/tiagozip/cap, Apache-2.0): a self-hosted
 * proof-of-work captcha. The browser part solves through Cap's documented
 * programmatic mode (https://trycap.dev/guide/programmatic),
 * `new Cap({ apiEndpoint }).solve()`, and the module draws its own accessible
 * box. Cap's `<cap-widget>` is never shown: its visible UI
 * carries a link to trycap.dev that cannot be switched off.
 *
 * The programmatic mode still creates a `<cap-widget>` element, hidden with
 * `display: none`, as the solver's host. Its shadow root holds Cap's credits
 * link; the module removes it there, and Cap only re-adds it to a visible
 * widget. All files Cap needs are fetched from the configured endpoint:
 * the solver wasm through `CAP_CUSTOM_WASM_URL` / `CAP_CUSTOM_HASHWX_URL`
 * (Cap standalone serves them with `ENABLE_ASSETS_SERVER=true`), so nothing
 * loads from a CDN.
 */
export interface CapProviderOptions {
  /** The Cap instance, e.g. `https://captcha.example.com`. */
  endpoint: string
  /** The site key created in Cap's dashboard. */
  siteKey: string
}

interface CapSolveResult { success: boolean, token: string }
interface CapInstance {
  widget: HTMLElement
  solve: () => Promise<CapSolveResult | undefined>
  reset: () => void
  addEventListener: (type: string, listener: (event: CustomEvent) => void) => void
}
type CapConstructor = new (config: Record<string, unknown>) => CapInstance

interface CapWindow {
  Cap?: CapConstructor
  CAP_CUSTOM_WASM_URL?: string
  CAP_CUSTOM_HASHWX_URL?: string
  CAP_DISABLE_WIDGET_REF?: boolean
}

export interface CapHandle {
  events: CaptchaWidgetEvents
  cap: CapInstance | null
  solved: boolean
}

let capConstructor: CapConstructor | null = null

/** Points Cap at the instance's own asset server, then imports the solver. */
export async function loadCap(endpoint: string): Promise<CapConstructor> {
  const w = window as unknown as CapWindow
  // Set before the import: Cap reads them when it first fetches its wasm.
  w.CAP_CUSTOM_WASM_URL = `${endpoint}/assets/cap_wasm_bg.wasm`
  w.CAP_CUSTOM_HASHWX_URL = `${endpoint}/assets/hashwx.wasm`
  w.CAP_DISABLE_WIDGET_REF = true
  if (!capConstructor) {
    const mod = await import('@cap.js/widget') as unknown as { default?: CapConstructor }
    // The package is CommonJS that also sets window.Cap; take whichever the bundler gives.
    capConstructor = (typeof mod.default === 'function' ? mod.default : null) ?? w.Cap ?? null
  }
  if (!capConstructor) throw new Error('[captcha] Cap could not be loaded')
  return capConstructor
}

/** Removes every link from the hidden solver host (Cap's credits and troubleshooting links). */
export function stripCapLinks(widget: HTMLElement) {
  widget.style.display = 'none'
  widget.setAttribute('aria-hidden', 'true')
  for (const link of Array.from(widget.shadowRoot?.querySelectorAll('a') ?? [])) link.remove()
}

/** Cap's siteverify answers, mapped (https://trycap.dev/guide/standalone/ and standalone/src/siteverify.js in the Cap repository). */
async function verifyCap(name: string, ctx: Parameters<CaptchaProviderDefinition<CapProviderOptions>['server']['verify']>[0], token: string, action?: string) {
  const endpoint = trimUrl(ctx.secrets.verifyEndpoint) || trimUrl(ctx.options.endpoint)
  const siteKey = String(ctx.options.siteKey ?? '').trim()
  const secret = ctx.secrets.secret ?? ''
  if (!endpoint || !siteKey || !secret) return fail(name, 'misconfigured', action)
  let res: { status: number, data: unknown }
  try {
    res = await ctx.fetch(`${endpoint}/${encodeURIComponent(siteKey)}/siteverify`, {
      method: 'POST',
      body: { secret, response: token },
      timeout: ctx.timeout,
    })
  }
  catch {
    return fail(name, 'provider_unavailable', action)
  }
  const body = record(res.data)
  // Cap binds no action to a token, so the expected action is what it confirms.
  if (res.status === 200 && body.success === true) return ok(name, action)
  if (res.status >= 500) return fail(name, 'provider_unavailable', action)
  const message = typeof body.error === 'string' ? body.error : ''
  if (/invalid site key or secret/i.test(message)) return fail(name, 'misconfigured', action)
  if (res.status === 403 && /expired/i.test(message)) return fail(name, 'expired', action)
  if (res.status === 404 || res.status === 400) return fail(name, 'invalid', action)
  if (res.status === 401 || res.status === 403) return fail(name, 'misconfigured', action)
  return fail(name, 'invalid', action)
}

export function createCapProvider(name: string, options: { brand: boolean, region: string }): CaptchaProviderDefinition<CapProviderOptions, CapHandle> {
  return defineCaptchaProvider<CapProviderOptions, CapHandle>({
    name,
    meta: { consent: 'none', region: options.region, invisible: true, score: false, action: false, ui: 'own', brand: options.brand },
    client: {
      async load(ctx) {
        const endpoint = trimUrl(ctx.options.endpoint)
        if (!endpoint || !ctx.options.siteKey) throw new Error(`[captcha] ${name}: endpoint and siteKey are required`)
        await loadCap(endpoint)
      },
      render(_ctx, _el, events) {
        return { events, cap: null, solved: false }
      },
      async execute(handle, ctx) {
        const Cap = await loadCap(trimUrl(ctx.options.endpoint))
        if (handle.cap) {
          handle.solved = false
          handle.cap.widget.remove()
        }
        const cap = new Cap({ apiEndpoint: `${trimUrl(ctx.options.endpoint)}/${encodeURIComponent(String(ctx.options.siteKey))}/` })
        stripCapLinks(cap.widget)
        handle.cap = cap
        cap.addEventListener('progress', (event) => {
          const progress = Number((event.detail as { progress?: number } | undefined)?.progress)
          if (Number.isFinite(progress)) handle.events.progress(progress)
        })
        // Cap resets its widget when the token expires.
        cap.addEventListener('reset', () => {
          if (handle.cap !== cap || !handle.solved) return
          handle.solved = false
          handle.events.expire()
        })
        const result = await cap.solve()
        if (!result?.token) throw new Error(`[captcha] ${name}: the challenge was not solved`)
        handle.solved = true
        return result.token
      },
      reset(handle) {
        handle.solved = false
        handle.cap?.widget.remove()
        handle.cap = null
      },
      destroy(handle) {
        handle.solved = false
        handle.cap?.widget.remove()
        handle.cap = null
      },
    },
    server: {
      verify: (ctx, input) => verifyCap(name, ctx, input.token, input.action),
    },
  })
}
