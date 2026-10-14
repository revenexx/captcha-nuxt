/**
 * The captcha on the page, independent of Nuxt: which provider runs (consent
 * and fallback), loading, rendering, solving and the token envelope. The
 * component and `useCaptcha()` are thin layers over it, so the logic is tested
 * without a Nuxt app.
 */
import { computed, ref, shallowRef } from 'vue'
import type { InjectionKey } from 'vue'
import { buildToken } from './envelope'
import { resolveLabels } from './labels'
import type {
  AnyCaptchaProvider, CaptchaClientContext, CaptchaConsentSeam, CaptchaLabels, CaptchaPublicConfig, CaptchaState, CaptchaWidgetEvents,
} from './types'

export interface ScriptRequest {
  key?: string
  use?: () => unknown
  /** Set for providers with `meta.consent: 'required'`: gate the script on this vendor. */
  consent?: { vendor: string, purpose?: string }
}

/** What the Nuxt plugin provides to the component and the composable. */
export interface CaptchaRuntime {
  registry: Record<string, AnyCaptchaProvider>
  config: () => CaptchaPublicConfig
  /**
   * The consent seam. `null` when @revenexx/consent-manager-nuxt is not
   * installed: providers then load directly and the theme owns consent.
   */
  consent: () => CaptchaConsentSeam | null
  loadScript: (src: string, request: ScriptRequest) => Promise<unknown>
}

export const CAPTCHA_RUNTIME: InjectionKey<CaptchaRuntime> = Symbol.for('revenexx-captcha-runtime')

export type SelectionReason = 'configured' | 'consent' | 'failed' | 'unknown'
export interface Selection {
  /** The provider that runs, or `null` when none may. */
  name: string | null
  /** Why: the configured provider, or the fallback because of missing consent, a failed load or an unknown name. */
  reason: SelectionReason
}

/** The consent vendor and purpose a provider is gated on. */
export function consentTarget(name: string, definition: AnyCaptchaProvider, config: CaptchaPublicConfig): { vendor: string, purpose?: string } {
  const options = config.providers?.[name] ?? {}
  const vendor = typeof options.consentVendor === 'string' && options.consentVendor ? options.consentVendor : definition.meta.vendor ?? name
  const purpose = typeof options.consentPurpose === 'string' && options.consentPurpose ? options.consentPurpose : definition.meta.purpose
  return purpose ? { vendor, purpose } : { vendor }
}

/** Whether a provider has to wait for consent it does not have. */
export function lacksConsent(name: string, definition: AnyCaptchaProvider, config: CaptchaPublicConfig, consent: CaptchaConsentSeam | null): boolean {
  if (definition.meta.consent !== 'required' || !consent) return false
  const { vendor, purpose } = consentTarget(name, definition, config)
  try {
    return !consent.allows(vendor, purpose)
  }
  catch {
    return true
  }
}

/** Picks the provider: the requested one, else the fallback when consent is missing or the name is unknown. */
export function selectProvider(requested: string, config: CaptchaPublicConfig, registry: Record<string, AnyCaptchaProvider>, consent: CaptchaConsentSeam | null): Selection {
  const fallback = config.fallback && registry[config.fallback] && config.fallback !== requested ? config.fallback : null
  const definition = registry[requested]
  if (!definition) return { name: fallback, reason: 'unknown' }
  if (lacksConsent(requested, definition, config, consent)) {
    if (fallback && !lacksConsent(fallback, registry[fallback]!, config, consent)) return { name: fallback, reason: 'consent' }
    return { name: null, reason: 'consent' }
  }
  return { name: requested, reason: 'configured' }
}

export interface ControllerOptions {
  action?: string
  /** A provider other than the configured one. */
  provider?: string
  invisible?: boolean
  onSolve?: (token: string) => void
  onError?: (error: unknown) => void
  onExpire?: () => void
  onReset?: () => void
}

