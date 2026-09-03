# ADR-0007: Vendor a content-addressed SDK artifact for the RepoLens runtime

- **Status:** Accepted
- **Date:** 2026-08-29
- **Scope:** Portable local SDK consumption and RepoLens handshake migration only

## Context

Phase 6B produces a deterministic, private 14-file `@oneweb/module-sdk` package, but an independently
cloned module still cannot consume that runtime without a package registry or a sibling OneWeb
checkout. RepoLens therefore remains portable but duplicates the browser handshake. Its production
session mode also needs the module-owned `authorizationCode` from `MODULE_INIT` to be exchanged
before `MODULE_READY`; the Phase 6B runtime intentionally exposes neither init fields nor its nonce,
port or a generic message API.

Publishing the package would combine this migration with registry identity, release and semver
policy. A `file:../one-webext` dependency would make deployment depend on a local directory layout.
Copying SDK source into RepoLens would create an unaudited fork rather than a distribution boundary.

## Decision

- Check the complete reviewed package artifact—`package.json`, `contract.json` and all twelve
  deterministic ESM/declaration files—into RepoLens under a dedicated vendor directory. This is a
  distribution copy of build output, not a second SDK source tree.
- Check in a schema-versioned provenance lock with the exact POSIX relative-path allowlist, each
  SHA-256 digest and one aggregate digest over the sorted path/digest pairs. A RepoLens-local
  verifier uses only those checked files, rejects extras as well as omissions or changes, and runs
  in every normal `check` without knowing where OneWeb is installed.
- Provide a separate explicit development sync/verifier which accepts an OneWeb checkout path,
  verifies the deterministic source package first, copies only the reviewed allowlist and rewrites
  the content lock. The checkout path and filesystem metadata are never serialized. The existing
  cross-repository gate additionally compares the vendored artifact byte-for-byte with the current
  OneWeb build.
- Serve the browser runtime through an exact route-to-file map for only `runtime-client.js`,
  `runtime-state.js`, `protocol.js` and `catalog.js`. Same-origin ESM imports resolve inside that
  map. Requests for declarations, contract/package metadata, traversal or unknown paths are 404.
- Add `onConnected(initFields)` as the runtime's only new lifecycle hook. It receives a frozen
  projection which excludes `protocol`, `version`, `moduleId`, `type`, `challenge` and
  `sessionNonce`. The client owns and keeps private the challenge, session nonce and port. It sends
  `MODULE_READY` only after the hook resolves and the same client/port is still live. Hook rejection,
  destruction, port failure or late resolution destroys the session and emits no READY.
- Migrate RepoLens's embed to a nonce-bearing ESM script importing that vendored client. The hook
  performs only the existing optional one-time authorization exchange; validated context updates
  feed the existing untrusted-data projection. Independent-page/default-repository behavior does
  not instantiate the iframe runtime.

## Threat model

Risks are artifact drift or substitution, hidden extra vendor files, serving arbitrary filesystem
paths, leaking a developer checkout into production, exposing canonical handshake authority to the
consumer, sending READY before authentication, and a late async completion reviving a destroyed
port. The controls are complete allowlists, per-file plus aggregate hashes, an offline verifier,
fixed server routes, canonical-field projection, READY ordering and terminal lifecycle checks.

Vendoring does not make RepoLens trusted by OneWeb and does not move origin/source/grant validation
out of the host. Init fields and context remain untrusted structured data. No SDK or RepoLens route
gains browser APIs, storage, permissions, arbitrary fetch/URL/path, typed capability RPC or access
to another module.

## Consequences

- RepoLens remains independently cloneable and runnable while using the exact reviewed runtime
  artifact; no registry or sibling checkout is needed in production.
- SDK updates are deliberate repository changes with a reviewable file/digest delta. The explicit
  sync tool is development-only and package publication remains a later decision.
- RepoLens can preserve session authentication ordering without receiving a generic MessagePort API.
- Vendoring has intentional repository weight and requires a sync step when the SDK artifact changes.

## Acceptance evidence

Accepted on 2026-08-29. Two added SDK lifecycle scenarios bring OneWeb to 333 unit tests and cover
projected init fields, READY ordering, setup rejection, destroy/resolve and port-failure races. The
deterministic private package still contains exactly 14 packed files. RepoLens vendors all 14 under
an offline-verifiable per-file/aggregate SHA-256 lock, passes 34 tests, rejects changed/missing/extra
artifacts, exposes only four exact runtime routes and matches the current OneWeb build byte-for-byte.

Real Chromium delays session exchange and observes no early READY, then completes context delivery;
it ignores a forged challenge, reconnects after reload and rejects an old-port context. OneWeb
passes typecheck, full lint, production build, package reproducibility and all 16 extension E2E
scenarios; RepoLens passes both browser scripts and its independent/cross-repository checks. Both
repositories pass `git diff --check` at the Phase 6C checkpoint.
