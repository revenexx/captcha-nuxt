<div align="center">

# @revenexx/captcha-nuxt

**One captcha component and one server function for Nuxt. The provider is configuration.**
`<RevenexxCaptcha>` puts a token into your form, `verifyCaptcha()` checks it on the server, and
`captcha.provider` decides who does the work: the privacy-friendly RevenexxCaptcha, any
self-hosted [Cap](https://github.com/tiagozip/cap), Friendly Captcha, Cloudflare Turnstile or a
provider of your own. Switching providers changes no page and no route.

[![npm version](https://img.shields.io/npm/v/@revenexx/captcha-nuxt?color=2B90B6)](https://www.npmjs.com/package/@revenexx/captcha-nuxt)
[![npm downloads](https://img.shields.io/npm/dm/@revenexx/captcha-nuxt?color=2B90B6)](https://www.npmjs.com/package/@revenexx/captcha-nuxt)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

</div>

---

## Why

- 🔁 **Provider adapter, like Nuxt Image.** One component, one composable, one server function.
  Moving from Turnstile to Cap is a line in `nuxt.config`, or a setting per tenant.
- 🛡️ **Privacy-friendly default.** The default provider, RevenexxCaptcha, is proof of work on
  [Cap](https://github.com/tiagozip/cap): no cookies, no tracking, no third-party script. It
  needs no consent and runs where the consent for a third-party captcha is missing.
- 🧩 **An own, accessible box.** Cap-based providers render the module's box: a real checkbox
  button, a live status for screen readers, dark mode, CSS variables and a slot for your own UI.
  No widget of someone else, no link to a third party, nothing from a CDN.
- ✉️ **Tokens that say where they come from.** Every token reads `rvx1.<provider>.<token>`, so the
  server verifies at the provider that actually issued it, also after a fallback, and refuses
  tokens of providers your shop does not use.
- 🍪 **Consent-aware.** With [`@revenexx/consent-manager-nuxt`](https://github.com/revenexx/consent-manager-nuxt)
  installed, Turnstile loads only once its vendor is allowed. Until then the fallback renders.
- 🔐 **Secrets at runtime only.** Site secrets and API keys are server-only runtime config, read
  from the environment per process. They are never part of `nuxt.config`, the build or the page.
- 🏢 **Per tenant through the revenexx platform.** With `source: 'rider'`, provider and site keys
  come from Rider at runtime, and Rider verifies with the tenant's secrets.
- 👻 **Invisible when you want it.** `useCaptcha().execute()` runs the challenge without a box.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Like Nuxt Image, for captchas](#like-nuxt-image-for-captchas)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Credentials and runtime config](#credentials-and-runtime-config)
- [`<RevenexxCaptcha>`](#revenexxcaptcha)
- [`useCaptcha()`](#usecaptcha)
- [`verifyCaptcha()` and `CaptchaResult`](#verifycaptcha-and-captcharesult)
- [Providers](#providers)
- [Custom providers](#custom-providers)
- [Consent and fallback](#consent-and-fallback)
- [Rider mode](#rider-mode)
- [Security notes](#security-notes)
- [Theming](#theming)
- [TypeScript](#typescript)
- [Compatibility](#compatibility)
- [Troubleshooting](#troubleshooting)
- [Acknowledgements](#acknowledgements)
- [Development and releasing](#development-and-releasing)

## Installation

```bash
npm i @revenexx/captcha-nuxt @nuxt/scripts     # or pnpm add / yarn add
```

`@nuxt/scripts` is a peer dependency: third-party captcha scripts (Turnstile) load through it.
The module installs it for you if it is missing from `modules`.

## Quick start

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@nuxt/scripts', '@revenexx/captcha-nuxt'],
  captcha: {
    provider: 'revenexx',
    providers: {
      revenexx: { siteKey: 'your-site-key' }, // public; the secret goes in the environment
    },
  },
})
```

```bash
# .env on the server, never in the repository
NUXT_CAPTCHA_CAP_SECRET=<the site's secret key>
```

```vue
<!-- pages/contact.vue -->
<script setup lang="ts">
const form = reactive({ name: '', message: '', captcha: '' })
async function send() {
  await $fetch('/api/contact', { method: 'POST', body: form })
}
</script>

<template>
  <form @submit.prevent="send">
    <input v-model="form.name" name="name">
    <textarea v-model="form.message" name="message" />
    <RevenexxCaptcha v-model="form.captcha" action="contact" />
    <button :disabled="!form.captcha">Senden</button>
  </form>
</template>
```

```ts
// server/api/contact.post.ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const result = await verifyCaptcha(event, body.captcha, { action: 'contact' })
  if (!result.success) throw createError({ statusCode: 422, data: result.errors })
  // … the token was valid, and it is used up now
})
```

`<RevenexxCaptcha>`, `useCaptcha()` and `defineCaptchaProvider()` are auto-imported in the app,
`verifyCaptcha()` and `defineCaptchaProvider()` in Nitro. A plain HTML form post works too: the
component renders a hidden input named `captcha` that carries the token.

## Like Nuxt Image, for captchas

| | Nuxt Image | this module |
| --- | --- | --- |
| What a page uses | `<NuxtImg>` | `<RevenexxCaptcha>`, `useCaptcha()` |
| What a route uses | (none) | `verifyCaptcha(event, token, { action })` |
| Choosing the service | `image.provider` | `captcha.provider` |
| Options per service | `image.providers.<name>` | `captcha.providers.<name>` |
| Override per use | `<NuxtImg provider="…">` | `<RevenexxCaptcha provider="…">` |
| Your own service | `defineProvider()` in a file, registered by path | `defineCaptchaProvider()` in a file, registered by path |
| Built-in services use the same interface | yes | yes |

## How it works

```
nuxt.config: captcha.provider ─┐          (or Rider, per tenant, with source: 'rider')
                               ▼
SSR ──► <RevenexxCaptcha>: provider chosen (consent? → fallback), box or widget container,
        <input type="hidden" name="captcha" value="">
browser ──► provider loads (Cap solver from the Cap instance / SDK / @nuxt/scripts)
        ──► visitor ticks the box, or useCaptcha().execute() runs it invisibly
        ──► token = rvx1.<provider>.<raw token> → hidden input + v-model
form post ──► your route ──► verifyCaptcha(event, token, { action })
                               ├─ config mode: siteverify at <provider> (Cap, Friendly, Turnstile)
                               └─ rider mode:  POST Rider /api/v1/public/captcha/verify
                               ▼
                             CaptchaResult { success, provider, action, score?, errors }
```

## Configuration

All options go under `captcha` in `nuxt.config.ts`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `provider` | `string` | `'revenexx'` | `'revenexx'`, `'cap'`, `'friendly'`, `'turnstile'`, `'none'`, `'test'` or the name of a custom provider. |
| `source` | `'config' \| 'rider'` | `'config'` | `'rider'`: provider and site keys come from Rider at runtime, see [Rider mode](#rider-mode). |
| `fallback` | `string \| false` | `'revenexx'` | Renders instead when the provider lacks consent or its script fails. `false`: no fallback, the box shows a notice. |
| `labels` | `Partial<CaptchaLabels>` | German texts | Overrides for every visible and announced text, see below. |
| `rider.url` | `string` | `'https://rider.revenexx.com'` | Rider's base URL. |
| `rider.site` | `string` | `''` | The public site id (`rcs_…`). |
| `providers.revenexx` | `{ endpoint, siteKey }` | `{ endpoint: 'https://captcha.revenexx.com', siteKey: '' }` | RevenexxCaptcha. |
| `providers.cap` | `{ endpoint, siteKey }` | `{ endpoint: '', siteKey: '' }` | Any Cap instance (`endpoint` without the site key, e.g. `https://cap.example.com`). |
| `providers.friendly` | `{ siteKey, region, language?, startMode?, theme? }` | `{ siteKey: '', region: 'eu' }` | Friendly Captcha v2. `region`: `'eu'` or `'global'`. |
| `providers.turnstile` | `{ siteKey, theme?, size?, language? }` | `{ siteKey: '' }` | Cloudflare Turnstile. |
| `providers.test` | `{ token?, delay? }` | `{}` | The token the test box hands out (`'pass'`) and a delay in ms. |
| `providers.<name>` | `{ provider: '~/captcha/my-provider', … }` | | A custom provider file, plus its public options. |
| `providers.<name>.consentVendor` / `.consentPurpose` | `string` | the provider's | The vendor (and purpose) code in your consent policy. |
| `forwardIp` | `boolean` | `true` | Send the visitor's address (`getRequestIP(event, { xForwardedFor: true })`) as `remoteip` to Turnstile and Rider. |

**Labels.** German defaults, each overridable through `captcha.labels`:

| Key | Default |
| --- | --- |
| `verify` | Ich bin kein Roboter |
| `verifying` | Wird geprüft … |
| `done` | Erfolgreich geprüft |
| `error` | Prüfung fehlgeschlagen. Bitte erneut versuchen. |
| `expired` | Prüfung abgelaufen. Bitte erneut bestätigen. |
| `group` | Schutz vor automatisierten Anfragen (accessible name of the box) |
| `consentRequired` | Diese Prüfung wird erst nach Ihrer Einwilligung geladen. |
| `unavailable` | Die Prüfung ist gerade nicht verfügbar. |
| `brand` | RevenexxCaptcha |

For a multilingual shop, render your own box through the [slot](#revenexxcaptcha), which
receives the labels and leaves the texts to your i18n.

## Credentials and runtime config

Secrets are **server-only runtime config**. The module declares them empty; you fill them
through the environment of the running server. They are never set in `nuxt.config`, never part
of the build and never sent to the browser.

| Environment variable | Used for | Side |
| --- | --- | --- |
| `NUXT_CAPTCHA_CAP_SECRET` | the Cap site secret, for `cap` and for `revenexx` in config mode | server |
| `NUXT_CAPTCHA_CAP_VERIFY_ENDPOINT` | optional internal URL for Cap's siteverify (e.g. `http://cap.internal:3000`), instead of the public `endpoint` | server |
| `NUXT_CAPTCHA_FRIENDLY_API_KEY` | Friendly Captcha API key (`X-API-Key`) | server |
| `NUXT_CAPTCHA_TURNSTILE_SECRET` | Turnstile secret key | server |
| `NUXT_CAPTCHA_RIDER_TOKEN` | the shop's Bearer token for Rider (rider mode) | server |
| `NUXT_CAPTCHA_FORWARD_IP` | `false` to stop sending `remoteip` | server |
| `NUXT_PUBLIC_CAPTCHA_PROVIDER`, `NUXT_PUBLIC_CAPTCHA_FALLBACK`, `NUXT_PUBLIC_CAPTCHA_SOURCE` | switch the provider at runtime | public |
| `NUXT_PUBLIC_CAPTCHA_PROVIDERS_<NAME>_SITE_KEY`, `…_<NAME>_ENDPOINT`, `…_FRIENDLY_REGION` | site keys and endpoints, e.g. `NUXT_PUBLIC_CAPTCHA_PROVIDERS_TURNSTILE_SITE_KEY` | public |
| `NUXT_PUBLIC_CAPTCHA_RIDER_URL`, `NUXT_PUBLIC_CAPTCHA_RIDER_SITE` | Rider's URL and the site id | public |

Public values (site keys, endpoints) are fine in `nuxt.config` or in the environment; they end up
in the page anyway. A custom provider's secrets go under `runtimeConfig.captcha.secrets.<name>`:
declare the keys empty in `nuxt.config` and fill them with
`NUXT_CAPTCHA_SECRETS_<NAME>_<KEY>` at runtime; the provider receives them as `ctx.secrets`.

## `<RevenexxCaptcha>`

```vue
<RevenexxCaptcha
  v-model="token"
  action="contact"
  name="captcha"
  @solve="onSolve"
  @error="onError"
  @expire="onExpire"
/>
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `action` | `string` | | The action the server expects. Turnstile binds it into the token; for others it is checked against `verifyCaptcha`'s `action`. |
| `v-model` | `string` | `''` | The enveloped token. Cleared on expiry and on error; clearing it resets the captcha. |
| `provider` | `string` | `captcha.provider` | Use another provider here. The route has to accept it: `verifyCaptcha(event, token, { provider: 'turnstile' })`. |
| `invisible` | `boolean` | `false` | No box. The challenge runs when the surrounding `<form>` is submitted; the form is submitted again with the token. |
| `name` | `string` | `'captcha'` | The name of the hidden input. |

| Event | Payload | When |
| --- | --- | --- |
| `solve` | `token` | the challenge was solved |
| `error` | `error` | the challenge failed, or no provider could load |
| `expire` | | the token expired before the form was sent |

**States.** `idle` → `verifying` (with progress) → `done`, or `error` / `expired`. The root
element carries `data-captcha-state`, `data-captcha-provider` and, when the fallback runs,
`data-captcha-fallback="consent" | "failed"`.

**Accessibility.** The own box is a `role="group"` named by `labels.group`, holding one
`<button role="checkbox" aria-checked>` (keyboard: Tab, Space/Enter) with `aria-busy` while
verifying. A visually hidden `role="status" aria-live="polite"` region announces each state.

**Headless.** The default slot replaces the box and receives
`{ state, token, provider, progress, labels, execute, reset }`. The hidden input stays.
Widget providers (Friendly Captcha, Turnstile) render their own widget; the slot is meant for
the own-box providers.

```vue
<RevenexxCaptcha v-slot="{ state, execute, labels }" v-model="token" action="contact">
  <MyButton :loading="state === 'verifying'" @click="execute">{{ labels.verify }}</MyButton>
</RevenexxCaptcha>
```

Through a template ref, the component exposes `execute()`, `reset()`, `state`, `token` and
`provider`.

## `useCaptcha()`

The invisible mode: no box, the challenge runs when you call `execute()`.

```ts
const captcha = useCaptcha({ action: 'newsletter' })

async function subscribe() {
  const token = await captcha.execute()            // 'rvx1.revenexx.…'
  await $fetch('/api/newsletter', { method: 'POST', body: { email, captcha: token } })
  captcha.reset()                                    // a token is valid once
}
```

| Returns | Type | |
| --- | --- | --- |
| `execute()` | `() => Promise<string>` | Loads the provider if needed, runs the challenge, resolves with the enveloped token. Rejects when it fails. |
| `reset()` | `() => void` | Forgets the token; the next `execute()` runs a new challenge. |
| `token` | `Readonly<Ref<string>>` | |
| `state` | `Readonly<Ref<CaptchaState>>` | |
| `provider` | `ComputedRef<string>` | The provider that runs (the fallback when consent is missing). |

Options: `action`, `provider`. Call it in `setup`. Cap-based providers and Turnstile
(`execution: 'execute'`, `appearance: 'interaction-only'`) run without UI; Turnstile shows a
challenge in a small container only if Cloudflare asks for an interaction. Friendly Captcha has
no invisible mode; its widget renders in that container.

## `verifyCaptcha()` and `CaptchaResult`

```ts
verifyCaptcha(event: H3Event, token: unknown, options?: {
  action?: string            // expected action
  provider?: string | string[] // providers accepted in addition to provider + fallback
  minScore?: number          // refuse a score below this (providers that report one)
}): Promise<CaptchaResult>

interface CaptchaResult {
  success: boolean
  provider: string             // the provider that verified (from the envelope)
  action?: string              // confirmed action (providers without binding: the expected one)
  score?: number
  errors: Array<'missing' | 'invalid' | 'expired' | 'replayed' | 'action_mismatch'
              | 'low_score' | 'provider_unavailable' | 'misconfigured'>
}
```

It never throws. Decide on `success`, and use `errors` for logging and messages:

| Error | Meaning | Typical answer |
| --- | --- | --- |
| `missing` | no token was sent | 422, ask to solve the captcha |
| `invalid` | unknown, malformed or already used token (Cap, Turnstile), or a provider the shop does not accept | 422 |
| `expired` | the token expired (Turnstile also reports a reused token this way) | 422, ask to solve again |
| `replayed` | the provider reports reuse (Friendly Captcha, Rider) | 422 |
| `action_mismatch` | solved for another action | 422 |
| `low_score` | below `minScore` | 422 or a second factor |
| `provider_unavailable` | network error, timeout (5 s) or 5xx at the provider or Rider | 503, or let it pass by your own policy |
| `misconfigured` | missing or wrong secret, site key or Rider token; `none`/`test` in production | 500, fix the configuration |

## Providers

| Provider | UI | Consent | Region | Invisible | Score | Action binding | Server needs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `revenexx` | own box + brand line | none | EU (operated by revenexx) | ✓ | — | — (checked against the expected one) | `NUXT_CAPTCHA_CAP_SECRET` (config mode) |
| `cap` | own box | none | self-hosted | ✓ | — | — | `NUXT_CAPTCHA_CAP_SECRET` |
| `friendly` | Friendly Captcha widget | none | EU (`region: 'eu'`) or global | — | — | — | `NUXT_CAPTCHA_FRIENDLY_API_KEY` |
| `turnstile` | Turnstile widget | **required** (`cloudflare-turnstile`) | global (Cloudflare) | ✓ | — | ✓ | `NUXT_CAPTCHA_TURNSTILE_SECRET` |
| `none` | nothing | none | local | ✓ | — | — | never in production |
| `test` | own box | none | local | ✓ | — | — | never in production |

**revenexx / cap.** Proof of work on [Cap](https://github.com/tiagozip/cap). The browser solves
through Cap's documented programmatic mode, `new Cap({ apiEndpoint }).solve()`, from the npm
package `@cap.js/widget` (0.1.58), bundled with your app and loaded on demand. Before it loads,
the module points Cap's solver at the instance's own wasm files
(`<endpoint>/assets/cap_wasm_bg.wasm`, `<endpoint>/assets/hashwx.wasm`), so nothing comes from
a CDN; run Cap standalone with `ENABLE_ASSETS_SERVER=true`. Cap's own `<cap-widget>` is not
shown, because its UI always links to trycap.dev; the module draws its own box instead. The
server posts `{ secret, response }` to `<verify endpoint or endpoint>/<siteKey>/siteverify`. A
Cap token is valid once. `revenexx` is `cap` with `https://captcha.revenexx.com` and the brand
line.

**friendly.** Friendly Captcha v2 through `@friendlycaptcha/sdk`, imported on demand. The server
posts to `https://{eu|global}.frcapi.com/api/v2/captcha/siteverify` with `X-API-Key`. Use
`region: 'eu'` for EU-only processing (the default).

**turnstile.** `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, loaded
through `@nuxt/scripts`, rendered explicitly with `action`. The server posts `secret`,
`response`, `remoteip` (when `forwardIp`) and an idempotency key to Cloudflare's siteverify and
refuses a token solved for another action. Cloudflare limits `action` to 32 characters of
letters, digits, `_` and `-`.

**none / test.** `none` accepts everything; `test` accepts `pass` and refuses `fail`. Both
refuse every token as `misconfigured` when the server runs with `NODE_ENV=production`, decided
at runtime, and a production build warns about them.

## Custom providers

A provider is a file with a default export, registered by path, like a Nuxt Image provider:

```ts
// nuxt.config.ts
captcha: {
  provider: 'acme',
  providers: {
    acme: { provider: '~/captcha/acme', siteKey: 'public-key' },
  },
},
runtimeConfig: {
  captcha: { secrets: { acme: { secret: '' } } }, // filled by NUXT_CAPTCHA_SECRETS_ACME_SECRET
},
```

```ts
// captcha/acme.ts
export default defineCaptchaProvider<{ siteKey: string }, { id: string }>({
  name: 'acme',
  meta: { consent: 'required', vendor: 'acme', region: 'eu', invisible: true, score: true, action: true, ui: 'widget' },
  client: {
    async load(ctx) {
      // Browser only. Third-party scripts through ctx.loadScript (consent-gated when meta.consent is 'required'),
      // npm SDKs with a dynamic import().
      await ctx.loadScript('https://acme.example/api.js', { use: () => window.acme })
    },
    render(ctx, el, events) {
      const id = window.acme.render(el, { sitekey: ctx.options.siteKey, action: ctx.action, onSolve: events.solve })
      return { id }
    },
    execute: handle => window.acme.execute(handle.id), // or return the raw token
    reset: handle => window.acme.reset(handle.id),
  },
  server: {
    async verify(ctx, { token, action, remoteip }) {
      try {
        const res = await ctx.fetch('https://acme.example/verify', { method: 'POST', body: { secret: ctx.secrets.secret, token, remoteip }, timeout: ctx.timeout })
        const data = res.data as { ok: boolean, action: string, score: number }
        return data.ok
          ? { success: true, provider: 'acme', action: data.action, score: data.score, errors: [] }
          : { success: false, provider: 'acme', errors: ['invalid'] }
      }
      catch {
        return { success: false, provider: 'acme', errors: ['provider_unavailable'] }
      }
    },
  },
})
```

The built-in providers are written exactly this way (see `src/runtime/providers/`). Notes:

- `meta.ui`: `'own'` renders the module's box and calls `client.execute()` on click,
  `'widget'` renders your widget into a container, `'none'` solves at once without UI.
- `client.execute()` may return the raw token or report it through `events.solve`. The module
  wraps it into the envelope; never build the envelope yourself.
- `ctx.fetch` answers `{ status, data }` and never throws on an HTTP status, only on a network
  error or timeout.
- After `verify`, the module checks `action` (when your result reports one) and `minScore`.
- Provider names may contain letters, digits, `-` and `_` (no dots: they are part of the envelope).
- `defineCaptchaProvider` is auto-imported in the app and in Nitro, and exported from the
  package root for types.

## Consent and fallback

A provider with `meta.consent: 'required'` (Turnstile, or your own) asks before it loads:

- **With [`@revenexx/consent-manager-nuxt`](https://github.com/revenexx/consent-manager-nuxt)
  installed**, the module asks its `$consentProvider.allows(vendor, purpose)`. The vendor is
  `cloudflare-turnstile` for Turnstile (override with `providers.turnstile.consentVendor` /
  `consentPurpose` to match your policy's codes). Without consent, the **fallback** renders
  instead (RevenexxCaptcha by default), its token carries `rvx1.revenexx.…`, and the server
  verifies it there. The Turnstile script is also loaded through the consent manager's
  `@nuxt/scripts` trigger. When the visitor allows the vendor later, the box switches to the
  provider unless it was already solved.
- **Without the consent module**, such providers load directly. Your theme owns consent then:
  render the component only once your own consent solution allows the vendor, or pick a
  provider that needs none.
- With `fallback: false` and no consent, the box shows `labels.consentRequired` and the form
  cannot be sent with a token. A provider whose script fails to load is replaced by the
  fallback the same way.

The server accepts tokens of `provider` and `fallback`, so a fallback token needs nothing in
your route.

## Rider mode

Rider is the revenexx platform service that configures captchas per tenant. With
`source: 'rider'`, the shop holds no provider secret at all:

```ts
captcha: {
  source: 'rider',
  rider: { site: 'rcs_…' },            // public site id; url defaults to https://rider.revenexx.com
},
```

```bash
NUXT_CAPTCHA_RIDER_TOKEN=<the shop's Rider token>
```

- **Configuration.** During SSR the server reads
  `GET {rider.url}/api/v1/public/captcha/sites/{site}` →
  `{ data: { site, provider, site_key, fallback, revenexx: { endpoint, site_key } } }`, caches
  it per process for 60 s (requests in flight are shared, failures are not cached) and hands it
  to the browser in the payload. The browser never calls Rider. If Rider cannot be reached, the
  static `nuxt.config` configuration applies.
- **Verification.** `verifyCaptcha()` posts
  `{ token: <full enveloped token>, action?, remoteip? }` to
  `{rider.url}/api/v1/public/captcha/verify` with `Authorization: Bearer <NUXT_CAPTCHA_RIDER_TOKEN>`
  and returns Rider's `CaptchaResult`. A missing or unknown token (401) is `misconfigured`, a
  network error, timeout (5 s) or 5xx is `provider_unavailable`.
- `GET /_captcha/config` returns the resolved public configuration, for pages rendered without
  SSR. It holds no secret.

## Security notes

- **Secrets at runtime only.** The module reads no environment variable while `nuxt build` runs.
  A test builds a fixture with every `NUXT_CAPTCHA_*` secret set to a canary and asserts none of
  them is in `.output`. Do not write secrets into `nuxt.config`.
- **Replay.** Verify every token on the server, once, before you act on the form. Cap and
  Turnstile tokens are single-use, and a second verification fails (`invalid` / `expired`).
  Call `reset()` (or let the component reset) after a submit.
- **Action binding.** Pass `action` on both sides. Turnstile binds it into the token and a
  mismatch fails as `action_mismatch`. Cap and Friendly Captcha bind no action; there the action
  separates your forms in logs and in Rider, not cryptographically.
- **Only your providers.** A token naming a provider the shop does not accept (for example a
  forged `rvx1.none.x`) is `invalid` without any call. `none` and `test` refuse every token in
  production.
- **Fail closed.** `verifyCaptcha()` returns `success: false` on any doubt, including
  timeouts. Whether you let a form through when the provider is down is your decision; the
  result tells you (`provider_unavailable`).
- **IP addresses.** With `forwardIp` (default), the visitor's address goes to Turnstile and to
  Rider as `remoteip`; Cap and Friendly Captcha receive none. Set `forwardIp: false` if your
  privacy notice does not cover it.

## Theming

The own box is styled with CSS variables on `.rvx-captcha` and adapts to
`prefers-color-scheme: dark`:

```css
.rvx-captcha {
  --rvx-captcha-bg: #fff;
  --rvx-captcha-fg: #1a1a1a;
  --rvx-captcha-muted: #5b6370;
  --rvx-captcha-border: #d0d5dd;
  --rvx-captcha-accent: #0f2a44;     /* progress ring */
  --rvx-captcha-success: #1f7a4d;
  --rvx-captcha-error: #b42318;
  --rvx-captcha-radius: 8px;
  --rvx-captcha-focus: 3px solid #3b82f6;
  --rvx-captcha-width: 18rem;
}
```

Classes, data attributes and the slot are listed in [docs/theming.md](./docs/theming.md).

## TypeScript

```ts
import type {
  CaptchaResult, CaptchaError, CaptchaState, CaptchaLabels, CaptchaProviderDefinition,
  CaptchaProviderMeta, CaptchaClientContext, CaptchaServerContext, CaptchaWidgetEvents,
  CaptchaFetch, CaptchaPublicConfig, BuiltinProviderName, ModuleOptions,
} from '@revenexx/captcha-nuxt'
import { defineCaptchaProvider } from '@revenexx/captcha-nuxt' // or the auto-import
```

## Compatibility

| | |
| --- | --- |
| Nuxt | `>= 4.0.0` (SSR recommended) |
| `@nuxt/scripts` | `^1.0.0` (peer) |
| Node | `>= 20` |
| Cap | Cap standalone 3.x with the asset server; `@cap.js/widget` 0.1.58 |
| Consent | optional: `@revenexx/consent-manager-nuxt` |

## Troubleshooting

- **The box says "Die Prüfung ist gerade nicht verfügbar."** The provider could not load and
  there is no working fallback. For Cap: `endpoint` and `siteKey` must be set, and the browser
  must reach `<endpoint>/<siteKey>/challenge` (CORS) and `<endpoint>/assets/cap_wasm_bg.wasm`
  (`ENABLE_ASSETS_SERVER=true`).
- **Every verification is `misconfigured`.** The secret is missing in the server's environment
  (`NUXT_CAPTCHA_CAP_SECRET`, `…_FRIENDLY_API_KEY`, `…_TURNSTILE_SECRET`, or
  `NUXT_CAPTCHA_RIDER_TOKEN` in rider mode), or you run `none`/`test` with
  `NODE_ENV=production`.
- **`invalid` for a token that looked fine.** It was verified twice (single use), it names a
  provider your route does not accept (a `:provider` override needs
  `verifyCaptcha(…, { provider })`), or Cap's site key differs from the token's.
- **Turnstile never appears.** With the consent module installed, its vendor
  (`cloudflare-turnstile`, or your `consentVendor`) must exist in your published policy and be
  allowed; until then the fallback renders, which is intended.
- **Requests to cdn.jsdelivr.net.** Cap falls back to jsdelivr only when the custom wasm URLs
  are not set, which the module always does, or, for a decompression helper, in browsers without
  `DecompressionStream` (all current browsers have it).
- **`useCaptcha() needs the @revenexx/captcha-nuxt module`.** The composable was called outside
  the Nuxt app, or the module is not in `modules`.

## Acknowledgements

The `revenexx` and `cap` providers build on **[Cap](https://github.com/tiagozip/cap)** by
[tiagozip](https://github.com/tiagozip), the self-hosted proof-of-work CAPTCHA, licensed under
Apache-2.0. RevenexxCaptcha runs Cap standalone, and the browser solver is Cap's own
`@cap.js/widget`, used unmodified through its programmatic mode. Thank you for Cap. See
[NOTICE](./NOTICE).

Friendly Captcha's SDK (`@friendlycaptcha/sdk`, MPL-2.0) and Cloudflare Turnstile are used
through their public APIs.

## Development and releasing

```bash
pnpm install
pnpm dev:prepare && pnpm dev                    # playground/
pnpm lint && pnpm test:types && pnpm test && pnpm build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [documentation](./docs/index.md). Releases are
automated with [Changesets](https://github.com/changesets/changesets) and npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers), so no tokens are involved:

1. `pnpm changeset`: choose a bump and describe the change, then commit the new changeset file.
2. On push to `main`, the **Release** workflow opens a "Version Packages" PR.
3. Merging that PR bumps the version, updates [CHANGELOG.md](./CHANGELOG.md) and publishes to
   npm with provenance.

## License

[MIT](./LICENSE) © revenexx
