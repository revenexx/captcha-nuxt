# @revenexx/captcha-nuxt: documentation

Start with the [README](../README.md): installation, configuration, the component, the
composable, `verifyCaptcha()`, the providers, consent, rider mode and security notes.

| Page | What it covers |
| --- | --- |
| [Cookbook](recipes.md) | a contact form, invisible forms, a per-page provider, Turnstile behind consent, a self-hosted Cap, rider mode, a custom provider, tests with the `test` provider |
| [Theming](theming.md) | CSS variables, classes and data attributes, the slot, dark mode, accessibility |
| [Contract](contract.md) | the normative part: the token envelope, `CaptchaResult`, the provider interface, the Rider API, failure modes |
| [Acceptance criteria](../specs/module-contract.md) | what the module promises, each criterion bound to a test |

## Related

- [Cap](https://github.com/tiagozip/cap): the proof-of-work CAPTCHA the `revenexx` and `cap`
  providers build on.
- [`@revenexx/consent-manager-nuxt`](https://github.com/revenexx/consent-manager-nuxt): the
  consent module whose `$consentProvider` gates providers that need consent.
- Rider (revenexx platform): configures captchas per tenant and verifies in rider mode.
