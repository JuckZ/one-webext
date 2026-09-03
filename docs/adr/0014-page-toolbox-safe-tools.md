# ADR-0014: Page Toolbox first packaged safe tools

- **Status:** Accepted (Phase 7B-C Complete)
- **Date:** 2026-09-01
- **Scope:** Three static clean-room page tools, canonical plans and ownership-aware DOM execution

## Context

ADR-0011 through ADR-0013 establish one default-off packaged builtin, finite per-origin settings,
an abstract generation lifecycle/resource ledger and an authenticated exact-origin top-frame
injection channel. Phase 7B-C is the first stage allowed to mutate a page. It must prove useful DOM
behavior without turning the lifecycle port into a generic DOM, event or code bridge.

## Decision

Ship exactly three build-time catalog entries:

1. `password-visibility` accepts only a fixed double- or triple-click gesture setting. A delegated
   listener may change the `type` of a qualified current-page password input, but must never read its
   `value`. The first mutation records the exact prior attribute and a bounded node authority.
2. `free-page-edit` accepts only `rich-text` or `plain-text`. It may own the top document body's
   exact prior `contenteditable` presence/value and use one bounded observer to cover body
   replacement. It never reads, stores or emits edited content and does not use `designMode` or
   editing commands.
3. `selection-copy-release` accepts only three booleans: selection, copy and context-menu release.
   It may own one packaged static style and only the named `copy`, `contextmenu` and `selectstart`
   listeners. It exposes no caller-selected event, selector, CSS, text or action.

Descriptors remain default-off, top-frame, exact-origin, isolated-world and network-free. Settings
use exact-key schemas and the existing 2 KiB/depth/node ceilings. The trusted management surface may
enable, update or disable one catalog ID only for the current already-approved origin. Origin, tab,
frame, navigation and generation are host-derived. A disabled request contains no settings.

The lifecycle protocol is versioned forward to carry a monotonically increasing plan revision and
a sorted list of `{ toolId, settings }` values that has already passed the packaged catalog. It
does not carry implementation names, selectors, event types, URLs, methods, HTML, script,
expressions or arbitrary payloads. A stale/repeated plan revision is ignored. INIT, plan updates and
DISPOSE remain session-nonce and full-binding bound.

The content coordinator constructs one tool binding and one resource ledger per catalog entry.
Apply/update/dispose are synchronous and idempotent for the PoC. Updates publish only after the
tool-specific mutation succeeds; ambiguous or partial failure terminates and drains that tool
instead of retaining partial active authority. Removal, navigation, exact-origin revocation,
disable, port loss, worker restart or generation replacement drains tool instances in reverse order.

DOM ownership is kept in isolated-world memory and verified against the currently observed value.
Cleanup restores an attribute/style only if the same tool still owns the exact value it applied.
If page code, a framework or another tool subsequently changes or moves that resource, cleanup
skips it. Every listener, observer, owned style and prior-value record is ledgered exactly once;
password tracking is explicitly bounded.

## Threat model

- **Generic page deputy:** remote modules and pages cannot choose a tool, origin or plan. Only a
  trusted extension page reaches the finite management validator; only packaged IDs/schemas cross
  the authenticated lifecycle port.
- **Credential/content exfiltration:** implementations contain no fetch/browser API and never read
  password values, edited text, selections, cookies or page HTML. No tool data enters storage,
  Registry, logs, context bridge or remote-frame state.
- **Irreversible page damage:** whole-body replacement, HTML injection, arbitrary attributes,
  generic selectors/actions and MAIN-world execution are absent. Prior values are exact and cleanup
  is ownership-aware.
- **Listener/style abuse:** selection release has a closed three-event list and static CSS. Password
  uses one fixed delegated click listener. Free edit has one bounded body observer. All are removed
  through the ledger.
- **Replay/lifecycle races:** plan revision, session nonce, full binding and generation reject stale
  commands. First terminal cause wins; late work sees no authority.
- **Cross-tool/site mutation:** each tool has its own binding, ledger and ownership token. Host state
  remains keyed by normalized exact origin; one site's update cannot name another site.

## Rejected alternatives

- Copying the legacy userscript implementation: it has default-on behavior, untracked listeners and
  incorrect restoration.
- A selector/action JSON language or arbitrary DOM command protocol: this is an execution language
  and a confused-deputy escape hatch.
- Page-provided CSS/event names or MAIN-world hooks: unnecessary authority for the three tools.
- Persisting page snapshots or edited content: not needed for a manual reversible PoC.
- A Shadow DOM controller or complete settings UI: deferred to Phase 7C.

## Phase boundary

Phase 7B-C may add the static catalog, canonical plan protocol, trusted current-site tool mutation,
packaged DOM adapter/coordinator and tests for these three tools. It does not add a fourth tool,
multi-site completeness work, Shadow DOM UI, a generic page bridge, network/browser capability,
legacy migration or repository retirement. Phase 7B-D remains the next gate.

## Acceptance evidence

The production catalog contains exactly the three reviewed IDs and protocol v2 transports only
their canonically cloned settings with a monotonic plan revision. Unit tests cover descriptors,
exact schemas, malformed/duplicate plans, password node limits and dynamic nodes, exact prior-value
restoration, page-owned later mutation, body replacement, fixed event release, repeated/late plan
messages and overlapping generation ownership. The Chromium PoC explicitly enables, updates and
disables every tool, verifies top-frame-only behavior and untrusted text safety, replaces the
navigation generation, then proves revocation and module disable drain all owned resources.

At acceptance OneWeb passes typecheck, full-repository lint, all 494 unit tests, the deterministic
20-file SDK package/export gate, production Chromium build, all 21 Chromium E2E scenarios and
`git diff --check`. RepoLens remains on its protected 34-test/14-file offline vendor baseline with
the already documented expected SDK drift, and `one-tampermonkey` remains clean and read-only at
`448bf86d031881b3df687a6bcda416acd39307fa`.
