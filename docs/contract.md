# Contract

The normative part of the module: what other packages, services and custom providers can rely
on. A change here is a breaking change.

## Token envelope

Every token the browser hands out (hidden input, `v-model`, `solve`, `useCaptcha().execute()`)
has the form

```
rvx1.<provider>.<raw token>
```

- `rvx1` is the envelope version.
- `<provider>` is the name of the provider that issued the raw token (the fallback's name when
  the fallback ran). Provider names match `^[a-z][\w-]{0,63}$` (case-insensitive): no dots.
- `<raw token>` is the provider's token, unchanged. It may contain dots and colons.

The server splits on the **first two dots only**. A token that does not start with `rvx1.` is
treated as a raw token of the configured provider. `rvx1.` followed by no provider or no raw
token is `invalid`. Tokens longer than 16 384 characters are `invalid` without a call.

## Accepted providers

`verifyCaptcha()` verifies only tokens whose provider is the configured `provider`, the
`fallback`, or one named in `options.provider`. Any other provider is `invalid` without a call.
In rider mode Rider decides.

## `CaptchaResult`

```ts
interface CaptchaResult {
  success: boolean
  provider: string
  action?: string
  score?: number
  errors: CaptchaError[]
}
```

`success` is `true` exactly when `errors` is empty. After the provider answered, the module adds
`action_mismatch` when the result reports an action other than the expected one, and
`low_score` when `minScore` is set and the reported score is lower.

`score` is present only when the provider reported one, in `0..1` where **higher is more
human**: reCAPTCHA v3's score as Google reports it, hCaptcha Enterprise's score (which rates
malicious activity) as `1 - score`, and in rider mode whatever Rider reports (`null` counts as
none). A provider with its own default threshold (reCAPTCHA v3: `providers.recaptcha.minScore`,
default `0.5`) receives `verifyCaptcha`'s `minScore` as `input.minScore`, which wins over that
default.

| Error | Raised when |
| --- | --- |
| `missing` | the token is empty or not a string |
| `invalid` | a malformed envelope, a provider the shop does not accept, or the provider says invalid/unknown/used |
| `expired` | the provider says expired (Turnstile and reCAPTCHA: also `timeout-or-duplicate`) |
| `replayed` | the provider says already used (Friendly Captcha `response_duplicate`, hCaptcha `already-seen-response`, Rider) |
| `action_mismatch` | the token was solved for another action |
| `low_score` | the score is below `minScore` (reCAPTCHA v3: below `0.5` unless configured otherwise) |
| `provider_unavailable` | network error, timeout (5 s), 5xx, an unexpected answer, or a provider that threw |
| `misconfigured` | missing/wrong secret, site key or Rider token; `none`/`test` under `NODE_ENV=production` |

### Provider mappings

| Provider | Answer | Error |
| --- | --- | --- |
| Cap | 200 `{ success: true }` | (success) |
| Cap | 404 "Token not found", 400 | `invalid` |
| Cap | 403 "Token expired" | `expired` |
| Cap | 403/404 "Invalid site key or secret" | `misconfigured` |
| Cap | network, 5xx | `provider_unavailable` |
| Friendly Captcha | `auth_required`, `auth_invalid`, `sitekey_invalid` | `misconfigured` |
| Friendly Captcha | `response_missing` | `missing` |
| Friendly Captcha | `response_invalid`, `bad_request` | `invalid` |
| Friendly Captcha | `response_timeout` | `expired` |
| Friendly Captcha | `response_duplicate` | `replayed` |
| Turnstile | `missing-input-secret`, `invalid-input-secret` | `misconfigured` |
| Turnstile | `missing-input-response` | `missing` |
| Turnstile | `invalid-input-response`, `bad-request` | `invalid` |
| Turnstile | `timeout-or-duplicate` | `expired` |
| Turnstile | `internal-error`, 5xx | `provider_unavailable` |
| Turnstile | success with another `action` | `action_mismatch` |
| hCaptcha | `missing-input-secret`, `invalid-input-secret`, `sitekey-secret-mismatch`, `not-using-dummy-passcode` | `misconfigured` |
| hCaptcha | `expired-input-response` | `expired` |
| hCaptcha | `already-seen-response` | `replayed` |
| hCaptcha | `missing-input-response`, `invalid-input-response`, `bad-request`, any other code | `invalid` |
| hCaptcha | network, 5xx | `provider_unavailable` |
| reCAPTCHA | `missing-input-secret`, `invalid-input-secret` | `misconfigured` |
| reCAPTCHA | `timeout-or-duplicate` | `expired` |
| reCAPTCHA | `missing-input-response`, `invalid-input-response`, `bad-request`, any other code | `invalid` |
| reCAPTCHA | network, 5xx | `provider_unavailable` |
| reCAPTCHA v3 | success with another `action` | `action_mismatch` |
| reCAPTCHA v3 | success with `score` below `minScore` (default `0.5`) | `low_score` |

