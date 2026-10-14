# Playground

A minimal Nuxt app that runs `@revenexx/captcha-nuxt` from source. It is a reference example
and not part of the package's build or test run.

It shows a contact form with the visible `<RevenexxCaptcha>`, a newsletter form that runs the
challenge invisibly through `useCaptcha().execute()`, and `server/api/contact.post.ts`, which
verifies the token with `verifyCaptcha()` before doing anything else.

## Run it

From the repository root:

```bash
pnpm install
pnpm dev:prepare
pnpm dev
```

It starts with the `test` provider, which needs no account: the box hands out `pass`, and the
server accepts `rvx1.test.pass`. Set `providers.test.token` to `'fail'` to see a refusal.

## Against a real Cap

Run a Cap instance (`tiago2/cap`, or Cap standalone with Bun and Valkey/Redis) with
`ENABLE_ASSETS_SERVER=true`, create a site key in its dashboard, then:

```bash
# playground/.env (never commit it)
NUXT_PUBLIC_CAPTCHA_PROVIDER=cap
NUXT_PUBLIC_CAPTCHA_PROVIDERS_CAP_ENDPOINT=http://localhost:3000
NUXT_PUBLIC_CAPTCHA_PROVIDERS_CAP_SITE_KEY=<site key>
NUXT_CAPTCHA_CAP_SECRET=<secret key>
```

Use `NUXT_PUBLIC_CAPTCHA_PROVIDER=revenexx` with
`NUXT_PUBLIC_CAPTCHA_PROVIDERS_REVENEXX_ENDPOINT` / `…_REVENEXX_SITE_KEY` for the branded box.
The `test` and `none` providers refuse every token when the server runs with
`NODE_ENV=production`, so switch the provider before running a production build.

Things to try:

- Submit the contact form twice with the same token: the second answer is `invalid`, because a
  Cap token is valid once.
- Open the network panel: the page talks to the shop and to the Cap instance only.
- Open `/_captcha/config` to see the public configuration the browser receives.
