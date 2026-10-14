import { describe, expect, it } from 'vitest'
import { buildToken, parseToken } from '../../src/runtime/envelope'

describe('the token envelope', () => {
  it('wraps every token as rvx1.<provider>.<raw> [@spec:module-contract:AC-1]', () => {
    expect(buildToken('revenexx', 'abc')).toBe('rvx1.revenexx.abc')
    expect(buildToken('myProvider', 'x')).toBe('rvx1.myProvider.x')
    expect(() => buildToken('bad.name', 'x')).toThrow()
  })

  it('splits on the first two dots only, so raw tokens keep their dots and colons [@spec:module-contract:AC-1]', () => {
    const cap = '4dde56b8e7:3f1a.9c:e0.b2'
    expect(parseToken(buildToken('cap', cap), 'revenexx')).toEqual({ provider: 'cap', raw: cap, enveloped: true })
    const jwtLike = 'eyJhbGciOi.eyJzdWIiOi.SflKxw'
    expect(parseToken(`rvx1.turnstile.${jwtLike}`, 'revenexx')).toEqual({ provider: 'turnstile', raw: jwtLike, enveloped: true })
  })

  it('treats an un-enveloped token as the configured provider\'s [@spec:module-contract:AC-1]', () => {
    expect(parseToken('0.abc:def', 'friendly')).toEqual({ provider: 'friendly', raw: '0.abc:def', enveloped: false })
  })

  it('refuses an empty token and a broken envelope', () => {
    for (const token of ['', '   ', undefined, null, 42, 'rvx1.', 'rvx1.cap', 'rvx1.cap.', 'rvx1..raw', 'rvx1.b@d.raw']) {
      expect(parseToken(token, 'revenexx'), String(token)).toBeNull()
    }
  })
})
