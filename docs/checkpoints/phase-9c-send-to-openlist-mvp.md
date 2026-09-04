# Phase 9C Send to OpenList manual MVP checkpoint

Date: 2026-09-04

Status: Complete

## Protected starting point

Phase 9C starts from the uncommitted Phase 9A–9B work on
`codex/phase-9a-openlist-contract`. The frozen `v0.1.0-rc.1`, RC artifacts and Phase 8D evidence are
unchanged. Phase 9B passed typecheck, full lint, 643/643 unit tests, reproducible 20-file SDK,
28-file production Chromium identity/build and 25/25 Chromium E2E. RepoLens remains protected with
34/34 tests and its offline 14-file vendor.

## Phase boundary

Phase 9C may add only the trusted task-list/cancel connector operations and the smallest management
view for one active profile, manual text input, reviewed path/tool selection, per-item submission
results, explicit undone/done refresh and reviewed single-task cancellation.

It must not add context menus, current-page capture, page scanning, a resident content script,
polling, automatic retry, a persistent local queue, arbitrary server paths, page credentials,
provider-private APIs or a generic network capability.

## Exit criteria

- Manual input is normalized by the Phase 9A candidate contract and never auto-submitted.
- Profile save/connect, destination and dynamic tool review are explicit, and secret disclosures are
  confined to the dedicated trusted-background record plus the transient password input.
- Undone and done tasks are refreshed only on user action, strictly projected and bounded, and never
  treated as a local source of truth.
- Cancellation uses a short-lived, single-use plan bound to the latest undone snapshot, profile,
  origin and generation; stale, substituted or repeated confirmations fail.
- Loading, empty, error, ambiguous add and lifecycle-invalidated states render as text, with no
  polling, retry or persistent submission queue.

## Delivered

- The module management view exposes one active profile, explicit permission/token connection and
  manual multiline candidate input. Candidates are normalized, deduplicated and displayed before a
  separate submit action; no successful parse can trigger a request by itself.
- Destination and server-returned tools are reviewed explicitly. The background accepts only the
  fixed, typed commands and keeps per-item `succeeded`, `failed`, `outcome-unknown` or invalidated
  results without retrying or persisting a queue.
- The connector projects bounded undone/done task snapshots only on user refresh. A cancel review is
  single-use and generation/profile/origin/snapshot-bound; confirmation re-reads undone tasks before
  calling the fixed encoded cancel endpoint.
- Candidate URLs, titles and task fields are rendered as text. The transient token input is cleared
  after use and no secret is returned in protocol snapshots, Registry records, URLs or normal
  module state.

## Verification

Completed on 2026-09-04:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`: **651/651** tests across 83 files
- `pnpm verify:module-sdk`: reproducible **20-file** private SDK package
- `pnpm build`: production Chromium build and identity gate, **28 files**
- `EXTENSION_PATH="$PWD/extension" pnpm test:e2e`: **26/26** Chromium tests
- RepoLens: **34/34** tests and the offline **14-file** vendor gate; the verifier reports only the
  accepted `typedCapabilities.storage.module` drift and the vendor was not synchronized
- `git diff --check` in both writable repositories

The frozen `v0.1.0-rc.1`, RC artifacts and evidence are unchanged. Work remains uncommitted on
`codex/phase-9a-openlist-contract`. Phase 9D is next.
