import { getCurrentScope, inject, onScopeDispose, readonly } from 'vue'
import { CAPTCHA_RUNTIME, createCaptchaController } from '../controller'

export interface UseCaptchaOptions {
  /** The action the server expects. */
  action?: string
  /** Use another provider than the configured one. */
  provider?: string
}

/**
 * The invisible mode: no box, the challenge runs when you call `execute()`.
 *
 *   const captcha = useCaptcha({ action: 'newsletter' })
 *   async function submit() {
 *     const token = await captcha.execute()
 *     await $fetch('/api/newsletter', { method: 'POST', body: { email, captcha: token } })
 *     captcha.reset()
 *   }
 *
 * A provider that needs to show a challenge (Turnstile in interaction-only
 * mode, Friendly Captcha) renders it in a small container of its own.
 */
export function useCaptcha(options: UseCaptchaOptions = {}) {
  const runtime = inject(CAPTCHA_RUNTIME, null)
  if (!runtime) throw new Error('[captcha] useCaptcha() needs the @revenexx/captcha-nuxt module')
  const captcha = createCaptchaController(runtime, { ...options, invisible: true })
  if (getCurrentScope()) onScopeDispose(() => captcha.destroy())
  return {
    /** Runs the challenge and resolves with the enveloped token. */
    execute: captcha.execute,
    /** Forgets the token; the next `execute()` runs a new challenge. */
    reset: captcha.reset,
    token: readonly(captcha.token),
    state: readonly(captcha.state),
    /** The provider that runs (the fallback when consent is missing). */
    provider: captcha.provider,
  }
}
