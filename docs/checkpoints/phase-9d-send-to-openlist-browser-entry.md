# Phase 9D Send to OpenList browser entry checkpoint

Date: 2026-09-04

Status: Complete

## Protected starting point

Phase 9D starts from the uncommitted Phase 9A–9C work on
`codex/phase-9a-openlist-contract`. The frozen `v0.1.0-rc.1`, RC artifacts and Phase 8D evidence are
unchanged. Phase 9C passed typecheck, full lint, 651/651 unit tests, reproducible 20-file SDK,
28-file production Chromium identity/build and 26/26 Chromium E2E. RepoLens remains protected with
34/34 tests and its offline 14-file vendor.

## Phase boundary

Phase 9D may add only explicit browser resource discovery: fixed context-menu entries for a link,
image, audio, video or page; current-page capture; and a user-triggered temporary top-frame scan via
the existing `activeTab + scripting` permission boundary. Discovery must feed the same Phase 9A
candidate normalizer and transient review inbox. It never submits, persists a queue or carries page
cookies, referers, headers or private-site data.

It must not add a resident content script, static `<all_urls>`, automatic scanning, XHR interception,
provider-private adapters, arbitrary scripts/selectors/actions, background polling or automatic
submission.

## Exit criteria

- Every discovery route is tied to an explicit user gesture and returns only bounded URL/title/source
  values to the trusted background.
- Temporary scanning executes only in the active tab's top frame and uses fixed packaged code.
- Invalid schemes and credentials are rejected; valid candidates are normalized, deduplicated and
  quota-bounded without changing signed query bytes other than dropping HTTP(S) fragments.
- Local-use targets remain visible with an explicit blocked diagnosis and can never reach submit.
- Context-menu and scan failures are isolated from existing candidates, profiles, secrets, tasks and
  every other module.

## Delivered

- Three fixed browser context menus collect only the page URL, link URL or media source supplied by
  the browser. Their enabled state follows the seeded builtin; foreign menu IDs and incognito tabs
  are rejected.
- Current-page capture queries the active ordinary tab only. Page scan calls one packaged,
  non-parameterized function through `scripting.executeScript` with `frameIds: [0]`; it enumerates a
  fixed list of URL-bearing elements and returns bounded plain data.
- A worker-memory discovery inbox merges and deduplicates normalized results. Existing candidates
  survive failed scans, worker restart loses the inbox, and disable/reinstall clears its authority.
- The trusted management view merges manual and browser candidates, renders titles and URLs as text,
  disables every explicit local-use target and labels all remaining candidates as dependent on the
  server's real outbound policy. Discovery never submits.
- The production manifest adds only the `contextMenus` non-host permission. It retains the existing
  `activeTab + scripting` boundary, the single GitHub content script and no static `<all_urls>`.

## Verification

Completed on 2026-09-04:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`: **660/660** tests across 85 files
- `pnpm verify:module-sdk`: reproducible **20-file** private SDK package
- `pnpm build`: production Chromium build and identity gate, **28 files**
- `EXTENSION_PATH="$PWD/extension" pnpm test:e2e`: **27/27** Chromium tests
- RepoLens: **34/34** tests and the offline **14-file** vendor gate; its accepted
  `typedCapabilities.storage.module` drift remains explicit and the vendor was not synchronized
- `git diff --check` in both writable repositories

The frozen `v0.1.0-rc.1`, RC artifacts and evidence are unchanged. Work remains uncommitted on
`codex/phase-9a-openlist-contract`. Phase 9E is next.
