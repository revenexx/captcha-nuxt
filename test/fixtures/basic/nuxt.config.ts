import Captcha from '../../../src/module'

export default defineNuxtConfig({
  modules: ['@nuxt/scripts', Captcha],
  compatibilityDate: '2025-10-01',
  captcha: { provider: 'test', fallback: false },
})
