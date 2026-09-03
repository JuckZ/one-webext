# ADR-0018: Page Toolbox generation-bound Shadow DOM control surface

- **Status:** Accepted (Phase 7C-C Complete)
- **Date:** 2026-09-02
- **Scope:** Packaged closed Shadow DOM surface, authenticated toggle commands and lifecycle cleanup

## Context

Phase 7C-B accepts the trusted sidebar as the only authority-bearing product settings surface. An
approved site already receives one authenticated, top-frame, isolated-world Page Toolbox runtime
generation and the finite enabled-tool plan. A page-local convenience surface is useful, but it must
not become a second permission prompt, storage client, arbitrary settings editor or generic DOM/
browser bridge.

## Decision

Add one packaged, closed Shadow DOM control surface after—and only after—the existing lifecycle
INIT authenticates the content runtime. The surface is owned by the current exact-origin/tab/
navigation/generation binding. It renders fixed OneWeb copy and exactly the three packaged tool IDs;
it never renders page content, page title, URL, password, selection, edited text or remote data. Its
only privileged request is `set one packaged tool enabled/disabled`.

The lifecycle channel advances to version 3. A control request is a canonical envelope containing
the current session nonce and binding, one client-generated session-unique action ID, a catalog tool
ID and one boolean. It contains no origin/URL supplied independently of the authenticated binding,
settings document, selector, event name, HTML/CSS, script, expression, browser method, storage key,
permission request or arbitrary message. The host result repeats the canonical action identity and
returns either changed/unchanged acceptance or one stable bounded error.

The content runtime creates action IDs from its authenticated challenge plus a monotonic sequence,
accepts at most one pending surface action and accepts a result only for that pending ID/current
session/binding. The host permits at most one in-flight action and 128 total action IDs per session;
duplicates, floods and stale generations fail closed. The host rechecks the live session, enabled
seeded record, tab/navigation exact origin, stored site approval and browser exact-origin permission
inside its existing serial mutation queue. Enabling uses only the site's already validated stored
tool settings or that packaged tool's static default. Disabling changes only the catalog ID. A
successful mutation writes before publish, advances the same per-site revision and synchronizes all
authenticated sessions for that origin; no separate page-control storage exists.

The surface uses `attachShadow({mode: 'closed', delegatesFocus: true})` and creates every element with
DOM APIs plus `textContent`. One fixed host node, its shadow style and delegated listeners are owned
by an internal generation-bound resource-ledger authority. Navigation, revoke, disable, port loss,
worker restart, generation replacement or explicit runtime disposal releases listeners and removes
the owned host in reverse order. If the page removes or replaces the host, ownership-aware cleanup
does not overwrite the page's later DOM choice; the authenticated port generation is still ended.

The trusted sidebar remains the only surface that can approve an origin, edit finite tool settings,
perform revision-bound whole-site CAS, reload stale state or revoke access. The Shadow surface cannot
open a browser permission prompt and cannot act before approval because it does not exist before an
authenticated approved-site generation.

## Threat model

- **Page-to-host forgery:** MAIN-world page code has no runtime port, session nonce, binding or closed
  shadow references. Synthetic page events cannot name a command; the only command producer is the
  packaged isolated-world listener.
- **Confused deputy:** request identity is canonical and bound to the authenticated session. The
  host derives storage namespace and rechecks the bound tab/origin rather than accepting a target.
- **Replay/flood:** client and host both enforce one pending action, unique IDs and finite per-session
  totals. Duplicate, late and old-generation results cannot change UI or host authority.
- **Settings escape:** page actions carry only tool ID plus boolean. Settings resolve from validated
  host state or immutable packaged defaults; no arbitrary settings or DOM program crosses the port.
- **Lifecycle race:** the controller serializes mutations and rechecks the current session before
  committing. Teardown removes only the matching generation; a peer tab/origin remains live.
- **DOM/CSS interference:** a page may hide, move or remove the host, but cannot obtain permission or
  message authority. Cleanup is ownership-aware and never restores through a page-owned replacement.
- **Sensitive display:** the surface contains static tool labels and enabled booleans only. It never
  reads or displays page data.

## Rejected alternatives

- An open ShadowRoot or light-DOM product panel.
- A page control that asks for host permission or approves/revokes a site.
- Sending complete settings, arbitrary selectors/actions or a generic message payload from content.
- Calling browser storage, scripting, permissions, tabs or network APIs from the content runtime.
- Persisting launcher open/closed state or pending actions.
- A control surface per tool or a second Page Toolbox module.

## Phase boundary

Phase 7C-C may add the pure surface reducer, lifecycle-v3 toggle/result envelopes, the closed packaged
surface, host toggle adapter and Chromium lifecycle/isolation gate. It must not add settings editors,
new tools, page-origin permission UI, arbitrary DOM/code/network/browser bridges, Shadow persistence,
remote-module injection, static `<all_urls>`, legacy migration or Phase 7C-D decisions.

## Acceptance evidence

The accepted implementation adds a pure generation-bound surface reducer, exact lifecycle-v3
toggle/result validators, a closed packaged ShadowRoot, a one-pending content client and a serialized
host adapter. Focused tests prove canonical identity, first-terminal-wins, duplicate and late result
rejection, 128-ID flood containment, default-versus-saved settings selection, write-before-publish,
same-origin synchronization, cross-origin failure isolation, static-text rendering, construction
rollback and ownership-aware reverse cleanup.

The real Chromium gate approves one exact origin through the trusted sidebar, then operates the
closed surface by keyboard without gaining a ShadowRoot reference. It toggles password visibility
and free edit, observes sidebar synchronization, keeps a second origin untouched, survives a
page-owned host removal/replacement, creates fresh authority after navigation and worker restart,
and drains the surface and tools on revoke and module disable. Unrelated module records, namespaced
state, permissions, storage and remote fixture traffic remain byte-for-byte unchanged outside the
expected Page Toolbox document.

OneWeb passes typecheck, full lint, **549/549 unit tests**, the reproducible **20-file SDK** gate,
production Chromium build, **24/24 Chromium E2E** scenarios and `git diff --check`. RepoLens remains
on its unchanged **34-test/14-file** offline vendor baseline with only the already accepted
`typedCapabilities.storage.module`/artifact drift; the legacy repository remains read-only.
