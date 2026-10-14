import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineCaptchaProvider } from '../../src/runtime/define'
import revenexx from '../../src/runtime/providers/revenexx'
import turnstile from '../../src/runtime/providers/turnstile'
import type { AnyCaptchaProvider, CaptchaClientContext, CaptchaProviderDefinition, CaptchaResult, CaptchaServerContext } from '../../src/runtime/types'

describe('defineCaptchaProvider', () => {
  it('types a custom provider with the interface of the built-ins [@spec:module-contract:AC-13]', () => {
    const mine = defineCaptchaProvider<{ siteKey: string, mode?: 'a' | 'b' }, { id: number }>({
      name: 'mine',
      meta: { consent: 'required', region: 'eu', invisible: false, score: true, action: true, vendor: 'mine-vendor' },
      client: {
        load(ctx) {
          expectTypeOf(ctx).toEqualTypeOf<CaptchaClientContext<{ siteKey: string, mode?: 'a' | 'b' }>>()
          expectTypeOf(ctx.options.siteKey).toBeString()
        },
        render: () => ({ id: 1 }),
        execute: handle => String(handle.id),
        reset(handle) {
          expectTypeOf(handle.id).toBeNumber()
        },
      },
      server: {
        async verify(ctx, input) {
          expectTypeOf(ctx).toEqualTypeOf<CaptchaServerContext<{ siteKey: string, mode?: 'a' | 'b' }>>()
          expectTypeOf(input.token).toBeString()
          return { success: true, provider: 'mine', score: 0.9, errors: [] }
        },
      },
    })
    expectTypeOf(mine).toEqualTypeOf<CaptchaProviderDefinition<{ siteKey: string, mode?: 'a' | 'b' }, { id: number }>>()
    expectTypeOf(mine.server.verify).returns.resolves.toEqualTypeOf<CaptchaResult>()
    expectTypeOf(revenexx).toExtend<AnyCaptchaProvider>()
    expectTypeOf(mine).toExtend<AnyCaptchaProvider>()
    expectTypeOf(revenexx.client.load).parameter(0).toEqualTypeOf<CaptchaClientContext<{ endpoint: string, siteKey: string }>>()
    expectTypeOf(turnstile.meta).toEqualTypeOf<CaptchaProviderDefinition['meta']>()
    expect(mine.name).toBe('mine')
  })

  it('rejects a provider without a server part [@spec:module-contract:AC-13]', () => {
    // @ts-expect-error server.verify is required
    const broken = defineCaptchaProvider({ name: 'x', meta: { consent: 'none', region: 'eu', invisible: false, score: false, action: false }, client: { load() {}, render: () => null, reset() {} } })
    expect(broken.name).toBe('x')
  })
})
