import { defineNuxtPlugin, useRequestFetch, useRuntimeConfig, useScript, useState } from '#imports'
import type { Plugin } from '#app'
import { providers } from '#captcha-providers'
import { CAPTCHA_RUNTIME } from './controller'
import type { CaptchaRuntime, ScriptRequest } from './controller'
import type { CaptchaConsentSeam, CaptchaPublicConfig } from './types'

/**
 * Provides the captcha runtime to <RevenexxCaptcha> and useCaptcha(). In rider
 * mode the server resolves the site's configuration (from Rider, cached) during
 * SSR and hands it to the browser in the payload, so the browser never calls Rider.
 */
const plugin: Plugin = defineNuxtPlugin({
  name: 'revenexx-captcha',
  async setup(nuxtApp) {
    const staticConfig = useRuntimeConfig().public.captcha as unknown as CaptchaPublicConfig
    const resolved = useState<CaptchaPublicConfig | null>('rvx-captcha-config', () => null)

    if (staticConfig.source === 'rider' && !resolved.value) {
      try {
        const fetcher = import.meta.server ? useRequestFetch() : $fetch
        resolved.value = await fetcher<CaptchaPublicConfig>('/_captcha/config')
      }
      catch {
        resolved.value = { ...staticConfig, resolvedFrom: 'config' }
      }
    }

    const consent = (): CaptchaConsentSeam | null => {
      if (!staticConfig.consentModule) return null
      const seam = (nuxtApp as unknown as { $consentProvider?: CaptchaConsentSeam }).$consentProvider
      // The consent module is installed but provides nothing: nothing that needs consent may load.
      return seam ?? { allows: () => false }
    }

    const runtime: CaptchaRuntime = {
      registry: providers,
      config: () => resolved.value ?? staticConfig,
      consent,
      loadScript(src: string, request: ScriptRequest) {
        return nuxtApp.runWithContext(() => {
          const seam = request.consent ? consent() : null
          const trigger = seam?.trigger && request.consent
            ? seam.trigger(request.consent.vendor, request.consent.purpose)
            : 'manual'
          const script = useScript({ src, key: request.key, crossorigin: false }, {
            trigger: trigger as 'manual',
            use: request.use as (() => Record<string, unknown>) | undefined,
          })
          return new Promise<unknown>((resolve, reject) => {
            script.onLoaded(instance => resolve(instance))
            script.onError(error => reject(error ?? new Error(`[captcha] ${src} failed to load`)))
            if (trigger === 'manual') script.load().catch(reject)
          })
        })
      },
    }

    nuxtApp.vueApp.provide(CAPTCHA_RUNTIME, runtime)
  },
})

export default plugin
