# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release, run:

```bash
pnpm changeset
```

Pick a bump (patch/minor/major) and describe the change. On push to `main`, the
Release workflow opens (or updates) a **"Version Packages"** PR; merging it
bumps the version, writes the changelog, and publishes to npm via OIDC
[trusted publishing](https://docs.npmjs.com/trusted-publishers) — no token.
