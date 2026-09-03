# ADR-0008: Fix a bounded typed capability RPC contract before adding transport

- **Status:** Accepted (Phase 6D-A through Phase 6D-C Complete)
- **Date:** 2026-08-29
- **Scope:** Pure RPC contract plus lifecycle-bound client/dispatcher skeleton; no real capability

## Context

Remote manifests can declare a finite capability ID, but OneWeb exposes no capability data plane.
Adding a generic port message or `browser.call(method, args)` would turn the trusted host into a
confused deputy and make manifest review meaningless. Connecting transport and browser behavior
while identity, cancellation, resource and error rules are unsettled would also make replay and
lifecycle bugs difficult to distinguish from implementation bugs.

Phase 6D-A therefore defines an executable pure contract first. Its output can be reviewed and
tested without a frame, MessagePort, Registry, permission prompt, service worker or browser API.

## Threat model

| Threat                            | Required control                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confused deputy                   | Capability must be in both the module's supplied manifest declaration set and the host's static typed catalog; operation must belong to that capability.                   |
| Forgery or replay                 | Canonical module/session/generation/request identity is constructor-owned; request IDs are unique for the complete session and terminal events cannot reopen them.         |
| Cross-module request ID collision | Exact module, opaque session and positive generation are compared on every transition; request ID alone never identifies work.                                             |
| Stale session or generation       | Mismatched identities and every event after session destruction are rejected without state revival.                                                                        |
| Duplicate/replaced response       | Result/error must repeat the registered capability and operation; first terminal transition wins and later responses are invalid.                                          |
| Cancel/complete race              | Reducer event order is authoritative; whichever valid terminal event arrives first wins. Cancel after result and result after cancel are both rejected.                    |
| Timeout and late result           | Deadline is fixed at 15 seconds. Timeout is terminal; a result at or after the deadline is rejected and cannot land.                                                       |
| Request flooding                  | Maximum 16 in-flight requests and 1,024 total unique IDs per session; rejected registration does not mutate state.                                                         |
| Oversized or hostile data         | Request payload is at most 16 KiB; result is at most 64 KiB; maximum depth is eight and maximum nodes 512. Only finite JSON-like plain data is accepted.                   |
| Cycles or unserializable values   | Reject cycles, accessors, symbol keys, functions, bigint, undefined, non-finite numbers, class instances and other non-plain values before measuring or schema validation. |
| Unknown capability/operation      | No free-form method exists. Validation is against one declarative capability-specific request/result schema catalog.                                                       |
| Error disclosure                  | Error envelopes contain one stable code only—no raw exception, stack, host path, URL or diagnostic object.                                                                 |

## Decision

- Use protocol `oneweb.capability`, version `1`, with four discriminants:
  `CAPABILITY_REQUEST`, `CAPABILITY_RESULT`, `CAPABILITY_ERROR` and `CAPABILITY_CANCEL`.
- Bind every envelope to `moduleId`, `sessionId`, `generation`, `requestId`, `capability` and
  `operation`. Constructors take these as separate trusted inputs and project canonical objects;
  payload fields cannot override identity.
- Define a declarative schema DSL for null, boolean, finite number, bounded string, literal, bounded
  array and exact object fields. A generic catalog maps capability/operation pairs to request and
  result schemas, and TypeScript derives the corresponding payload/result types.
- Validation receives the expected session identity and manifest-declared capability set. The
  catalog itself is the static host allowlist. Valid data is cloned and recursively frozen.
- Use stable validation/error codes and never include raw host failures. The pure lifecycle state
  stores all request IDs for the bounded session, so replay prevention does not depend on an
  evictable cache.
- Model `pending`, `succeeded`, `failed`, `cancelled`, `timed-out` and `session-destroyed`. Register,
  result/error, cancel, timeout and destroy are pure reducer events. The reducer never performs work,
  schedules timers or invokes callbacks.
