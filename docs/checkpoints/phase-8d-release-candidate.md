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

**Complete (2026-09-03).** The accepted source is commit
`b5055864de36c058203ffc16111a209a4a7b06c9` on `codex/0.1.0-rc`. A first clean-clone packaging run
correctly rejected an empty Chromium ZIP produced by the old non-recursive `extension/*` command.
Commit `b505586` replaced that command with the same reviewed `web-ext build` boundary used for the
Firefox package. The entire procedure was then restarted from a new clone of that commit; evidence
from the failed package was not reused.

The final clean clone passed:

- frozen installation with 1,073 packages and no `file:`, `link:`, sibling-checkout or absolute-path
  dependency;
- typecheck, full lint, **558/558 unit tests** and the reproducible **20-file private SDK** gate;
- Chromium production build and the **28-file identity/runtime scan**, followed by **24/24 Chromium
  E2E** scenarios in a newly created Playwright profile;
- Firefox production build and the same **28-file identity/runtime scan**, strict manifest validation
  with **0 errors / 0 notices / 0 warnings**, and the **1/1 real Firefox temporary-install gate** in a
  newly created profile;
- RepoLens **34/34 tests** and its offline **14-file vendor** gate. The accepted
  `typedCapabilities.storage.module` drift was reproduced and remains intentionally unsynchronized;
- source-clean `git status`, both writable repositories' `git diff --check`, and an unchanged clean
  `one-tampermonkey` checkout at the archived commit.

## Accepted artifacts

- Chromium: `one-web-0.1.0-chromium.zip`, 19 archive entries / 12 files, SHA-256
  `0f5e3b0f30166e3e792646f2a13cb8892629e9820b5134a23cc5ad034208fa60`.
- Firefox: `one-web-0.1.0-firefox.xpi`, 19 archive entries / 12 files, SHA-256
  `28500594902fde401f824ae0838e390988243fcf3c83cad515d6a8738d14b1a3`.

Both archives passed integrity tests and contain only the manifest, five packaged icons and six
production HTML/CSS/JavaScript files. Chromium exposes `side_panel`; Firefox exposes
`sidebar_action`; both identify `OneWeb` `0.1.0`, use `https://github.com/JuckZ/one-web`, and retain
Firefox ID `one-web@juckz.local`. The file lists and extracted text contain no source maps, tests,
package metadata, local dependency, user-home path, secret marker, Tampermonkey/GM/userscript code,
external CDN, remote `eval`, hard-coded private-site URL or stale product identity.

The accepted source commit is identified by annotated tag `v0.1.0-rc.1`. The checkpoint evidence is
a follow-up documentation commit and does not change the tagged package or runtime sources. No
GitHub Release, npm package, browser-store upload or formal `0.1.0` publication was created; each
remains a separately authorized action.
