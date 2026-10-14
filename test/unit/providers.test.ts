import { describe, expect, it } from 'vitest'
import cap from '../../src/runtime/providers/cap'
import revenexx from '../../src/runtime/providers/revenexx'
import friendly from '../../src/runtime/providers/friendly'
import turnstile from '../../src/runtime/providers/turnstile'
import hcaptcha from '../../src/runtime/providers/hcaptcha'
import recaptcha from '../../src/runtime/providers/recaptcha'
import none from '../../src/runtime/providers/none'
import test from '../../src/runtime/providers/test'
import { mockFetch, serverContext } from './helpers'

const capOptions = { endpoint: 'https://captcha.example.com/', siteKey: 'site1' }
const capSecrets = { secret: 'sk-test', verifyEndpoint: '' }

describe('cap and revenexx siteverify', () => {
  it('posts { secret, response } to <endpoint>/<siteKey>/siteverify and accepts 200 success [@spec:module-contract:AC-3]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { success: true } })
    const result = await revenexx.server.verify(serverContext('revenexx', capOptions, capSecrets, fetch), { token: 'site1:a:b', action: 'contact' })
    expect(result).toEqual({ success: true, provider: 'revenexx', action: 'contact', errors: [] })
    expect(calls[0]!.url).toBe('https://captcha.example.com/site1/siteverify')
    expect(calls[0]!.init).toMatchObject({ method: 'POST', body: { secret: 'sk-test', response: 'site1:a:b' } })
  })

  it('uses the internal verify endpoint when one is set [@spec:module-contract:AC-3]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { success: true } })
    await cap.server.verify(serverContext('cap', capOptions, { secret: 's', verifyEndpoint: 'http://cap.internal:3000/' }, fetch), { token: 't:1:2' })
    expect(calls[0]!.url).toBe('http://cap.internal:3000/site1/siteverify')
  })

  it('maps Cap\'s answers to the result errors [@spec:module-contract:AC-3]', async () => {
    const cases: Array<[{ status: number, data?: unknown } | Error, string]> = [
      [{ status: 404, data: { success: false, error: 'Token not found' } }, 'invalid'],
      [{ status: 403, data: { success: false, error: 'Token expired' } }, 'expired'],
      [{ status: 403, data: { success: false, error: 'Invalid site key or secret' } }, 'misconfigured'],
      [{ status: 404, data: { success: false, error: 'Invalid site key or secret' } }, 'misconfigured'],
      [{ status: 400, data: { success: false, error: 'Missing required parameters' } }, 'invalid'],
      [{ status: 502, data: 'Bad gateway' }, 'provider_unavailable'],
      [{ status: 500 }, 'provider_unavailable'],
      [new Error('ECONNREFUSED'), 'provider_unavailable'],
    ]
    for (const [answer, error] of cases) {
      const { fetch } = mockFetch(answer)
      const result = await cap.server.verify(serverContext('cap', capOptions, capSecrets, fetch), { token: 'x:y:z' })
      expect(result, JSON.stringify(answer)).toMatchObject({ success: false, provider: 'cap', errors: [error] })
    }
  })

  it('answers misconfigured without a call when the secret or site key is missing [@spec:module-contract:AC-3]', async () => {
    const { fetch } = mockFetch({ status: 200, data: { success: true } })
    expect((await cap.server.verify(serverContext('cap', capOptions, { secret: '' }, fetch), { token: 'x' })).errors).toEqual(['misconfigured'])
    expect((await cap.server.verify(serverContext('cap', { endpoint: 'https://c', siteKey: '' }, capSecrets, fetch), { token: 'x' })).errors).toEqual(['misconfigured'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('is the same provider, neither with a brand line', () => {
    expect(revenexx.meta).toMatchObject({ ui: 'own', brand: false, consent: 'none', invisible: true })
    expect(cap.meta).toMatchObject({ ui: 'own', brand: false, consent: 'none', invisible: true })
  })
})

describe('friendly captcha v2 siteverify', () => {
  const options = { siteKey: 'FCMG', region: 'eu' as const }

  it('posts { response, sitekey } with X-API-Key to the EU endpoint [@spec:module-contract:AC-4]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { success: true, data: { event_id: 'e', challenge: { timestamp: 't', origin: 'o' } } } })
    const result = await friendly.server.verify(serverContext('friendly', options, { apiKey: 'A1' }, fetch), { token: 'resp', action: 'contact' })
    expect(result).toEqual({ success: true, provider: 'friendly', action: 'contact', errors: [] })
    expect(calls[0]!.url).toBe('https://eu.frcapi.com/api/v2/captcha/siteverify')
    expect(calls[0]!.init).toMatchObject({ method: 'POST', headers: { 'X-API-Key': 'A1' }, body: { response: 'resp', sitekey: 'FCMG' } })
    const { fetch: global, calls: globalCalls } = mockFetch({ status: 200, data: { success: true } })
    await friendly.server.verify(serverContext('friendly', { siteKey: 'FCMG', region: 'global' as const }, { apiKey: 'A1' }, global), { token: 'resp' })
    expect(globalCalls[0]!.url).toBe('https://global.frcapi.com/api/v2/captcha/siteverify')
  })

  it('maps the documented error codes [@spec:module-contract:AC-4]', async () => {
    const cases: Array<[number, string, string]> = [
      [401, 'auth_required', 'misconfigured'],
      [401, 'auth_invalid', 'misconfigured'],
      [400, 'sitekey_invalid', 'misconfigured'],
      [400, 'response_missing', 'missing'],
      [200, 'response_invalid', 'invalid'],
      [200, 'response_timeout', 'expired'],
      [200, 'response_duplicate', 'replayed'],
      [400, 'bad_request', 'invalid'],
    ]
    for (const [status, code, error] of cases) {
      const { fetch } = mockFetch({ status, data: { success: false, error: { error_code: code, detail: '' } } })
      const result = await friendly.server.verify(serverContext('friendly', options, { apiKey: 'A1' }, fetch), { token: 'resp' })
      expect(result, code).toMatchObject({ success: false, provider: 'friendly', errors: [error] })
    }
    const { fetch } = mockFetch({ status: 503 })
    expect((await friendly.server.verify(serverContext('friendly', options, { apiKey: 'A1' }, fetch), { token: 'r' })).errors).toEqual(['provider_unavailable'])
  })

  it('needs no consent and processes in the EU', () => {
    expect(friendly.meta).toMatchObject({ consent: 'none', region: 'eu' })
  })
})

describe('turnstile siteverify', () => {
  const options = { siteKey: '0x4AAA' }

  it('posts secret, response, remoteip and an idempotency key [@spec:module-contract:AC-5]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { 'success': true, 'action': 'contact', 'hostname': 'shop.example', 'error-codes': [] } })
    const result = await turnstile.server.verify(serverContext('turnstile', options, { secret: 'ts' }, fetch), { token: 'tok', action: 'contact', remoteip: '203.0.113.9' })
    expect(result).toEqual({ success: true, provider: 'turnstile', action: 'contact', errors: [] })
    expect(calls[0]!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(calls[0]!.init.body).toMatchObject({ secret: 'ts', response: 'tok', remoteip: '203.0.113.9' })
    expect(String(calls[0]!.init.body!.idempotency_key)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('refuses a token solved for another action [@spec:module-contract:AC-5]', async () => {
    const { fetch } = mockFetch({ status: 200, data: { success: true, action: 'login' } })
    const result = await turnstile.server.verify(serverContext('turnstile', options, { secret: 'ts' }, fetch), { token: 'tok', action: 'contact' })
    expect(result).toEqual({ success: false, provider: 'turnstile', action: 'login', errors: ['action_mismatch'] })
  })

  it('maps the documented error codes [@spec:module-contract:AC-5]', async () => {
    const cases: Array<[string, string]> = [
      ['timeout-or-duplicate', 'expired'],
      ['invalid-input-response', 'invalid'],
      ['missing-input-response', 'missing'],
      ['invalid-input-secret', 'misconfigured'],
      ['missing-input-secret', 'misconfigured'],
      ['bad-request', 'invalid'],
      ['internal-error', 'provider_unavailable'],
    ]
    for (const [code, error] of cases) {
      const { fetch } = mockFetch({ status: 200, data: { 'success': false, 'error-codes': [code] } })
      const result = await turnstile.server.verify(serverContext('turnstile', options, { secret: 'ts' }, fetch), { token: 'tok' })
      expect(result, code).toMatchObject({ success: false, errors: [error] })
    }
    const { fetch } = mockFetch(new Error('timeout'))
    expect((await turnstile.server.verify(serverContext('turnstile', options, { secret: 'ts' }, fetch), { token: 'tok' })).errors).toEqual(['provider_unavailable'])
  })

  it('needs consent and binds actions', () => {
    expect(turnstile.meta).toMatchObject({ consent: 'required', action: true, invisible: true, vendor: 'cloudflare-turnstile' })
  })
})

describe('hcaptcha siteverify', () => {
  const options = { siteKey: '10000000-ffff-ffff-ffff-000000000001' }

  it('posts secret, response, remoteip and sitekey form-encoded to api.hcaptcha.com [@spec:module-contract:AC-15]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { 'success': true, 'challenge_ts': '2026-10-14T10:00:00Z', 'hostname': 'shop.example', 'error-codes': [] } })
    const result = await hcaptcha.server.verify(serverContext('hcaptcha', options, { secret: 'hs' }, fetch), { token: 'P1_tok', action: 'contact', remoteip: '203.0.113.9' })
    expect(result).toEqual({ success: true, provider: 'hcaptcha', action: 'contact', errors: [] })
    expect(calls[0]!.url).toBe('https://api.hcaptcha.com/siteverify')
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { secret: 'hs', response: 'P1_tok', remoteip: '203.0.113.9', sitekey: options.siteKey },
    })
    const { fetch: bare, calls: bareCalls } = mockFetch({ status: 200, data: { success: true } })
    await hcaptcha.server.verify(serverContext('hcaptcha', { siteKey: '' }, { secret: 'hs' }, bare), { token: 't' })
    expect(bareCalls[0]!.init.body).toEqual({ secret: 'hs', response: 't' })
  })

  it('maps the documented error codes [@spec:module-contract:AC-15]', async () => {
    const cases: Array<[string, string]> = [
      ['missing-input-secret', 'misconfigured'],
      ['invalid-input-secret', 'misconfigured'],
      ['sitekey-secret-mismatch', 'misconfigured'],
      ['expired-input-response', 'expired'],
      ['already-seen-response', 'replayed'],
      ['missing-input-response', 'invalid'],
      ['invalid-input-response', 'invalid'],
      ['bad-request', 'invalid'],
      ['something-new', 'invalid'],
    ]
    for (const [code, error] of cases) {
      const { fetch } = mockFetch({ status: 200, data: { 'success': false, 'error-codes': [code] } })
      const result = await hcaptcha.server.verify(serverContext('hcaptcha', options, { secret: 'hs' }, fetch), { token: 'tok' })
      expect(result, code).toMatchObject({ success: false, provider: 'hcaptcha', errors: [error] })
    }
    for (const answer of [new Error('ECONNRESET'), { status: 500 }, { status: 503, data: 'down' }]) {
      const { fetch } = mockFetch(answer)
      expect((await hcaptcha.server.verify(serverContext('hcaptcha', options, { secret: 'hs' }, fetch), { token: 'tok' })).errors, JSON.stringify(answer)).toEqual(['provider_unavailable'])
    }
  })

  it('answers misconfigured without a call when the secret is missing [@spec:module-contract:AC-15]', async () => {
    const { fetch } = mockFetch({ status: 200, data: { success: true } })
    expect((await hcaptcha.server.verify(serverContext('hcaptcha', options, { secret: '' }, fetch), { token: 'x' })).errors).toEqual(['misconfigured'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes an Enterprise score through, turned into "higher is more human" [@spec:module-contract:AC-15]', async () => {
    const { fetch } = mockFetch({ status: 200, data: { success: true, score: 0.2, score_reason: ['safe'] } })
    const result = await hcaptcha.server.verify(serverContext('hcaptcha', options, { secret: 'hs' }, fetch), { token: 'tok' })
    expect(result.success).toBe(true)
    expect(result.score).toBeCloseTo(0.8)
  })

  it('needs consent, runs invisibly, reports no score or action by default', () => {
    expect(hcaptcha.meta).toMatchObject({ consent: 'required', region: 'us', invisible: true, score: false, action: false, ui: 'widget', vendor: 'hcaptcha' })
  })
})

describe('recaptcha siteverify', () => {
  const v2 = { siteKey: '6Lv2', version: 'v2' as const }
  const v3 = { siteKey: '6Lv3', version: 'v3' as const }

  it('posts secret, response and remoteip form-encoded to Google [@spec:module-contract:AC-16]', async () => {
    const { fetch, calls } = mockFetch({ status: 200, data: { success: true, challenge_ts: '2026-10-14T10:00:00Z', hostname: 'shop.example' } })
    const result = await recaptcha.server.verify(serverContext('recaptcha', v2, { secret: 'rs' }, fetch), { token: '03AF', action: 'contact', remoteip: '203.0.113.9' })
    expect(result).toEqual({ success: true, provider: 'recaptcha', action: 'contact', errors: [] })
    expect(calls[0]!.url).toBe('https://www.google.com/recaptcha/api/siteverify')
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { secret: 'rs', response: '03AF', remoteip: '203.0.113.9' },
    })
  })

  it('maps the documented error codes [@spec:module-contract:AC-16]', async () => {
    const cases: Array<[string, string]> = [
      ['missing-input-secret', 'misconfigured'],
      ['invalid-input-secret', 'misconfigured'],
      ['timeout-or-duplicate', 'expired'],
      ['missing-input-response', 'invalid'],
      ['invalid-input-response', 'invalid'],
      ['bad-request', 'invalid'],
    ]
    for (const [code, error] of cases) {
      const { fetch } = mockFetch({ status: 200, data: { 'success': false, 'error-codes': [code] } })
      const result = await recaptcha.server.verify(serverContext('recaptcha', v2, { secret: 'rs' }, fetch), { token: 'tok' })
      expect(result, code).toMatchObject({ success: false, provider: 'recaptcha', errors: [error] })
    }
    for (const answer of [new Error('ETIMEDOUT'), { status: 502 }]) {
      const { fetch } = mockFetch(answer)
      expect((await recaptcha.server.verify(serverContext('recaptcha', v2, { secret: 'rs' }, fetch), { token: 'tok' })).errors).toEqual(['provider_unavailable'])
    }
    const { fetch } = mockFetch({ status: 200, data: { success: true } })
    expect((await recaptcha.server.verify(serverContext('recaptcha', v2, { secret: '' }, fetch), { token: 'x' })).errors).toEqual(['misconfigured'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports v3\'s score and action and refuses a score below 0.5 by default [@spec:module-contract:AC-16]', async () => {
    const answer = (score: number, action = 'contact') => mockFetch({ status: 200, data: { success: true, score, action, hostname: 'shop.example' } }).fetch
    expect(await recaptcha.server.verify(serverContext('recaptcha', v3, { secret: 'rs' }, answer(0.9)), { token: 't', action: 'contact' }))
      .toEqual({ success: true, provider: 'recaptcha', action: 'contact', score: 0.9, errors: [] })
    expect(await recaptcha.server.verify(serverContext('recaptcha', v3, { secret: 'rs' }, answer(0.5)), { token: 't', action: 'contact' }))
      .toMatchObject({ success: true, score: 0.5 })
    expect(await recaptcha.server.verify(serverContext('recaptcha', v3, { secret: 'rs' }, answer(0.3)), { token: 't', action: 'contact' }))
      .toEqual({ success: false, provider: 'recaptcha', action: 'contact', score: 0.3, errors: ['low_score'] })
  })

  it('takes the threshold from verifyCaptcha\'s minScore, else the provider option [@spec:module-contract:AC-16]', async () => {
    const answer = () => mockFetch({ status: 200, data: { success: true, score: 0.6, action: 'contact' } }).fetch
    expect((await recaptcha.server.verify(serverContext('recaptcha', { ...v3, minScore: 0.7 }, { secret: 'rs' }, answer()), { token: 't' })).errors).toEqual(['low_score'])
    expect((await recaptcha.server.verify(serverContext('recaptcha', { ...v3, minScore: 0.7 }, { secret: 'rs' }, answer()), { token: 't', minScore: 0.4 })).success).toBe(true)
    expect((await recaptcha.server.verify(serverContext('recaptcha', v3, { secret: 'rs' }, answer()), { token: 't', minScore: 0.8 })).errors).toEqual(['low_score'])
  })

  it('refuses a v3 token made for another action [@spec:module-contract:AC-16]', async () => {
    const { fetch } = mockFetch({ status: 200, data: { success: true, score: 0.9, action: 'login' } })
    const result = await recaptcha.server.verify(serverContext('recaptcha', v3, { secret: 'rs' }, fetch), { token: 't', action: 'contact' })
    expect(result).toEqual({ success: false, provider: 'recaptcha', action: 'login', score: 0.9, errors: ['action_mismatch'] })
    const { fetch: both } = mockFetch({ status: 200, data: { success: true, score: 0.1, action: 'login' } })
    expect((await recaptcha.server.verify(serverContext('recaptcha', v3, { secret: 'rs' }, both), { token: 't', action: 'contact' })).errors).toEqual(['action_mismatch', 'low_score'])
  })

  it('needs consent, reports a score and binds the action', () => {
    expect(recaptcha.meta).toMatchObject({ consent: 'required', region: 'us', invisible: true, score: true, action: true, ui: 'widget', vendor: 'google-recaptcha' })
  })
})

describe('none and test', () => {
  it('test accepts pass and refuses fail', async () => {
    const { fetch } = mockFetch({ status: 500 })
    expect(await test.server.verify(serverContext('test', {}, {}, fetch), { token: 'pass', action: 'contact' })).toEqual({ success: true, provider: 'test', action: 'contact', errors: [] })
    expect((await test.server.verify(serverContext('test', {}, {}, fetch), { token: 'fail' })).errors).toEqual(['invalid'])
    expect((await none.server.verify(serverContext('none', {}, {}, fetch), { token: 'anything' })).success).toBe(true)
  })

  it('both refuse every token in production [@spec:module-contract:AC-6]', async () => {
    const { fetch } = mockFetch({ status: 500 })
    expect(await test.server.verify(serverContext('test', {}, {}, fetch, true), { token: 'pass' })).toMatchObject({ success: false, errors: ['misconfigured'] })
    expect(await none.server.verify(serverContext('none', {}, {}, fetch, true), { token: 'none' })).toMatchObject({ success: false, errors: ['misconfigured'] })
    expect(test.meta.production).toBe(false)
    expect(none.meta.production).toBe(false)
  })
})