- Keep the permission-free conformance descriptor in tests only. Production SDK files contain the
  generic catalog machinery but no test or business capability descriptor.

## Non-goals and consequences

There is no MessagePort integration, runtime client request method, ModuleFrameHost change, host
dispatcher, Registry lookup, browser/chrome API, permission prompt or actual capability in Phase
6D-A. There is also no arbitrary message, URL, fetch, HTTP method, script or expression escape hatch.

The SDK artifact will intentionally gain one reviewed pure-contract export and therefore diverge
from RepoLens's Phase 6C vendor. RepoLens remains unchanged and independently verifiable; 6D-B must
make an explicit consumption decision rather than silently syncing it now.

## Acceptance evidence

Phase 6D-A is accepted with 23 focused pure unit cases inside a 356-test OneWeb suite, public
consumer compile-time mapping checks and a deterministic 16-file package/export gate. Typecheck,
full lint, production Chromium build, all 16 existing extension E2E scenarios and `git diff --check`
pass. The built RPC subpath contains no host, Registry, MessagePort, browser/chrome, network or
arbitrary-message dependency and no production capability descriptor.

RepoLens remains unchanged: its 34-test protection check and offline 14-file vendor verification
pass. Its explicit cross-repository verifier rejects the expected package/export drift rather than
silently accepting or synchronizing it. RepoLens also passes `git diff --check`; portable
consumption of the changed artifact is an explicit Phase 6D-B decision.

## Phase 6D-B transport supplement (Complete, 2026-08-30)

Phase 6D-B connects this accepted contract to the already authenticated remote-frame port, but does
not add a browser capability. The iframe SDK client owns request IDs, the fixed timeout, pending
promises and cancellation only for its current in-memory module/session/generation binding. A new
init or frame lifetime creates a new binding; destroy, port failure and frame reload terminally
reject all old work. Results and errors must validate against the original request before a callback
can run, and no caller payload may replace canonical identity.

The trusted host owns the current `ModuleFrameHost` session and a monotonically increasing local
generation. Its dispatcher accepts only the authenticated port, validates the installed manifest
declaration, installed grant, static typed catalog and finite operation, and then uses the same pure
reducer for quotas, cancellation, timeout and terminal ordering. Handler injection is deliberately
narrow and permission-free in this phase. A missing handler returns only
`CAPABILITY_UNAVAILABLE`; a thrown handler returns only `OPERATION_FAILED`, never its exception,
stack or host detail. The dispatcher contains no Registry mutation, `browser`/`chrome` call, URL,
HTTP method, fetch, script or general message bridge.

When a request fails full capability or payload validation, the dispatcher may emit its stable error
only after separately projecting a payload-free canonical reference with the exact authenticated
session identity and bounded capability/operation syntax. It never reflects malformed top-level
messages or foreign sessions. Handler maps are snapshotted against the static catalog. A request
cancelled or destroyed before its handler microtask begins never invokes the handler; a later abort
removes result authority even if trusted handler code finishes afterward.

RepoLens does not call typed capability RPC in 6D-B, so its Phase 6C 14-file vendored artifact and
production routes remain unchanged. Synchronizing the newer OneWeb artifact would add unused public
files and routes without a runtime consumer. The offline 14-file gate remains authoritative for
RepoLens; the explicit cross-repository verifier is expected to continue reporting reviewed public
artifact/export drift until a later phase has a concrete RepoLens RPC consumer.

### Phase 6D-B acceptance evidence

The SDK now exposes a typed request handle, explicit cancellation and stable client errors while the
runtime owns the authenticated session binding. OneWeb's optional host dispatcher owns generation,
manifest declaration, installed grant, static catalog and handler lifecycle. It has no production
capability descriptor or real handler; the only echo descriptor and handler injection remain in
tests and the Chromium fixture. Canonical init fields override optional init data, RPC is withheld
until `MODULE_READY`, and host/client port failure or reload destroys every pending callback and
abort signal.

