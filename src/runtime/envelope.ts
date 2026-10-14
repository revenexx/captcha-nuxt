/**
 * The token envelope. Every token the browser hands out is
 * `rvx1.<provider>.<raw token>`, so the server verifies at the provider that
 * actually issued it, including a fallback the browser switched to. Raw tokens
 * may contain dots and colons (Cap's do), so only the first two dots split.
 */
export const ENVELOPE_VERSION = 'rvx1'

/** Provider names are envelope-safe: no dots, nothing that needs escaping. */
export const PROVIDER_NAME = /^[a-z][\w-]{0,63}$/i

/** Longer tokens are refused before any provider is called. */
export const MAX_TOKEN_LENGTH = 16_384

export interface ParsedToken {
  provider: string
  raw: string
  /** Whether the token carried an envelope; an un-enveloped token belongs to the configured provider. */
  enveloped: boolean
}

export function buildToken(provider: string, raw: string): string {
  if (!PROVIDER_NAME.test(provider)) throw new Error(`[captcha] invalid provider name "${provider}"`)
  return `${ENVELOPE_VERSION}.${provider}.${raw}`
}

/**
 * Splits a token into provider and raw token. Returns `null` for an empty
 * token and for an envelope without a provider or a raw token.
 */
export function parseToken(token: unknown, defaultProvider: string): ParsedToken | null {
  if (typeof token !== 'string') return null
  const value = token.trim()
  if (!value) return null
  if (!value.startsWith(`${ENVELOPE_VERSION}.`)) return { provider: defaultProvider, raw: value, enveloped: false }
  const rest = value.slice(ENVELOPE_VERSION.length + 1)
  const dot = rest.indexOf('.')
  if (dot <= 0) return null
  const provider = rest.slice(0, dot)
  const raw = rest.slice(dot + 1)
  if (!raw || !PROVIDER_NAME.test(provider)) return null
  return { provider, raw, enveloped: true }
}
