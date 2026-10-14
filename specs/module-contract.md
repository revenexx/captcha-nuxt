---
feature: module-contract
title: The captcha module
where:
  - Every form of a theme that renders <RevenexxCaptcha> or calls useCaptcha()
  - Every server route that calls verifyCaptcha()
  - The route /_captcha/config
ticket: PE-1007
updated: 2026-10-14
---

# The captcha module

**The captcha module** gives a Nuxt shop one captcha component and one server function, and
switches the provider through configuration. Each token carries the provider that issued it, so
the server verifies at the right place, also after a fallback. Each criterion is claimed by a
test tagged `@spec:module-contract:AC-n`.

## Acceptance criteria

### AC-1 — Every token names its provider

- **Given** a token handed out by any provider
- **When** the browser puts it into the form
- **Then** it reads `rvx1.<provider>.<raw token>`, the server splits it on the first two dots
  only, and a token without the envelope counts as the configured provider's
- **Because** raw tokens contain dots and colons, and a fallback has to be verified at the fallback
- verify: unit

### AC-2 — Only the providers the shop uses are verified

- **Given** a shop configured with one provider and a fallback
- **When** a token names another provider (`rvx1.none.x`, `rvx1.test.pass`)
- **Then** it is refused as `invalid` without calling anyone, unless the route names that
  provider in `verifyCaptcha(…, { provider })`
- verify: unit, ssr

### AC-3 — Cap and RevenexxCaptcha are verified at their siteverify

- **Given** a Cap or RevenexxCaptcha token
- **When** the server verifies it
- **Then** it posts `{ secret, response }` to `<verify endpoint or endpoint>/<siteKey>/siteverify`
  and maps 404 "Token not found" and 400 to `invalid`, 403 "Token expired" to `expired`,
  "Invalid site key or secret" to `misconfigured`, and a network error or 5xx to
  `provider_unavailable`
- verify: unit

### AC-4 — Friendly Captcha is verified with its v2 API

- **Given** a Friendly Captcha token
- **When** the server verifies it
- **Then** it posts `{ response, sitekey }` with `X-API-Key` to the configured region's
  `frcapi.com` siteverify and maps every documented error code
- verify: unit

### AC-5 — Turnstile is verified with the action bound

- **Given** a Turnstile token
- **When** the server verifies it with an expected action
- **Then** it posts `secret`, `response`, `remoteip` and an idempotency key, maps the documented
  error codes, and refuses a token solved for another action as `action_mismatch`
- verify: unit

### AC-6 — `none` and `test` never pass in production

- **Given** the `none` or `test` provider
- **When** the server runs with NODE_ENV=production
- **Then** every token is refused as `misconfigured`, decided at runtime and not at build time
- verify: unit

### AC-7 — No secret is part of a build or reaches the browser

- **Given** every secret variable (`NUXT_CAPTCHA_*`) set while the shop is built
- **When** the build finishes
- **Then** no file of the build output contains one of them, and the public configuration holds
  none
- **Because** a build artifact is shared, cached and deployed far more widely than a runtime secret
- verify: unit, ssr

### AC-8 — In rider mode the server asks Rider, the browser does not

- **Given** `source: 'rider'` and a site id
- **When** a page is server-rendered
- **Then** the provider and site keys come from Rider (cached 60 s per process, requests in
  flight shared, failures not cached, the static configuration on failure) and reach the browser
  in the payload
- verify: unit, ssr

### AC-9 — In rider mode Rider verifies

- **Given** `source: 'rider'`
- **When** a route calls `verifyCaptcha()`
- **Then** the full enveloped token goes to Rider's verify endpoint with the shop's Bearer token;
  401 maps to `misconfigured`, a network error or 5xx to `provider_unavailable`, and no provider
  secret is needed in the shop
- verify: unit, ssr

### AC-10 — A provider without consent is replaced by the fallback

- **Given** a provider with `meta.consent: 'required'` and `@revenexx/consent-manager-nuxt`
  denying its vendor
- **When** the captcha renders
- **Then** the provider's script is not loaded, the fallback renders instead, and the token's
  envelope names the fallback
- verify: unit

### AC-11 — The own box is accessible and links nowhere

- **Given** the revenexx or cap provider
- **When** the box renders and is solved
- **Then** it is a checkbox button in a named group with a live status, goes idle → verifying →
  done (or error, expired), writes the token into the hidden input, and the page holds no Cap or
  trycap.dev link
- verify: unit

### AC-12 — The first HTML holds the captcha, the server route decides

- **Given** a page with `<RevenexxCaptcha>` and a route using `verifyCaptcha()`
- **When** the page is server-rendered and the form is posted
- **Then** the HTML holds the box and the hidden input, and the route accepts `rvx1.test.pass`
  and refuses `rvx1.test.fail`
- verify: ssr

### AC-13 — A custom provider has the built-ins' interface

- **Given** a provider declared with `defineCaptchaProvider()`
- **When** it is type-checked
- **Then** its client and server parts are typed with its own options and handle, exactly like
  the built-in providers
- verify: unit

### AC-14 — A provider that fails to load is replaced by the fallback

- **Given** a provider whose script or SDK fails to load
- **When** the captcha renders
- **Then** the fallback renders instead, or a notice when there is none
- verify: unit
