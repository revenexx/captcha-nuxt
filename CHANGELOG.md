# @revenexx/captcha-nuxt

## 0.2.0

### Minor Changes

- 54f6d97: Adds hCaptcha and Google reCAPTCHA v2/v3 as built-in providers. Set `captcha.provider` to `'hcaptcha'` or `'recaptcha'`, put the site key under `captcha.providers.<name>.siteKey` and the secret in `NUXT_CAPTCHA_HCAPTCHA_SECRET` or `NUXT_CAPTCHA_RECAPTCHA_SECRET`. Both load through `@nuxt/scripts`, need consent (vendors `hcaptcha` and `google-recaptcha`, overridable with `consentVendor`) and fall back to RevenexxCaptcha without it, like Turnstile.

  - reCAPTCHA takes `version: 'v2'` (the default: the checkbox, or invisible with `invisible` / `useCaptcha()`) or `'v3'`. With v3 the component draws no box, only the line "Diese Website ist durch reCAPTCHA geschützt." (`labels.recaptchaNotice`), and `verifyCaptcha()` reports `score` and `action`, refuses a score below 0.5 as `low_score` (change it with `providers.recaptcha.minScore` or `verifyCaptcha`'s `minScore`) and a token made for another action as `action_mismatch`. Google's badge stays visible; `hideBadge: true` hides it, which Google allows only when the form says it is protected by reCAPTCHA. reCAPTCHA Enterprise is not supported yet.
  - hCaptcha runs as its checkbox widget or invisibly. A reused token is `replayed`. An hCaptcha Enterprise score is reported so that higher means more human, like every other score.
  - In rider mode, Rider's site answer may carry the provider's public `options` (for reCAPTCHA `{ version }`), which are merged into the provider's options, and Rider's `score` is passed through.
  - `CaptchaLabels` gains `recaptchaNotice`, and a provider's `server.verify()` now also receives the route's `minScore`. Nothing changes for existing configurations.

## 0.1.1

### Patch Changes

- 8011a04: Published from CI with npm provenance, so the package's origin can be verified with `npm audit signatures`. Nothing changes in the module.

## 0.1.0

### Minor Changes

- 28f6111: First release: one captcha component (`<RevenexxCaptcha>`) and one server function (`verifyCaptcha()`) for Nuxt, with the provider switched by configuration, like Nuxt Image does for images. Ships the privacy-friendly RevenexxCaptcha and any self-hosted Cap with an own accessible box (no third-party link, nothing loaded from a CDN), Friendly Captcha v2, Cloudflare Turnstile, and `none`/`test` for development. Tokens travel as `rvx1.<provider>.<token>`, so the server verifies at the provider that issued them. Providers that need consent wait for `@revenexx/consent-manager-nuxt` and fall back to RevenexxCaptcha meanwhile. `useCaptcha()` runs invisibly, `defineCaptchaProvider()` adds your own provider, and `source: 'rider'` takes provider and site keys per tenant from the revenexx platform. Secrets are read at runtime only.
