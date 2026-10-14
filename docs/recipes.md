# Cookbook

## A contact form

See the [quick start](../README.md#quick-start). The minimum on the server:

```ts
const result = await verifyCaptcha(event, body.captcha, { action: 'contact' })
if (!result.success) throw createError({ statusCode: 422, data: result.errors })
```

## A plain HTML form post

No JavaScript handler needed: the hidden input carries the token.

```vue
<form method="post" action="/api/contact">
  <input name="email">
  <RevenexxCaptcha action="contact" />
  <button>Senden</button>
</form>
```

```ts
const body = await readBody(event)          // form-encoded: { email, captcha }
const result = await verifyCaptcha(event, body.captcha, { action: 'contact' })
```

## Invisible on submit

```vue
<form @submit.prevent="send">
  …
  <RevenexxCaptcha v-model="token" action="signup" invisible />
  <button>Registrieren</button>
</form>
```

The challenge runs when the form is submitted; the form is then submitted again with the token,
so `send` sees `token` filled. Or drive it yourself:

```ts
const captcha = useCaptcha({ action: 'signup' })
async function send() {
  const token = await captcha.execute()
  await $fetch('/api/signup', { method: 'POST', body: { …, captcha: token } })
  captcha.reset()
}
```

## Another provider on one page

```vue
<RevenexxCaptcha provider="turnstile" action="login" v-model="token" />
```

```ts
await verifyCaptcha(event, body.captcha, { action: 'login', provider: 'turnstile' })
```

## Turnstile behind consent, RevenexxCaptcha meanwhile

```ts
modules: ['@nuxt/scripts', '@revenexx/consent-manager-nuxt', '@revenexx/captcha-nuxt'],
captcha: {
  provider: 'turnstile',
  fallback: 'revenexx',
  providers: {
    turnstile: { siteKey: '0x4AAA…', consentVendor: 'cloudflare-turnstile' },
    revenexx: { siteKey: '…' },
  },
},
```

Secrets: `NUXT_CAPTCHA_TURNSTILE_SECRET` and `NUXT_CAPTCHA_CAP_SECRET` (for the fallback). The
route needs nothing extra: it accepts `turnstile` and `revenexx` tokens.

## hCaptcha or reCAPTCHA behind consent

```ts
modules: ['@nuxt/scripts', '@revenexx/consent-manager-nuxt', '@revenexx/captcha-nuxt'],
captcha: {
  provider: 'recaptcha',            // or 'hcaptcha'
  fallback: 'revenexx',
  providers: {
    recaptcha: { siteKey: '6L…', version: 'v3' },   // vendor google-recaptcha
    hcaptcha: { siteKey: '…' },                      // vendor hcaptcha
    revenexx: { siteKey: '…' },
  },
},
```

Secrets: `NUXT_CAPTCHA_RECAPTCHA_SECRET` (or `NUXT_CAPTCHA_HCAPTCHA_SECRET`) and
`NUXT_CAPTCHA_CAP_SECRET` for the fallback. The route stays as it is; with reCAPTCHA v3 it may
set its own threshold:

```ts
const result = await verifyCaptcha(event, body.captcha, { action: 'contact', minScore: 0.7 })
if (result.errors.includes('low_score')) { /* ask for a second factor instead of refusing */ }
```

## reCAPTCHA v3 without the badge

```ts
captcha: {
  provider: 'recaptcha',
  providers: { recaptcha: { siteKey: '6L…', version: 'v3', hideBadge: true } },
  labels: { recaptchaNotice: 'This site is protected by reCAPTCHA.' },
},
```

Google allows hiding the badge only when the form says the site is protected by reCAPTCHA.
`<RevenexxCaptcha>` shows `labels.recaptchaNotice` for v3 in any case. With `useCaptcha()` there
is no component, so write the sentence next to your form yourself.

## A self-hosted Cap

Run Cap standalone ([docs](https://trycap.dev/guide/standalone/)) with
`ENABLE_ASSETS_SERVER=true`, create a site key, and allow your shop's origin in the key's CORS
settings if you restrict them.

```ts
captcha: {
  provider: 'cap',
  providers: { cap: { endpoint: 'https://cap.example.com', siteKey: '…' } },
},
```

```bash
NUXT_CAPTCHA_CAP_SECRET=sk-…
NUXT_CAPTCHA_CAP_VERIFY_ENDPOINT=http://cap:3000   # optional: siteverify over the internal network
```

## Rider mode (revenexx tenants)

```ts
captcha: { source: 'rider', rider: { site: 'rcs_…' } },
```

```bash
NUXT_CAPTCHA_RIDER_TOKEN=…
```

Change the provider in Rider; the shop picks it up within 60 seconds, without a deploy.

## A custom provider

See [Custom providers](../README.md#custom-providers) and the built-ins in
`src/runtime/providers/`. A provider with its own box (`meta.ui: 'own'`) only implements
`client.execute()` and returns the raw token:

```ts
export default defineCaptchaProvider<{ endpoint: string }, null>({
  name: 'pow',
  meta: { consent: 'none', region: 'self-hosted', invisible: true, score: false, action: false, ui: 'own' },
  client: {
    load() {},
    render: () => null,
    async execute(_handle, ctx) {
      const { solve } = await import('my-pow-solver')
      return solve(ctx.options.endpoint)
    },
    reset() {},
  },
  server: {
    async verify(ctx, { token, action }) {
      const res = await ctx.fetch(`${ctx.options.endpoint}/verify`, { method: 'POST', body: { token, secret: ctx.secrets.secret } })
      return res.status === 200
        ? { success: true, provider: 'pow', action, errors: [] }
        : { success: false, provider: 'pow', errors: [res.status >= 500 ? 'provider_unavailable' : 'invalid'] }
    },
  },
})
```

## Tests and local development

```ts
captcha: { provider: process.env.CI ? 'test' : 'revenexx' }   // evaluated at build time
```

With `test`, the box hands out `pass` and the server accepts `rvx1.test.pass` and refuses
`rvx1.test.fail`, so end-to-end tests post fixed tokens. Run the server with `NODE_ENV=test`
(or development): under `NODE_ENV=production`, `test` and `none` refuse every token.

You can also switch at runtime without a rebuild: `NUXT_PUBLIC_CAPTCHA_PROVIDER=test`.