OneWeb passes typecheck, full lint, all 379 unit tests, deterministic two-build SDK verification,
production Chromium build, all 17 Chromium scenarios and `git diff --check`. The package contains
18 packed files: `package.json`, `contract.json` and 16 reviewed ESM/declaration files, including the
new capability client pair. Its export/content gate rejects host, Registry, browser/chrome, fetch,
arbitrary-message and absolute-path leakage.

The Chromium conformance fixture uses only echo/math schemas and one permission-free echo handler.
It proves a successful typed result, explicit client cancellation reaching the host abort signal,
stable unavailable for the handler-free math operation, generation rotation after reload and no
change to extension permissions or module storage.

RepoLens remains on the Phase 6C artifact by decision: all 34 tests and its offline 14-file vendor
gate pass, with no production or route change. The cross-repository verifier reports the expected
public package/index/runtime drift and therefore proves it did not silently accept the newer
artifact. RepoLens also passes `git diff --check`.

## Phase 6D-C conformance supplement (Complete, 2026-08-30)

The accepted transport is closed only after two independent module/session/generation principals
survive success, stable error, cancellation, timeout, both quota ceilings, hostile envelopes and
lifecycle loss without sharing authority. The echo/math catalog and handlers remain test assets.
They are not added to the production manifest capability list merely to make installation accept a
test ID.

Chromium therefore composes the real standard installer/Registry records for two different origins
with frames loaded from those same fixture origins through the built SDK and authenticated test host
dispatcher. A single before/after permission and storage snapshot covers installed records, grants,
timestamps, updates, builtin namespaces and global permissions. This proves the production
boundaries together without giving a remote production module a conformance or browser capability.

The completed fixture couples two built SDK clients to two host dispatchers without sharing any
binding, request counter, timer, callback or AbortSignal. Tests cover valid result and stable error,
explicit cancellation, timeout, both quota ceilings, cross-module request IDs, forged
module/session/generation/capability/operation/result fields, oversized and malformed values,
duplicate and late terminal envelopes, stale generation, port failure, destroy and reload. A
separate two-FrameHost case confirms that reloading alpha aborts only alpha's handler authority and
that stale alpha port traffic cannot alter beta's generation or results.

In Chromium, two modules install normally from different exact loopback origins. Test-only frames
from those origins authenticate with the built SDK and their own dispatcher binding. Both complete
success, stable failure and cancel; alpha then exhausts its 16-request in-flight quota, receives a
forged response, replays an old-session request after reload and is removed while beta continues to
complete new work. Request IDs differ and only alpha's generation rotates. A full extension
permissions and local-storage snapshot taken after installation and namespace seeding is identical
after the hostile lifecycle sequence, covering RepoLens, Bookmark Doctor, Clash Control, Browser
Journal, both remote records/grants/timestamps/update candidates and their module-local state.

### Phase 6D-C acceptance evidence

OneWeb passes typecheck, full lint, all 384 unit tests, deterministic two-build verification of the
18-file private SDK package, production Chromium build, all 18 Chromium scenarios and
`git diff --check`. Production source and package exports contain no `conformance.echo` descriptor,
real capability handler, browser/chrome API, arbitrary network/message bridge or new permission.

RepoLens remains deliberately unchanged: `pnpm check` passes all 34 tests and its offline 14-file
vendor digest gate. The cross-repository verifier reports the expected content/export drift against
the newer OneWeb SDK, proving no unneeded RPC artifact or production route was synchronized;
`git diff --check` also passes.

Phase 6 typed RPC infrastructure is closed by this supplement. The next stage is an explicit
evaluation of the first real capability candidate, including permission, sensitive-data,
confused-deputy, write-risk and user-value analysis. This decision does not authorize direct
implementation of `tabs.open`, storage, clipboard, downloads, notifications, auth or another
existing capability identifier.
