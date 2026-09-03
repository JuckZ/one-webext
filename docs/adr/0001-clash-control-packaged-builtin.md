# ADR-0001: Use a packaged builtin for Clash Control

- **Status:** Accepted
- **Date:** 2026-08-28
- **Scope:** Phase 4A architecture decision only

## Context

Clash-compatible controllers expose authenticated HTTP endpoints on a user-configured localhost
origin. OneWeb needs to prove that it can read a minimal status without turning its remote-module
bridge into an arbitrary network API or exposing a controller secret to untrusted code.

Phase 4A compared two executable shapes against the same real Chromium and localhost-fixture gate:

1. A standard `remote-frame` runs at its declared origin inside the existing OneWeb sandbox. The
   experiment confirms it has no extension runtime or extension storage and receives only declared,
   granted context fields over the generic module bridge.
2. A packaged `builtin` uses a dedicated versioned request protocol whose receiver is the trusted
   background. It reviews one normalized exact loopback origin, adds the authorization header there
   and returns only sanitized version/mode status.

For a remote frame to own the controller call, the user secret would have to enter companion-owned
remote code, and success would depend on controller CORS/private-network policy. Giving the frame a
background fetch or secret bridge would weaken every remote module's boundary and create the generic
network capability that the module platform intentionally excludes.

## Decision

Clash Control will use a packaged `builtin` connector.

The accepted Phase 4A path has these non-negotiable properties:

- Controller input is a pure `http` or `https` origin on `localhost`, IPv4 `127.0.0.0/8` or IPv6
  `::1`; credentials, non-root paths, queries and fragments are rejected.
- The user reviews and grants only the normalized exact-origin pattern.
- The trusted background can issue only `GET /version` and `GET /configs`, with no credentials mode,
  no referrer, redirects disabled, a five-second cancellation deadline and a stream-enforced 64 KiB
  response limit.
- The secret is one-shot request memory in Phase 4A. It does not enter a URL, DOM node, generic
  context bridge, remote frame, log, extension storage, module Registry record or namespaced module
  state. Reflected secret text from a hostile localhost process is rejected rather than rendered.
- Disable, relevant permission removal and disconnect cancel the lifecycle and clear the dedicated
  capability grant. Only connector-acquired, unshared origin permission may be removed.
- The background protocol is accepted only from trusted extension management pages. Remote frames
  receive no Clash-specific operation and no generic localhost request primitive.

## Evidence

The Phase 4A gate includes loopback normalization, endpoint/authorization assertions, authentication,
network and protocol diagnostics, redirect and size rejection, secret non-disclosure, lifecycle
cancellation, conservative permission cleanup and Registry-level isolation tests. A real Chromium
scenario connects to an independent authenticated localhost fixture, shows only implementation,
version and mode, verifies secret absence across DOM, page URLs, console output and extension
storage, exercises authentication failure and disconnect, and snapshots RepoLens, Bookmark Doctor
and two installed remote modules before and after the flow.

At acceptance, typecheck, full-repository lint, all 199 unit tests, the production Chromium build,
all 13 Chromium E2E scenarios and `git diff --check` pass.

## Consequences

- Phase 4B stabilizes this dedicated connection and credential lifecycle; it does not introduce
  a generic secret vault, arbitrary URL fetch, remote controller or remote-frame credential bridge.
- Phase 4A does not persist credentials. Any future persistence proposal requires a separate threat
  model and dedicated trusted-background storage contract.
- Proxy switching, rule/configuration writes, reconnect, polling, notifications and multiple
  profiles remain outside this decision and outside Phase 4A.
- A future local companion may still provide its own independent UI and authentication, but it is
  not the OneWeb Clash Control trust path selected here.

## Phase 4B supplement — stable connection boundary

Phase 4B keeps this ADR's packaged-builtin decision and fixes the PoC lifecycle as follows:

- Persist one versioned profile containing only the normalized exact loopback controller origin.
  Secret, token, generation, connection status and response data remain memory-only.
