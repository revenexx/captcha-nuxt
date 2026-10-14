export default defineNuxtConfig({
  modules: ['@nuxt/scripts', '../src/module'],
  devtools: { enabled: true },
  compatibilityDate: '2025-10-01',
  captcha: {
    // 'test' works without any account. Switch to 'revenexx' or 'cap' and set
    // the endpoint and site key (NUXT_PUBLIC_CAPTCHA_PROVIDERS_CAP_ENDPOINT,
    // NUXT_PUBLIC_CAPTCHA_PROVIDERS_CAP_SITE_KEY) and the secret
    // (NUXT_CAPTCHA_CAP_SECRET) in playground/.env.
    provider: 'test',
    fallback: false,
    providers: {
      test: { delay: 600 },
    },
  },
})
