import { execFile } from 'node:child_process'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

/**
 * A build must never carry the secrets of the machine it ran on. The fixture
 * is built with every secret variable the module reads set to a canary, and no
 * file of the output may contain one of them.
 */
const rootDir = fileURLToPath(new URL('../fixtures/env-credentials', import.meta.url))
const CANARIES = {
  NUXT_CAPTCHA_RIDER_TOKEN: 'rdr_canary_rider_token',
  NUXT_CAPTCHA_CAP_SECRET: 'sk-canary-cap-secret',
  NUXT_CAPTCHA_CAP_VERIFY_ENDPOINT: 'https://canary-cap-verify.invalid',
  NUXT_CAPTCHA_FRIENDLY_API_KEY: 'canary-friendly-api-key',
  NUXT_CAPTCHA_TURNSTILE_SECRET: '0x-canary-turnstile-secret',
  NUXT_CAPTCHA_HCAPTCHA_SECRET: '0x-canary-hcaptcha-secret',
  NUXT_CAPTCHA_RECAPTCHA_SECRET: 'canary-recaptcha-secret',
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(entries.map(e => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])))
  return nested.flat()
}

describe('a production build', () => {
  it('holds no secret that was in the environment at build time [@spec:module-contract:AC-7]', async () => {
    await rm(join(rootDir, '.output'), { recursive: true, force: true })
    await promisify(execFile)(fileURLToPath(new URL('../../node_modules/.bin/nuxi', import.meta.url)), ['build', rootDir], {
      env: { ...process.env, ...CANARIES },
      maxBuffer: 64 * 1024 * 1024,
    })
    const output = await files(join(rootDir, '.output'))
    expect(output.length).toBeGreaterThan(0)
    const leaks: string[] = []
    for (const file of output) {
      const content = await readFile(file, 'latin1')
      for (const [name, value] of Object.entries(CANARIES)) if (content.includes(value)) leaks.push(`${name} in ${file.slice(rootDir.length)}`)
    }
    expect(leaks).toEqual([])
    // The keys exist, empty, so the variables fill them at runtime.
    const server = (await Promise.all(output.filter(f => f.endsWith('.mjs')).map(f => readFile(f, 'utf8')))).join('\n')
    expect(server).toMatch(/"turnstileSecret":\s*""/)
    expect(server).toMatch(/"hcaptchaSecret":\s*""/)
    expect(server).toMatch(/"recaptchaSecret":\s*""/)
    expect(server).toMatch(/"riderToken":\s*""/)
  })
})
