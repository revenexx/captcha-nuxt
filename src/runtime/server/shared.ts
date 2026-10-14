/**
 * Server-side logic, kept free of Nitro so it is unit-tested with a mocked
 * fetch. Credentials are read at runtime only, from the runtime config (which
 * the NUXT_CAPTCHA_* variables override per process); nothing here is ever
 * part of the build.
 */
import { MAX_TOKEN_LENGTH, buildToken, parseToken } from '../envelope'
import { fail, record, trimUrl } from '../result'
import type { AnyCaptchaProvider, CaptchaError, CaptchaFetch, CaptchaPublicConfig, CaptchaResult } from '../types'

/** The server-only runtime config (`runtimeConfig.captcha`). */
export interface CaptchaPrivateConfig {
  riderToken?: string
  capSecret?: string
  capVerifyEndpoint?: string
  friendlyApiKey?: string
  turnstileSecret?: string
  hcaptchaSecret?: string
  recaptchaSecret?: string
  forwardIp?: boolean
  /** Secrets of custom providers: `secrets.<provider>.<key>`. */
  secrets?: Record<string, Record<string, string>>
}

export const DEFAULT_TIMEOUT = 5000
export const RIDER_CACHE_MS = 60_000

/** The secrets a provider gets, resolved per request from the runtime config. */
export function secretsFor(name: string, config: CaptchaPrivateConfig | undefined): Record<string, string> {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const custom = Object.fromEntries(Object.entries(config?.secrets?.[name] ?? {}).map(([k, v]) => [k, str(v)]))
  switch (name) {
    case 'cap':
    case 'revenexx':
      return { ...custom, secret: str(config?.capSecret) || str(custom.secret), verifyEndpoint: str(config?.capVerifyEndpoint) || str(custom.verifyEndpoint) }
    case 'friendly':
      return { ...custom, apiKey: str(config?.friendlyApiKey) || str(custom.apiKey) }
    case 'turnstile':
      return { ...custom, secret: str(config?.turnstileSecret) || str(custom.secret) }
    case 'hcaptcha':
      return { ...custom, secret: str(config?.hcaptchaSecret) || str(custom.secret) }
    case 'recaptcha':
      return { ...custom, secret: str(config?.recaptchaSecret) || str(custom.secret) }
    default:
      return custom
  }
}

/**
 * Whether the server runs in production — read at runtime. Nitro inlines the
 * literal `process.env.NODE_ENV` at build time, so the variable is looked up by
 * a computed key: what counts is the environment the server process starts in.
 */
export function isProduction(env: Record<string, string | undefined> = process.env): boolean {
  const key = ['NODE', 'ENV'].join('_')
  return env[key] === 'production'
}

/**
 * A per-process cache with a fixed lifetime and in-flight sharing: N requests
 * for one key within the window cost one call. Failures are not cached.
 */
export class TtlCache<T> {
  private entries = new Map<string, { at: number, value: Promise<T> }>()
  constructor(private ttlMs: number, private max = 1000) {}

  get(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.entries.get(key)
    if (hit && now - hit.at < this.ttlMs) return hit.value
    if (this.entries.size >= this.max) this.entries.clear()
    const value = load()
    this.entries.set(key, { at: now, value })
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key)
    })
    return value
  }

  clear() {
    this.entries.clear()
  }
}

/** Rider's answer for a site: `GET {rider.url}/api/v1/public/captcha/sites/{site}`. */
export interface RiderSite {
  site: string
  provider: 'revenexx' | 'friendly' | 'turnstile' | 'hcaptcha' | 'recaptcha'
  site_key: string
  fallback: 'revenexx' | null
  revenexx: { endpoint: string, site_key: string }
  /**
   * Public options of the provider, merged into `providers.<provider>`: for
   * recaptcha `{ version: 'v2' | 'v3' }`, else `{}`. Older Rider versions send
   * none.
   */
  options: Record<string, unknown>
}

const RIDER_PROVIDERS = ['revenexx', 'friendly', 'turnstile', 'hcaptcha', 'recaptcha']
/** Options Rider may not set: the site key comes from `site_key`, a provider file and consent codes from the shop. */
const RIDER_RESERVED_OPTIONS = ['siteKey', 'provider', 'consentVendor', 'consentPurpose']

/** Rider's `options`: an object of plain values, or nothing. */
function riderOptions(value: unknown): Record<string, unknown> {
  const options: Record<string, unknown> = {}
  for (const [key, option] of Object.entries(record(value))) {
    if (RIDER_RESERVED_OPTIONS.includes(key)) continue
    if (['string', 'number', 'boolean'].includes(typeof option)) options[key] = option
  }
  return options
}

