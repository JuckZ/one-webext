# ADR-0009: Evaluate `storage.module` before any real capability adapter

- **Status:** Accepted (Phase 6E-A and Phase 6E-B Complete; Phase 6E-C Next)
- **Date:** 2026-08-30
- **Scope:** Candidate selection and accepted pure `storage.module` contract; no storage adapter or handler

## Context

Phase 6D closed the generic typed RPC transport, quotas, terminal lifecycle and two-module isolation
gate without exposing browser work. The public remote manifest catalog nevertheless contains six
capability identifiers that predate a real dispatcher implementation: `tabs.open`,
`storage.module`, `clipboard.write`, `downloads.create`, `notifications.show` and `auth.start`.
A catalog identifier is review vocabulary, not authority to implement it.

OneWeb currently declares `activeTab`, `storage` and `tabs`, with `bookmarks` optional. It does not
declare clipboard, downloads or notifications permission. The trusted code already has a generic
`oneweb.module-state.v1:<module-id>` key derivation and clone boundary for packaged builtins, but it
does not yet provide remote-module quotas, compare-and-swap mutation, deletion cleanup or an RPC
schema. Opening tabs is already used by packaged UI, and the RepoLens seed has a temporary
origin-bound authorization adapter, but neither is a safe generic remote capability.

The first candidate should produce real module value while adding no permission, arbitrary browser
method, URL/fetch proxy or cross-module authority. Risk and lifecycle fit matter more than choosing
the smallest-looking API call.

## Evaluation method

User value uses a 1–5 scale, where 5 is strongest. Risk uses low/medium/high, and PoC cost uses
small/medium/high. “Permission reuse” means the current production manifest already contains the
necessary browser permission; it does not imply an installed module grant or approved RPC handler.

| Candidate            |                   User value | Current permission/primitives                                                                                 | Sensitive data                                                                        | Confused-deputy risk                                                                                | Write/destructive risk                                                             | Platform coupling                                                                                  | Minimum safe PoC cost | Decision                                                                                 |
| -------------------- | ---------------------------: | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `storage.module`     |                            4 | **Full permission reuse:** `storage`; partial reuse of generic module-state key derivation and clone boundary | Medium: preferences, drafts or tokens may be placed in opaque module data             | Low/medium if the host derives one namespace; high if callers can name storage areas or global keys | Medium but local: overwrite, quota exhaustion and stale concurrent writes          | Low/medium: portable storage API, but MV3 concurrency and uninstall cleanup need host coordination | Medium                | **Go to 6E-B pure contract only**                                                        |
| `tabs.open`          |                            4 | **Full reuse:** existing tabs boundary; creation itself is simple                                             | Medium: destination can reveal user intent or embed tracking data                     | High: an arbitrary HTTPS destination makes OneWeb a navigation/phishing deputy                      | Medium: user-visible external navigation, popup spam and possible download handoff | Low API coupling; medium/high review and user-gesture coupling                                     | Medium                | **Defer:** require a separately reviewed navigation-plan contract                        |
| `clipboard.write`    |                            3 | **No reliable cross-browser reuse:** direct gesture and clipboard permission semantics differ                 | High: modules can replace clipboard contents with secrets, commands or deceptive text | Medium/high: the host lends a privileged user gesture to remote content                             | Medium: destructive overwrite of user clipboard state                              | High: Chromium/Firefox gesture and permission behavior differ                                      | Medium/high           | **No-go now**                                                                            |
| `downloads.create`   |                            3 | **No:** production manifest has no `downloads` permission                                                     | High: generated bytes, source metadata and filenames                                  | High: arbitrary URL/blob/file generation becomes a filesystem deputy                                | High: persistent filesystem side effect, collisions and dangerous content          | Medium/high: permission, filename and download-manager behavior                                    | High                  | **No-go:** new permission and destructive review required                                |
| `notifications.show` |                            2 | **No:** production manifest has no `notifications` permission                                                 | Medium: notification text may reveal private context                                  | High: extension identity can be used for spoofing, phishing or harassment                           | Medium: persistent attention surface and action routing                            | Medium/high: permission, platform UI, rate limits and action lifecycle                             | High                  | **No-go:** weak first value/risk ratio                                                   |
| `auth.start`         | 5 for service-backed modules | **Partial:** tabs/exact origin and the temporary RepoLens adapter exist; no generic pairing contract          | High: challenges, login state, account linkage and short-lived codes                  | High: open redirect, origin substitution, replay and credential confusion                           | High: changes external account/session state                                       | High: backend protocol, cookie partitioning, redirect and browser login behavior                   | High                  | **Defer:** valuable, but needs its own auth threat model and RepoLens migration decision |

## Decision

Select `storage.module` as the only candidate allowed to enter Phase 6E-B. This is not approval to
add a handler. Phase 6E-B must remain pure and settle all of the following before an adapter exists:

- One finite module-owned document or another equally bounded schema; no caller-supplied browser
  storage area, global key, extension key prefix or arbitrary method.
