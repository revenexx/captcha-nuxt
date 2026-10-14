import type { H3Event } from 'h3'
import { getRequestIP } from 'h3'
import { useRuntimeConfig } from '#imports'
import { providers } from '#captcha-providers'
import type { CaptchaPublicConfig, CaptchaResult } from '../../types'
import { nitroFetch, resolvePublicConfig, verifyToken } from '../shared'
import type { CaptchaPrivateConfig, VerifyOptions } from '../shared'

export type { VerifyOptions as CaptchaVerifyOptions } from '../shared'

/**
 * Verifies a captcha token at the provider its envelope names, or at Rider in
 * rider mode. Never throws: a failure is a `CaptchaResult` with `errors`.
 *
 *   const result = await verifyCaptcha(event, body.captcha, { action: 'contact' })
 *   if (!result.success) throw createError({ statusCode: 422, data: result.errors })
 */
export async function verifyCaptcha(event: H3Event, token: unknown, options: VerifyOptions = {}): Promise<CaptchaResult> {
  const runtime = useRuntimeConfig(event) as unknown as { captcha?: CaptchaPrivateConfig, public: { captcha: CaptchaPublicConfig } }
  const secrets = runtime.captcha ?? {}
  const config = await resolvePublicConfig(runtime.public.captcha, nitroFetch)
  const remoteip = secrets.forwardIp !== false ? getRequestIP(event, { xForwardedFor: true }) : undefined
  return verifyToken(token, options, { config, secrets, registry: providers, fetch: nitroFetch, remoteip })
}
