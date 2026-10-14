import { describe, expect, it } from 'vitest'
import { acceptedProviders, isProduction, secretsFor, verifyToken } from '../../src/runtime/server/shared'
import type { VerifyDeps } from '../../src/runtime/server/shared'
import cap from '../../src/runtime/providers/cap'
import revenexx from '../../src/runtime/providers/revenexx'
import turnstile from '../../src/runtime/providers/turnstile'
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
    const runtime = { capSecret: ' sk ', capVerifyEndpoint: 'http://cap:3000', friendlyApiKey: 'fk', turnstileSecret: 'ts', secrets: { mine: { token: 't' } } }
    expect(secretsFor('revenexx', runtime)).toEqual({ secret: 'sk', verifyEndpoint: 'http://cap:3000' })
    expect(secretsFor('cap', runtime)).toEqual({ secret: 'sk', verifyEndpoint: 'http://cap:3000' })
    expect(secretsFor('friendly', runtime)).toEqual({ apiKey: 'fk' })
    expect(secretsFor('turnstile', runtime)).toEqual({ secret: 'ts' })
    expect(secretsFor('mine', runtime)).toEqual({ token: 't' })
    expect(secretsFor('turnstile', undefined)).toEqual({ secret: '' })
  })
})
