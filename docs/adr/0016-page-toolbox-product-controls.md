# ADR-0016: Page Toolbox product control contract

- **Status:** Accepted (Phase 7C-A Complete)
- **Date:** 2026-09-02
- **Scope:** Pure current-site product snapshots, presentation, drafts and concurrency states

## Context

Phase 7B proves a default-off packaged Page Toolbox runtime, three finite clean-room tools and full
two-origin isolation. It intentionally exposes no product settings surface. Adding a trusted
sidebar and a page Shadow DOM launcher in one step would mix presentation decisions with active-tab
derivation, exact-origin permission, storage CAS and content lifecycle authority.

Phase 7C-A therefore fixes the product contract as pure data before any browser-backed control is
connected. It imports the reviewed static tool catalog but no browser/chrome API, Registry, storage,
background dispatcher, Page Toolbox port or DOM adapter.

## Decision

The product control snapshot is versioned and host-derived. It contains a bounded display title,
the normalized current exact origin when supported, a non-negative revision, module/site access
state and settings for exactly the packaged tool IDs. Its access states are closed:

- `unsupported`: the current top-level document has no eligible HTTP(S) exact origin;
- `module-disabled`: the seeded Page Toolbox record is disabled;
- `site-unapproved`: the origin has no complete stored approval plus browser exact-origin grant;
- `ready`: the module, site entry and permission are all valid.

The pure presentation reducer additionally owns `idle`, `loading`, `ready`, `saving`, `stale` and
`error` request phases. Each load/save request has a unique bounded ID. Only the currently pending
request may publish a terminal result. A save starts from the loaded revision; a conflict or a newer
host revision invalidates the draft and enters `stale`. Late, duplicate and replaced terminals are
ignored. Discarding a draft restores the last accepted canonical snapshot. Inputs are cloned and
outputs are immutable so one view instance cannot mutate another.

Exactly three static product controls exist in this phase:

1. password visibility: double-click or triple-click gesture, default double-click;
2. free page edit: rich-text or plain-text mode, default rich-text;
3. selection/copy release: three named booleans only, all default true.

All tools are presented default-off. Labels, summaries and choices come from a packaged product
catalog, never from a page or remote module. Settings pass the existing tool-specific schema and
finite quotas before they enter a draft. Origin and page title are untrusted display strings: the
model removes non-display control characters, applies explicit length bounds and returns text only.
Future UIs must render it by text interpolation, never HTML.

The trusted extension sidebar will be the authority-bearing product surface in Phase 7C-B. It may
later request current-tab preparation, exact-origin approval/revocation and revision-bound settings
mutation through a narrow background protocol. It still cannot submit a target tab, origin,
physical storage key or generation. The future Shadow DOM surface in Phase 7C-C is a convenience
view tied to its authenticated page generation. It has a strict subset of commands, no independent
permission/storage authority and no generic DOM or browser bridge.

## Threat model

- **Confused site deputy:** a view never selects its target origin. The future host creates the
  snapshot from the current authenticated top frame; the pure model only validates that snapshot.
- **Lost update:** every mutation is bound to the accepted revision. Conflict becomes an explicit
  stale state and never overwrites a newer site document.
- **Catalog/settings escape:** tool IDs and settings are validated against the packaged catalog and
  exact schemas. Arbitrary IDs, URLs, selectors, event names, scripts and expressions are absent.
- **Untrusted display content:** page titles and origins never become HTML, CSS, URLs to navigate or
  log fields. They are bounded text-only projections.
- **Cross-instance replacement:** request IDs, canonical clones and immutable state prevent one
  reducer instance or late response from publishing into another authority.
- **Premature page authority:** no Shadow root, page listener, permission request, storage mutation,
  injection or lifecycle message is introduced by 7C-A.

## Rejected alternatives

- Building the full sidebar and background protocol before fixing stale/conflict semantics.
- Giving a Shadow DOM launcher direct access to storage, permissions or arbitrary tool settings.
- Reusing the legacy floating menu, click replay or external assets/CDN.
- Generating controls from remote descriptors or allowing generic selector/action settings.
- Optimistic last-write-wins updates without an accepted revision.

## Phase boundary

Phase 7C-A may add documentation, a pure versioned snapshot validator, packaged control metadata,
presentation projection and a deterministic request/draft reducer with unit tests. It must not
modify the manifest, permissions, background controller, ModuleFrameHost, Page Toolbox protocol,
settings store, content runtime, current sidebar UI or page DOM. Phase 7C-B is the next separately
reviewed stage.

## Acceptance evidence

The implementation contains only a pure snapshot validator, product catalog projection and reducer.
Nineteen focused tests cover all access states, default-off controls, finite settings choices,
malformed/accessor/over-limit inputs, request replacement, late terminals, revision and response
conflicts, draft discard, immutable inputs, hostile display text, surface-policy separation and
reducer-instance isolation.

At acceptance OneWeb passes typecheck, full-repository lint, all 515 unit tests, the deterministic
20-file SDK package/export gate, production Chromium build, all 22 Chromium E2E scenarios against
the freshly built `extension/` artifact and `git diff --check`. RepoLens remains unchanged and
passes all 34 tests plus its offline 14-file vendor gate and `git diff --check`; its cross-repository
verifier continues to report only the intentionally unsynchronized
`typedCapabilities.storage.module`/artifact drift. `one-tampermonkey` remains clean and read-only at
`448bf86d031881b3df687a6bcda416acd39307fa`.
