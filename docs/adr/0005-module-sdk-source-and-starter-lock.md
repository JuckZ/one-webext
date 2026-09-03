# ADR-0005: Extract the Module SDK as an unpublished source contract with a starter lock

- **Status:** Accepted
- **Date:** 2026-08-29
- **Scope:** Public remote-module manifest and bridge contract only

## Context

OneWeb's remote manifest and bridge protocol are stable enough to be reused, but their constants,
types and validation currently live beside Registry records, builtin capabilities, update metadata
and host-only frame security. E2E fixtures and RepoLens repeat protocol/version literals. That makes
drift easy and makes it unclear which parts a third-party module may safely depend on.

No package registry or release process exists yet. Adding a production `file:../one-webext`
dependency to `repolens-starter` would make an otherwise standalone starter impossible to clone and
run. Publishing an npm package in the same phase would combine contract extraction with distribution
and versioning decisions.

## Decision

- Create a private `packages/module-sdk` source package in the OneWeb repository, addressed internally as
  `@oneweb/module-sdk` through repository build aliases. It is not published in Phase 6A.
- Export only immutable manifest/protocol constants, remote-safe context/capability/field catalogs,
  public remote manifest/message types, pure remote-manifest validation/definition and pure bridge
  envelope helpers.
- Retain builtin manifest types/capabilities, installed records, update/approval state, Registry,
  permission acquisition, exact-origin/source verification, nonce ownership and frame lifecycle in
  the host.
- Generate a canonical JSON compatibility lock from the public SDK catalogs. Host tests assert the
  lock and exports agree.
- Check the identical versioned lock into `repolens-starter`. RepoLens derives its bridge descriptor
  and standard manifest generator from local locked values and tests both. An explicit cross-repo
  command compares the locks and validates the starter manifest against the source SDK before the
  two repositories are released together.
- Route OneWeb's host wrappers and two conformance fixtures through the source SDK, proving that the
  extracted contract is executable without exposing host authority.

## Threat model

Risks are accidentally exporting privileged builtin capabilities, weakening host origin/source
checks while deduplicating code, accepting caller-forged envelope identity fields, allowing unknown
manifest fields/capabilities to pass, or letting the compatibility copy drift. Controls are an
explicit export surface, pure allowlisted validators, host-owned security wrappers, canonical field
overwrite in envelope creation, immutable catalogs and a cross-repository lock verifier.

## Consequences

- Module authors gain one reviewable public contract without inheriting OneWeb internals.
- The host and conformance fixtures exercise the same code intended for future distribution.
- RepoLens remains independently runnable before package publication while compatibility drift is
  detectable.
- A runtime client, package build/publish pipeline, semver policy, CLI and starter repository remain
  separate decisions.

Phase 6B subsequently addresses only the runtime client and unpublished local build under
[`ADR-0006`](0006-runtime-client-and-local-package-build.md). RepoLens keeps the lock-based portable
arrangement selected here; it does not gain a sibling runtime dependency.

## Acceptance evidence

Accepted on 2026-08-29 after the SDK catalog/manifest/envelope tests, host wrapper tests and both
conformance fixtures passed through the extracted source package. RepoLens serves its generated
standard manifest, derives its bridge descriptor from the checked lock, passes 30 tests and is
accepted by the real SDK validator; both locks are byte-identical. OneWeb passes typecheck,
full-repository lint, all 324 unit tests, production Chromium build and all 16 Chromium E2E
scenarios. Both repositories pass `git diff --check` at the Phase 6A checkpoint.