hCaptcha and reCAPTCHA are posted form-encoded (`content-type: application/x-www-form-urlencoded`):
hCaptcha `secret`, `response`, `remoteip`, `sitekey` to `https://api.hcaptcha.com/siteverify`;
reCAPTCHA `secret`, `response`, `remoteip` to `https://www.google.com/recaptcha/api/siteverify`.

Sources: Cap standalone `src/siteverify.js`;
<https://developer.friendlycaptcha.com/docs/v2/api/siteverify>;
<https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>;
<https://docs.hcaptcha.com/>; <https://developers.google.com/recaptcha/docs/verify>;
<https://developers.google.com/recaptcha/docs/v3>.

## Provider interface

```ts
defineCaptchaProvider<Options, Handle>({
  name: string,
  meta: {
    consent: 'required' | 'none', region: string, invisible: boolean, score: boolean, action: boolean,
    ui?: 'own' | 'widget' | 'none', brand?: boolean, vendor?: string, purpose?: string, production?: boolean,
  },
  client: {
    load(ctx): void | Promise<void>,
    render(ctx, el, events): Handle | Promise<Handle>,
    execute?(handle, ctx): unknown,      // the raw token, or report it through events.solve
    reset(handle, ctx): void,
    destroy?(handle): void,
  },
  server: {
    verify(ctx, { token, action?, remoteip?, minScore? }): Promise<CaptchaResult>,
  },
})
```

- `client.*` runs in the browser only; `server.verify` on the server only. Import SDKs with a
  dynamic `import()` inside `client.load`.
- `ctx.options` is `captcha.providers.<name>` (public). `ctx.secrets` is server-only and resolved
  per request. `ctx.fetch` never throws on an HTTP status; with the header
  `content-type: application/x-www-form-urlencoded` it sends `body` form-encoded, else as JSON.
- The module builds the envelope, picks the provider, applies consent and fallback, and enforces
  `action` and `minScore`.

## Consent

A provider with `meta.consent: 'required'` loads only when `$consentProvider.allows(vendor, purpose)`
is `true`, with `vendor = providers.<name>.consentVendor ?? meta.vendor ?? name` and
`purpose = providers.<name>.consentPurpose ?? meta.purpose` (any purpose of the vendor when
unset). This applies when `@revenexx/consent-manager-nuxt` is installed (`hasNuxtModule`);
without it, such providers load directly. Without consent, the fallback runs; without a fallback,
nothing runs.

## Rider API

```
GET  {rider.url}/api/v1/public/captcha/sites/{site}
  200 { data: { site, provider: 'revenexx'|'friendly'|'turnstile'|'hcaptcha'|'recaptcha', site_key,
                fallback: 'revenexx'|null, revenexx: { endpoint, site_key },
                options?: { version: 'v2'|'v3' } (recaptcha) | {} (all others) } }

POST {rider.url}/api/v1/public/captcha/verify
  Authorization: Bearer <NUXT_CAPTCHA_RIDER_TOKEN>
  { token: <full enveloped token>, action?, remoteip? }
  200 { data: CaptchaResult }   401 when the token is missing or unknown
```

`options` holds the provider's public options and is merged into `providers.<provider>` (only
plain values; `siteKey`, `provider`, `consentVendor` and `consentPurpose` are ignored). Rider
versions before it send none, which counts as `{}`. Rider applies the score threshold itself and
answers `score` as a number or `null`; the module passes a number through and drops `null`.

The site answer is cached per process for 60 s, requests in flight are shared, failures are not
cached, and the static configuration applies when Rider fails. Both calls time out after 5 s.