- Model connection state explicitly as disconnected, preparing, connecting, connected or error.
  A preparation token is bound to its profile origin and generation and is invalid after expiry,
  replacement or any lifecycle cancellation.
- Treat MV3 worker startup as a disconnected session with no credential and no automatic reconnect;
  startup clears a stale dedicated capability grant even when the exact-origin permission remains.
- Coordinate exact-origin release through narrow packaged-builtin usage probes, while retaining the
  existing installed-remote-module veto. Neither generic Registry behavior nor the remote-frame
  bridge learns Clash-specific rules.

This supplement does not approve secret persistence. A future persistent-secret proposal still
requires a separate threat model and ADR revision before implementation.

The accepted supplement is implemented and verified by 221 unit tests plus 13 real Chromium
scenarios. The browser gate reloads the extension worker, observes a disconnected origin-only
profile and cleared dedicated grant, confirms zero automatic controller requests, and then requires
a fresh manual preparation and secret entry. `git diff --check`, typecheck, full lint and the
production Chromium build also pass.

## Phase 4C supplement — fixed read-only snapshot boundary

Phase 4C keeps both prior decisions and extends the packaged builtin with one manual, fixed-purpose
read contract:

- Only the controller-owned `GET /version`, `GET /configs` and `GET /proxies` endpoints are eligible;
  no caller-facing path, URL, method, header or request-options input is introduced.
- Controller payloads are untrusted and cross strict versioned parsers that project only runtime
  mode, proxy groups, current selections and minimal node status. Raw payloads do not reach the UI.
- A sanitized snapshot exists only in the current worker's memory, bound to the connected origin,
  lifecycle generation and newest manual refresh. Lifecycle invalidation clears it before cleanup,
  and worker restart neither restores it nor triggers a request.
- The transient secret remains request/session memory in the trusted background and stays absent
  from snapshot fields and all previously enumerated disclosure surfaces.

This supplement does not authorize Clash mutations, arbitrary requests, delay probes, polling,
automatic refresh/reconnect or remote controllers. Phase 4D remains a separate decision and gate.

The accepted supplement is implemented with protocol version 3 and snapshot version 1. Its final
gate passes typecheck, full lint, all 242 unit tests, production Chromium build, 13 real Chromium
scenarios and `git diff --check`. Phase 4D is next; no operation authority is implied by this
read-only completion.

## Phase 4D-A supplement — reviewed single-group selection

The packaged-builtin decision now permits one narrowly defined mutation skeleton: after a current
normalized snapshot is explicitly read, the trusted background may prepare a short-lived one-time
plan for changing one proxy group's selection to one node already present in that group. The plan is
bound server-side to the exact loopback origin, connection generation, complete snapshot identity,
reviewed original selection, target and expiry. Confirmation carries only the opaque token.

Execution consumes the plan before I/O, re-reads and normalizes only `GET /proxies`, re-checks the
reviewed group/current selection/target membership, and internally constructs only
`PUT /proxies/${encodeURIComponent(groupName)}` with exactly `{ name: targetNode }`. No caller-
controlled path, method, headers or JSON fields are accepted. Successful and ambiguous executions
invalidate the old snapshot; failures retain neither plan nor claimed success. Lifecycle changes,
permission loss and worker restart invalidate every outstanding plan.

This supplement does not approve mode switching, rules/config/provider writes, delay tests,
automatic selection, retries, arbitrary requests or operation UI. The review selector and explicit
confirmation surface are Phase 4D-B. Secret handling and all 4B/4C isolation requirements remain
unchanged.

This accepted supplement is implemented with dedicated protocol version 4. The public plan omits
its server-side snapshot binding, every confirmation is single-use, and strict protocol validation
rejects extra caller path/body/secret fields. The localhost fixture confirms the exact encoded
single-group write and manual-only snapshot recovery, while a real worker restart rejects an old
plan without a controller request. Typecheck, full lint, all 267 unit tests, production Chromium
build, all 13 Chromium scenarios and `git diff --check` pass. Phase 4D-B is the next decision and
product step.