function asRiderSite(data: unknown): RiderSite | null {
  const site = record(record(data).data)
  const revenexx = record(site.revenexx)
  if (typeof site.provider !== 'string' || !RIDER_PROVIDERS.includes(site.provider)) return null
  if (typeof site.site_key !== 'string') return null
  if (site.fallback !== null && site.fallback !== 'revenexx' && site.fallback !== undefined) return null
  return {
    site: String(site.site ?? ''),
    provider: site.provider as RiderSite['provider'],
    site_key: site.site_key,
    fallback: (site.fallback ?? null) as RiderSite['fallback'],
    revenexx: { endpoint: String(revenexx.endpoint ?? ''), site_key: String(revenexx.site_key ?? '') },
    options: riderOptions(site.options),
  }
}

export const riderCache = new TtlCache<RiderSite>(RIDER_CACHE_MS)

/** Fetches a site's captcha configuration from Rider, cached per process for 60 s. */
export function fetchRiderSite(url: string, site: string, fetcher: CaptchaFetch, cache = riderCache): Promise<RiderSite> {
  const base = trimUrl(url)
  return cache.get(`${base}|${site}`, async () => {
    const res = await fetcher(`${base}/api/v1/public/captcha/sites/${encodeURIComponent(site)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      timeout: DEFAULT_TIMEOUT,
    })
    if (res.status !== 200) throw new Error(`[captcha] rider answered ${res.status}`)
    const parsed = asRiderSite(res.data)
    if (!parsed) throw new Error('[captcha] rider answered an unexpected shape')
    return parsed
  })
}

/** The static configuration with Rider's answer applied. */
export function applyRiderSite(config: CaptchaPublicConfig, site: RiderSite): CaptchaPublicConfig {
  const providers: Record<string, Record<string, unknown>> = {}
  for (const [name, options] of Object.entries(config.providers ?? {})) providers[name] = { ...options }
  providers.revenexx = {
    ...providers.revenexx,
    endpoint: site.revenexx.endpoint || providers.revenexx?.endpoint,
    siteKey: site.revenexx.site_key || (site.provider === 'revenexx' ? site.site_key : providers.revenexx?.siteKey),
  }
  if (site.provider !== 'revenexx') providers[site.provider] = { ...providers[site.provider], ...riderOptions(site.options), siteKey: site.site_key }
  return { ...config, provider: site.provider, fallback: site.fallback ?? false, providers, resolvedFrom: 'rider' }
}

/**
 * The public configuration of this request. In rider mode it is Rider's
 * answer (cached); when Rider fails, the static configuration.
 */
export async function resolvePublicConfig(config: CaptchaPublicConfig, fetcher: CaptchaFetch, cache = riderCache): Promise<CaptchaPublicConfig> {
  const base: CaptchaPublicConfig = { ...config, resolvedFrom: 'config' }
  if (config.source !== 'rider' || !config.rider?.site || !trimUrl(config.rider?.url)) return base
  try {
    return applyRiderSite(base, await fetchRiderSite(config.rider.url, config.rider.site, fetcher, cache))
  }
  catch {
    return base
  }
}

export interface VerifyOptions {
  /** The action the form expects. A provider that binds actions must report the same one. */
  action?: string
  /** Providers accepted in addition to the configured provider and fallback (for a `:provider` override). */
  provider?: string | string[]
  /** Refuse a provider score below this (0..1). */
  minScore?: number
}

export interface VerifyDeps {
  config: CaptchaPublicConfig
  secrets: CaptchaPrivateConfig
  registry: Record<string, AnyCaptchaProvider>
  fetch: CaptchaFetch
  remoteip?: string
  env?: Record<string, string | undefined>
  timeout?: number
}

const ERRORS: CaptchaError[] = ['missing', 'invalid', 'expired', 'replayed', 'action_mismatch', 'low_score', 'provider_unavailable', 'misconfigured']

function asResult(data: unknown, fallbackProvider: string): CaptchaResult | null {
  const r = record(record(data).data)
  if (typeof r.success !== 'boolean') return null
  const errors = Array.isArray(r.errors) ? (r.errors as unknown[]).filter((e): e is CaptchaError => ERRORS.includes(e as CaptchaError)) : []
  const result: CaptchaResult = {
    success: r.success && errors.length === 0,
    provider: typeof r.provider === 'string' && r.provider ? r.provider : fallbackProvider,
    errors: r.success && errors.length === 0 ? [] : (errors.length ? errors : ['invalid']),
  }
  if (typeof r.action === 'string') result.action = r.action
  if (typeof r.score === 'number') result.score = r.score
  return result
}

/**
 * Rider mode: Rider holds every provider secret of the tenant and verifies.
 * POST {rider.url}/api/v1/public/captcha/verify, `Authorization: Bearer <token>`,
 * JSON `{ token, action?, remoteip? }` → `{ data: CaptchaResult }`.
 */
export async function verifyWithRider(envelope: string, provider: string, options: VerifyOptions, deps: VerifyDeps): Promise<CaptchaResult> {
  const token = (deps.secrets.riderToken ?? '').trim()
  const url = trimUrl(deps.config.rider?.url)
  if (!token || !url) return fail(provider, 'misconfigured', options.action)
  const body: Record<string, unknown> = { token: envelope }
  if (options.action) body.action = options.action
  if (deps.remoteip) body.remoteip = deps.remoteip
  let res: { status: number, data: unknown }
  try {
    res = await deps.fetch(`${url}/api/v1/public/captcha/verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      body,
      timeout: deps.timeout ?? DEFAULT_TIMEOUT,
    })
  }
  catch {
    return fail(provider, 'provider_unavailable', options.action)
  }
  if (res.status === 401 || res.status === 403) return fail(provider, 'misconfigured', options.action)
  if (res.status >= 500) return fail(provider, 'provider_unavailable', options.action)
  if (res.status !== 200) return fail(provider, 'invalid', options.action)
  return asResult(res.data, provider) ?? fail(provider, 'provider_unavailable', options.action)
}

