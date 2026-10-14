import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'

/**
 * A real Nuxt fixture with the `test` provider, built for production and
 * started with NODE_ENV=test (the `test` provider refuses NODE_ENV=production).
 * What a visitor without JavaScript receives, and what a form post to a route
 * using verifyCaptcha() answers, is asserted here.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/basic', import.meta.url)),
  env: { NODE_ENV: 'test' },
})

async function post(captcha: string | undefined) {
  const res = await fetch('/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ captcha }),
  })
  return { status: res.status, body: await res.json() as { success: boolean, provider: string, errors: string[], action?: string } }
}

describe('server-rendered captcha', () => {
  it('renders the box and the hidden input in the first HTML [@spec:module-contract:AC-12]', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('data-captcha-provider="test"')
    expect(html).toContain('data-captcha-state="idle"')
    expect(html).toMatch(/<button[^>]*role="checkbox"[^>]*aria-checked="false"/)
    expect(html).toContain('Ich bin kein Roboter')
    expect(html).toMatch(/<input type="hidden" name="captcha" value="">/)
    expect(html).not.toMatch(/trycap\.dev|challenges\.cloudflare\.com|frcapi\.com/)
  })

  it('accepts rvx1.test.pass and rejects rvx1.test.fail through verifyCaptcha() [@spec:module-contract:AC-12]', async () => {
    const pass = await post('rvx1.test.pass')
    expect(pass.status).toBe(200)
    expect(pass.body).toEqual({ success: true, provider: 'test', action: 'contact', errors: [] })

    const failed = await post('rvx1.test.fail')
    expect(failed.status).toBe(422)
    expect(failed.body).toMatchObject({ success: false, provider: 'test', errors: ['invalid'] })

    const missing = await post(undefined)
    expect(missing.body.errors).toEqual(['missing'])
  })

  it('never verifies a provider the shop does not use [@spec:module-contract:AC-2]', async () => {
    const forged = await post('rvx1.none.anything')
    expect(forged.status).toBe(422)
    expect(forged.body).toMatchObject({ success: false, provider: 'none', errors: ['invalid'] })
  })

  it('serves the public configuration without a secret [@spec:module-contract:AC-7]', async () => {
    const config = await $fetch<Record<string, unknown>>('/_captcha/config')
    expect(config.provider).toBe('test')
    expect(JSON.stringify(config)).not.toMatch(/secret|apiKey|riderToken/i)
  })
})
