# Contributing to `@revenexx/captcha-nuxt`

What the package *is* and how to use it lives in the [README](README.md). This file covers how
work gets in: setup, the checks, and releases.

## Setup

```bash
pnpm install
pnpm dev:prepare     # stub build + type generation for the module and the playground
pnpm dev             # runs playground/ against the module source
```

The playground starts with the `test` provider and needs no account. To run it against a real
Cap instance, see [playground/README.md](playground/README.md).

## Before you push

CI (`.github/workflows/ci.yml`) runs these on every push and pull request against `main`.
Running them locally only changes when you find out:

| Command | What it checks |
| --- | --- |
| `pnpm lint` | ESLint (`@nuxt/eslint-config`) |
| `pnpm test:types` | `vue-tsc` over the module and, separately, over the Nitro server routes |
| `pnpm test` | Vitest: unit tests of the envelope, the providers' server mappings, rider mode, the controller and the component, plus SSR tests against fixture apps and a build that must not contain secrets |
| `pnpm build` | `nuxt-module-build`. Run it: a tarball without `dist` is the classic broken release. |

Tests that prove an acceptance criterion carry its tag, `@spec:module-contract:AC-n`, matching
[specs/module-contract.md](specs/module-contract.md). A change to what the module promises
changes that spec and its test together.

## Commits and pull requests

- English, imperative subject line ("Map Cap's 403 to expired").
- One logical change per pull request. Reference the issue it belongs to.
- No secrets anywhere: site secrets, API keys and Rider tokens go in a git-ignored `.env`, never
  in code, docs, fixtures or commit messages. Tests make no network calls; mock the fetch.

## Releases

[Changesets](https://github.com/changesets/changesets). Every pull request that changes what
ships carries one:

```bash
pnpm changeset       # pick patch / minor / major and describe the change for users
```

Write the changeset for someone upgrading: what changed for them and what they have to do.
That text becomes the [CHANGELOG](CHANGELOG.md) entry.

On push to `main`, `.github/workflows/release.yml` opens or updates a **Version Packages** pull
request. Merging it bumps the version, writes the changelog and publishes to npm with
provenance through npm OIDC trusted publishing, so there is no `NPM_TOKEN`. The trusted
publisher binding is keyed to this repository **and the workflow filename**, so
`release.yml` keeps its name.

npm binds a trusted publisher to a package that exists, so the very first version of a new
package goes up by hand, and the binding stays *pending* until a version comes through
`release.yml`. Publishing by hand needs `--provenance=false`, because `publishConfig.provenance`
is only satisfiable inside GitHub Actions; npm may then hold the version as *staged* until it
is approved on npmjs.com. 0.1.0 went that way; 0.1.1 was the first release through the
workflow.

A peer-dependency range (`nuxt`, `@nuxt/scripts`) is part of what the package promises. Moving
it needs a changeset even when nothing else changes.

## Changing the contract

The token envelope, `CaptchaResult`, the provider interface and the Rider API are shared with
Rider and with every custom provider. See [docs/contract.md](docs/contract.md). A change there is
a breaking change for someone else, so coordinate it rather than landing it here alone.

## Third-party code

The `revenexx` and `cap` providers use Cap's `@cap.js/widget` (Apache-2.0) unmodified, pinned
to an exact version. Moving that pin means checking again that the programmatic mode renders
nothing visible and that the module still removes every link from the hidden solver element
(see `src/runtime/providers/cap-core.ts`). Keep [NOTICE](NOTICE) current.
