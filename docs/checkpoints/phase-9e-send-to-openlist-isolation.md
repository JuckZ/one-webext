# Phase 9E Send to OpenList isolation checkpoint

Date: 2026-09-04

Status: Complete

## Protected starting point

Phase 9E starts from the uncommitted Phase 9A–9D work on
`codex/phase-9a-openlist-contract`. The frozen `v0.1.0-rc.1`, RC artifacts and Phase 8D evidence are
unchanged. Phase 9D passed typecheck, full lint, 660/660 unit tests, reproducible 20-file SDK,
28-file production Chromium identity/build and 27/27 Chromium E2E. RepoLens remains protected with
34/34 tests and its offline 14-file vendor.

## Phase boundary

Phase 9E may harden only the already accepted Send to OpenList surface: pinned OpenList/AList fixture
compatibility, profile-array storage and two-origin isolation, permission/disable/remove/reinstall and
worker-restart semantics, secret non-disclosure, Chromium/Firefox parity and complete unchanged-state
assertions for every existing builtin and remote module.

It must not add automatic polling/retry, a persistent task queue, provider-specific adapters, page
credentials, arbitrary connector operations, background automation, remote code or another feature.

## Exit criteria

- One common connector passes pinned OpenList and AList response/`Client-Id` differences without
  duplicating implementations or hard-coding tool names.
- Profile and token records support two exact origins with independent lifecycle, and deleting,
  revoking, failing or restarting one cannot change the other.
- DOM, URL, logs, generic module state, Registry, context bridge, remote frames and unrelated storage
  expose no token; only the dedicated per-profile local record may contain it.
- Chromium and Firefox production artifacts retain the fixed permission/content-script boundary and
  pass real lifecycle checks.
- Phase 9 closes only if the complete isolation and repository-protection gates pass without adding
  a provider-private fallback.

## Delivered

- Kept one fixed connector and added separate pinned local OpenList and AList fixture modes. The
  AList fixture requires the host-derived non-secret `Client-Id`; each fixture returns a different
  dynamic tool list, proving the product has no provider/tool-name branch in its public contract.
- Extended the versioned profile collection to retain up to eight exact-origin entries and dedicated
  per-profile local token records while keeping one active service in the MVP UI. Switching active
  profiles releases the previous transient origin authority without deleting that profile or token.
- Bound deletion and origin revocation to one profile. Revoking an inactive origin cannot disconnect
  the active service; deleting the active profile removes only its metadata/token and restores the
  next eligible profile. Disable clears all Send to OpenList tokens while retaining non-secret
  profiles.
- Preserved the protected-builtin rule: management removal is refused rather than partially deleting
  seeded state. The tested installation-identity replacement/reinstall path clears all Send to
  OpenList profiles and tokens without touching another module.
- Proved worker restart loses connection, in-flight and discovery-inbox authority, performs no
  automatic request, and restores only the explicitly persistent profile/token-presence view.
- Extended real Chromium and Firefox fixtures through the fixed connector and explicit discovery
  path while retaining exact-origin, top-frame, no-page-secret and no-provider-private-API bounds.

## Verification

Completed on 2026-09-04 with:

- OneWeb typecheck and full lint: passed.
- OneWeb unit tests: **665/665** across 85 files.
- Private SDK reproducibility/exports gate: two clean builds, **20 packed files** each, identical.
- Chromium production build and identity scan: **28 production files**, passed.
- Chromium E2E: **28/28**, including dual-service/origin isolation, permission revocation, worker
  restart and complete existing-module snapshots.
- Firefox production build and identity scan: **28 production files**, passed.
- Firefox manifest validation: **0 errors / 0 notices / 0 warnings**.
- Real Firefox packaged-builtin gates: **2/2**, covering Send to OpenList and the existing Page
  Toolbox lifecycle proof.
- RepoLens protection: **34/34 tests** and offline **14-file vendor** gate passed. Its vendor was not
  synchronized; the ADR-accepted `typedCapabilities.storage.module` artifact drift remains the only
  cross-repository diagnostic.
- OneWeb and RepoLens `git diff --check`: passed. The archived `one-tampermonkey` checkout remained
  read-only and unchanged.

The frozen `v0.1.0-rc.1`, its source commit, RC archives and Phase 8D evidence remain unchanged.
Phase 9 is complete. No commit, push, Release, browser-store action or RC mutation was performed.
The subsequent read-only release review and the rule requiring a new `v0.1.0-rc.2` if `0.1.0`
includes Phase 9 are recorded in
[`post-phase-9-release-convergence.md`](post-phase-9-release-convergence.md).