- Host-derived namespace from the authenticated installed module ID, never payload identity.
- Exact serialized-size, depth, node and per-module quota limits in addition to the existing RPC
  envelope limits.
- Serialized compare-and-swap or equivalent lost-update semantics across frames, service-worker
  lifetimes and reinstall races.
- Explicit `get`, mutation and clear terminal behavior, stable errors, immutable cloned results and
  cancellation rules. The operation list must not be a stringly browser-storage facade.
- Disable, remove, reinstall and grant-revocation semantics. Removal must not leave an undeclared
  remote namespace, while disabling must not let a destroyed session continue a write.
- Local-only treatment, safe rendering/diagnostics, and a statement that semantic secrets cannot be
  detected merely because structural JSON validation passes.
- Complete isolation from Registry records, grants, update candidates, builtin namespaces,
  RepoLens state and every other installed module.

The accepted 6E-B contract does not itself authorize storage access. A separately scoped Phase 6E-C
may consider one injected `browser.storage.local` adapter and a test consumer. `tabs.open` is the
next candidate to reconsider after storage, but only as a host-generated, user-reviewed navigation
plan rather than arbitrary URL opening. `auth.start` remains a distinct future architecture
decision; the temporary RepoLens adapter is not evidence that a generic auth capability is safe.

## Consequences and acceptance evidence

Phase 6E-A changes documentation only. It does not change the SDK catalog, package bytes, manifest,
permissions, dispatcher, FrameHost, background code, RepoLens production code or vendored SDK.
There is no real capability schema, handler or browser/chrome call.

Before this decision, the Phase 6D-C baseline was reproduced. OneWeb remains at HEAD
`062c8e74d8141bef54d87d7ea1f31148e47cffa5` and passes typecheck, full lint, all 384 unit tests,
deterministic 18-file SDK verification, production Chromium build, all 18 Chromium scenarios and
`git diff --check`. RepoLens remains at HEAD `c994ac74f0c61bb1b3a90fed9f315e8768b724b8`
and passes all 34 tests, the offline 14-file vendor gate and `git diff --check`; its cross-repository
verifier continues to report the accepted SDK artifact/export drift. Both large uncommitted
worktrees remain protected and no vendor is synchronized.

## Phase 6E-B pure-contract supplement (Accepted, 2026-08-30)

The selected capability is a single module-owned JSON-like document, not a browser-storage facade.
Its finite operations are `read`, whole-document `replace` and whole-document `clear`. Read has no
caller fields. Replace carries only the expected revision and document; clear carries only the
expected revision. Authenticated module/session/generation identity stays canonical in the RPC
envelope. Storage area, physical key, namespace, next revision and arbitrary browser method are
never payload fields.

The document ceiling is 12 KiB after UTF-8 JSON encoding, depth six and 256 nodes, within the generic
16 KiB/eight-depth/512-node request ceiling. Values are acyclic JSON-like null, boolean, finite
number, string, dense array or plain object data. Canonical clones are recursively frozen and object
keys are ordered. The host supplies a new opaque revision derived from 24 bytes of entropy for each
successful replace or clear; compare-and-swap requires the caller's expected revision to equal the
current snapshot. A successful clear rotates the revision even when the document is already null.

Stable failures reuse the bounded RPC vocabulary: malformed or oversized documents use
`PAYLOAD_INVALID`/`PAYLOAD_TOO_LARGE`, revoked grants use `CAPABILITY_NOT_ALLOWED`, a destroyed
session uses `SESSION_DESTROYED`, and foreign module/session or stale generation uses
`SESSION_MISMATCH`. Phase 6E-B adds only `STORAGE_REVISION_CONFLICT` for a valid current session with
a stale expected revision.

Disable and worker restart destroy the current session while retaining the document/revision for a
future authenticated session. Grant revocation retains local data but makes it inaccessible until a
new grant and session exist. Removal destroys authority and requires the future adapter to delete
the document atomically; reinstall begins with a fresh empty document and unrelated revision.
Semantic secrets cannot be detected by structural validation, so document contents remain local and
must never enter logs, Registry, context bridge, diagnostics, another module namespace or RepoLens.

This supplement does not authorize `browser.storage`, dispatcher/FrameHost/Registry/UI changes, a
real handler or another capability. Phase 6E-C remains separately gated.

The accepted implementation adds only pure SDK contracts and tests: a bounded JSON schema kind,
the capability-specific catalog and canonical constructors, immutable normalized clones, opaque
revision helpers and a pure mutation/lifecycle reducer. OneWeb passes typecheck, full lint, all 413
unit tests (29 storage-contract tests), the reproducible 20-file package/export gate, production
build and all 18 Chromium scenarios. One GitHub-dependent scenario used its configured retry after
an external navigation timeout and then passed a direct isolated rerun; local SDK/RPC scenarios
pass directly. RepoLens remains unchanged: 34 tests and the offline 14-file vendor gate pass, while
the cross-repository verifier explicitly
reports the expected storage contract/artifact/export drift. No RepoLens vendor, runtime consumer,
permission, dispatcher, FrameHost, Registry, management UI or real storage adapter changed.
