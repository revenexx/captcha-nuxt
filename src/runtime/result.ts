import type { CaptchaError, CaptchaResult } from './types'

export function ok(provider: string, action?: string, score?: number): CaptchaResult {
  const result: CaptchaResult = { success: true, provider, errors: [] }
  if (action !== undefined) result.action = action
  if (score !== undefined) result.score = score
  return result
}

export function fail(provider: string, errors: CaptchaError | CaptchaError[], action?: string): CaptchaResult {
  const result: CaptchaResult = { success: false, provider, errors: Array.isArray(errors) ? errors : [errors] }
  if (action !== undefined) result.action = action
  return result
}

/** An object from an unknown JSON body, or an empty one. */
export function record(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
}

/** `https://x.example/` and `https://x.example` alike, without trailing slashes. */
export function trimUrl(url: unknown): string {
  return typeof url === 'string' ? url.trim().replace(/\/+$/, '') : ''
}
