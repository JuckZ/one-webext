# ADR-0006: Add a lifecycle-safe runtime client and reproducible unpublished package build

- **Status:** Accepted
- **Date:** 2026-08-29
- **Scope:** Remote-frame handshake client and local SDK artifact only

## Context

Phase 6A made manifest and envelope shapes reusable, but every remote iframe still has to implement
`MODULE_HELLO`, `MODULE_INIT`, challenge/session nonce handling, `MessagePort` ownership and
`CONTEXT_UPDATE` validation itself. The source package also has no independent ESM/declaration
build, so its reviewed public export boundary is not yet the same artifact a consumer would load.

Publishing now would combine lifecycle design, artifact layout, versioning and distribution. A
production `file:../one-webext` dependency in RepoLens would instead make the starter dependent on a
particular sibling checkout and break its independent clone/run property.

## Decision

- Add one minimal browser runtime client to `@oneweb/module-sdk`. Callers explicitly provide the
  installed module ID, exact parent origin and a context callback. The client owns only its current
  window listener, high-entropy challenge, one `MessagePort`, one session nonce and the lifecycle
  `idle -> hello-sent -> connected -> destroyed`.
- Accept initialization only from the adapter's exact parent object and origin, with matching
  protocol, version, module ID and active challenge, a nonce of at least 24 characters and exactly
  one transferred port. The client automatically emits the canonical `MODULE_READY` envelope and
  accepts only SDK-validated `CONTEXT_UPDATE` messages on that port.
- Make `start()` and `destroy()` idempotent. Destruction and terminal adapter failures remove
  listeners, close the owned port, clear nonce/challenge and revoke callbacks. There is no automatic
  reconnect, persistence, queue, fetch or generic message/RPC surface.
- Keep exact installed entry origin/source verification, initialization fields, authorization,
  grant filtering and iframe reload ownership in OneWeb's host. The client verifies only what an
  unprivileged remote iframe can observe about its parent and transferred channel.
- Build the private package independently with TypeScript into deterministic ESM and `.d.ts`
  output. Package exports expose only reviewed root/runtime entry points and the versioned contract;
  the auditable file allowlist excludes OneWeb host, builtin, Registry, permission and fixture code.
- Use the built runtime entry in OneWeb's real Chromium conformance iframe. RepoLens remains on its
  Phase 6A local lock/descriptor and has no sibling production dependency. Its explicit cross-repo
  verifier consumes the built public export, validates its manifest and confirms bridge constants.

## Threat model

The primary risks are a forged parent window/origin, stale or repeated init, caller-overridden
envelope identity, weak challenge, short/reused nonce, late messages after destruction, port leaks,
cross-instance state, accepting unknown port messages, or accidentally packaging host authority.
Controls are exact identity comparisons, Web Crypto entropy, Phase 6A validators and canonical
envelope creation, single-use instance state, listener/port teardown, instance-isolation tests,
explicit package exports/files and two-build digest comparison.

Context values remain untrusted structured data. The client never interprets them as HTML and has
no browser/chrome API, storage, permission, arbitrary URL, fetch, Registry, capability RPC or other
module state access.

## Consequences

- Minimal module iframes can use a reviewed handshake implementation without receiving host power.
- The local artifact becomes testable as the future distribution shape while remaining private and
  unpublished.
- RepoLens compatibility is proved without coupling its runtime to the OneWeb repository layout.
- Typed capability RPC, advanced context subscriptions, automatic reconnect, package publication,
  semver/release policy, CLI and marketplace remain separate decisions.

## Acceptance evidence

Accepted on 2026-08-29 after seven runtime-client unit scenarios covered valid context delivery,
forged initialization dimensions, repeated/concurrent lifecycle calls, failures, teardown and
instance isolation. The private package produces 12 deterministic ESM/declaration files and a
14-file dry-run package allowlist; two clean builds have identical content digests, public JS/type
consumers pass and private subpaths are blocked. OneWeb's real RepoLens conformance iframe loads the
built runtime and reconnects after teardown/reload without changing builtin or module state.

OneWeb passes typecheck, full-repository lint, all 331 unit tests, production Chromium build, the
package reproducibility/export gate and all 16 Chromium E2E scenarios. RepoLens passes all 30 tests,
uses no sibling production dependency, and its manifest plus hand-written bridge are accepted by
the built SDK. Both repositories pass `git diff --check` at the Phase 6B checkpoint.
