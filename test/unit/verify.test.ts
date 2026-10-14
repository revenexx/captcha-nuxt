import { describe, expect, it, vi } from 'vitest'
import { acceptedProviders, isProduction, nitroFetch, secretsFor, verifyToken } from '../../src/runtime/server/shared'
import type { VerifyDeps } from '../../src/runtime/server/shared'
import cap from '../../src/runtime/providers/cap'
import revenexx from '../../src/runtime/providers/revenexx'
import turnstile from '../../src/runtime/providers/turnstile'
import recaptcha from '../../src/runtime/providers/recaptcha'
import none from '../../src/runtime/providers/none'
import test from '../../src/runtime/providers/test'
import { defineCaptchaProvider } from '../../src/runtime/define'
import type { CaptchaPublicConfig } from '../../src/runtime/types'
import { mockFetch } from './helpers'

const registry = { revenexx, cap, turnstile, none, test }
const config = (over: Partial<CaptchaPublicConfig> = {}): CaptchaPublicConfig => ({
  provider: 'revenexx',
  source: 'config',
  fallback: 'revenexx',
  labels: {},
  rider: { url: 'https://rider.example', site: '' },
  providers: { revenexx: { endpoint: 'https://captcha.example.com', siteKey: 'k1' }, turnstile: { siteKey: '0x4' } },
  ...over,
})
const deps = (over: Partial<VerifyDeps> = {}): VerifyDeps => ({
  config: config(),
  secrets: { capSecret: 'sk', turnstileSecret: 'ts' },
  registry,
  fetch: mockFetch({ status: 200, data: { success: true } }).fetch,
  env: { NODE_ENV: 'test' },
  ...over,
})

describe('verifyToken', () => {
  it('verifies at the provider the envelope names [@spec:module-contract:AC-1]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { success: true, action: 'contact' } })
    const result = await verifyToken('rvx1.turnstile.abc.def', { action: 'contact' }, deps({ config: config({ provider: 'turnstile' }), fetch }))
    expect(result).toEqual({ success: true, provider: 'turnstile', action: 'contact', errors: [] })
    expect(calls[0]!.url).toContain('challenges.cloudflare.com')
    expect(calls[0]!.init.body).toMatchObject({ response: 'abc.def' })
  })

  it('verifies an un-enveloped token at the configured provider [@spec:module-contract:AC-1]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { success: true } })
    const result = await verifyToken('k1:abc:def', {}, deps({ fetch }))
    expect(result.provider).toBe('revenexx')
    expect(calls[0]!.url).toBe('https://captcha.example.com/k1/siteverify')
    expect(calls[0]!.init.body).toMatchObject({ response: 'k1:abc:def' })
  })

  it('accepts only the configured provider, its fallback and providers named per call [@spec:module-contract:AC-2]', async () => {
    const { fetch } = mockFetch({ status: 200, data: { success: true } })
    const forged = await verifyToken('rvx1.none.x', {}, deps({ fetch }))
    expect(forged).toMatchObject({ success: false, provider: 'none', errors: ['invalid'] })
    const testToken = await verifyToken('rvx1.test.pass', {}, deps({ fetch }))
    expect(testToken.errors).toEqual(['invalid'])
    expect(fetch).not.toHaveBeenCalled()
    expect(acceptedProviders(config({ provider: 'turnstile' }), { provider: ['cap'] })).toEqual(['turnstile', 'revenexx', 'cap'])
    expect(acceptedProviders(config({ fallback: false }), {})).toEqual(['revenexx'])
    const named = await verifyToken('rvx1.test.pass', { provider: 'test' }, deps({ fetch }))
    expect(named.success).toBe(true)
  })

  it('verifies a fallback token at the fallback [@spec:module-contract:AC-10]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { success: true } })
    const result = await verifyToken('rvx1.revenexx.k1:a:b', { action: 'contact' }, deps({ config: config({ provider: 'turnstile' }), fetch }))
    expect(result).toEqual({ success: true, provider: 'revenexx', action: 'contact', errors: [] })
    expect(calls[0]!.url).toBe('https://captcha.example.com/k1/siteverify')
  })

  it('answers missing and invalid without a call', async () => {
    const { fetch } = mockFetch({ status: 200, data: { success: true } })
    expect((await verifyToken('', {}, deps({ fetch }))).errors).toEqual(['missing'])
    expect((await verifyToken(undefined, {}, deps({ fetch }))).errors).toEqual(['missing'])
    expect((await verifyToken('rvx1.cap', {}, deps({ fetch }))).errors).toEqual(['invalid'])
    expect((await verifyToken(`rvx1.revenexx.${'x'.repeat(20_000)}`, {}, deps({ fetch }))).errors).toEqual(['invalid'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses none and test when the server runs with NODE_ENV=production [@spec:module-contract:AC-6]', async () => {
    const production = { NODE_ENV: 'production' }
    for (const name of ['none', 'test']) {
      const result = await verifyToken(`rvx1.${name}.pass`, {}, deps({ config: config({ provider: name, fallback: false }), env: production }))
      expect(result, name).toMatchObject({ success: false, provider: name, errors: ['misconfigured'] })
    }
    const dev = await verifyToken('rvx1.test.pass', {}, deps({ config: config({ provider: 'test' }), env: { NODE_ENV: 'development' } }))
    expect(dev.success).toBe(true)
    expect(isProduction({ NODE_ENV: 'production' })).toBe(true)
    expect(isProduction({})).toBe(false)
  })

  it('enforces the action and a minimum score for custom providers too', async () => {
    const scored = defineCaptchaProvider({
      name: 'scored',
      meta: { consent: 'none', region: 'eu', invisible: true, score: true, action: true },
      client: { load() {}, render: () => null, reset() {} },
      server: { verify: async (_ctx, input) => ({ success: true, provider: 'scored', action: input.token, score: 0.3, errors: [] }) },
    })
    const d = deps({ config: config({ provider: 'scored' }), registry: { ...registry, scored } })
    expect((await verifyToken('rvx1.scored.login', { action: 'contact' }, d)).errors).toEqual(['action_mismatch'])
    expect((await verifyToken('rvx1.scored.contact', { action: 'contact', minScore: 0.5 }, d)).errors).toEqual(['low_score'])
    expect((await verifyToken('rvx1.scored.contact', { action: 'contact', minScore: 0.2 }, d)).success).toBe(true)
  })

  it('hands verifyCaptcha\'s minScore to reCAPTCHA v3, which otherwise applies 0.5 [@spec:module-contract:AC-16]', async () => {
    const d = (score: number) => deps({
      config: config({ provider: 'recaptcha', providers: { recaptcha: { siteKey: '6Lv3', version: 'v3' } } }),
      registry: { ...registry, recaptcha },
      secrets: { recaptchaSecret: 'rs' },
      fetch: mockFetch({ status: 200, data: { success: true, score, action: 'contact' } }).fetch,
    })
    expect(await verifyToken('rvx1.recaptcha.03AF', { action: 'contact' }, d(0.4))).toEqual({ success: false, provider: 'recaptcha', action: 'contact', score: 0.4, errors: ['low_score'] })
    expect((await verifyToken('rvx1.recaptcha.03AF', { action: 'contact', minScore: 0.3 }, d(0.4))).success).toBe(true)
    expect((await verifyToken('rvx1.recaptcha.03AF', { action: 'contact', minScore: 0.7 }, d(0.6))).errors).toEqual(['low_score'])
    expect((await verifyToken('rvx1.recaptcha.03AF', { action: 'login' }, d(0.9))).errors).toEqual(['action_mismatch'])
  })

  it('turns a throwing provider into provider_unavailable', async () => {
    const broken = defineCaptchaProvider({
      name: 'broken',
      meta: { consent: 'none', region: 'eu', invisible: false, score: false, action: false },
      client: { load() {}, render: () => null, reset() {} },
      server: { verify: async () => { throw new Error('boom') } },
    })
    const result = await verifyToken('rvx1.broken.x', {}, deps({ config: config({ provider: 'broken' }), registry: { ...registry, broken } }))
    expect(result).toMatchObject({ success: false, provider: 'broken', errors: ['provider_unavailable'] })
  })
})

