import Captcha from '../../../src/module'

// Rider's URL and token come from the environment at runtime (see test/e2e/rider.test.ts).
export default defineNuxtConfig({
  modules: ['@nuxt/scripts', Captcha],
  compatibilityDate: '2025-10-01',
  captcha: {
    provider: 'turnstile',
    source: 'rider',
    rider: { site: 'rcs_fixture' },
  },
})
