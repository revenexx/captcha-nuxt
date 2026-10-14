/// <reference lib="dom" />
/**
 * The public types of @revenexx/captcha-nuxt. One provider interface serves the
 * built-in providers and custom ones alike, the way Nuxt Image's providers do.
 */

/** Why a verification failed. An empty list means it succeeded. */
export type CaptchaError =
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'replayed'
  | 'action_mismatch'
  | 'low_score'
  | 'provider_unavailable'
  | 'misconfigured'

/** What `verifyCaptcha()` answers. */
export interface CaptchaResult {
  success: boolean
  /** The provider that verified the token (the one its envelope names). */
  provider: string
  /** The action the provider confirmed, or the expected one for providers that bind no action. */
  action?: string
  /** A risk score in 0..1 where the provider reports one (higher is more human). */
  score?: number
  errors: CaptchaError[]
}

export type BuiltinProviderName = 'revenexx' | 'cap' | 'friendly' | 'turnstile' | 'none' | 'test'

/** The states of a captcha on the page. */
export type CaptchaState = 'idle' | 'verifying' | 'done' | 'error' | 'expired'

/** Every visible and announced text. German defaults, overridable through `captcha.labels`. */
export interface CaptchaLabels {
  /** The idle label of the box. */
  verify: string
  verifying: string
  done: string
  error: string
  expired: string
  /** The accessible name of the whole box. */
  group: string
  /** Shown when a provider needs consent, none was given and no fallback is configured. */
  consentRequired: string
  /** Shown when no provider could be loaded. */
  unavailable: string
  /** The brand line of the revenexx provider. */
  brand: string
}

export interface CaptchaProviderMeta {
  /** Whether the provider may only load after consent for its vendor. */
  consent: 'required' | 'none'
  /** Where verification data is processed: 'eu', 'global', 'self-hosted' or 'local'. */
  region: 'eu' | 'global' | 'self-hosted' | 'local' | (string & {})
  /** Whether the provider can run without showing anything (`useCaptcha().execute()`). */
  invisible: boolean
  /** Whether the provider reports a risk score. */
  score: boolean
  /** Whether the provider binds the action into the token and reports it back. */
  action: boolean
  /**
   * Who draws the box: `'own'` means the module's accessible box with
   * `execute()` behind its button, `'widget'` means the provider renders its
   * own widget into a container, `'none'` means nothing is shown. Default `'widget'`.
   */
  ui?: 'own' | 'widget' | 'none'
  /** Show the brand line (`labels.brand`) under the own box. */
  brand?: boolean
  /** The consent vendor code in the published policy. Default: the provider name. */
  vendor?: string
  /** The consent purpose the vendor has to be allowed for. Default: any of the vendor's purposes. */
  purpose?: string
  /** `false` for providers that must never verify in production (`none`, `test`). */
  production?: boolean
}

/** What the module hands a provider in the browser. */
export interface CaptchaClientContext<Options = Record<string, unknown>> {
  /** The provider name as configured (the envelope carries it). */
  name: string
  /** This provider's public options from `captcha.providers.<name>`. */
  options: Options
  action?: string
  invisible: boolean
  labels: CaptchaLabels
  /**
   * Load a third-party script through `@nuxt/scripts`. For a provider with
   * `meta.consent: 'required'` it is gated by the consent trigger when
   * `@revenexx/consent-manager-nuxt` is installed. Resolves with what `use` returns.
   */
  loadScript: <T = unknown>(src: string, options?: { key?: string, use?: () => T }) => Promise<T | undefined>
}

/** The callbacks a provider reports through. `solve` takes the provider's raw token. */
export interface CaptchaWidgetEvents {
  solve: (rawToken: string) => void
  error: (error: unknown) => void
  expire: () => void
  progress: (percent: number) => void
}

export interface CaptchaClient<Options = Record<string, unknown>, Handle = unknown> {
  /** Load the provider's SDK or script. Called once per page, before `render`. */
  load: (ctx: CaptchaClientContext<Options>) => void | Promise<void>
  /** Mount the provider into `el` (or prepare a handle for an own-UI provider). */
  render: (ctx: CaptchaClientContext<Options>, el: HTMLElement, events: CaptchaWidgetEvents) => Handle | Promise<Handle>
  /**
   * Run the challenge: return (or resolve with) the raw token, or return
   * nothing and report it through `events.solve`. Needed for `ui: 'own'` and
   * for invisible use.
   */
  execute?: (handle: Handle, ctx: CaptchaClientContext<Options>) => unknown
  reset: (handle: Handle, ctx: CaptchaClientContext<Options>) => void
  /** Remove whatever `render` created. */
  destroy?: (handle: Handle) => void
}

/** A server-side HTTP call that never throws on an HTTP status, only on a network error or timeout. */
export type CaptchaFetch = (url: string, init: {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: Record<string, unknown>
  timeout?: number
}) => Promise<{ status: number, data: unknown }>

/** What the module hands a provider on the server. */
export interface CaptchaServerContext<Options = Record<string, unknown>> {
  name: string
  options: Options
  /** This provider's server-only secrets, read from runtime config at request time. */
  secrets: Record<string, string>
  fetch: CaptchaFetch
  /** The runtime NODE_ENV is `production`. */
  production: boolean
  /** Milliseconds a provider call may take. */
  timeout: number
}

export interface CaptchaVerifyInput {
  /** The provider's raw token (the envelope is already removed). */
  token: string
  /** The action the form expects. */
  action?: string
  /** The visitor's address, when `forwardIp` is on. */
  remoteip?: string
}

export interface CaptchaServer<Options = Record<string, unknown>> {
  verify: (ctx: CaptchaServerContext<Options>, input: CaptchaVerifyInput) => Promise<CaptchaResult>
}

/** A captcha provider: built in or your own, both through `defineCaptchaProvider()`. */
export interface CaptchaProviderDefinition<Options = Record<string, unknown>, Handle = unknown> {
  name: string
  meta: CaptchaProviderMeta
  client: CaptchaClient<Options, Handle>
  server: CaptchaServer<Options>
}

// A registry holds providers of any options and handle type; their callbacks
// are contravariant in both, so the registry is typed loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCaptchaProvider = CaptchaProviderDefinition<any, any>

/** The public, per-request configuration: static config, or what Rider answered for this site. */
export interface CaptchaPublicConfig {
  provider: string
  source: 'config' | 'rider'
  fallback: string | false
  labels: Partial<CaptchaLabels>
  rider: { url: string, site: string }
  providers: Record<string, Record<string, unknown>>
  /** Whether @revenexx/consent-manager-nuxt is installed (set by the module). */
  consentModule?: boolean
  /** Where this configuration came from: `'rider'` only when Rider answered. */
  resolvedFrom?: 'config' | 'rider'
}

/** The seam of @revenexx/consent-manager-nuxt this module uses (`nuxtApp.$consentProvider`). */
export interface CaptchaConsentSeam {
  allows: (vendor: string, purpose?: string) => boolean
  onChange?: (cb: () => void) => () => void
  trigger?: (vendor: string, purpose?: string) => unknown
}
