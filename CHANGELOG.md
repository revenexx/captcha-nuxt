# @revenexx/captcha-nuxt

## 0.1.0

### Minor Changes

- 28f6111: First release: one captcha component (`<RevenexxCaptcha>`) and one server function (`verifyCaptcha()`) for Nuxt, with the provider switched by configuration, like Nuxt Image does for images. Ships the privacy-friendly RevenexxCaptcha and any self-hosted Cap with an own accessible box (no third-party link, nothing loaded from a CDN), Friendly Captcha v2, Cloudflare Turnstile, and `none`/`test` for development. Tokens travel as `rvx1.<provider>.<token>`, so the server verifies at the provider that issued them. Providers that need consent wait for `@revenexx/consent-manager-nuxt` and fall back to RevenexxCaptcha meanwhile. `useCaptcha()` runs invisibly, `defineCaptchaProvider()` adds your own provider, and `source: 'rider'` takes provider and site keys per tenant from the revenexx platform. Secrets are read at runtime only.