/** Checks the result against what the form expects: the action and a minimum score. */
function enforce(result: CaptchaResult, options: VerifyOptions): CaptchaResult {
  const errors = [...result.errors]
  if (result.success && options.action && result.action !== undefined && result.action !== options.action) errors.push('action_mismatch')
  if (result.success && options.minScore !== undefined && result.score !== undefined && result.score < options.minScore) errors.push('low_score')
  if (!errors.length) return result
  return { ...result, success: false, errors: [...new Set(errors)] }
}

/** The providers this shop accepts a token from: the configured one, its fallback, and any named per call. */
export function acceptedProviders(config: CaptchaPublicConfig, options: VerifyOptions): string[] {
  const extra = options.provider === undefined ? [] : Array.isArray(options.provider) ? options.provider : [options.provider]
  return [...new Set([config.provider, config.fallback || '', ...extra].filter(Boolean))]
}

/**
 * Verifies a token. The envelope names the provider; only providers this shop
 * accepts are verified, so a forged `rvx1.none.x` never passes a shop that
 * uses another provider.
 */
export async function verifyToken(token: unknown, options: VerifyOptions, deps: VerifyDeps): Promise<CaptchaResult> {
  const config = deps.config
  const parsed = parseToken(token, config.provider)
  if (typeof token !== 'string' || !token.trim()) return fail(config.provider, 'missing', options.action)
  if (!parsed || token.length > MAX_TOKEN_LENGTH) return fail(config.provider, 'invalid', options.action)

  if (config.source === 'rider') {
    const envelope = parsed.enveloped ? token.trim() : buildToken(parsed.provider, parsed.raw)
    return enforce(await verifyWithRider(envelope, parsed.provider, options, deps), options)
  }

  if (!acceptedProviders(config, options).includes(parsed.provider)) return fail(parsed.provider, 'invalid', options.action)
  const definition = deps.registry[parsed.provider]
  if (!definition) return fail(parsed.provider, 'misconfigured', options.action)
  const production = isProduction(deps.env)
  if (definition.meta.production === false && production) return fail(parsed.provider, 'misconfigured', options.action)

  let result: CaptchaResult
  try {
    result = await definition.server.verify({
      name: parsed.provider,
      options: config.providers?.[parsed.provider] ?? {},
      secrets: secretsFor(parsed.provider, deps.secrets),
      fetch: deps.fetch,
      production,
      timeout: deps.timeout ?? DEFAULT_TIMEOUT,
    }, { token: parsed.raw, action: options.action, remoteip: deps.remoteip, minScore: options.minScore })
  }
  catch {
    result = fail(parsed.provider, 'provider_unavailable', options.action)
  }
  return enforce({ ...result, provider: parsed.provider }, options)
}

/**
 * Nitro's global `$fetch` (ofetch) as a {@link CaptchaFetch}: no retries, a
 * timeout, and an HTTP error answered with its status instead of thrown.
 */
export const nitroFetch: CaptchaFetch = async (url, init) => {
  type Raw = (url: string, options: Record<string, unknown>) => Promise<{ status: number, _data?: unknown }>
  const raw = (globalThis as unknown as { $fetch: { raw: Raw } }).$fetch.raw
  // A form-encoded body (hCaptcha, reCAPTCHA) is encoded here, not left to the fetch library.
  const form = Object.entries(init.headers ?? {}).some(([k, v]) => k.toLowerCase() === 'content-type' && v.startsWith('application/x-www-form-urlencoded'))
  const body = form && init.body
    ? new URLSearchParams(Object.entries(init.body).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString()
    : init.body
  const res = await raw(url, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body,
    timeout: init.timeout ?? DEFAULT_TIMEOUT,
    retry: 0,
    ignoreResponseError: true,
  })
  return { status: res.status, data: res._data }
}
