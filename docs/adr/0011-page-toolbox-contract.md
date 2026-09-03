# ADR-0011: Evaluate the historical userscript as one packaged Page Toolbox

- **Status:** Accepted (Phase 7A Complete)
- **Date:** 2026-08-30
- **Scope:** Read-only legacy audit and pure Page Toolbox contracts; no runtime or tool code

## Context

`one-tampermonkey` is a historical all-sites userscript prototype containing general page utilities,
site-specific automation, userscript privileges and UI code in one entry. OneWeb must become the
only active source, test and release entry without copying that historical host model or exposing page
execution to remote-frame modules.

Phase 7A audits each behavior and fixes the packaged builtin, tool lifecycle, site authorization,
data isolation and repository boundary before a content runtime exists. The historical repository is
strictly read-only throughout this phase.

## Audit result

The complete evidence and feature evaluation matrix live in
[`page-toolbox-legacy-audit.md`](../page-toolbox-legacy-audit.md). No legacy implementation is safe
to copy directly. The first PoC candidates are clean-room rewrites of password visibility, explicit
free-page edit and a narrowed selection/copy release. Floating UI, spacing inspection and night mode
are later/deferred. Analytics-global mutation, hard-coded intranet/report behavior, click replay,
whole-body store redirection, remote Vue and remote request/eval are rejected.

## Decision

Represent Page Toolbox as one disabled seeded `builtin` with no default matches, contexts,
capabilities or page permission. Its host-private packaged-page descriptor contains only versioned
tool metadata and selects implementations from an internal build-time allowlist. A remote manifest,
remote frame or context/capability message cannot name an entry, submit source or request arbitrary
execution.

Page access requires the enabled builtin, explicit user approval of one normalized HTTP(S) exact
origin and a tool enabled in that origin's local settings. Static `<all_urls>`, implicit subframe
access and wildcard stored grants are rejected. Phase 7B will choose a narrow injected registration
adapter and separately review any `scripting` permission; Phase 7A makes no manifest change.

Every active tool is bound to module, tab, frame, exact origin, navigation and generation. The first
runtime is isolated-world and top-frame only. Apply/update/dispose are idempotent and use one
runtime-owned resource ledger for listeners, timers, observers, abort signals, owned nodes/styles
and exact prior DOM values. Disable, revocation, navigation, frame teardown, port loss and extension
update make old generations terminal and require deterministic cleanup.

The lifecycle is a finite `inactive`/`applying`/`active`/`updating`/`disposing`/`disposed`/`failed`
state machine. Terminal causes are first-wins for one generation, updates are atomic, and no late
work can revive authority. Disable, removal, origin revocation, navigation, port loss or worker
restart disposes the old generation; re-enable or reinstall requires a fresh binding and generation.

Page and DOM inputs are untrusted and local. Password values, selections, edited content, cookies,
click paths and private report data do not enter storage, logs, Registry, generic context bridge,
remote frames or other modules. Tool settings are finite, tool-specific and cannot contain code,
arbitrary browser methods, URLs, HTML or action selectors.

Page Toolbox uses the generic module-local namespace
`oneweb.module-state.v1:dev.oneweb.page-toolbox`. Version 1 permits at most 64 exact origins, 16
enabled tools per origin, 2 KiB per-tool settings, 8 KiB per site and 64 KiB total, with depth 8 and
1,024 total JSON-like nodes. Exceeding a limit fails closed without silent eviction. The descriptor
fixes top-frame, user-approved exact HTTP(S) origin scope, exact-origin grant requirement and a
static allowlisted settings schema ID/version; callers cannot supply arbitrary selectors, actions,
code, URLs, schemas or messages.

Disable retains finite preferences while disposing runtime authority. Explicit origin revocation
deletes that Page Toolbox site binding/settings and asks the shared coordinator to remove browser
permission only if unused elsewhere. Worker restart or extension update preserves valid settings
but invalidates every live generation; a fresh generation may reconcile them only after all current
authority checks pass. The protected seeded builtin is not user-removable, and extension
uninstall/data reset returns it to empty default-off state.

OneWeb becomes the only active source, test and release entry. `one-tampermonkey` stays read-only
through 7A and is not a package, submodule, subtree sync, sibling dependency or mirror. Accepted
behavior is reimplemented and tested in OneWeb during 7B/7C. A later explicitly authorized action may
archive the old repository directly; it does not require tags, migration notices or compatibility work.

## Threat model and rejected alternatives

- Remote dependencies, dynamic import, `GM_xmlhttpRequest + eval`, externally hosted Vue and source
  URLs are remote-code substitution paths and are rejected.
- A generic page-DOM capability would let a remote module turn OneWeb into an execution deputy; only
  packaged Page Toolbox code may enter the page runtime.
- Static all-sites content scripts weaken consent and privacy. Exact-origin, user-initiated access is
  required even for a packaged builtin.
- Tool-owned cleanup methods alone are insufficient because legacy code routinely loses listener
  identity and timers. The common host must own registration and disposal accounting.
- One small OneWeb module per legacy menu item would duplicate permission, injection, state and
  lifecycle infrastructure. One module with isolated internal descriptors is selected instead.
- Retaining a shared userscript package or dual builds keeps two host models and release paths alive;
  one active clean-room implementation is selected.

## Consequences

Phase 7B is split into 7B-A pure runtime contracts/resource ledger, 7B-B exact-origin injection and
lifecycle channel, 7B-C first safe-tool PoCs and 7B-D two-site/multi-tool isolation. ADR-0012 fixes
the 7B-A model. Individual tools cannot create their own injection, permission, storage,
message-authentication or cleanup layer. Shadow DOM, site-setting UI and browser-parity gates remain
in later separately reviewed stages; no migration surface is planned.

Phase 7A changes only OneWeb documentation. It does not authorize production source, manifest,
permission, Registry, dispatcher, FrameHost, management UI, runtime, tool or E2E changes, and it
does not modify RepoLens or `one-tampermonkey`.