describe('secrets', () => {
  it('come from the runtime config only, per provider [@spec:module-contract:AC-7]', () => {
    const runtime = { capSecret: ' sk ', capVerifyEndpoint: 'http://cap:3000', friendlyApiKey: 'fk', turnstileSecret: 'ts', hcaptchaSecret: 'hs', recaptchaSecret: 'rs', secrets: { mine: { token: 't' } } }
    expect(secretsFor('revenexx', runtime)).toEqual({ secret: 'sk', verifyEndpoint: 'http://cap:3000' })
    expect(secretsFor('cap', runtime)).toEqual({ secret: 'sk', verifyEndpoint: 'http://cap:3000' })
    expect(secretsFor('friendly', runtime)).toEqual({ apiKey: 'fk' })
    expect(secretsFor('turnstile', runtime)).toEqual({ secret: 'ts' })
    expect(secretsFor('hcaptcha', runtime)).toEqual({ secret: 'hs' })
    expect(secretsFor('recaptcha', runtime)).toEqual({ secret: 'rs' })
    expect(secretsFor('mine', runtime)).toEqual({ token: 't' })
    expect(secretsFor('turnstile', undefined)).toEqual({ secret: '' })
  })
})

describe('nitroFetch', () => {
  it('sends a form-encoded body for hCaptcha and reCAPTCHA, JSON otherwise [@spec:module-contract:AC-15]', async () => {
    const raw = vi.fn(async (_url: string, _options: Record<string, unknown>) => ({ status: 200, _data: { success: true } }))
    vi.stubGlobal('$fetch', { raw })
    try {
      const res = await nitroFetch('https://api.hcaptcha.com/siteverify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { secret: 's&1', response: 'a b' } })
      expect(res).toEqual({ status: 200, data: { success: true } })
      expect(raw.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: 'secret=s%261&response=a+b', retry: 0, ignoreResponseError: true })
      await nitroFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: { secret: 's' } })
      expect(raw.mock.calls[1]![1]).toMatchObject({ body: { secret: 's' } })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