export function createCaptchaController(runtime: CaptchaRuntime, options: ControllerOptions = {}) {
  const config = () => runtime.config()
  const requested = () => options.provider || config().provider
  const labels = computed<CaptchaLabels>(() => resolveLabels(config().labels))

  const selection = shallowRef<Selection>(selectProvider(requested(), config(), runtime.registry, runtime.consent()))
  const state = ref<CaptchaState>('idle')
  const token = ref('')
  const progress = ref(0)
  const lastError = shallowRef<unknown>(null)
  const provider = computed(() => selection.value.name ?? '')
  const definition = computed(() => (selection.value.name ? runtime.registry[selection.value.name] ?? null : null))
  const ui = computed(() => definition.value?.meta.ui ?? 'widget')
  const brand = computed(() => definition.value?.meta.brand === true)
  /** No provider may run: consent is missing and there is no fallback, or nothing could load. */
  const unavailable = ref(false)

  let target: HTMLElement | null = null
  let headless: HTMLElement | null = null
  let handle: unknown = null
  let mounted: Promise<void> | null = null
  let generation = 0
  let pending: { resolve: (token: string) => void, reject: (error: unknown) => void } | null = null

  function context(name: string): CaptchaClientContext<Record<string, unknown>> {
    const definitionOf = runtime.registry[name]!
    const gated = definitionOf.meta.consent === 'required' && runtime.consent()
    return {
      name,
      options: config().providers?.[name] ?? {},
      action: options.action,
      invisible: options.invisible === true,
      labels: labels.value,
      loadScript: (src, request = {}) => runtime.loadScript(src, {
        ...request,
        consent: gated ? consentTarget(name, definitionOf, config()) : undefined,
      }) as Promise<never>,
    }
  }

  function events(gen: number, name: string): CaptchaWidgetEvents {
    const current = () => gen === generation
    return {
      solve(raw) {
        if (!current() || !raw) return
        token.value = buildToken(name, raw)
        state.value = 'done'
        progress.value = 100
        lastError.value = null
        pending?.resolve(token.value)
        pending = null
        options.onSolve?.(token.value)
      },
      error(error) {
        if (!current()) return
        token.value = ''
        state.value = 'error'
        lastError.value = error
        pending?.reject(error)
        pending = null
        options.onError?.(error)
      },
      expire() {
        if (!current()) return
        token.value = ''
        state.value = 'expired'
        progress.value = 0
        options.onExpire?.()
      },
      progress(percent) {
        if (!current()) return
        progress.value = Math.max(0, Math.min(100, Math.round(percent)))
      },
    }
  }

  function ensureHeadlessTarget(): HTMLElement {
    if (headless) return headless
    headless = document.createElement('div')
    headless.className = 'rvx-captcha-headless'
    headless.setAttribute('data-captcha-headless', '')
    document.body.appendChild(headless)
    return headless
  }

  function teardown() {
    generation++
    const def = definition.value
    if (def && handle !== null && handle !== undefined) {
      try {
        def.client.destroy?.(handle)
      }
      catch { /* the provider is gone already */ }
    }
    handle = null
  }

  async function load(name: string) {
    const gen = ++generation
    const def = runtime.registry[name]!
    const ctx = context(name)
    await def.client.load(ctx)
    if (gen !== generation) return
    const el = target ?? (def.meta.ui === 'widget' ? ensureHeadlessTarget() : document.createElement('div'))
    const rendered = await def.client.render(ctx, el, events(gen, name))
    if (gen !== generation) {
      def.client.destroy?.(rendered)
      return
    }
    handle = rendered
  }

  async function start(): Promise<void> {
    const name = selection.value.name
    if (!name) {
      unavailable.value = true
      return
    }
    try {
      await load(name)
    }
    catch (error) {
      // The provider's script or SDK failed: switch to the fallback once.
      let failure = error
      const fallback = config().fallback
      if (fallback && fallback !== name && runtime.registry[fallback]) {
        teardown()
        selection.value = { name: fallback, reason: 'failed' }
        try {
          await load(fallback)
          return
        }
        catch (again) {
          failure = again
        }
      }
      unavailable.value = true
      state.value = 'error'
      lastError.value = failure
      options.onError?.(failure)
      return
    }
    // A provider without UI solves at once.
    if (ui.value === 'none') await run().catch(() => {})
  }

  /** Loads and renders the provider into `el` (the component) or, headless, into a container of its own. */
  function mount(el?: HTMLElement | null): Promise<void> {
    if (el !== undefined) target = el
    mounted = start()
    return mounted
  }

  /** Runs the challenge and resolves with the enveloped token. */
  async function execute(): Promise<string> {
    if (state.value === 'done' && token.value) return token.value
    if (!mounted) mount()
    await mounted
    return run()
  }

  async function run(): Promise<string> {
    if (state.value === 'done' && token.value) return token.value
    const name = selection.value.name
    const def = definition.value
    if (!name || !def || unavailable.value) throw new Error('[captcha] no captcha provider is available')
    if (pending) {
      return new Promise((resolve, reject) => {
        const previous = pending!
        pending = {
          resolve: (t) => { previous.resolve(t); resolve(t) },
          reject: (e) => { previous.reject(e); reject(e) },
        }
      })
    }
    const result = new Promise<string>((resolve, reject) => { pending = { resolve, reject } })
    state.value = 'verifying'
    progress.value = 0
    const gen = generation
    const report = events(gen, name)
    try {
      const raw = def.client.execute ? await def.client.execute(handle, context(name)) : undefined
      if (typeof raw === 'string' && raw) report.solve(raw)
    }
    catch (error) {
      report.error(error)
    }
    return result
  }

  function reset() {
    const def = definition.value
    const name = selection.value.name
    pending?.reject(new Error('[captcha] reset'))
    pending = null
    token.value = ''
    state.value = 'idle'
    progress.value = 0
    lastError.value = null
    if (def && name && handle !== null && handle !== undefined) {
      try {
        def.client.reset(handle, context(name))
      }
      catch { /* nothing to reset */ }
    }
    options.onReset?.()
  }

  // Consent can change while the page is open: a granted vendor replaces the
  // fallback (if nothing was solved yet), a withdrawn one is replaced by it.
  const seam = runtime.consent()
  const unsubscribe = seam?.onChange?.(() => {
    const next = selectProvider(requested(), config(), runtime.registry, runtime.consent())
    if (next.name === selection.value.name || state.value === 'done') return
    teardown()
    selection.value = next
    unavailable.value = false
    state.value = 'idle'
    token.value = ''
    if (mounted) mount()
  })

  function destroy() {
    unsubscribe?.()
    pending?.reject(new Error('[captcha] destroyed'))
    pending = null
    teardown()
    headless?.remove()
    headless = null
    mounted = null
  }

  return {
    state,
    token,
    progress,
    provider,
    selection,
    ui,
    brand,
    labels,
    unavailable,
    error: lastError,
    mount,
    execute,
    reset,
    destroy,
  }
}

export type CaptchaController = ReturnType<typeof createCaptchaController>
