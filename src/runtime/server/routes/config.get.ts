import { defineEventHandler, setResponseHeader } from 'h3'
import { useRuntimeConfig } from '#imports'
import type { CaptchaPublicConfig } from '../../types'
import { nitroFetch, resolvePublicConfig } from '../shared'

/**
 * GET /_captcha/config: the public captcha configuration of this shop. In
 * rider mode it is what Rider answered for the site (cached 60 s), else the
 * static configuration. Server-rendered pages receive it in the payload; this
 * route is only for a page rendered without SSR. Holds no secret.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event).public.captcha as unknown as CaptchaPublicConfig
  setResponseHeader(event, 'cache-control', 'no-store')
  return resolvePublicConfig(config, nitroFetch)
})
