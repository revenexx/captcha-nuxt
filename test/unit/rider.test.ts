import { describe, expect, it } from 'vitest'
import { TtlCache, applyRiderSite, fetchRiderSite, resolvePublicConfig, verifyToken } from '../../src/runtime/server/shared'
import type { RiderSite } from '../../src/runtime/server/shared'
import type { CaptchaPublicConfig } from '../../src/runtime/types'
import { mockFetch } from './helpers'

const staticConfig: CaptchaPublicConfig = {
  provider: 'revenexx',
  source: 'rider',
  fallback: 'revenexx',
  labels: {},
  rider: { url: 'https://rider.example/', site: 'rcs_abc' },
  providers: {
    revenexx: { endpoint: 'https://captcha.revenexx.com', siteKey: '' },
    friendly: { siteKey: '', region: 'eu' },
    turnstile: { siteKey: '' },
  },
}
const site = { data: { site: 'rcs_abc', provider: 'turnstile', site_key: '0x4AAA', fallback: 'revenexx', revenexx: { endpoint: 'https://captcha.revenexx.com', site_key: 'k1' } } }

describe('rider configuration', () => {
  it('reads the site from Rider and applies it [@spec:module-contract:AC-8]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: site })
    const resolved = await resolvePublicConfig(staticConfig, fetch, new TtlCache<RiderSite>(60_000))
    expect(calls[0]!.url).toBe('https://rider.example/api/v1/public/captcha/sites/rcs_abc')
    expect(calls[0]!.init.method).toBe('GET')
    expect(resolved).toMatchObject({
      provider: 'turnstile',
      fallback: 'revenexx',
      resolvedFrom: 'rider',
      providers: { turnstile: { siteKey: '0x4AAA' }, revenexx: { endpoint: 'https://captcha.revenexx.com', siteKey: 'k1' } },
    })
    expect(applyRiderSite(staticConfig, { ...site.data, provider: 'friendly', fallback: null } as RiderSite)).toMatchObject({ provider: 'friendly', fallback: false, providers: { friendly: { siteKey: '0x4AAA', region: 'eu' } } })
  })

  it('caches the answer for 60 s and shares requests in flight [@spec:module-contract:AC-8]', async () => {
    const cache = new TtlCache<RiderSite>(60_000)
    const { fetch } = mockFetch({ status: 200, data: site })
    const now = Date.now()
    await Promise.all([fetchRiderSite('https://rider.example', 'rcs_abc', fetch, cache), fetchRiderSite('https://rider.example', 'rcs_abc', fetch, cache)])
    await fetchRiderSite('https://rider.example', 'rcs_abc', fetch, cache)
    expect(fetch).toHaveBeenCalledTimes(1)
    const later = cache.get('https://rider.example|rcs_abc', async () => ({ ...site.data, provider: 'friendly' } as RiderSite), now + 61_000)
    expect((await later).provider).toBe('friendly')
  })

  it('does not cache a failure and falls back to the static configuration [@spec:module-contract:AC-8]', async () => {
    const cache = new TtlCache<RiderSite>(60_000)
    const { fetch } = mockFetch({ status: 503 }, { status: 200, data: site })
    const first = await resolvePublicConfig(staticConfig, fetch, cache)
    expect(first).toMatchObject({ provider: 'revenexx', resolvedFrom: 'config' })
    const second = await resolvePublicConfig(staticConfig, fetch, cache)
    expect(second).toMatchObject({ provider: 'turnstile', resolvedFrom: 'rider' })
    const { fetch: broken } = mockFetch({ status: 200, data: { data: { provider: 'unknown-provider', site_key: 'x' } } })
    expect((await resolvePublicConfig(staticConfig, broken, new TtlCache<RiderSite>(60_000))).resolvedFrom).toBe('config')
    const { fetch: down } = mockFetch(new Error('ENOTFOUND'))
    expect((await resolvePublicConfig(staticConfig, down, new TtlCache<RiderSite>(60_000))).provider).toBe('revenexx')
  })

  it('merges Rider\'s public provider options, which older Rider versions omit [@spec:module-contract:AC-17]', async () => {
    const v3 = { data: { ...site.data, provider: 'recaptcha', site_key: '6Lv3', options: { version: 'v3' } } }
    const { fetch } = mockFetch({ status: 200, data: v3 })
    const withRecaptcha = { ...staticConfig, providers: { ...staticConfig.providers, recaptcha: { siteKey: '', version: 'v2', hideBadge: true } } }
    const resolved = await resolvePublicConfig(withRecaptcha, fetch, new TtlCache<RiderSite>(60_000))
    expect(resolved).toMatchObject({ provider: 'recaptcha', resolvedFrom: 'rider', providers: { recaptcha: { siteKey: '6Lv3', version: 'v3', hideBadge: true } } })

    const { fetch: old } = mockFetch({ status: 200, data: { data: { ...site.data, provider: 'hcaptcha', site_key: 'hc-key' } } })
    const legacy = await resolvePublicConfig(staticConfig, old, new TtlCache<RiderSite>(60_000))
    expect(legacy).toMatchObject({ provider: 'hcaptcha', resolvedFrom: 'rider', providers: { hcaptcha: { siteKey: 'hc-key' } } })

    // Rider never overrides the site key through options, nor sets anything but plain values.
    const forged = applyRiderSite(staticConfig, { ...site.data, provider: 'recaptcha', site_key: '6Lv3', options: { siteKey: 'other', provider: '~/x', nested: { a: 1 }, version: 'v3' } } as RiderSite)
    expect(forged.providers.recaptcha).toEqual({ siteKey: '6Lv3', version: 'v3' })
  })

  it('is not asked in config mode', async () => {
    const { fetch } = mockFetch({ status: 200, data: site })
    await resolvePublicConfig({ ...staticConfig, source: 'config' }, fetch)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('rider verification', () => {
  const deps = (fetch: ReturnType<typeof mockFetch>['fetch'], riderToken = 'rdr_secret') => ({
    config: staticConfig,
    secrets: { riderToken },
    registry: {},
    fetch,
    remoteip: '203.0.113.9',
    env: { NODE_ENV: 'production' },
  })

  it('posts the full envelope with the Bearer token and returns Rider\'s result [@spec:module-contract:AC-9]', async () => {
    const answer = { data: { success: true, provider: 'turnstile', action: 'contact', errors: [] } }
    const { fetch, calls } = mockFetch({ status: 200, data: answer })
    const result = await verifyToken('rvx1.turnstile.a.b:c', { action: 'contact' }, deps(fetch))
    expect(result).toEqual({ success: true, provider: 'turnstile', action: 'contact', errors: [] })
    expect(calls[0]!.url).toBe('https://rider.example/api/v1/public/captcha/verify')
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer rdr_secret' },
      body: { token: 'rvx1.turnstile.a.b:c', action: 'contact', remoteip: '203.0.113.9' },
      timeout: 5000,
    })
  })

  it('envelopes a bare token with the configured provider [@spec:module-contract:AC-9]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { data: { success: false, provider: 'revenexx', errors: ['replayed'] } } })
    const result = await verifyToken('k1:a:b', {}, deps(fetch))
    expect(calls[0]!.init.body).toMatchObject({ token: 'rvx1.revenexx.k1:a:b' })
    expect(result).toMatchObject({ success: false, errors: ['replayed'] })
  })

  it('maps 401 to misconfigured, 5xx and network errors to provider_unavailable [@spec:module-contract:AC-9]', async () => {
    for (const [answer, error] of [
      [{ status: 401, data: { message: 'Unauthenticated.' } }, 'misconfigured'],
      [{ status: 500 }, 'provider_unavailable'],
      [{ status: 503 }, 'provider_unavailable'],
      [new Error('timeout'), 'provider_unavailable'],
      [{ status: 200, data: { nope: true } }, 'provider_unavailable'],
    ] as const) {
      const { fetch } = mockFetch(answer)
      expect((await verifyToken('rvx1.revenexx.x', {}, deps(fetch))).errors, JSON.stringify(answer)).toEqual([error])
    }
    const { fetch } = mockFetch({ status: 200, data: {} })
    expect((await verifyToken('rvx1.revenexx.x', {}, deps(fetch, ''))).errors).toEqual(['misconfigured'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes the score Rider reports through, a null score as none [@spec:module-contract:AC-17]', async () => {
    const { fetch, calls } = mockFetch(
      { status: 200, data: { data: { success: true, provider: 'recaptcha', action: 'contact', score: 0.9, errors: [] } } },
      { status: 200, data: { data: { success: false, provider: 'recaptcha', action: 'contact', score: 0.1, errors: ['low_score'] } } },
      { status: 200, data: { data: { success: true, provider: 'recaptcha', action: 'contact', score: null, errors: [] } } },
    )
    const v3 = { ...deps(fetch), config: { ...staticConfig, provider: 'recaptcha', providers: { recaptcha: { siteKey: '6Lv3', version: 'v3' } } } }
    expect(await verifyToken('rvx1.recaptcha.03AF', { action: 'contact' }, v3)).toEqual({ success: true, provider: 'recaptcha', action: 'contact', score: 0.9, errors: [] })
    expect(calls[0]!.init.body).toMatchObject({ token: 'rvx1.recaptcha.03AF', action: 'contact' })
    expect(await verifyToken('rvx1.recaptcha.03AF', { action: 'contact' }, v3)).toEqual({ success: false, provider: 'recaptcha', action: 'contact', score: 0.1, errors: ['low_score'] })
    expect(await verifyToken('rvx1.recaptcha.03AF', { action: 'contact' }, v3)).toEqual({ success: true, provider: 'recaptcha', action: 'contact', errors: [] })
  })

  it('needs no provider secret in the shop [@spec:module-contract:AC-9]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { data: { success: true, provider: 'friendly', errors: [] } } })
    await verifyToken('rvx1.friendly.x', {}, deps(fetch))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).not.toContain('frcapi.com')
  })
})
