# Phase 8D `0.1.0` release-candidate checkpoint

Date: 2026-09-03

This checkpoint defines the source, clean-clone and artifact acceptance boundary for OneWeb
`0.1.0`. It does not publish a browser-store package or create a GitHub Release.

## Canonical identity

- Product: `OneWeb`
- GitHub repository: `https://github.com/JuckZ/one-web`
- Local/source project and root package: `one-web`
- Version: `0.1.0`
- Firefox add-on ID: `one-web@juckz.local`
- Stable protocol identities retained: `oneweb.module`, `dev.oneweb.*`, `@oneweb/module-sdk`

Phase 8B renamed the GitHub repository before changing the local checkout, remote, homepage, Logo
link, package or Firefox identity. RepoLens now keeps its integration reference under
`integrations/one-web/`. Phase 8C directly archived `JuckZ/one-tampermonkey` at
`448bf86d031881b3df687a6bcda416acd39307fa` without a tag, migration surface or source change.

## RC acceptance procedure

1. Commit and push the reviewed source checkpoint to `JuckZ/one-web` so a clone does not depend on
   the former large uncommitted working tree.
2. Create a new temporary directory with `mktemp -d` and clone the canonical HTTPS remote. Do not
   reuse the development checkout's `node_modules`, build artifacts, caches or browser profiles.
3. Install with `pnpm install --frozen-lockfile` and prove that package metadata and the lockfile
   contain no `file:`, `link:`, sibling checkout or absolute-path dependency.
4. Run typecheck, full lint, all unit tests and the deterministic private SDK gate.
5. Build Chromium, run the release identity/artifact scan and all Chromium E2E scenarios against the
   freshly built `extension/` directory. Playwright creates an isolated browser context/profile.
6. Build Firefox, repeat the identity scan, require strict `web-ext` manifest validation and run the
   real temporary-install lifecycle/isolation gate in a newly created Firefox profile.
7. Package one Chromium ZIP and Firefox XPI from their respective production trees. List and hash the
   archives; reject source maps, development-only files, secrets, local dependencies, absolute paths,
   userscript/GM/CDN/remote-eval code and stale product identity.
8. Re-run `git diff --check` and require the clean clone to remain source-clean apart from ignored
   build/test output. Record the tested commit and artifact SHA-256 values below.

RepoLens remains an independently cloneable consumer with its reviewed 14-file offline SDK vendor.
Its 34 tests and offline vendor gate must pass from the protected checkout. The accepted
`typedCapabilities.storage.module` drift stays explicit; this RC does not silently synchronize the
vendor.

## Status

**Active.** Completion requires the fresh clone, both clean-profile browser gates, packaged artifact
inspection and exact evidence. After acceptance, an RC Git tag may identify the tested commit, but no
GitHub Release, store upload or formal publication is authorized by this phase.
