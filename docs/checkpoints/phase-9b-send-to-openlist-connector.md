# Phase 9B Send to OpenList trusted connector checkpoint

Date: 2026-09-03

Status: Complete (2026-09-04)

## Protected starting point

Phase 9B starts from the uncommitted Phase 9A work on
`codex/phase-9a-openlist-contract`. The frozen `v0.1.0-rc.1` tag, release-candidate artifacts and
Phase 8D evidence are not modified. RepoLens retains its reviewed 14-file vendored SDK and large
uncommitted working tree; `one-tampermonkey` remains read-only and archived.

The entry gate remains OneWeb typecheck, full lint, 623/623 unit tests, reproducible 20-file SDK,
Chromium production identity/build and 24/24 Chromium E2E. RepoLens remains 34/34 with its offline
14-file vendor gate and the already accepted `typedCapabilities.storage.module` drift.

## Phase 9B boundary

Phase 9B may add only the packaged builtin record, one-profile trusted-background lifecycle, exact
origin approval, a dedicated local token record, the fixed audited OpenList/AList connector and
local hostile protocol fixtures. It supports identity verification, dynamic tool discovery and
one-URL adds with at most two writes in flight.

It does not add product task UI, browser resource discovery, context menus, page scanning, polling,
automatic retry, a persistent task queue, provider-private APIs or a generic network capability.

## Exit criteria

- Exact origin, profile, preparation token and lifecycle generation are bound before any request.
- Only the audited methods, paths, headers and bodies can leave the connector; redirects never
  forward the token.
- The token is stored under one host-owned local key and is absent from profiles, public results,
  Registry, generic module state, URLs, logs, DOM, context bridge and remote frames.
- OpenList/AList tool-discovery differences, raw Authorization, host-owned AList Client-Id, wrapped
  body status, hostile/oversized bodies and SimpleHttp no-task success are covered by local fixtures.
- A dispatched write followed by transport loss is `outcome-unknown` and is never retried.
- Disable, grant revocation, remove/reinstall and worker restart cancel transient authority and apply
  the documented profile/token cleanup semantics without affecting another module.

## Delivered checkpoint

- `dev.oneweb.send-to-openlist` is a disabled-by-default packaged builtin declaring only
  `resources.openlist.submit`; no new extension permission was added.
- The trusted background binds a validated profile, exact-origin preparation token, installation ID
  and generation before verification. It persists profile metadata and the token separately and
  never returns the token through the protocol.
- The connector owns every URL, method, header and body field. Tool discovery omits Authorization;
  `/api/me` and single-resource adds use the raw token, host-owned `Client-Id`, manual redirects,
  bounded responses and no credentials/referrer.
- Dynamic tools bind the reviewed destination path and generation. Every add carries exactly one
  candidate and no more than two writes run concurrently. Ambiguous POST transport loss is terminal
  `outcome-unknown` and is not retried.
- Disconnect, disable, origin revocation, reinstall and worker restart invalidate transient
  authority, revoke the capability grant and follow the documented profile/token cleanup boundary.
  Exact-origin removal remains coordinated with other builtins and user remote modules.

## Verification

- OneWeb: typecheck and full lint passed; 643/643 unit tests passed.
- Private SDK: two clean builds produced the same 20-file package.
- Production Chromium: identity gate passed with 28 production files.
- Chromium E2E: 25/25 passed, including the fixed background connector, dedicated token surface,
  dynamic tools, two per-item writes, disconnect cleanup and protected-module snapshot.
- RepoLens: 34/34 and the offline 14-file vendor gate passed. The cross-repository verifier retains
  only the accepted `typedCapabilities.storage.module` drift; the vendor was not synchronized.
- Both active repositories passed `git diff --check`; the archived `one-tampermonkey` repository was
  not modified.

Phase 9C is next. It may add only one-active-profile manual submission and explicit server task
refresh/cancellation UI; polling, retry, a persistent queue and browser discovery remain out of
scope.