## Phase 4D-B supplement — trusted review and confirmation surface

The accepted 4D-A authority is exposed only in the trusted packaged management page and only as two
separate user actions. Alternate nodes come from the current normalized ready snapshot. Preparing a
review sends the selected group and target through protocol v4; confirming sends only the opaque
token. The page displays old/new values, origin and expiry but never token, secret, URL path, JSON
body or generic request options.

The UI performs a local snapshot/expiry check for clear feedback, while the trusted background
remains authoritative and repeats the full 4D-A preflight. Success discards the local snapshot and
does not automatically refresh. Controller strings are rendered solely as text. This supplement
does not authorize new writes, change the 4D-A threat model, or pull Phase 4D-C concurrency and
Phase 4D-D final-isolation work forward.

This supplement is implemented without changing protocol version 4. The selector and review are
derived only from normalized snapshot data, plan expiry is checked locally for feedback, and the
confirmation transport receives only the token. Unit and Chromium checks prove untrusted text and
token/secret material stay out of executable or persistent surfaces, review produces no write, and
success requires a later manual refresh. Typecheck, full lint, all 280 unit tests, production
Chromium build, all 13 Chromium scenarios and `git diff --check` pass. Phase 4D-C is next.

## Phase 4D-C supplement — generation-fenced lifecycle recovery

The packaged management page must not let a late asynchronous response overwrite a newer Clash
lifecycle state. Each prepare, confirm, refresh, disconnect and permission-driven status update is
therefore generation-fenced in the UI, while the background retains the authoritative connection
generation, single-flight mutation and abort semantics.

The existing outcome-unknown rule is made observable in Chromium: if the controller applies the
fixed write but never returns a response, OneWeb reports no success and performs no retry or
automatic refresh. Only the Clash-standard `204 No Content` is accepted as a definitive write
acknowledgement; a `200`, malformed or missing acknowledgement, or post-write transport failure is
outcome-unknown. Remote selection replacement is rejected by the fixed preflight, and permission
loss during a blocked preflight aborts the operation before any write. No protocol change or new
authority is approved; Phase 4D-D keeps the final isolation decision.

This supplement is complete without changing dedicated protocol version 4. UI unit tests prove
late prepare/confirm responses cannot overwrite newer lifecycle state, and the controllable
localhost fixture proves stale preflight rejection, apply-then-no-response manual recovery and
permission-revocation cancellation. Typecheck, full lint, all 285 unit tests, production Chromium
build, all 14 Chromium scenarios and `git diff --check` pass. Phase 4D-D is next.

## Phase 4D-D supplement — final principal-isolation decision

Phase 4D-D completed on 2026-08-29 and changes no authority decision in this ADR. It audits the
packaged connector as one principal beside RepoLens, Bookmark Doctor and two installed remote
modules. Complete Registry records, update/approval state, namespaced local data and exact-origin
permissions are captured before the Clash lifecycle matrix and must be identical afterward for all
uninvolved principals.

The final browser evidence combines reviewed success, stale and outcome-unknown execution, manual
recovery, permission revocation and restart with a full secret-surface audit. Only trusted Clash
worker memory and its own record/origin lifecycle may change. A narrow defect fix is permitted only
to restore this boundary; new writes, protocols, polling, retries, profiles, remote controllers or
generic capabilities require a separate ADR.

The audit found and fixed one generic management-response consistency defect: an awaited lifecycle
hook could clean a module's grant while `setEnabled` still returned the pre-hook record. The manager
now rereads that same module after the hook; no Clash-specific branch was introduced. Complete unit
and Chromium matrices preserve every uninvolved record, update approval, namespace and permission,
and the secret-surface audit remains empty. Typecheck, full lint, all 287 unit tests, production
Chromium build, all 14 Chromium scenarios and `git diff --check` pass. The packaged-builtin decision
is accepted through the complete Phase 4 gate; Phase 5 requires separate decisions.
