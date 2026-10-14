import Captcha from '../../../src/module'

// Built by test/e2e/build-credentials.test.ts with every secret variable set
// to a canary; none of them may end up in .output.
export default defineNuxtConfig({
  modules: ['@nuxt/scripts', Captcha],
  compatibilityDate: '2025-10-01',
  captcha: {
    provider: 'turnstile',
    source: 'rider',
    rider: { site: 'rcs_fixture' },
    providers: { turnstile: { siteKey: '1x00000000000000000000AA' } },
  },
})
