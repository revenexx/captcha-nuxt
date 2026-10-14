import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'

/**
 * Rider mode against a stand-in Rider: the site's provider comes from Rider
 * during SSR (the static config says turnstile, Rider says revenexx), and
 * verifyCaptcha() asks Rider with the shop's Bearer token.
 */
const calls: Array<{ method?: string, url?: string, headers: Record<string, unknown>, body?: unknown }> = []
const rider = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined })
    if (req.method === 'GET' && req.url === '/api/v1/public/captcha/sites/rcs_fixture') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        data: { site: 'rcs_fixture', provider: 'revenexx', site_key: 'k1', fallback: null, revenexx: { endpoint: 'https://captcha.example.test', site_key: 'k1' } },
      }))
      return
    }
    if (req.method === 'POST' && req.url === '/api/v1/public/captcha/verify') {
      if (req.headers.authorization !== 'Bearer rdr_fixture') {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"Unauthenticated."}')
        return
      }
      const token = JSON.parse(body).token as string
      const success = token === 'rvx1.revenexx.k1:good:sig'
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        data: { success, provider: 'revenexx', action: 'contact', errors: success ? [] : ['replayed'] },
      }))
      return
    }
    res.writeHead(404).end()
  })
})
await new Promise<void>(resolve => rider.listen(0, '127.0.0.1', resolve))
const riderUrl = `http://127.0.0.1:${(rider.address() as AddressInfo).port}`
afterAll(() => { rider.close() })

await setup({
  rootDir: fileURLToPath(new URL('../fixtures/rider', import.meta.url)),
  env: { NUXT_PUBLIC_CAPTCHA_RIDER_URL: riderUrl, NUXT_CAPTCHA_RIDER_TOKEN: 'rdr_fixture' },
})

describe('rider mode', () => {
  it('renders the provider Rider configured and hands its config to the browser in the payload [@spec:module-contract:AC-8]', async () => {
    const before = calls.filter(c => c.method === 'GET').length
    const html = await $fetch<string>('/')
    expect(html).toContain('data-captcha-provider="revenexx"')
    expect(html).toContain('RevenexxCaptcha')
    expect(html).toContain('rvx-captcha-config')
    const second = await $fetch<string>('/')
    expect(second).toContain('data-captcha-provider="revenexx"')
    // Cached per process: two renders, at most one call.
    expect(calls.filter(c => c.method === 'GET').length - before).toBeLessThanOrEqual(1)
    expect(JSON.stringify(html)).not.toContain('rdr_fixture')
  })

  it('verifies at Rider with the Bearer token and the full envelope [@spec:module-contract:AC-9]', async () => {
    const res = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ captcha: 'rvx1.revenexx.k1:good:sig' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, provider: 'revenexx', action: 'contact', errors: [] })
    const call = calls.filter(c => c.method === 'POST').at(-1)!
    expect(call.headers.authorization).toBe('Bearer rdr_fixture')
    expect(call.body).toMatchObject({ token: 'rvx1.revenexx.k1:good:sig', action: 'contact' })

    const replay = await fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ captcha: 'rvx1.revenexx.k1:used:sig' }) })
    expect(replay.status).toBe(422)
    expect((await replay.json()).errors).toEqual(['replayed'])
  })
})
