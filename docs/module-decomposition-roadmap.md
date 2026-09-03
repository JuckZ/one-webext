# OneWeb Module Decomposition Roadmap

## 1. Current-state clarification

The current production build includes the OneWeb side panel, generic remote-frame module lifecycle,
RepoLens seed, Bookmark Doctor, Clash Control, Browser Journal, Page Toolbox, the trusted background
worker and packaged context/content runtimes. The private module SDK is built reproducibly from this
repository but is not published. Home, popup, old content-script UI and DevTools sources remain
non-productized prototypes and are not active build entries.

Those unused prototypes are optional design evidence, not compatibility obligations. OneWeb is an
unreleased, clean-slate product and does not preserve old configuration or runtime behavior merely
because a prototype once contained it.

## 2. Module forms

OneWeb needs three extension forms rather than forcing every feature into the RepoLens remote-iframe
model.

| Form           | Execution and trust model                                     | Typical use                                    |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `remote-frame` | Independently deployed web UI in a sandboxed iframe           | RepoLens and user-created web modules          |
| `builtin`      | Packaged extension code with optional privileged capabilities | Bookmarks, request rules, browsing data        |
| `command`      | Small host-owned action without a dedicated module page       | Tab navigation, reload, search and open action |

Remote modules must never download code into an extension context or receive raw browser APIs.
Built-in modules use the same registry, router and permission-review concepts, but their executable
code ships with OneWeb. Commands remain part of the host so small actions do not create unnecessary
module lifecycle and UI overhead.

## 3. Decomposition decisions

### RepoLens — reference remote module

- **Form:** `remote-frame`
- **Positioning:** GitHub repository intelligence.
- **Role in the platform:** The first seeded module and the compatibility reference for third-party
  module authors.
- **Next action:** Move its hard-coded origin, protocol and GitHub context delivery behind the
  generic module host without changing current user behavior.

### Bookmark Doctor — first privileged built-in module

- **Form:** `builtin`
- **Positioning:** Detect, repair, ignore and remove invalid bookmarks.
- **Why separate:** It has a coherent workflow, dedicated state, long-running checks and destructive
  operations that need focused confirmation UX.
- **Security boundary:** Bookmark data stays local. The module requests the optional `bookmarks`
  capability and cannot expose bookmark contents to remote modules.
- **Source prototype:** `src/options/Options.vue`, `src/utils/check.ts`, `src/utils/native.ts`,
  `src/utils/scheduler.ts` and `src/utils/whitelist.ts`.

### Clash Control — local connector module

- **Form:** Packaged `builtin` connector. The Phase 4A decision is recorded in
  [`ADR-0001`](adr/0001-clash-control-packaged-builtin.md).
- **Positioning:** Inspect and switch local Clash proxy selectors from the side panel.
- **Why separate:** It has a distinct audience, configuration lifecycle and external service.
- **Security boundary:** Request one normalized exact loopback origin. Keep the secret only in the
  dedicated trusted-background credential lifecycle; Phase 4A keeps it in request memory and does
  not persist it. Do not introduce a generic arbitrary-network capability or secret bridge.
- **Source prototype:** `src/popup/Popup.vue` and `src/logic/storage.ts`.

### Header Rules — declarative privileged module

- **Form:** `builtin`
- **Positioning:** Create, review, enable and disable per-site request-header rules.
- **Why separate:** It is unrelated to Clash even though both currently share the popup prototype.
- **Security boundary:** Use validated declarative rules and optional browser permissions. Never
  accept remote JavaScript or expose a generic request interception API.
- **Source prototype:** `customHeader` state in `src/logic/storage.ts` and its editor in
  `src/popup/Popup.vue`.

### Socket Inspector — developer module or separate extension

- **Form:** Packaged DevTools module if developer tooling remains in OneWeb; otherwise a separate
  extension.
- **Positioning:** Inspect WebSocket frames and inspected-page resources.
- **Why separate:** It needs a developer-specific surface and sensitive debugger or DevTools
  permissions that should not burden normal users.
- **Decision gate:** Keep it in OneWeb only if optional permissions and build entries can prevent a
  broad default install prompt.
- **Source prototype:** `src/contentScripts/views/App.vue`, `src/devtools/` and
  `src/devtools-page/`.

### Privacy Cleaner — privileged built-in module

- **Form:** `builtin`
- **Positioning:** Clear selected browser data for an explicit time range.
- **Why separate:** It has a coherent privacy workflow and destructive operations.
- **Security boundary:** Optional `browsingData` permission, explicit category selection and a final
  confirmation. Passwords and site data must never be preselected by default.
- **Source prototype:** `cleanHistory` in `src/logic/index.ts`.

### Browser Journal — optional local built-in module

- **Form:** `builtin`
- **Positioning:** Record a user-started, local browsing session for later review.
- **Why separate:** Session observation is useful without turning the OneWeb host into a permanent
  browsing-history collector.
- **Security boundary:** Phase 5A observes only active-tab activation and navigation after an
  explicit start, keeps the session in trusted worker memory, excludes incognito tabs and requests
  neither `history` nor `sessions`. Any future durable journal needs a separate retention, deletion
  and threat-model decision.
- **Source prototype:** `src/home/Home.vue`.

## 4. Host responsibilities that must not become modules

- Module installation, validation, enable/disable and removal.
- Module selection, routing, health and permission review.
- Active-tab context collection and field-level disclosure.
- OneWeb Home, module discovery and the command launcher.
- Product settings, theme, language and storage migrations.

Search-provider selection may remain part of OneWeb Home. Switching tabs, opening a URL, reloading a
page, opening settings and updating the action badge are `command` actions rather than modules.

The unfinished extension reloader should not become a OneWeb module. It requires broad
`management` access and is better removed or maintained as a separate developer extension.

## 5. Execution order and phase gates

Only one phase is active at a time. A later phase starts after the previous phase passes its tests
and leaves the default Chromium and Firefox builds usable.

### Phase 0 — Contracts and registry

- Define the versioned module manifest, contexts and capabilities.
- Validate remote origins, match patterns and bridge versions.
- Add versioned installed-module records and a storage-backed registry.
- Seed RepoLens without changing the current runtime path.

**Gate:** Unit tests cover valid and malicious manifests, storage recovery and deterministic seeding.

**Status (2026-08-26): Complete.** The contracts live in `src/modules/types.ts`, manifest
validation in `src/modules/manifest.ts`, the storage-backed registry in `src/modules/registry.ts`,
and the protected RepoLens seed in `src/modules/seeds/repolens.ts`. The background initializes the
registry. Phase 1A subsequently routes the current sidebar through that seeded record.

### Phase 1 — Generic RepoLens host

**Status (2026-08-26): Complete.**

#### Phase 1A — Generic remote-frame lifecycle — Complete

- The sidebar resolves RepoLens from `ModuleRegistry` and delegates its iframe to
  `ModuleFrameHost`.
- The initial `MODULE_HELLO` / `MODULE_INIT` exchange verifies exact origin, source, module ID and
  challenge, then transfers a private `MessageChannel` with a fresh nonce.
- Context delivery is limited to installed `grantedContexts`; remote code remains outside the
  extension context and receives no browser API.
- RepoLens now consumes `contexts["github.repository"]` through `oneweb.module` rather than the
  retired `repolens.bridge` protocol.
- Regression tests cover both initial-load/async-authorization and subsequent iframe-reload
  handshake races.

**Phase 1A gate:** Complete. OneWeb passed all 23 unit tests, both Chromium E2E scenarios,
Chromium and Firefox production builds, and strict Firefox manifest validation. RepoLens passed
all 28 checks.

#### Phase 1B — Generic context provider — Complete

- `ContextBroker` now owns provider source validation, normalization, per-tab state, dedupe,
  revisions and generic snapshots.
- GitHub parsing and SPA observation now live behind the `github.repository` provider; leaving a
  repository route emits an explicit removal so a remote module cannot retain stale context.
- Manifests declare `context_fields`, installed records persist `grantedContextFields`, and
  `ModuleFrameHost` sends only their intersection with normalized provider output.
- RepoLens no longer requests the unused `tab.basic` context or any host capability.
- The generic `oneweb.context` runtime protocol replaces RepoLens-specific content/background/
  sidebar messages while preserving sender validation and the Firefox navigation fallback.

**Phase 1B gate:** Complete. OneWeb passes all 28 unit tests and both Chromium E2E scenarios,
including context removal and restoration. The Firefox production build passes strict manifest
validation with zero errors, warnings or notices. RepoLens passes all 28 checks.

**Phase 1 gate:** Chromium behavior remains unchanged through the fully generic lifecycle and
context paths; Chromium and Firefox production artifacts remain usable. The default remote
delivery is now field-level rather than context-ID-only.

### Phase 2 — Module management

**Status (2026-08-28): Complete. Phase 2A through 2D-B4 close the module-platform loop.**

Phase 2 is split so storage mutation, UI, network permissions and update policy are not designed and
debugged at the same time. The background owns every registry mutation; extension pages may request
changes through the versioned management protocol but must not write module records directly.

#### Phase 2A — Background management core — Complete

- Serialize registry reads and mutations so concurrent enable/disable or remove operations cannot
  lose another change.
- Add list, enable/disable and remove operations behind a background-owned `ModuleManager`.
- Allow a seeded module to be disabled, but never removed. User-installed records may be disabled
  or removed without changing protected seeds.
- Define a pure permission-diff model for entry origin, matches, contexts, context fields and
  capabilities. It classifies expanded access but does not fetch or install an update.

**Phase 2A gate:** Unit tests cover seeded-module protection, user-module lifecycle, no-op
timestamps, concurrent mutations and both expanded-access and reduced-access diffs. OneWeb's
existing Chromium and Firefox gates remain usable.

**Phase 2A status (2026-08-27): Complete.** `ModuleRegistry` serializes normalization, reads and
mutations; `ModuleManager` owns list, enable/disable and remove requests in the background; the
sidebar reads the seed through that internal protocol instead of touching storage. Seed protection,
user lifecycle, no-op writes, concurrent changes, sender validation and permission diffs are covered
by unit tests. OneWeb passes all 37 unit tests, typecheck and lint, both Chromium E2E scenarios,
Chromium and Firefox production builds, and strict Firefox manifest validation with zero errors,
warnings or notices.

#### Phase 2B — Management interface — Complete

- Add the module list, enable/disable controls and removal confirmation.
- Show installed source, requested access and current grants as read-only details.
- Consume only the background management protocol; do not import the storage-backed registry into
  the UI mutation path.
- Keep the current module frame isolated from the management surface. Disabling the active module
  unloads it immediately; enabling it creates a fresh frame-host session.

**Phase 2B gate:** Unit tests cover the management client and permission presentation. Chromium E2E
covers list rendering, seed protection, active-module disable/enable and confirmed user-module
removal. The existing context and bridge scenario, Chromium/Firefox builds and Firefox manifest
validation must remain green.

**Phase 2B status (2026-08-27): Complete.** The side panel now has a module-management surface with
safe text-only manifest rendering, enabled state, protected-seed behavior, read-only requested and
granted access, and explicit user-module removal confirmation. Disabling the active RepoLens frame
destroys its channel; re-enabling creates a fresh host session and requests the active-tab context
again. OneWeb passes all 42 unit tests, typecheck and lint, all three Chromium E2E scenarios,
Chromium and Firefox production builds, and strict Firefox manifest validation with zero errors,
warnings or notices. The 420-by-900 management and expanded-permission layouts were also checked in
a real extension page with no console errors.

#### Phase 2C — Remote installation — Complete

- Add manifest-URL installation, schema review and exact optional-origin permission requests.
- Persist a user record only after explicit review and approval.
- Keep remote JavaScript in a sandboxed web frame; never load it into an extension context.
- Request the exact manifest origin synchronously from the trusted sidebar user gesture, then make
  the background verify that grant before it fetches anything.
- Re-fetch and compare a normalized manifest digest at confirmation time so a changed remote
  manifest cannot bypass the screen the user reviewed.
- Release optional origin access after cancellation, failed review or removal when no installed
  module still uses that origin.

The packaged optional-host and CSP declarations are ceilings, not grants. Runtime records and exact
`browser.permissions` origins remain authoritative; remote scripts continue to execute only in
sandboxed web frames.

**Phase 2C gate:** Unit tests cover safe URL patterns, permission denial, fetch limits, redirects,
origin binding, host compatibility, digest changes, grant normalization, duplicate IDs and origin
release. Chromium E2E installs an isolated local fixture only after review and confirms that cancellation
does not persist it. Existing unit, bridge, management, Chromium/Firefox build and manifest gates
remain green.

**Phase 2C status (2026-08-27): Complete.** The module manager accepts a manifest URL, requests
only its exact optional origin from the initiating click, and leaves all fetching, digest checks and
registry mutation in the background. Manifests are limited to 128 KiB, bound to a single approved
origin, checked against the host version and fetched again at confirmation; user-selected context
fields and capabilities are normalized against the reviewed declaration before persistence.
Cancellation, failed confirmation and removal release an origin only after the registry confirms no
other remote module uses it. Remote module copy is rendered as text, and its executable page remains
ordinary web content in the existing sandboxed iframe without `browser.*` access.

The final gate passes typecheck, full-repository lint, all 59 unit tests and all five Chromium E2E
scenarios. The E2E fixture covers cancel-without-persistence and confirmed installation with reduced
grants, including the mandatory confirmation-time re-fetch. Chromium and Firefox production builds
are refreshed, and strict Firefox manifest validation reports zero errors, warnings or notices.

#### Phase 2D — Updates and conformance

Phase 2D is split so the persisted update contract and security classification can stabilize before
network checks, approval UI or update application mutate an installed record.

##### Phase 2D-A — Update contract and pure classification — Complete

- Extend installed records with nullable candidate metadata: the validated candidate manifest,
  candidate source URL, SHA-256 digest of the normalized manifest, check timestamp and approval
  status.
- Migrate Phase 0–2C records by adding `update: null` during the next registry normalization write.
  Migration must preserve the installed manifest, grants and lifecycle timestamps.
- Classify copy/version changes and permission reductions as safe to apply.
- Require approval when a candidate adds match patterns, contexts, context fields, capabilities or
  changes activation from manual to suggested.
- Reject module ID, manifest/runtime type, source origin, entry origin or bridge protocol changes.
- Keep classification pure: no fetch, timers, registry mutation, permission prompts or UI.

**Phase 2D-A gate:** Tests cover unchanged/copy updates, reduced access, every expanded-access
dimension, malicious immutable-boundary changes, candidate-metadata normalization and Phase 0–2C
record migration. Typecheck, lint and unit tests remain green.

**Phase 2D-A status (2026-08-27): Complete.** Installed records now carry nullable, validated
candidate metadata without acquiring or applying updates. Registry normalization migrates legacy
records once while preserving installed manifests, grants and lifecycle timestamps; malformed
candidate state is cleared independently. The pure classifier treats copy/version, same-origin path
and reduced-access changes as safe, requires approval for expanded access, and rejects identity,
runtime, origin and bridge-boundary changes. OneWeb passes typecheck, full-repository lint and all 73
unit tests. This contract is the basis for Phase 2D-B1 candidate acquisition.

##### Phase 2D-B1 — Manual candidate acquisition and persistence — Complete

- Let the background `ModuleManager` trigger one manual update check for an installed user module;
  seeded modules and records without a pinned source URL are not remotely updateable.
- Always fetch from the installed record's `sourceUrl`. Reuse Phase 2C exact-origin permission,
  128 KiB, same-origin redirect, manifest validation, host compatibility and normalized-digest
  checks without accepting a caller-supplied URL.
- Classify the validated candidate through the Phase 2D-A pure model, then use a dedicated,
  serialized `ModuleRegistry` mutation to persist safe, approval-required or rejected metadata.
  Clear stale candidate metadata when acquisition fails.
- Keep the installed manifest, grants, enabled state, `installedAt` and `updatedAt` unchanged during
  checks, including concurrent checks.
- Bind `approved` to an `approvedManifestDigest` equal to the candidate digest. A candidate-content
  or digest change resets expanded-access approval to `pending` and clears that binding; legacy
  unbound approvals are also normalized to `pending`.
- Keep approval, application, UI, schedules, automatic upgrades and extra conformance modules out
  of this subphase.

**Phase 2D-B1 gate:** Tests cover normal, expanded-access and rejected candidates; failed and
cross-origin acquisition; digest changes and approval invalidation; serialized concurrent writes;
and preservation of installed state and lifecycle timestamps. Typecheck, lint and unit tests remain
green.

**Phase 2D-B1 status (2026-08-27): Complete.** The versioned background management boundary can
manually check an installed user module by ID, and only the Registry-resolved pinned `sourceUrl`
reaches the reused Phase 2C loader. The dedicated Registry mutation serializes candidate writes and
clears, validates update metadata, and uses an installation/update compare-and-swap boundary so an
older concurrent check cannot overwrite or clear newer state. Safe, expanded-access and rejected
candidates persist without changing installed manifests, grants, enabled state or lifecycle
timestamps. Expanded approvals require a matching `approvedManifestDigest`; changed or legacy
unbound candidates return to `pending`. OneWeb passes typecheck, full-repository lint and all 80
unit tests. This established the candidate boundary consumed by Phase 2D-B2.

##### Phase 2D-B2 — Approval and safe application — Complete

- Add explicit background approval only for `approval-required` candidates. Safe candidates need no
  approval, and rejected candidates can never become approved.
- Bind approval to the current normalized candidate digest and persist an authorization snapshot.
  Matches and activation are approved as part of the whole candidate; context-field and capability
  additions remain explicit user selections and never default to all candidate declarations.
- Before every application, re-fetch the installed record's pinned source URL and compare the
  normalized digest with both the persisted candidate digest and approved digest to prevent
  check-to-apply replacement. Re-run the Phase 2D-A classifier on the fetched candidate.
- Apply safe or validly approved updates through a serialized compare-and-swap registry mutation.
  Atomically replace the installed manifest, preserve `installedAt` and enabled state, update
  `updatedAt`, clear candidate metadata, remove grants no longer declared and add only explicitly
  approved context fields and capabilities.
- Reject stale, unapproved, rejected or inconsistent candidates without changing installed state.
  Concurrent checks, approvals, removal or reinstallation must prevent an older application from
  landing.
- Keep update UI, schedules, automatic upgrades and extra conformance modules out of this subphase.

**Phase 2D-B2 gate:** Tests cover safe application without approval, expanded-access approval and
fine-grained grants, rejected and stale candidates, application-time digest replacement, automatic
grant reduction, failure-state preservation and concurrent check/approval/application/removal.
Typecheck, full-repository lint and unit tests remain green.

**Phase 2D-B2 status (2026-08-27): Complete.** The background management boundary now exposes
explicit approval and application operations without adding update UI. Approval is available only
for expanded-access candidates, is bound to the normalized candidate digest, and persists
candidate-wide matches/activation plus only the user's selected field and capability additions.
Application always re-fetches the installed record's pinned source URL through the existing Phase
2C/B1 constraints, verifies stored and approved digests, compares normalized candidate content,
reclassifies, and commits through a full-record compare-and-swap mutation. Successful application
preserves installation identity and enabled state, updates `updatedAt`, removes undeclared grants,
adds only selected grants and clears update metadata; every failure leaves installed state intact.
Concurrent checks, reapproval, removal and reinstallation invalidate stale applications. OneWeb
passes typecheck, full-repository lint and all 92 unit tests. This established the application
boundary consumed by Phase 2D-B3.

##### Phase 2D-B3 — Update management UI — Complete

- Derive candidate copy, permission diffs, diagnostics, approval choices and enabled actions through a
  pure presentation/interaction model before rendering them.
- Let users manually check updateable remote modules through the existing versioned management
  client; never let the sidebar read Registry storage or accept a replacement source URL.
- Show candidate version, check time and text-only copy/access changes while clearly separating
  `safe`, `approval-required`, `approved`, `rejected` and locally stale states.
- Allow safe candidates to be applied without an approval control. Keep expanded-access approval and
  application as two explicit actions; matches, contexts and activation are candidate-wide, while
  only checked new context fields and capabilities enter the approval selection.
- Render rejected candidates as immutable-boundary diagnostics without approval or application.
- Refresh after checks, approvals, applications and concurrent-state failures. A check-to-apply
  replacement marks the stored candidate stale and disables it until another manual check.
- Treat all manifest copy and patterns as untrusted text. Keep schedules, automatic upgrades,
  notifications and extra conformance modules out of this subphase.

**Phase 2D-B3 gate:** Unit tests cover the pure state model, safe application, explicit expanded
approval with narrower grants, rejected diagnostics, loading, check/approval/application failures,
stale candidates, successful refresh and text-only rendering. Chromium E2E covers safe and expanded
updates, malicious immutable-boundary changes and application-time remote replacement alongside the
existing management and installation flows. Typecheck, full-repository lint and unit tests remain
green.

**Phase 2D-B3 status (2026-08-27): Complete.** The existing module cards now consume only
`ModuleManagementClient` update operations. The UI shows normalized candidate state and diffs,
defaults every newly requested field/capability to unselected, persists approval without applying,
and re-renders the atomically applied record only after the separate application succeeds. Remote
replacement or uncertain concurrent state cannot leave an actionable stale candidate, and every
manifest-controlled string is inserted through text nodes. OneWeb passes typecheck, full-repository
lint, production Chromium build and all 103 unit tests. All eight relevant Chromium management,
installation and update scenarios pass, including the four new B3 security cases. Phase 2D-B4 is the
next implementation target.

##### Phase 2D-B4 — Second conformance module and isolation — Complete

- Add a second independent, minimal installable conformance module through only a standard manifest
  URL, declared contexts/context fields/capabilities and the existing installation, check, approval
  and application protocol.
- Keep both conformance modules in test fixtures. Do not load fixture code into the extension
  execution environment or add module-ID, origin, runtime or business-logic branches to OneWeb.
- Serve the modules from different origins and verify that their exact-origin permissions,
  installed manifests, enabled state, grants, update candidates, approval snapshots, timestamps and
  removal state remain module-local.
- Cover concurrent and failing checks, approval, application, immutable-boundary rejection,
  application-time replacement and deletion. An operation on one module must not change or
  invalidate the other module.
- Verify that selected new context fields/capabilities enter only the approved module, and that an
  access reduction removes only that module's grants.

**Phase 2D-B4 gate:** Two conformance modules on different origins can be installed, checked,
reviewed and updated concurrently through the generic platform. Success, failure, rejection,
replacement and removal of either module leave the other module's record, grants, candidate,
approval and exact-origin permission unchanged. No production source recognizes either fixture.

**Phase 2D-B4 status (2026-08-28): Complete.** Reusable unit and Chromium fixtures now expose two
independent remote modules with separate origins and mutable manifests while keeping all fixture web
code outside the extension bundle. Registry/Installer/Manager tests exercise concurrent checks and
applications, safe and selected expanded grants, access reduction, rejection, acquisition failure,
application-time replacement and deletion races while snapshotting the uninvolved record. Chromium
installs both modules through their standard manifest URLs, applies a safe update to one and a
fine-grained approved update to the other, then verifies rejected-update and removal isolation plus
exact-origin permission release. No fixture identity or origin occurs in production source or the
production bundle. OneWeb passes typecheck, full-repository lint, production Chromium build, all 108
unit tests and all ten Chromium E2E scenarios.

**Phase 2 gate:** Complete. The generic platform now covers manifest contracts, registry lifecycle,
field-level context delivery, remote installation, digest-bound manual updates, explicit approval,
safe application, management UI and verified cross-module isolation without loading module code into
the extension execution environment.

### Phase 3 — Bookmark Doctor

**Status (2026-08-31): Phase 3A through Phase 3D, Phase 4A through Phase 4D-D, Phase 5A through
Phase 5C, Phase 6A through Phase 6E-C, Phase 7A and Phase 7B-A through Phase 7B-B are complete.
Phase 7B-C and Phase 7B-D are complete, closing the first packaged Page Toolbox runtime and its
dual-site/multi-tool isolation gate. Phase 7C-A through Phase 7C-D and the local portion of Phase 7D
are complete. Only separately authorized GitHub rename/archive administration remains outside this
checkpoint.**

Phase 3 is split so the data contract and optional permission boundary stabilize before a narrow
network proof of concept, destructive operations or a complete UI are introduced. Phase 3B is
deliberately not a reusable task platform: it answers only whether Bookmark Doctor can safely check
a batch of bookmark URLs in a real browser.

#### Phase 3A — Contract and read-only scan skeleton — Complete

- Define Bookmark Doctor as a packaged `builtin` manifest with no tab-context request. Its narrow
  `bookmarks.read` capability maps only to the browser's optional `bookmarks` permission.
- Define module-local storage namespacing, raw bookmark-tree input, normalized entries, stable entry
  IDs, URL eligibility, scan states, results and typed local errors as pure data contracts.
- Extract only the useful tree-flattening and URL-filtering rules from the old options prototype.
  Keep browser access behind a narrow reader interface and keep normalization free of browser
  globals.
- Seed a minimal disabled builtin record through generic Registry behavior. Missing optional
  permission or a disabled record must fail safely before reading the bookmark tree.
- Keep bookmark titles, URLs and results local to Bookmark Doctor. They must never enter RepoLens,
  a user-installed remote frame or the generic context bridge.
- Do not request URLs, determine link health, schedule work, mutate bookmarks, migrate ignore data,
  send notifications or add the complete Bookmark Doctor UI.

**Phase 3A gate:** Manifest and data-contract validation, empty/malformed/duplicate tree
normalization, URL classification, stable IDs, disabled and missing-permission behavior, namespaced
local state and builtin-versus-remote isolation are covered by tests. Existing module-platform gates
remain green.

**Phase 3A status (2026-08-28): Complete.** Bookmark Doctor is a disabled, ungranted packaged
`builtin` seed with no matches or context fields. `bookmarks.read` is reserved from remote manifests
and maps only to the browser manifest's optional `bookmarks` permission. Pure contracts and
normalization flatten bookmark trees, copy folder paths, classify HTTP(S), internal, local,
loopback, unsupported and malformed URLs, generate stable IDs, and report malformed, duplicate or
cyclic nodes without using browser globals. The narrow reader verifies builtin identity, enabled
state, module grant and optional permission before reading; all failures remain typed local data.
Generic module-state keys isolate results from RepoLens and two user modules. No network request,
task queue, whitelist migration, bookmark mutation, notification or Bookmark Doctor UI was added.
OneWeb passes typecheck, full-repository lint, production Chromium build, all 120 unit tests and the
two directly related Chromium regression scenarios.

#### Phase 3B — Manual batch-scan MVP — Complete

- Let the user manually prepare and start one scan of normalized `http` and `https` bookmarks.
  Request the optional `bookmarks` permission and only the exact origins present in that prepared
  batch; do not grant `<all_urls>` at runtime or expose a generic network capability.
- Use four workers, an eight-second per-link timeout, one request per URL and no retry policy.
  Classify results only as reachable, HTTP error, timeout or network failure.
- Keep the prepared batch, active run, progress and results in background memory. A side-panel or
  service-worker restart may discard them. Never write scan results or task state to extension
  storage.
- Support stop/cancel only. Do not add pause, resume, checkpoints or a reusable scheduler. A stale
  run must not publish into a later run.
- Stop active requests and queued work immediately when Bookmark Doctor is disabled or the optional
  `bookmarks` permission is removed. Synchronize the builtin capability grant through a generic,
  serialized Registry mutation; keep lifecycle dispatch keyed by packaged builtin entry rather than
  a module-ID branch in Registry.
- Add only a compact management-card surface for preparation, exact-origin approval, progress,
  stop and text-only results. Bookmark titles and URLs remain untrusted text and never enter the
  context bridge.

**Phase 3B MVP gate:** Pure tests cover all four outcomes, strict concurrency of four, the fixed
timeout, cancellation, lifecycle revocation, stale-run suppression and HTTP(S)-only probing. A real
Chromium scenario reads actual browser bookmarks, scans controlled local endpoints, stops a slow
batch and proves RepoLens plus both remote conformance records remain byte-for-byte unchanged.

**Phase 3B status (2026-08-28): Complete.** Bookmark Doctor now has a dedicated background
protocol, exact-origin two-step preparation, a four-worker in-memory coordinator and an
eight-second credential-free GET probe. The management card exposes only authorize, prepare,
start, progress, stop and a four-class text result list. No scan result or task checkpoint is written
to storage. Disabling the builtin or removing `bookmarks` aborts active work and invalidates the
prepared batch; a generic serialized capability mutation changes only the builtin record. OneWeb
passes typecheck, full-repository lint, all 136 unit tests, production Chromium build and all 11
Chromium E2E scenarios. The browser PoC reads real bookmarks, observes all four outcomes, stops an
eight-link slow batch, confirms a maximum of four simultaneous requests and snapshots RepoLens plus
both remote conformance modules unchanged.

#### Phase 3C — Safe repair operations — Complete

- Add `bookmarks.write` as a packaged-builtin-only capability. It maps to the same optional browser
  `bookmarks` permission as reading, but the Registry grant remains separate from `bookmarks.read`;
  a read grant must never imply mutation authority and remote-frame manifests cannot declare either
  bookmark capability.
- Put every repair behind a two-step background protocol. A request first re-reads the target and
  returns a short-lived, in-memory repair plan containing a random token, operation, old snapshot,
  proposed value, impact and expiry. A later explicit confirmation executes only that exact plan.
- Re-read the target immediately before mutation and compare bookmark ID, title, URL, parent and
  index. Reject expired, replaced or concurrently changed plans without applying any partial
  mutation. Disabling Bookmark Doctor or removing the optional permission invalidates every plan.
- Keep the browser boundary narrow: update accepts only title and/or URL; move accepts only a
  destination parent and optional index; delete applies only to an individual URL bookmark and uses
  a stronger destructive confirmation. Do not expose a generic bookmarks API.
- Treat ignore as module-local state rather than a browser mutation. Store ignored bookmark keys and
  minimal pre-delete recovery records only under Bookmark Doctor's namespaced local-storage key.
  Omit ignored IDs from later manual scan preparations. Persist the backup before delete and retain
  it whether the browser mutation succeeds or fails.
- Execute a confirmed batch item-by-item and return typed per-item success/failure results. A failed
  item must not roll back or mutate another item, and every path must preserve RepoLens plus all
  remote-module records, grants, update candidates, approvals and timestamps.
- Add only the minimum review controls needed to demonstrate update, move, ignore and delete.
  Display old/new values as untrusted text and keep full diagnostics, history, restore workflows and
  the complete product surface in Phase 3D.

**Phase 3C gate:** Pure plan validation covers field allowlists, confirmation strength, expiry and
snapshot equality. Controller tests cover write authorization, update/move/ignore/delete, stale
targets, backup-before-delete, partial batch failure, lifecycle invalidation and module isolation. A
real Chromium scenario reviews and confirms each operation, rejects a stale/destructive attempt and
proves RepoLens plus both remote conformance modules remain unchanged. Typecheck, full lint, complete
unit tests, production Chromium build and the relevant Chromium E2E suite must pass.

**Phase 3C status (2026-08-28): Complete.** Bookmark Doctor now declares separately granted
`bookmarks.read` and `bookmarks.write` capabilities while the remote-frame validator reserves both
for packaged builtins. Its versioned background protocol prepares two-minute, single-use plans from
fresh browser snapshots and confirms batches item-by-item. Update and move use field-specific narrow
APIs; ignore is namespaced local state and is omitted from later manual preparations; delete requires
an extra destructive checkbox and persists a bounded recovery record before removal. Expiry,
replacement, concurrent field changes, disable and permission removal reject stale plans. The final
gate passes typecheck, full lint, all 152 unit tests, production Chromium build, all 12 Chromium E2E
scenarios and `git diff --check`. Phase 3D is next; no restore workflow, full diagnostic UI,
automation, notifications or remote data exposure was added.

#### Phase 3D — Product UI and complete isolation gate — Complete

- Replace the raw bookmark-ID repair form with a result-driven workspace inside the existing
  Bookmark Doctor management surface. Keep the scanner contract unchanged: manual runs, in-memory
  results, four workers, eight-second timeout, four outcome classes and stop-only cancellation.
- Present scan summary, reachable/problem filters, progress and empty/error states as a pure view
  model. Each visible result may start only its own reviewed update, move, ignore or delete flow;
  untrusted titles, URLs, folder labels and diagnostics remain text-only.
- Expose namespaced local diagnostics for ignored bookmarks and deletion backups. Let the user
  remove an ignore entry, prepare a reviewed restore into the original parent and explicitly clear
  Bookmark Doctor local data. Restore uses a new narrow `create` boundary, checks the backup and
  destination again, rejects conflicts and removes only the successfully restored backup.
- Complete permission lifecycle controls. A deliberate revoke action stops active work, invalidates
  preparations and repair/restore plans, removes both Registry grants and removes the optional
  `bookmarks` permission. Track exact scan-origin permissions acquired by the current preparation
  and release only owned origins that are not required by an installed remote module; never revoke
  a pre-existing or shared module origin.
- Keep scan task state and results non-persistent. Persist only ignored IDs and bounded deletion
  backups in Bookmark Doctor's module-state namespace. Local cleanup must not touch Registry records,
  browser bookmarks, RepoLens state or another module's namespace.
- Keep the product surface in the existing trusted extension page. Do not route bookmark content
  through a remote frame, add a generic bookmarks/network capability or load test/module code into
  the extension execution environment.

**Phase 3D gate:** Pure presentation tests cover filters, diagnostics, repair drafts and untrusted
text. Controller tests cover restore review/conflict/staleness, unignore, cleanup, revoke, owned-origin
release and shared-origin retention. Chromium E2E covers onboarding, scan filters, result-driven
repairs, destructive confirmation, restore, ignored/local-data management, stop/revoke/disable and
re-enable, while full RepoLens and two-remote-module records, permissions, grants, updates,
timestamps and namespaced state remain unchanged. Typecheck, full lint, complete unit tests,
production Chromium build, full Chromium E2E and `git diff --check` must pass.

**Phase 3D status (2026-08-28): Complete.** The trusted management page now defaults to problem
results, supports reachable/all filters and starts every repair from the selected in-memory scan
row. Ignored entries and bounded deletion backups have text-only diagnostics, unignore, reviewed
restore and explicitly confirmed local cleanup. Central revocation stops work, invalidates plans,
clears both grants, verifies removal of the optional bookmark permission and conservatively retains
pre-existing or remote-module-shared origins. The final local safety review also fixed false-success
handling for browser-permission and Registry-grant revocation failures. Typecheck, full lint, all 164
unit tests, production Chromium build, all 12 Chromium E2E scenarios and `git diff --check` pass.

This phase does not add persistent scan tasks, pause/resume, retries, scheduling, automatic repair,
notifications, sync, a module marketplace or new business modules.

**Phase 3 gate — Complete (2026-08-28):** Disabling Bookmark Doctor prevents bookmark access;
revocation and module-local cleanup leave RepoLens and user-installed modules unaffected. Phase 4A
has since completed without reopening the Bookmark Doctor scope.

### Phase 4 — Clash Control

#### Phase 4A — Local connection PoC and architecture decision — Complete (2026-08-28)

- Build one independent Clash-compatible localhost fixture and a deliberately narrow manual
  connection flow. The user enters one controller origin, reviews the normalized loopback exact
  origin, grants that origin and performs one authenticated read of version and runtime mode.
- Compare a local `remote-frame` experiment with a packaged `builtin` connector using working code,
  not only a paper design. Record the result in an ADR before this subphase is complete.
- Classify invalid address, missing exact-origin permission, network failure, authentication failure
  and incompatible protocol without echoing controller responses or credentials.
- Keep the controller secret transient and dedicated to the trusted connection path. It must never
  enter a URL, rendered DOM, generic context bridge, remote frame, log, generic module-state key or
  another module namespace.
- On failure, explicit disconnect, disable or permission removal, cancel in-flight work, discard the
  secret and reclaim only an origin acquired by this connector and not shared by a user-installed
  remote module.

**Phase 4A gate:** URL/loopback normalization, exact-origin ownership, fixed endpoint requests,
credential non-disclosure, typed diagnostics, lifecycle cancellation and cross-module isolation pass
unit tests and a real Chromium PoC. Typecheck, full lint, complete unit tests, production Chromium
build, relevant Chromium E2E and `git diff --check` pass. The ADR selects the Phase 4B architecture.

**Result:** OneWeb now has a disabled packaged builtin seed and a dedicated trusted-background
protocol for manual prepare, authenticated read, status and disconnect. Only pure loopback origins
are accepted; `/version` and `/configs` are the only reachable paths, redirects are disabled,
responses are stream-capped at 64 KiB and the request is cancelled after five seconds. The real
Chromium fixture proves the secret stays out of DOM, URLs, logs, storage, generic module state and
remote frames. The same run preserves RepoLens, Bookmark Doctor and both user-installed remote
module records, grants, pending candidates, timestamps and namespaced state. The remote-frame
experiment confirms that the sandbox has neither extension runtime nor storage and would require
putting the controller credential in untrusted remote code; ADR-0001 therefore selects the packaged
`builtin` connector. Typecheck, full lint, all 199 unit tests, production Chromium build, all 13
Chromium E2E scenarios and `git diff --check` pass.

This subphase does not add proxy switching, rule or configuration writes, reconnect, polling,
notifications, multiple profiles, a complete product UI, remote controllers, a generic vault,
marketplace behavior, synchronization, arbitrary URL requests or a generic network capability.

#### Phase 4B — Connection contract and security boundary — Complete (2026-08-28)

- Replace the PoC's nullable status with a pure, generation-aware state model covering
  `disconnected`, `preparing`, `connecting`, `connected` and `error`. Every preparation token is
  short-lived and bound to the normalized profile origin plus the generation that created it;
  replacement, expiry, disconnect, disable, permission removal and worker lifecycle changes make
  the old binding unusable.
- Persist only a versioned controller profile containing the normalized exact loopback origin.
  Migrate legacy unversioned origin shapes through the same loopback normalizer. Never persist the
  secret, connection status, preparation token, generation or response data.
- Stabilize a dedicated versioned background protocol and diagnostic vocabulary. The trusted
  background remains limited to authenticated `GET /version` and `GET /configs`; callers cannot
  supply an endpoint, request options or arbitrary URL.
- Define MV3 restart semantics explicitly: a new worker may restore the normalized profile for
  display, but starts disconnected, clears any stale `clash.status.read` grant, has no secret or
  preparation, and never reconnects automatically.
- Make disconnect, disable, relevant permission removal, authentication/protocol failure and
  worker startup invalidate the lifecycle before asynchronous cleanup. Cleanup affects only Clash
  Control's dedicated grant and connector-owned, unshared exact-origin permission; another module's
  Registry record or namespaced state is never a rollback target.
- Introduce a narrow exact-origin usage coordinator for packaged builtins. Bookmark Doctor must not
  release an origin used by a preparing, connecting or connected Clash session, and Clash Control
  must not release an origin used by Bookmark Doctor. Existing conservative retention for origins
  referenced by installed remote modules remains unchanged. Generic Registry code contains no
  Clash ID, origin or runtime branch.

**Phase 4B gate:** Pure tests cover profile normalization and migration, state transitions,
generation/token replacement and restart recovery. Controller tests cover concurrent lifecycle
operations, exact permission ownership, authentication/protocol cleanup, permission races and full
isolation from RepoLens, Bookmark Doctor and two remote modules. Chromium regression covers worker
restart, secret non-disclosure and bidirectional origin retention. Typecheck, full lint, complete
unit tests, production Chromium build, full Chromium E2E and `git diff --check` must pass.

**Result:** Clash Control now persists only `oneweb.clash-control.profile.v1`, whose value contains
the profile version and normalized loopback controller origin. The pure five-state model binds each
preparation to its origin, expiry and monotonic in-worker generation; the protocol is version 2 and
connect messages repeat the full binding. Worker startup restores only that profile, eagerly clears
the stale dedicated grant, exposes `disconnected` and never issues a controller request. Secret,
preparation, generation, status and diagnostics remain absent from storage and generic module state.

A narrow packaged-builtin origin coordinator now makes release checks bidirectional while retaining
the existing installed-remote-module veto. Concurrent preparation, connect/disconnect/disable,
permission removal, authentication/protocol failure and cleanup-failure tests prove that an older
generation cannot publish a grant or status. The Chromium fixture is self-contained and generates
an exact RepoLens `frame-ancestors` policy for each ephemeral test extension ID; no production origin
check is weakened. The final gate passes typecheck, full-repository lint, all 221 unit tests,
production Chromium build, all 13 Chromium E2E scenarios and `git diff --check`.

This subphase does not add proxy switching, rule/configuration writes, reconnect, polling,
notifications, multiple profiles, a complete product UI, remote controllers, a generic vault,
marketplace behavior, synchronization, arbitrary URL requests or Phase 4C reads.

#### Phase 4C — Minimal read-only product capability — Complete (2026-08-28)

- Add one explicit manual refresh after a valid 4B connection. The caller cannot provide a path,
  URL, method or request options: the trusted connector reads only `GET /version`, `GET /configs`
  and `GET /proxies`, with the existing exact-loopback permission, redirect, timeout and bounded
  response rules.
- Define versioned pure parsers and projections for the current runtime mode, proxy groups, each
  group's selected node and minimal node status. Treat every controller field as untrusted; reject
  oversized, malformed or incompatible response shapes with stable diagnostics and never expose a
  raw controller object to the UI.
- Keep the normalized snapshot in worker memory only and bind it to the active origin and lifecycle
  generation. Manual refresh may replace only the snapshot for that same live generation. A stale
  response cannot publish after another refresh, disconnect, disable, permission removal, worker
  restart, authentication/protocol failure or any lifecycle cancellation.
- Extend the dedicated versioned protocol and narrow client with status/refresh results only. The
  trusted management surface renders values through text nodes and distinguishes loading, empty,
  stale and diagnostic states. It performs no automatic refresh, polling or reconnect.
- Preserve 4B secret handling and origin coordination. Snapshot data, secret material and raw
  controller responses remain absent from storage, generic module state, context messages, remote
  frames, logs, URLs and every other module namespace.

**Phase 4C gate:** Pure tests cover the endpoint allowlist, response caps, normalization, malformed
and incompatible payloads and text-only projections. Controller tests cover manual refresh races,
generation binding, lifecycle invalidation, authentication/network/protocol failure, restart and
shared-origin/cross-module isolation. Chromium connects to the localhost fixture, displays mode and
proxy-group selections, refreshes manually, then proves disconnect, permission removal and worker
restart clear the snapshot without automatic requests or changes to RepoLens, Bookmark Doctor or
the two remote conformance modules. Typecheck, full lint, complete unit tests, production Chromium
build, full Chromium E2E and `git diff --check` must pass.

**Result:** The dedicated protocol is now version 3 and exposes one payload-free manual refresh.
The controller keeps the session secret and normalized snapshot only in worker memory, reads exactly
`/version`, `/configs` and `/proxies`, and projects mode, sorted proxy groups, selected nodes and
minimal node type/alive state through a strict version-1 snapshot parser. Unknown fields are dropped;
malformed, reflected-secret and oversized payloads receive stable diagnostics. A newer refresh is
the only one allowed to publish for a live generation. Network failure keeps an explicitly stale
in-memory snapshot, while authentication, protocol, permission and lifecycle failure clear the
snapshot, credential and dedicated grant.

The trusted management card renders every controller value through text nodes and provides explicit
empty, loading, ready, stale and diagnostic states with manual refresh only. The Chromium fixture
changes mode and selected node between refreshes, injects markup-like group text, then verifies
disconnect, exact-origin revocation and a real worker restart discard the snapshot without an
automatic request. RepoLens, Bookmark Doctor and two installed remote modules retain their records,
grants, update candidates, timestamps and namespaced state. The final gate passes typecheck,
full-repository lint, all 242 unit tests, production Chromium build, all 13 Chromium E2E scenarios
and `git diff --check`.

This subphase does not add mode or node switching, rule/config/provider writes, delay tests,
arbitrary paths or URL probes, automatic refresh/reconnect, polling, notification, multiple
profiles, remote controllers, generic networking, marketplace behavior, synchronization or the
Phase 4D operation surface.

#### Phase 4D — Reviewed operations and complete isolation gate

Phase 4D is split so the first write boundary is proven independently from its product UI and final
concurrency/isolation gate. Only one 4D subphase may be active at a time.

##### Phase 4D-A — Node-switch contract and safe execution skeleton — Complete (2026-08-28)

- Support exactly one mutation: selecting an existing node for an existing proxy group. Do not add
  mode changes, rule/config/provider writes, delay probes, automatic selection or a caller-defined
  URL, path, method, header or JSON body.
- Create a short-lived, random, single-use memory plan from the current `ready` normalized snapshot.
  Bind it to the exact loopback controller origin, connection generation, complete normalized
  snapshot identity, group, original selection, target node and expiry. The group and target must be
  exact members of that snapshot; confirming sends only the opaque token.
- Before writing, consume the plan, re-check lifecycle and exact-origin permission, fetch the fixed
  authenticated `GET /proxies` endpoint, normalize it through the same untrusted-data boundary and
  compare the group, original selection and target membership. Expiry, reuse, plan replacement,
  concurrent confirmation, remote replacement or lifecycle change rejects the operation.
- Generate the only write path inside the trusted controller as
  `PUT /proxies/${encodeURIComponent(groupName)}`. Generate the body inside that boundary as exactly
  `{ "name": targetNode }`; never accept a caller body or pass through controller JSON.
- Consume every confirmation plan on success or failure. Successful or ambiguous execution clears
  the old read snapshot. Disconnect, disable, permission removal, authentication/protocol failure
  and worker startup clear plans, abort work and preserve the 4B/4C secret and isolation rules.
- Expose only a versioned background protocol and narrow client methods. A hidden test entry may use
  that protocol, but the selector, review copy, confirmation dialog and product action states remain
  Phase 4D-B work.

**Phase 4D-A threat model:** the localhost process and every response field are untrusted; a remote
frame or compromised web module may try to forge group names, paths, bodies or tokens; lifecycle
events and concurrent trusted-page requests may race; and a write response may be lost after the
controller acted. Controls are an unguessable worker-memory token, server-side plan binding, strict
snapshot membership, a fixed preflight read, internal path/body construction, one active mutation,
generation checks and abort-before-cleanup. A network failure never claims success and leaves no
plan or authoritative snapshot, so recovery requires a new manual read and review rather than an
automatic retry.

**Phase 4D-A gate:** Pure tests cover plan construction, full snapshot binding, membership, path
encoding, exact body construction, expiry and stale comparison. Controller/protocol tests cover a
legal switch, snapshot-external values, token reuse/replacement, preflight remote change, concurrent
plans/confirms, disconnect/disable/permission/restart invalidation, authentication/protocol/network
failure, response limits, secret non-disclosure and cross-module isolation. Real Chromium invokes
the trusted background protocol against the localhost fixture and verifies the encoded single-group
write, snapshot invalidation and lack of automatic follow-up. Typecheck, full lint, complete unit,
production build, full Chromium E2E and `git diff --check` must pass.

**Phase 4D-A status (2026-08-28): Complete.** The dedicated protocol is now version 4 and accepts
only bounded group/target selectors for review plus a token-only confirmation. The worker-memory
plan binds the complete normalized snapshot and every lifecycle/security field; confirmation
consumes it before a fixed `/proxies` preflight and internally generated encoded `PUT`. Unit coverage
includes successful, stale, expired, replayed, concurrent, lifecycle-cancelled and outcome-unknown
operations, secret-surface checks and RepoLens/Bookmark Doctor/two-remote-module isolation. The
localhost Chromium fixture verifies the exact path/body, snapshot invalidation, manual-only refresh
and worker-restart rejection. Typecheck, full-repository lint, all 267 unit tests, production
Chromium build, all 13 Chromium E2E scenarios and `git diff --check` pass. Phase 4D-B is next.

##### Phase 4D-B — Review and confirmation UI — Complete (2026-08-29)

- Add a selector only for alternate nodes present in a current `ready` normalized snapshot. Stale,
  empty or missing snapshots remain read-only and cannot start a review.
- Keep review and execution separate. The first action calls the existing v4 preparation protocol;
  the review renders the controller origin, group, current node, target node and expiry, but never
  the token, secret, path, request body or generic request options. A second explicit action sends
  only the plan token to the existing confirmation protocol.
- Derive selectable groups and review validity through a pure presentation model. Expired, locally
  stale or lifecycle-invalid plans must be visibly rejected before confirmation; the background
  remains authoritative and revalidates every plan.
- Treat group/node/type values as untrusted text. Use text nodes and native form controls only; no
  controller string may become HTML, a selector fragment, script, URL or request construction input.
- On success, clear the local review and read snapshot, report the old/new selection and require a
  separate manual refresh. Do not automatically refresh, retry or claim success after a failed or
  ambiguous confirmation. Disconnect, disable, permission removal and worker restart clear the UI
  review through the existing lifecycle/status path.

**Phase 4D-B gate:** Pure tests cover selectable alternatives, snapshot binding, expiry and stale
review states. UI tests cover the separate review/confirmation actions, token-only confirmation,
safe untrusted-text rendering, local expiry, failure recovery, success snapshot invalidation and
disable/disconnect cleanup. Chromium performs the complete visible selector → review → confirmation
flow, proves there is exactly one encoded write and no automatic follow-up, then manually refreshes
to observe the new selection. Typecheck, full lint, complete unit, production build, full Chromium
E2E and `git diff --check` must pass. Phase 4D-C remains pending.

**Phase 4D-B status (2026-08-29): Complete.** A pure presentation model derives alternate nodes and
rejects expired or locally stale reviews. The trusted management page now separates selection,
review and token-only confirmation, renders every controller value as text, and keeps token/secret
material out of the DOM. Successful confirmation clears the old snapshot and requires an explicit
manual refresh; expiry, ambiguous network outcomes, cancellation, disable and worker restart do not
retry or retain a usable UI review. The Chromium scenario performs the visible flow, proves review
causes no write, observes exactly one encoded write after confirmation, and verifies no automatic
follow-up. Typecheck, full-repository lint, all 280 unit tests, production Chromium build, all 13
Chromium E2E scenarios and `git diff --check` pass. Phase 4D-C is next.

##### Phase 4D-C — Concurrency and lifecycle hardening — Complete

- Add an explicit UI operation generation/fence so a late prepare, confirm or status response cannot
  republish a review, success message or snapshot after a newer refresh, disconnect, disable,
  permission removal or page lifecycle refresh.
- Keep confirmation single-flight in both UI and background. Repeated clicks, a competing refresh or
  a replacement review must not produce a second write or restore consumed authority.
- Exercise the existing application-time preflight against a controller selection replacement. A
  changed current node or target membership rejects the review with no write and requires a fresh
  manual snapshot.
- Treat a write whose response is lost after the controller applies it as outcome-unknown. The UI
  must not claim success or retry; it clears local authority/snapshot and only an explicit later
  refresh may reveal the controller's actual state.
- Abort a blocked preflight/write on disconnect, disable, exact-origin permission removal or worker
  restart. Late asynchronous completion must not alter UI state, restore the dedicated grant or issue
  a write after cancellation.
- Preserve the protocol v4, one mutation type, exact origin, fixed endpoints/body, memory-only
  secret/plan and manual-only recovery boundaries. The complete RepoLens/Bookmark Doctor/two-remote
  isolation matrix remains Phase 4D-D.

**Phase 4D-C gate:** Unit tests cover the UI generation fence, late response suppression,
single-flight confirmation, lifecycle supersession and outcome-unknown presentation. A controllable
localhost fixture supports preflight blocking, remote selection replacement and apply-then-no-response
writes. Chromium verifies stale preflight rejection, ambiguous manual recovery and permission
revocation during active confirmation with no late write or automatic request. Typecheck, full lint,
complete unit, production build, full Chromium E2E and `git diff --check` must pass. Phase 4D-D
remains pending.

**Phase 4D-C status (2026-08-29): Complete.** Every asynchronous Clash management action now uses
an operation-generation fence, so late prepare, confirm and status results cannot revive an expired
review or overwrite a newer disconnect/disable state. The background consumes switch authority
once, repeats the fixed `/proxies` preflight and accepts only the Clash-standard `204 No Content` as
a definitive write acknowledgement; any other or absent post-write result is outcome-unknown and
requires a manual refresh. The controllable Chromium fixture verifies selection replacement with no
write, apply-then-no-response recovery, and exact-origin revocation while a preflight is blocked.
Typecheck, full-repository lint, all 285 unit tests, production Chromium build, all 14 Chromium E2E
scenarios and `git diff --check` pass. Phase 4D-D is next.

##### Phase 4D-D — Complete isolation gate — Complete

- Snapshot complete records for RepoLens, Bookmark Doctor and two installed remote modules,
  including manifest, enabled state, grants, lifecycle timestamps, update candidate and approval.
  Seed each applicable module-local namespace and preserve the two remote exact-origin permissions.
- Exercise the trusted Clash UI through connect, refresh, reviewed switch, stale/ambiguous failure,
  manual recovery, disconnect or exact-origin revocation. Clash operations may change only the Clash
  record, memory session and its explicitly authorized controller origin.
- Verify Bookmark Doctor permission, scan/repair workspace state and active lifecycle remain local;
  Clash must neither read nor invalidate them. RepoLens and both remote modules keep their records,
  candidate approvals, iframe authority, namespaced state and origin permissions byte-for-byte.
- Recheck every secret surface: URL/resource entries, DOM, logs, local/session storage, extension
  storage, generic context bridge, remote frames and module state. Controller payloads remain safe
  text and cannot create executable DOM.
- Include failure and lifecycle races in the final matrix: an unapproved origin, authentication or
  protocol failure, stale preflight, outcome-unknown write, permission removal, disable and worker
  restart cannot publish into another module or recover consumed authority.
- Add no new operation, permission, protocol method, polling, retry, profile, controller reach or
  generic capability. Phase 4D-D is verification and any narrowly required isolation fix only.

**Phase 4D-D gate:** Unit tests cover complete-record and namespaced-state snapshots across success,
failure and lifecycle cancellation. Chromium installs two origins, creates pending update authority,
keeps Bookmark Doctor local state active, performs the Clash operation/recovery sequence, audits all
secret surfaces and proves other records, state and permissions remain unchanged. Typecheck, full
lint, complete unit, production build, full Chromium E2E and `git diff --check` must pass before
Phase 4 can be marked complete.

**Phase 4D-D status (2026-08-29): Complete.** The final unit matrix preserves complete records,
digest-bound update approval, module-local state and two remote exact-origin permissions through
Clash success, authentication failure, stale preflight and disable-time cancellation. It uncovered
and fixed one generic consistency defect: after a lifecycle hook performs Registry cleanup,
`ModuleManager.setEnabled` now rereads and returns the final same-module record instead of its stale
pre-cleanup snapshot. No Clash ID or origin special case was added.

The Chromium matrix keeps RepoLens, an enabled and bookmark-authorized Bookmark Doctor, a safe
remote candidate, a separately approved expansion candidate, both remote origin permissions and
all namespaced state unchanged through reviewed switching, worker restart, authentication failure,
outcome-unknown manual recovery and exact-origin revocation during a blocked preflight. DOM, URL,
resource, console, extension/local/session storage and remote-frame audits contain no secret or
executable controller markup. Typecheck, full-repository lint, all 287 unit tests, production
Chromium build, all 14 Chromium E2E scenarios and `git diff --check` passed at Phase 4 closure.

**Phase 4 gate — Complete:** The connector cannot access unapproved origins or another module's
secrets, records, namespaced state, update authority or permissions.

### Phase 5 — Remaining candidates

Phase 5 begins with one evidence-based candidate decision, then advances only one accepted candidate
at a time. Candidate work must not be parallelized because each option changes a distinct privileged
browser boundary.

#### Candidate evaluation matrix

| Candidate        | User value                                                       | Existing permission reuse                                                             | Sensitive data                                                       | Write/destructive risk                                                                                | Platform coupling                                                             | Smallest credible PoC                                                            | Decision                                                                  |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Browser Journal  | High for intentional session recall without permanent collection | Existing `tabs` and trusted worker runtime; no new permission in 5A                   | Active tab titles and URLs after explicit start                      | Read-only; privacy risk is bounded by manual lifecycle, incognito exclusion and memory-only retention | Low: narrow `tabs` event source behind a packaged builtin                     | Manual start/stop, active-tab activation/navigation, bounded in-memory list      | **Go for 5A only**                                                        |
| Header Rules     | Useful for advanced per-site troubleshooting                     | Existing prototype state only; execution needs new declarative request-rule authority | Request destinations and user-authored header values                 | High: changes network behavior and can expose credentials or break sites                              | Medium/high: browser rule syntax, quotas and permission review                | Validated rule compiler plus review/apply/revoke lifecycle                       | **No-go for now**; needs a dedicated declarative-rule threat model        |
| Socket Inspector | Strong specialist developer value, low general-user value        | No safe reuse; likely DevTools, `webRequest` or `debugger` boundaries                 | Full request metadata and WebSocket payloads                         | Primarily read-only, but observation is exceptionally sensitive                                       | Very high: DevTools surfaces, target attachment and browser-specific behavior | Separate DevTools build, explicit attachment and bounded frame capture           | **No-go in OneWeb for now**; assess as an independent developer extension |
| Privacy Cleaner  | Clear privacy value                                              | Requires optional `browsingData` and category/time-range authority                    | Browsing history, cookies, cache, passwords and site data categories | Very high and irreversible deletion risk                                                              | Medium: browser-specific deletion categories and semantics                    | Category projection, preview, explicit final confirmation and failure accounting | **No-go for now**; defer to a dedicated destructive-operation phase       |

Repository evidence supports Browser Journal: the host already owns `tabs` events, while the old
`src/home/Home.vue` history/session prototype can be discarded instead of migrated. Header Rules has
only unexecuted `customHeader` state, Socket Inspector has only developer-surface prototypes, and the
legacy Privacy Cleaner action groups destructive categories too broadly. These findings do not
authorize the three rejected candidates.

#### Phase 5A — Candidate evaluation and Browser Journal manual-session PoC — Complete

- Add Browser Journal as a disabled packaged `builtin` through the generic seed/registry path. Do
  not add an ID or runtime branch to generic Registry, remote-frame or context-bridge code.
- Accept only an explicit user start and stop from the trusted management page. Register narrow
  active-tab activation/navigation listeners only while recording; do not inspect earlier browser
  history, recently closed tabs or background-tab activity.
- Normalize only HTTP(S) entries with a stable bounded data contract, exclude incognito windows,
  drop malformed events, collapse consecutive duplicates and retain at most 100 entries.
- Keep the authoritative session and entries only in trusted service-worker memory. A worker start,
  module disable or lifecycle cancellation begins stopped with an empty session and no listener.
  Normal stop detaches listeners while retaining the current ephemeral list for review.
- Render state, entry count and a minimal title/URL list only as text in the packaged management
  page. No event, URL, title or entry is accepted from the page.
- Keep Journal data out of storage, logs, generic context messages, remote frames and every other
  module namespace. RepoLens, Bookmark Doctor, Clash Control and two installed remote modules must
  remain unchanged throughout Journal success and lifecycle failure paths.

**Phase 5A gate:** Pure tests cover normalization, malformed/incognito exclusion, duplicate and
capacity limits. Controller/protocol tests cover manual start/stop, listener ownership, disable and
worker-start semantics without storage. Chromium proves start-after-only recording, stop, safe
worker restart and complete module isolation. Typecheck, full lint, complete unit, production build,
complete Chromium E2E and `git diff --check` must pass.

**Phase 5A status (2026-08-29): Complete.** The evidence matrix selects only Browser Journal and
keeps Header Rules, Socket Inspector and Privacy Cleaner at no-go. Browser Journal is a disabled
packaged seed with no contexts, capabilities or new permissions. Its versioned trusted-page
protocol accepts only start, stop and status; the worker-owned controller attaches a narrow active
tab event source while recording and keeps normalized HTTP(S) titles/URLs solely in memory. The pure
model excludes incognito, inactive, malformed, unsupported and credential-bearing entries, strips
fragments, bounds text, collapses consecutive equivalents and retains at most 100 entries.

Normal stop removes listeners while leaving the ephemeral result visible. Disable, tabs-permission
lifecycle invalidation and worker restart clear authority and entries. Unit and Chromium isolation
matrices preserve RepoLens, Bookmark Doctor, Clash Control, two installed remote records, module
namespaces and origin permissions, and confirm Journal content is absent from extension/local/session
storage and executable DOM. Typecheck, full-repository lint, all 304 unit tests, production Chromium
build, all 15 Chromium E2E scenarios and `git diff --check` pass. At that checkpoint, Phase 5B was
the next decision and had to justify durable single-candidate product work before adding authority.

#### Phase 5B — Explicit local save and finite retention — Complete

The 5A evidence supports the manual observation boundary but not continuous or automatic capture.
Its worker-memory loss also prevents an explicitly recorded session from having durable user value.
Phase 5B therefore authorizes only a user-invoked save of a completed in-memory session, under the
separate retention decision in [`ADR-0003`](adr/0003-browser-journal-explicit-retention.md).

- Save only the trusted worker's current stopped, non-empty normalized session. The management page
  supplies no entries, titles, URLs, tab IDs, retention duration or storage key.
- Project saved entries down to event kind, occurrence time, bounded title and canonical URL. Do not
  persist tab/window IDs, live listener state, recording authority or an active-session resume token.
- Use only Browser Journal's generic module-local namespace with schema version 1. Retain at most ten
  explicitly saved sessions and 100 entries per session; sessions become expired after seven days
  and are pruned on worker startup or any archive operation without introducing alarms.
- Keep start/stop manual. Never auto-save on stop, disable, browser shutdown or worker suspension.
  Worker restart remains stopped/empty while explicitly saved sessions can be read separately.
- Provide explicit deletion of one saved session and a separate confirmed clear-all action. Disable
  stops and clears the ephemeral session but retains explicitly saved data so it can still be viewed
  and deleted; the UI must disclose this distinction.
- Serialize archive mutations and fail closed on malformed/legacy state or storage errors. A failed,
  stale or concurrent save/delete/clear must not alter current recording authority, Registry data,
  another namespace or another module's permission.
- Render saved content only as text. Saved Journal data remains unavailable to RepoLens, Bookmark
  Doctor, Clash Control, remote frames, the generic context bridge, logs, URLs, local/session storage,
  export, synchronization or notifications.

**Phase 5B gate:** Pure tests cover schema normalization, projection, expiry, ten-session/100-entry
limits and malformed state. Controller/protocol/UI tests cover explicit save, duplicate/stale save,
individual delete, confirmed clear, disabled access, storage failure and serialized mutation. Real
Chromium proves no auto-save, explicit save surviving worker restart, deletion, hostile-text safety
and complete cross-module isolation. Typecheck, full lint, complete unit, production build, complete
Chromium E2E and `git diff --check` must pass.

History import, `history`/`sessions` permissions, recording persistence/resume, automatic retention
jobs, search, export, summaries, synchronization and the other three candidates remain outside 5B.

**Phase 5B status (2026-08-29): Complete.** Browser Journal protocol version 2 adds archive read,
input-free save, bounded identifier-only delete and literal-confirmed clear operations. The trusted
background projects its own stopped snapshot into schema-v1 module-local state, removes live
session/tab/window authority, prunes malformed and seven-day-expired records, and serializes every
mutation. Saving never happens automatically; worker restart remains stopped and empty while the
separate archive survives, and disabling preserves only deliberately saved records for review or
deletion.

Pure, controller, protocol, UI and isolation tests cover projection, malformed-state cleanup,
limits, expiry, duplicate/stale operations, storage failure and disable-during-save cancellation.
Real Chromium proves explicit-only persistence, hostile-text rendering, worker-restart survival,
single deletion, confirmed clear and unchanged RepoLens, Bookmark Doctor, Clash Control and two
remote modules. Typecheck, full-repository lint, all 316 unit tests, production Chromium build, all
16 Chromium E2E scenarios and `git diff --check` pass.

#### Phase 5C — Local archive review and product decision — Complete

Phase 5C accepts a narrow local-review decision in
[`ADR-0004`](adr/0004-browser-journal-local-archive-review.md). The bounded archive has enough value
to justify a readable index and one-session detail surface, but not a new collection, query or data
movement capability.

- Keep Browser Journal protocol version 2, archive schema version 1, seven-day expiry, ten-session
  limit and explicit save/delete/clear operations unchanged. Phase 5C adds no background or storage
  mutation operation.
- Extract a pure presentation model that sorts saved sessions newest-first, preserves a valid local
  selection, falls back to the newest remaining session and derives entry count, recording range and
  exact expiry time without mutating archive data.
- Render a compact session index and only one selected detail at a time. The selected detail may show
  all of that session's already bounded 100 entries rather than silently truncating at ten.
- Keep selection only in packaged-page memory. Worker or page restart may default to the newest
  retained session; selection is not recording authority and must not enter storage or the protocol.
- Reconcile selection after archive refresh, save, individual delete, clear and expiry pruning. A
  removed or stale identifier must never revive deleted content or block access to remaining data.
- Continue to render every title, URL and timestamp as untrusted text. Disabled Browser Journal may
  review and delete the deliberate archive but still cannot attach tab listeners.

**Phase 5C gate:** Pure tests cover ordering, valid selection, stale-selection fallback, expiry
projection, immutability and hostile text. UI tests cover compact indexing, full selected-session
detail, selection changes, delete fallback, clear and disabled review. Chromium saves two distinct
sessions, verifies newest-default and explicit older selection, survives worker restart, deletes the
selected session, retains the other while disabled and preserves all other module records,
namespaces and permissions. Typecheck, full lint, complete unit, production build, complete Chromium
E2E and `git diff --check` must pass.

History import, broader tab observation, recording persistence/resume, automatic save or cleanup
jobs, search, export, summaries, synchronization and the other three rejected candidates remain
outside Phase 5C.

**Phase 5C status (2026-08-29): Complete.** A pure immutable presentation model orders the bounded
archive newest-first, derives exact expiry, keeps only a valid ephemeral selection and safely falls
back after deletion or pruning. The packaged management page now renders a compact ten-session
index and one selected session's complete bounded detail instead of expanding every archive and
silently truncating each to ten entries. Save selects the new session; page/worker restart defaults
to the newest; delete, clear and disabled review reconcile only against the authoritative archive.

No background protocol, schema, permission, listener or storage path changed. Pure and UI tests
cover ordering, expiry, immutability, hostile text, 12-entry complete detail, selection changes and
delete fallback. Real Chromium verifies two explicit sessions, restart, older-session selection,
deletion, disabled retention and unchanged RepoLens, Bookmark Doctor, Clash Control and two remote
modules. Typecheck, full-repository lint, all 321 unit tests, production Chromium build, all 16
Chromium E2E scenarios and `git diff --check` pass.

**Phase 5 gate — Complete:** Browser Journal now has a manual memory session, explicit bounded local
retention and a usable local-only review surface without becoming a history collector. Header Rules,
Socket Inspector and Privacy Cleaner remain no-go decisions.

### Phase 6 — Module developer experience

#### Phase 6A — SDK contract extraction and starter compatibility baseline — Complete

Phase 6A follows [`ADR-0005`](adr/0005-module-sdk-source-and-starter-lock.md) and extracts only the
stable public contract needed by an unprivileged `remote-frame` module.

- Create a private, unpublished `@oneweb/module-sdk` source package inside the OneWeb repository. Export
  manifest/protocol versions, remote-safe context/capability catalogs and field catalogs, public
  TypeScript types, remote manifest validation/definition and strict envelope helpers.
- Keep installed records, Registry/update state, builtin runtimes/capabilities, permission prompts,
  exact-origin ownership, authorization-code creation and frame lifecycle inside the host. They are
  not SDK APIs.
- Make the host manifest validator and bridge wrapper delegate their remote public shapes to the SDK
  without weakening origin/source, nonce, allowlist or field-level grant checks.
- Make both conformance fixtures build manifests and protocol envelopes from the SDK surface instead
  of repeating protocol/version literals.
- Add a versioned JSON compatibility lock generated from the SDK public catalog. Because Phase 6A
  does not publish a package, `repolens-starter` consumes an identical checked lock plus its own
  runtime descriptor and standard manifest generator; a cross-repository verifier must reject any
  drift before release.
- Expose RepoLens's `/.well-known/oneweb-module.json` from its configured public origin and validate
  the generated manifest against the SDK contract. Keep `/embed` sandboxed and browser-API-free.
- Preserve every Phase 0–5 security boundary. No SDK helper may accept an arbitrary browser method,
  URL request, capability name, host record or executable payload.

**Phase 6A gate:** SDK tests cover catalogs, manifest normalization/rejection, immutable canonical
constants and forged envelope fields. Existing host manifest/protocol/frame tests must pass through
the extracted implementation. Conformance tests prove two different manifests consume the same
surface. RepoLens tests prove the standard manifest route, descriptor/lock match, hostile manifest
input rejection and existing MessageChannel behavior; the cross-repo verifier compares the starter
lock to the canonical SDK lock. Typecheck, full lint, complete unit/build gates in both repositories,
full OneWeb Chromium E2E and `git diff --check` must pass.

Phase 6A does not publish an npm package, add a runtime handshake client, add typed RPC, create a
starter repository, add a CLI/marketplace/signature service or change direct-URL installation.

**Phase 6A status (2026-08-29): Complete.** The private source SDK now owns the public remote
manifest and envelope contract while all builtin, Registry, permission, exact-origin and lifecycle
authority remains in the host. Host and conformance code consume the source package. RepoLens keeps
an independent byte-identical contract lock, serves its generated standard manifest, derives its
bridge descriptor locally and provides an explicit cross-repository verifier that invokes the real
SDK validator. OneWeb passes typecheck, full lint, 324 unit tests, production Chromium build and all
16 Chromium E2E scenarios; RepoLens passes all 30 tests and the cross-repository compatibility gate.

#### Phase 6B — Runtime client and local package build — Complete

Phase 6B follows [`ADR-0006`](adr/0006-runtime-client-and-local-package-build.md). It adds only a
minimal remote-frame handshake/context client and reproducible local package artifact so modules no
longer hand-write `MODULE_HELLO`, `MODULE_INIT`, `MessagePort`, challenge/session nonce or
`CONTEXT_UPDATE` validation.

- Require explicit module ID and exact parent origin. Generate the challenge with Web Crypto and
  accept one exact-parent, exact-origin, protocol/version/module/challenge-matched init carrying
  exactly one port and a sufficiently long session nonce.
- Define `idle`, `hello-sent`, `connected` and terminal `destroyed` states. Start/destroy are
  idempotent; failure/destruction removes listeners, closes the port and clears all session and
  callback authority. Unknown, repeated, stale and post-destroy messages do not land.
- Reuse Phase 6A validators and canonical envelope construction. Do not add arbitrary messages,
  typed capability RPC, fetch, browser APIs, persistence, automatic reconnect or host ownership to
  the client.
- Produce deterministic ESM and `.d.ts` output from `packages/module-sdk` with an explicit export
  map and file allowlist. Two clean builds must have the same sorted files and content digests; no
  host, builtin, Registry/update/approval, permission, fixture or absolute-path content may ship.
- Run the real conformance iframe from the built runtime. RepoLens retains its independent local
  lock/descriptor and uses the explicit verifier against the built package rather than gaining a
  sibling production dependency.

**Phase 6B gate:** runtime tests cover valid context flow, every forged init dimension, short nonce,
repeat/concurrent start/init, unknown port messages, destroy races, port closure, instance isolation
and canonical envelopes. Package gates cover deterministic content, public imports and blocked
host/internal subpaths. Full OneWeb typecheck/lint/unit/build/Chromium plus RepoLens check and
cross-repository built-package compatibility must pass with both `git diff --check` gates.

Phase 6B does not add typed capability RPC, advanced context subscription APIs, arbitrary messages,
automatic reconnect, persistent sessions, npm publication, semver/release policy, CLI, marketplace,
signature service or new permissions.

**Phase 6B status (2026-08-29): Complete.** The SDK now owns a minimal exact-parent runtime with
memory-only challenge, nonce and port state; valid initialization automatically emits
`MODULE_READY`, and only validated `CONTEXT_UPDATE` data reaches the caller. Seven new unit scenarios
bring OneWeb to 331 tests. The independent build creates 12 deterministic ESM/declaration files and
an exact 14-file dry-run package allowlist; two clean digests match, JS/type consumers use only
public exports, private subpaths fail, and forbidden host/builtin content is absent. The real
Chromium conformance iframe loads this build and reloads without changing RepoLens, Bookmark Doctor,
Clash Control or Browser Journal state. All 16 E2E scenarios pass. RepoLens remains independently
runnable, passes 30 tests and validates its manifest/bridge against the built SDK.

#### Phase 6C — Portable SDK consumption and RepoLens runtime migration evaluation — Complete

Phase 6C follows [`ADR-0007`](adr/0007-portable-sdk-vendor-and-repolens-runtime.md). It evaluates one
independently cloneable consumption path and, only after its provenance boundary is executable,
migrates RepoLens away from its hand-written handshake.

- Vendor the complete reviewed 14-file unpublished package artifact in RepoLens. A versioned
  provenance lock records the exact relative file allowlist, every SHA-256 digest and an aggregate
  content digest. RepoLens's normal install, start, check and browser flows must need no OneWeb
  checkout and no `file:../one-webext` dependency.
- Add a RepoLens-local verifier which accepts no source path and rejects missing, additional or
  changed vendored files. Keep a separate explicit development sync/cross-repository verifier: it
  may take an absolute OneWeb checkout argument, but that path must never enter production code,
  package metadata, the artifact or its provenance lock.
- Serve only the fixed JavaScript dependency closure needed by the iframe runtime through exact
  same-origin routes. Do not expose a path join, directory server, source map, declaration, package
  metadata or arbitrary file endpoint.
- Extend the SDK client only with a narrow asynchronous connection hook for module-owned init
  fields. Canonical protocol, module, challenge, nonce and type fields are stripped before the hook;
  `MODULE_READY` is withheld until it resolves. Rejection, port failure, destruction or a late
  resolution closes the session without READY. Challenge, nonce and port remain private and there
  is no generic send/post API.
- Load the vendored ESM runtime from RepoLens's nonce-bearing module script, exchange the optional
  one-time authorization code in that connection hook and consume validated context updates through
  the runtime callback. Remove the duplicate challenge, init, port and context-envelope validator
  from the production embed while retaining independent-page behavior.

**Phase 6C gate:** SDK unit tests cover init-field projection, READY ordering, rejected async setup,
destroy/resolve races and unchanged forged-init/port isolation. RepoLens tests cover the exact
artifact allowlist/digests, independent local verification, cross-repository artifact identity,
fixed server routes, module CSP/import syntax, session-auth-before-READY and absence of the old
hand-written handshake. A real Chromium iframe must connect through the vendored runtime, load a
repository context, reject late/forged initialization and reconnect after reload without changing
OneWeb module or builtin state. Both repositories pass their complete Phase 6B gates plus
`git diff --check`.

Phase 6C does not add typed capability RPC, an arbitrary port-message API, advanced subscriptions,
npm publication, a registry, semver automation, CLI, marketplace, signature service, new browser or
network permissions, or a sibling production dependency.

**Phase 6C status (2026-08-29): Complete.** RepoLens now checks in the exact 14-file deterministic
private package artifact with per-file SHA-256 and one aggregate content digest. Its offline gate
rejects substitution, omission and extra files from an independent directory; the explicit sync and
cross-repository gates prove the vendor bytes, contract and runtime surface match OneWeb without
serializing a checkout path. The server exposes only four exact same-origin ESM routes. The live
embed imports that runtime, exchanges session authorization through projected init fields before
READY, and contains no hand-written window handshake, challenge, nonce, channel or context-envelope
validator.

The SDK's two added lifecycle scenarios bring OneWeb to 333 unit tests. Typecheck, full lint,
production Chromium build, deterministic 14-file package gate and all 16 Chromium extension E2E
scenarios pass. RepoLens passes 34 tests, its offline and cross-repository gates, both Playwright CLI
browser scenarios and `git diff --check`. Real Chromium proves delayed session setup withholds READY,
forged initialization is ignored, reload creates a new session and a late old-port update cannot
replace the new context. OneWeb's complete extension matrix preserves RepoLens, Bookmark Doctor,
Clash Control, Browser Journal and both remote conformance records across the same built runtime.

### Phase 6D — Typed capability RPC

#### Phase 6D-A — Threat model and pure contract — Complete (2026-08-29)

Phase 6D-A follows [`ADR-0008`](adr/0008-typed-capability-rpc-pure-contract.md) and fixes only the
typed, capability-specific data and lifecycle contract. It does not connect that contract to a
`MessagePort`, host dispatcher, Registry, browser API or real capability.

- Define a separately versioned, discriminated request/result/error/cancel envelope. Every envelope
  binds the canonical module ID, opaque session ID, positive generation, unique request ID,
  capability and finite operation; constructors must not accept caller overrides for those fields.
- Define a declarative schema/catalog DSL whose type mapping derives each operation's request and
  result shape. Validation requires both the manifest-declared capability set supplied by the host
  and a matching static catalog descriptor. There is no `method`, arbitrary message name, browser
  API path, URL, HTTP method, fetch options, script or expression field.
- Restrict payloads to finite JSON-like plain data with no cycles, accessors, symbols, class
  instances or non-finite numbers. Fix request payload at 16 KiB, result at 64 KiB, depth at eight
  and visited nodes at 512. Return deeply frozen clones so validation never grants mutable authority.
- Fix one session at at most 16 in-flight and 1,024 total request IDs, with a non-negotiable 15-second
  deadline. Success, error, caller cancellation, timeout and session destruction are terminal;
  response/cancel ordering is first-terminal-wins and every repeated or late event is rejected.
- Emit only stable error codes without raw exception strings or host details. Keep the single
  conformance descriptor in unit tests; it has pure echo/math data only, uses no browser permission
  and never enters production manifest/catalog/Registry state.

**Phase 6D-A gate:** unit and compile-time tests cover request/result/error/cancel, canonical field
ownership, unknown/undeclared capability and operation, invalid/oversized/non-serializable input,
duplicate IDs, cross-module/session/generation substitution, timeout/cancel/result races, repeated
and late responses, resource ceilings, state immutability and instance isolation. The reproducible
package/export gate must show the new public subpath contains only reviewed pure contract code.
OneWeb's complete typecheck/lint/unit/build and existing Chromium regression remain green. RepoLens
keeps its Phase 6C vendor bytes and production runtime unchanged; expected public-package drift is
diagnostic evidence for 6D-B, not an instruction to sync it in this phase.

Phase 6D-A does not implement runtime send/receive, a host dispatcher, browser/chrome calls, a real
capability, arbitrary URL/network/message access, automatic reconnect, package publication, semver
automation, CLI, marketplace, signatures or new permissions.

**Phase 6D-A status (2026-08-29): Complete.** The private SDK now exports only one additional public
subpath, `@oneweb/module-sdk/capability-rpc`. It contains protocol/version constants, exact
capability-specific schemas, compile-time request/result mapping, canonical constructors, frozen
wire validators and a pure terminal lifecycle reducer. The test-only echo/math descriptor never
enters the built package, production Registry or a module manifest. The package allowlist grows
deterministically from 14 to 16 packed files, and its dedicated content audit rejects host,
Registry, MessagePort, browser/chrome, network and arbitrary-message dependencies.

OneWeb passes typecheck, full-repository lint, all 356 unit tests, the two-clean-build 16-file package
reproducibility/export/consumer gate, production Chromium build, all 16 existing Chromium isolation
scenarios and `git diff --check`. RepoLens remains byte-for-byte unchanged in this phase: its
protection check passes all 34 tests and the offline 14-file vendor gate. The explicit cross-repo
verifier intentionally reports public-artifact drift because OneWeb's package export map and file
set now include the pure RPC subpath; no vendor sync was performed, and 6D-B must make that
consumption decision explicitly. RepoLens also passes `git diff --check`.

#### Phase 6D-B — SDK client and host dispatcher skeleton — Complete (2026-08-30)

Connect the accepted pure contract to a lifecycle-bound SDK request client and a host-side dispatcher
skeleton without adding a real capability. This phase must separately decide how RepoLens consumes
the changed public artifact and cannot weaken Phase 6D-A identity, schema or terminal-state rules.

- Bind SDK-created requests to the runtime client's current module ID, session nonce and host-owned
  positive generation. Generate high-entropy request IDs internally; expose only typed request and
  cancellation, with the fixed 15-second timeout, 16 in-flight and 1,024 total IDs enforced by the
  6D-A reducer.
- Match result/error/cancel to the complete registered identity, capability and operation. Timeout,
  cancel, destroy, port failure, reload and replacement init remove callback authority; no late
  response can revive a terminal request.
- Attach a trusted dispatcher only to `ModuleFrameHost`'s authenticated port/session/generation.
  Require the capability in the installed manifest and grant as well as a static typed catalog;
  keep handler injection narrow and return stable `CAPABILITY_UNAVAILABLE` when no handler exists.
- Keep the skeleton permission-free: no browser/chrome API, Registry mutation, arbitrary method,
  URL, fetch, HTTP option, script, expression or general port-message extension.
- Keep RepoLens on its independently runnable Phase 6C 14-file vendor because it has no typed RPC
  consumer in this phase. Its offline gate remains authoritative and its explicit cross-repository
  verifier continues to report the reviewed public-artifact drift rather than silently syncing it.

**Phase 6D-B status (2026-08-30): Complete.** The SDK now creates high-entropy request IDs and typed
request handles from its current authenticated runtime binding, validates the full original identity
on result/error/cancel, and makes cancel, timeout, destroy and port failure terminal. The runtime
requires a host-owned positive generation only when a capability catalog is enabled; the field is
canonical and never reaches the module's general init callback. `ModuleFrameHost` creates an optional
dispatcher only for its authenticated port, withholds it until `MODULE_READY`, and destroys it on
reload, teardown or port failure. The dispatcher intersects manifest declaration, installed grant,
static catalog and finite operation before invoking a narrow injected handler. No production handler
or real capability is present; absent handlers return only `CAPABILITY_UNAVAILABLE`.

The dispatcher projects a payload-free canonical request reference only after protocol, exact
session identity, request ID, capability and operation syntax pass. It can therefore return the
6D-A stable validation code for undeclared, non-allowlisted, unknown-operation or hostile-payload
requests without echoing payload data; forged session or malformed top-level envelopes remain
silent. Handler maps are snapshotted against the static catalog, and cancellation or teardown before
the handler microtask removes authority without starting handler work.

Unit and compile-time coverage includes typed result inference, caller identity replacement,
unavailable/error/cancel handling, forged module/session/generation/capability/operation responses,
timeouts, quotas, duplicate IDs, handler exceptions, immutable data, destroy/port/reload races and
instance isolation. The deterministic package gate now reviews 18 packed files—`package.json`,
`contract.json` and 16 ESM/declaration files—and adds the public capability-client subpath without
host, Registry, browser/chrome, permission, fetch, arbitrary-message or absolute-path content.

OneWeb passes typecheck, full-repository lint, all 379 unit tests, two-clean-build package
reproducibility/export/consumer checks, production Chromium build, all 17 Chromium scenarios and
`git diff --check`. Real Chromium completes a permission-free iframe request through the built SDK
client and actual dispatcher skeleton, validates a successful echo result, client cancellation and
host abort, receives stable unavailable, then repeats after reload with a rotated generation and
request ID while leaving extension permissions plus all module storage unchanged.

RepoLens intentionally remains unchanged on its independently runnable Phase 6C artifact: its
`pnpm check` gate passes all 34 tests and the offline 14-file vendor gate. Its explicit cross-repository
verifier continues to reject the expected public artifact/export drift; no unused SDK files or ESM
routes were synchronized. RepoLens also passes `git diff --check`.

#### Phase 6D-C — Conformance and complete isolation gate — Complete (2026-08-30)

Exercise the skeleton only with the permission-free conformance capability, hostile frames and two
modules. Prove request, cancellation, teardown, quotas and failures remain isolated before any real
capability is proposed.

The production manifest catalog cannot declare the test-only `conformance.echo` capability. The
gate therefore composes two standard boundaries without weakening either: two different-origin
remote modules first install through the real installer/Registry path, while test-only frames from
those origins use the built SDK, authenticated host handshake and dispatcher harness. One complete
permissions/storage snapshot covers both layers. No conformance ID, descriptor or handler enters a
production manifest, Registry seed, builtin or bundle-owned default catalog.

The unit and Chromium matrix must prove success, stable error, explicit cancel, timeout, both quota
ceilings, handler failure and hostile envelope rejection independently for two sessions. Flooding,
replay, forged identity, reload, removal or teardown of one frame must not consume or invalidate the
other session. Phase 6D-C does not select or implement a real capability.

**Phase 6D-C status (2026-08-30): Complete.** A reusable dual-session fixture drives two SDK
clients and two host dispatchers through independent module/session/generation bindings. Unit tests
cover success, stable handler/result failure, cancel, timeout, both quota ceilings, forged and
cross-principal envelopes, duplicate and late terminal messages, stale generation, port loss,
destroy and FrameHost reload while the peer continues. The Chromium gate installs two standard
remote modules from different exact origins, then loads test-only frames from those same origins
through the built SDK and authenticated dispatcher harness. Alpha flooding, forged response, old
session replay, reload and removal leave beta live, while one complete extension permissions and
storage snapshot—including installed records, grants, timestamps, update candidates and module
namespaces—remains unchanged.

OneWeb passes typecheck, full-repository lint, all 384 unit tests, the reproducible 18-file SDK
package/export gate, production Chromium build, all 18 Chromium scenarios and `git diff --check`.
RepoLens remains unchanged on its portable Phase 6C artifact: all 34 tests and the offline 14-file
vendor gate pass; the explicit cross-repository verifier continues to reject the reviewed SDK
artifact/export drift. No test capability enters a production manifest, Registry, builtin or
default catalog, and no browser/chrome handler exists.

Phase 6 typed RPC infrastructure is now closed. The separately scoped first-capability evaluation
below chooses only which pure contract may be designed next; it does not authorize a browser
adapter.

### Phase 6E — First real capability

#### Phase 6E-A — Candidate evaluation — Complete (2026-08-30)

Compare every catalogued remote capability under one evidence-based matrix before adding a schema,
handler or permission. The matrix must cover user value, reuse of current permissions and host
primitives, sensitive data, confused-deputy exposure, write/destructive side effects, browser and
MV3 coupling, minimum PoC cost and a go/no-go decision. A catalog ID is not an implementation
commitment.

The unified matrix and rationale are recorded in
[`ADR-0009`](adr/0009-first-real-capability-candidate.md). `storage.module` is the only go candidate
for the next pure-contract phase because it reuses the existing `storage` permission and generic
module-state namespace without external navigation, filesystem or attention-surface side effects.
This is conditional: the current helper lacks remote quotas, serialized compare-and-swap, removal
cleanup and a semantic data policy, so no adapter can be added yet.

`tabs.open` is deferred pending a host-generated, user-reviewed navigation-plan contract;
`auth.start` needs a separate authentication threat model and RepoLens migration decision.
Clipboard, downloads and notifications are no-go for now because of user-gesture or new-permission
requirements and disproportionate spoofing/destructive risk.

**Phase 6E-A gate:** documentation-only changes preserve the reproduced Phase 6D-C baseline:
OneWeb typecheck, full lint, 384 unit tests, deterministic 18-file SDK verification, production
build, 18 Chromium scenarios and `git diff --check`; RepoLens 34 tests, offline 14-file vendor and
`git diff --check`. The cross-repository verifier continues to report the accepted artifact/export
drift. No SDK, catalog, manifest, permission, dispatcher, handler, production consumer or RepoLens
vendor changes are part of 6E-A.

#### Phase 6E-B — `storage.module` threat model and pure contract — Complete (2026-08-30)

Only a 6E-A `go` candidate may enter this phase. Fix its finite operations, schemas, quotas,
revocation, lifecycle and error rules as pure code before any browser/chrome adapter exists.

The accepted contract exposes only `read`, whole-document `replace` and whole-document `clear`.
Requests carry an expected opaque revision where mutation requires compare-and-swap; authenticated
module/session/generation identity remains in the canonical RPC envelope. Storage area, actual key,
namespace, next revision and every browser method remain host-owned and absent from caller payloads.
The module document is finite JSON-like data capped at 12 KiB, depth six and 256 nodes inside the
stricter generic RPC ceiling.

The accepted pure contract adds a capability-specific schema/catalog, canonical envelope helpers,
recursively frozen normalized clones, host-generated opaque revisions and a pure CAS/lifecycle
reducer. Stable outcomes cover conflict, quota and malformed data, grant revocation, destroyed or
foreign sessions, stale generations, remove/reinstall and first-terminal-wins RPC races. Disable and
worker restart retain inaccessible local data while destroying session authority; removal clears
the document and reinstall begins empty with a new binding and revision. Semantic secrets remain
structurally unknowable and are explicitly local-only.

**Phase 6E-B gate:** OneWeb passes typecheck, full-repository lint, all 413 unit tests—including 29
`storage.module` contract tests—the deterministic 20-file SDK package/export gate, production
Chromium build, all 18 Chromium scenarios and `git diff --check`. One GitHub-dependent scenario
needed its configured retry after an external navigation timeout, then passed a direct isolated
rerun; the local SDK/RPC regressions pass directly. RepoLens remains unchanged at 34 tests and its
offline 14-file vendor gate; the cross-repository verifier explicitly reports the expected
`typedCapabilities.storage.module`,
artifact and export drift. No vendor was synchronized, and no browser/chrome storage call,
dispatcher, FrameHost, Registry, management UI or permission changed.

#### Phase 6E-C — Narrow storage adapter PoC and complete isolation gate — Complete (2026-08-30)

Only after 6E-B acceptance may a separately scoped task add one injected adapter and conformance
consumer. It must preserve module/session isolation and may not grow a generic browser method, URL,
fetch or storage escape hatch.

The PoC adds one trusted-background `storage.local` adapter behind an extension-only, versioned
session protocol. A standard authenticated FrameHost opens one short-lived module/session/generation
binding and forwards only canonical `storage.module` requests. The background rechecks the current
installed record, enabled state, manifest declaration and grant for every operation. It alone derives
the physical key and installation namespace, selects the storage area, generates the next revision
and serializes CAS mutations. Callers can never name a key, prefix, area, browser method or next
revision.

One module-owned stored record contains only its installation identity, opaque revision and bounded
document. Disable, grant removal, frame teardown and worker restart destroy session authority but
retain local data; removal invalidates the session and deletes the one derived record; reinstall
with a new installation identity starts empty even if stale bytes survived an earlier failed cleanup.
Two module queues and namespaces remain independent. Phase 6E-C does not add storage UI or another
capability.

The completed browser PoC installs two `storage.module` modules from different exact origins and
loads their test-only consumers from the fixture servers, never into the extension execution
environment. Both consumers use the built SDK runtime through the standard authenticated FrameHost
path. Real Chromium covers read/replace/clear, a stale CAS conflict, concurrent cross-module writes,
disable/re-enable retention, worker-restart restoration through fresh sessions, capability
shrink/revocation, deletion of exactly one physical record and hostile-text rendering. Each failure
leaves the peer module, RepoLens, Bookmark Doctor, Clash Control, Browser Journal, the unrelated
remote module, general module state and unrelated extension storage unchanged.

**Phase 6E-C gate:** OneWeb passes typecheck, full-repository lint, all 430 unit tests, the
deterministic 20-file SDK package/export gate, production Chromium build, all 19 Chromium scenarios
and `git diff --check`. RepoLens remains unchanged and passes all 34 tests plus its offline 14-file
vendor gate; the cross-repository verifier continues to report the expected unsynchronized
`typedCapabilities.storage.module`/artifact drift. No RepoLens vendor, new permission, generic
storage escape hatch, Page Toolbox implementation or `one-tampermonkey` change is included.

### Phase 7 — Page Toolbox consolidation — Complete

OneWeb is the only source, test and release entry for Page Toolbox. The three accepted ideas from the
historical `one-tampermonkey` prototype are new clean-room OneWeb tools, not a migrated feature set.
The old repository is not a second active product and will be archived directly in a separately
authorized administrative phase. There is no tag, migration notice, compatibility layer, submodule,
subtree sync, sibling/`file:` dependency, bidirectional copy or separately published package.

#### Phase 7A — Historical prototype audit and Page Toolbox contract — Complete

Audit the old userscripts and classify portable behavior, site-specific assumptions, remote-code
execution, permissions and cleanup obligations. Define one packaged builtin manifest plus an
internal tool descriptor and `apply`/`update`/`dispose` lifecycle. Do not turn every small page tool
into a full OneWeb module.

The immutable `one-tampermonkey@448bf86` audit and complete go/no-go matrix are recorded in
[`page-toolbox-legacy-audit.md`](page-toolbox-legacy-audit.md), with the accepted architecture in
[`ADR-0011`](adr/0011-page-toolbox-contract.md). No historical implementation qualifies for direct
copying. Password visibility, explicit free-page edit and a narrowed selection/copy release are the
only 7B go candidates, all as clean-room rewrites. The floating surface is a 7C rewrite candidate;
spacing inspection and night mode are deferred. Remote request/eval, external Vue, analytics-global
mutation, click replay, store redirection and hard-coded intranet/report behavior are rejected.

The draft builtin has no default matches or capability grant. An exact HTTP(S) origin, enabled
module and per-site tool selection are all required. Immutable tool descriptors contain no code;
only an internal packaged allowlist can bind an implementation. One common top-frame isolated-world
runtime must own module/tab/frame/origin/navigation/generation authority plus every listener, timer,
observer, abort signal, DOM marker and restoration value. Page content remains local and never
enters generic contexts, remote frames, logs or another module.

The contract fixes a seven-state lifecycle (`inactive`, `applying`, `active`, `updating`,
`disposing`, `disposed`, `failed`) with generation-bound first-terminal-wins behavior and atomic
updates. Page Toolbox uses its generic module-local namespace with hard ceilings of 64 exact-origin
sites, 16 enabled tools per site, 2 KiB per-tool settings, 8 KiB per-site settings, 64 KiB total,
depth 8 and 1,024 JSON-like nodes; overflow fails closed. Descriptor applicability is top-frame,
user-approved exact HTTP(S) origin only, and settings schemas come from a static packaged allowlist.

**Phase 7A status (2026-08-30): Complete.** The immutable legacy snapshot was audited without a
source copy or repository mutation. OneWeb passes typecheck, full-repository lint, all 430 unit
tests, the deterministic 20-file SDK package/export gate, production Chromium build, all 19
Chromium scenarios against the freshly built `extension/` artifact and `git diff --check`. RepoLens
remains unchanged and passes all 34 tests plus its offline 14-file vendor gate and `git diff
--check`; the verifier retains the expected explicit `typedCapabilities.storage.module`/artifact
drift. `one-tampermonkey` remains clean at
`448bf86d031881b3df687a6bcda416acd39307fa`.

#### Phase 7B — Common packaged-page runtime and first safe tools PoC — Complete

Phase 7B is intentionally split so pure authority and cleanup contracts land before any browser
surface or tool behavior:

##### Phase 7B-A — Pure runtime contract and resource ledger — Complete

Implement browser- and DOM-independent descriptor/settings/binding validators with canonical
clones, the seven-state generation lifecycle reducer and an abstract resource ledger with a pure
test adapter. Lock the Phase 7A exact-origin/top-frame/static-schema/default-off boundary, all finite
settings quotas, atomic update, first-terminal-wins, idempotence, reverse-order cleanup and
ownership-aware restoration. This phase does not register a content script, request permission,
touch a page or ship a tool.

**Phase 7B-A status (2026-08-31): Complete.** Builtin-local pure contracts now validate and
canonically clone static descriptors, complete finite settings and module/tool/origin/top-frame/
navigation/generation bindings. The seven-state reducer enforces idempotent apply/update/dispose,
atomic settings publication, rollback, first-terminal-wins and stale authority rejection. The
abstract ledger covers listener, timer, observer, abort, owned node/style and prior-value resources,
drains exactly once in reverse order and skips restoration after ownership changes. Its adapter and
all 31 new tests use plain strings/objects only.

OneWeb passes typecheck, full-repository lint, all 461 unit tests, the deterministic 20-file SDK
package/export gate, production Chromium build, all 19 existing Chromium scenarios against the
fresh build and `git diff --check`. RepoLens remains unchanged and passes all 34 tests plus its
offline 14-file vendor gate; the verifier retains the expected explicit
`typedCapabilities.storage.module`/artifact drift. `one-tampermonkey` remains clean at
`448bf86d031881b3df687a6bcda416acd39307fa`.

##### Phase 7B-B — Exact-origin injection and lifecycle channel — Complete

Implement an explicit `scripting.executeScript` adapter that may inject only the fixed packaged
Page Toolbox isolated-world runtime into frame 0 after the enabled builtin, normalized current
HTTP(S) origin, stored site grant and browser exact-origin permission all pass. The separately
reviewed `scripting` API permission does not grant a site: optional host permission remains the
mandatory user consent boundary, and no static `<all_urls>`, persistent dynamic registration,
function injection, caller-selected file/path or MAIN-world execution is permitted.

Bind the content runtime to the trusted background through a dedicated versioned `runtime.Port`.
The background authenticates the extension sender, tab, frame 0, sender URL origin, current tab
navigation, enabled seeded record, finite local site state and exact-origin permission before
issuing a fresh memory-only session nonce and generation. Challenge/session/generation mismatches,
duplicates and late messages fail closed. Disable, revocation, navigation, tab removal, port loss
and worker restart invalidate only the affected authority. This phase may establish an empty-tool
runtime for conformance, but includes no tool behavior, generic DOM/code/message bridge, Shadow DOM
or product configuration UI. [`ADR-0013`](adr/0013-page-toolbox-injection-channel.md) records the
adapter and threat-model decision.

**Phase 7B-B status (2026-08-31): Complete.** OneWeb now seeds the protected default-off Page
Toolbox builtin and persists only its validated finite site document in the existing module-local
namespace. A fixed adapter calls `scripting.executeScript` with only
`dist/pageToolbox/index.global.js`, a validated tab ID and frame 0; the built 5.88 KiB isolated
runtime exposes only its named lifecycle port and contains no storage, permission, scripting,
fetch, remote-module handshake or management route. The manifest adds reviewed `scripting` API
access but keeps Page Toolbox absent from static content-script matches and retains optional exact
HTTP(S) origins as the mandatory site consent ceiling.

The versioned HELLO/INIT/READY/DISPOSE/DISPOSED channel binds extension sender, current tab, frame
0, sender/current exact origin, document/navigation identity, generation, challenge and memory-only
session nonce. Preparation derives the current tab and confirmation requires the matching
single-use unexpired token plus an already-present exact permission. Navigation, disable, tab
removal, port loss, permission revocation and worker restart invalidate only the affected session;
startup rechecks saved state and permissions before a fresh fixed-file injection. Origin release is
bidirectionally conservative across all packaged builtin probes and installed remote modules.

OneWeb passes typecheck, full-repository lint, all 481 unit tests, the reproducible 20-file SDK
package/export gate, production Chromium build, all 20 Chromium E2E scenarios and
`git diff --check`. RepoLens remains unchanged and passes 34 tests plus its offline 14-file vendor
gate and `git diff --check`; the cross-repository verifier reports only the expected existing
`typedCapabilities.storage.module`/artifact drift. `one-tampermonkey` remains clean and read-only at
`448bf86d031881b3df687a6bcda416acd39307fa`.

##### Phase 7B-C — First safe tool PoC — Complete

Clean-room implement password visibility, explicit free-page edit and narrowed selection/copy
release on the accepted common runtime. Each implementation stays top-frame, default-off,
network-free and ledger-owned.

**Phase 7B-C status (2026-09-01): Complete.** The accepted boundary adds only three packaged static
descriptors and exact finite settings schemas. A trusted management request may select one of those
IDs for the current already-approved top-frame origin; it cannot submit an origin, tab, selector,
script, expression, event type or DOM operation. The background canonically validates and stores the
site document, then sends only normalized tool plans over the authenticated session. Password input
values, edited text and selections never cross the content-runtime boundary.

The password tool delegates only its fixed visibility gesture and mutates qualified password input
types without reading values. Free edit owns only the current document body's exact prior
`contenteditable` attribute and handles body replacement. Selection/copy release owns one packaged
style plus the fixed `copy`, `contextmenu` and `selectstart` listeners, with settings limited to
booleans for those named behaviors. All mutations, observers and listeners use the common resource
ledger, reverse cleanup and ownership-aware restoration. The detailed protocol and DOM threat model
is recorded in [`ADR-0014`](adr/0014-page-toolbox-safe-tools.md).

The packaged catalog now drives password visibility with a bounded delegated gesture, reversible
body `contenteditable`, and a static selection/copy release style plus its three named listeners.
Lifecycle protocol v2 carries only canonical sorted plans and a monotonic plan revision. The DOM
coordinator derives per-tool bindings, uses the seven-state reducer, ledgers every observer,
listener, prior attribute and owned style, and shares ownership tokens across overlapping
generations so the final owner restores the original page value without reviving stale mutations.

Unit coverage includes static schemas, plan canonicalization, dynamic password nodes, body
replacement, page-owned later changes, overlapping generations, fixed-event behavior, malformed
plans, management synchronization and stale plan revisions. Real Chromium enables, updates and
disables all three tools, proves child frames and unapproved origins remain untouched, navigates to
a fresh generation without duplicate resources, and tears down on revocation and module disable
while two installed remote modules and every unrelated builtin record/state/permission remain
unchanged. OneWeb passes typecheck, full-repository lint, all 494 unit tests, the reproducible
20-file SDK package/export gate, production Chromium build, all 21 Chromium E2E scenarios and
`git diff --check`.

##### Phase 7B-D — Two-site/multi-tool complete isolation gate — Complete

Prove two exact origins and multiple tools preserve generation, settings, resources, permissions
and every unrelated OneWeb principal across success, failure, navigation, revocation and teardown.

**Phase 7B-D status (2026-09-02): Complete.** This is a conformance and hardening gate, not a product
feature stage. Two independently approved exact origins must hold separate settings, tabs, sessions,
generation and plan revision while several packaged tools run concurrently. Updating, failing,
navigating or revoking one origin/tool may mutate only that authority; the peer origin and peer tools
must remain live and byte-for-byte stable.

The gate snapshots Page Toolbox state plus every unrelated builtin and installed remote record,
grant, update candidate, timestamp, module-local namespace, browser permission and extension storage
key. It injects lifecycle and DOM ownership failures, stale plan acknowledgements, port loss,
navigation replacement and exact-origin revocation. Shared-origin permission retention remains
conservative across packaged builtins and remote records. No new catalog entry, permission, runtime
message, settings field or UI is permitted. [`ADR-0015`](adr/0015-page-toolbox-isolation-gate.md)
defines the evidence boundary.

The reusable controller gate holds two authenticated ports with independent exact origins,
generations and plan revisions. It changes each site's overlapping tool plans separately, injects a
stale acknowledgement into one port, verifies only that session is terminated, and continues to
update and revoke the peer site. The DOM gate runs two documents and overlapping tool sets, replaces
one owned style with page authority, verifies only that tool fails closed, then drains the first
document while the second document and its resources remain active.

Real Chromium installs two remote modules on the two Page Toolbox origins, approves and runs all
three tools independently on both tabs, mutates one owned resource, changes only that site's plan,
replaces only its navigation generation and revokes it while the peer session remains byte-for-byte
stable and interactive. Final module disable drains the remaining site. Complete Registry records,
grants, update candidates, timestamps, namespaced state, permissions, request counters and storage
snapshots remain unchanged outside the intentional Page Toolbox/Registry keys. No production
catalog, protocol, permission or runtime code required expansion. OneWeb passes typecheck,
full-repository lint, all 496 unit tests, the reproducible 20-file SDK gate, production Chromium
build, all 22 Chromium E2E scenarios and `git diff --check`.

The PoC acceptance table in `page-toolbox-legacy-audit.md` is normative: each tool has no
browser-data/network authority beyond explicit exact-origin page access, must restore only its owned
prior DOM state, and must leave every other site, tool and module unchanged after success, failure,
revocation, navigation or disposal.

#### Phase 7C — Product controls, isolated UI and remaining generic tools — In progress

Phase 7C is split so a user-facing control contract is reviewed before it can acquire browser,
settings or page authority:

##### Phase 7C-A — Product control contract and pure presentation model — Complete

Define a browser-, DOM- and injection-independent snapshot and reducer for the current site's Page
Toolbox controls. The model must distinguish loading, unsupported origin, disabled builtin,
unapproved site, approved site, stale concurrent data and stable failure. It projects exactly the
three packaged catalog tools into bounded safe labels, explicit default-off controls and finite
settings choices; it cannot accept a selector, script, expression, URL, event name or arbitrary
tool ID.

The trusted sidebar is the future authority-bearing product control surface. A future page Shadow
DOM surface is a convenience view with a narrower command vocabulary and no independent settings,
permission or lifecycle authority. Both consume host-derived exact-origin snapshots; neither may
derive or submit a target origin. Draft edits remain pure and local in this phase. A save lifecycle
must bind one request to the loaded revision, use first-terminal-wins and enter a stale state on a
concurrent revision instead of silently overwriting. Origin and title remain untrusted bounded text.

This phase may add only pure validators, canonical cloning, presentation projection, draft/reducer
logic and unit tests. It does not modify the extension manifest, Page Toolbox lifecycle protocol,
background controller, settings store, content runtime, DOM tools or current UI. The decision and
threat model are recorded in [`ADR-0016`](adr/0016-page-toolbox-product-controls.md).

**Phase 7C-A status (2026-09-02): Complete.** The accepted model canonically validates a versioned,
host-derived current-site snapshot with closed unsupported/module-disabled/site-unapproved/ready
states. It projects exactly three packaged Chinese-language controls with finite options and
default-off behavior, normalizes hostile title text without interpreting markup, and fixes separate
trusted-sidebar versus future generation-bound Shadow-surface authority.

The pure reducer owns unique load/save requests, immutable complete drafts, loaded revisions,
first-terminal-wins, exact successful-draft comparison, explicit conflict/stale state and safe
discard. Invalid tool IDs and arbitrary settings never become a draft; late, replaced and
cross-instance results cannot publish authority. The implementation imports no browser/chrome API,
DOM, Registry, storage, controller or lifecycle protocol and changes no existing runtime or UI.

OneWeb passes typecheck, full-repository lint, all 515 unit tests, the deterministic 20-file SDK
package/export gate, production Chromium build, all 22 Chromium scenarios against the freshly built
`extension/` artifact and `git diff --check`. RepoLens remains unchanged and passes all 34 tests plus
its offline 14-file vendor gate and `git diff --check`; the cross-repository verifier retains the
expected explicit `typedCapabilities.storage.module`/artifact drift. `one-tampermonkey` remains
clean and read-only at `448bf86d031881b3df687a6bcda416acd39307fa`.

##### Phase 7C-B — Trusted sidebar current-site settings and narrow background protocol — Complete

Connect the trusted extension sidebar to a host-derived active-tab status/prepare/approve/revoke and
CAS settings protocol. Keep exact-origin permission, enabled record and current navigation checks in
the background; the UI cannot name a tab, origin, storage key or lifecycle generation.

The background returns the 7C-A versioned product snapshot and derives page title, exact origin,
module/site/permission state and current per-site revision from the active top-level browser tab. A
settings mutation contains only the loaded revision and one complete catalog-validated site
document. It is serialized, rechecks the enabled seeded record, current tab, stored approval and
browser exact-origin permission, then atomically replaces only that site or returns an explicit
revision conflict. Accepted replacements advance exactly one persistent per-site revision and
synchronize only that origin's authenticated content sessions.

Persist revisions in the existing Page Toolbox module-local key through a versioned wrapper around
the already validated settings document. Legacy schema-1 values migrate in memory with revision zero
per approved site and are rewritten only on the next real mutation. Approval creates revision zero;
revoke/permission removal deletes that site's settings and revision; disable and worker restart
retain both. No second storage namespace, arbitrary key, origin supplied by the UI or last-write-wins
fallback is allowed.

The trusted module-management card consumes the 7C-A reducer. It may explicitly request the prepared
exact-origin browser permission, render only static packaged controls, keep edits as a local draft,
save once with CAS, discard, reload stale state and revoke the current site. All page title/origin
content is text-only. The accepted protocol, persistence migration and threat model are recorded in
[`ADR-0017`](adr/0017-page-toolbox-sidebar-control.md). This stage does not add Shadow DOM, a page
launcher, a new tool, arbitrary settings, remote-module access or legacy migration.

**Phase 7C-B status (2026-09-02): Complete.** The existing Page Toolbox module-local key now holds a
strict schema-2 wrapper with the finite schema-1 settings plus an exact-key per-site revision map.
Legacy values migrate at revision zero without read-time writeback. Approval creates revision zero;
whole-site replacement is serialized, write-before-publish CAS; revoke and permission removal delete
only the derived site's settings/revision. Accepted no-op commits advance exactly once, while stale,
exhausted, malformed or failed writes publish no new authority.

The trusted management card derives its page title, active top-level exact origin, module state,
permission state and revision exclusively through the background status request. It renders exactly
the three packaged finite controls, keeps edits as a local complete draft, and separates
prepare/permission/confirm, save, discard, reload and revoke. A client validates the prepared origin
before requesting it; neither client nor UI can submit another origin, tab, module ID, storage key or
lifecycle generation. Conflict is an explicit stale terminal and never retries automatically.

OneWeb passes typecheck, full lint, **531/531 unit tests**, the reproducible **20-file SDK** gate,
production Chromium build, **23/23 Chromium E2E** scenarios and `git diff --check`. The new browser
scenario proves two trusted management pages cannot overwrite each other, then changes active origin,
revokes and cleans the packaged tools while unrelated records/state/permissions remain unchanged.
RepoLens stays on its unchanged **34-test/14-file** offline vendor baseline; its verifier retains only
the expected `typedCapabilities.storage.module`/artifact drift. The legacy repository remains
read-only. This established the prerequisite consumed by Phase 7C-C.

##### Phase 7C-C — Shadow DOM page control surface and lifecycle — Complete

Add a packaged, isolated Shadow DOM launcher only after 7C-B is accepted. It may display current
tool state and request a closed set of current-site actions over the authenticated generation
channel, but owns no permission prompt, arbitrary settings document or privileged browser adapter.
Navigation, revocation, disable and teardown must remove its nodes, styles and listeners through the
existing resource ledger.

The accepted design is fixed in [`ADR-0018`](adr/0018-page-toolbox-shadow-control.md). The packaged
closed ShadowRoot appears only after lifecycle authentication and exposes exactly one finite action:
enable or disable one of the three packaged tools. The request is bound to the current nonce,
tab/origin/navigation/generation and carries no settings, target, permission or arbitrary payload.
The host selects validated saved settings or an immutable packaged default and commits through the
existing serialized per-site state path. The trusted sidebar remains the only approval, detailed
settings, CAS reload and revoke authority.

The implementation advances only the packaged lifecycle protocol to version 3 and adds no permission,
network, storage-key or generic DOM/message input. A pure reducer binds the enabled projection and
one pending action to the authenticated origin/tab/navigation/generation. The content runtime derives
unique action IDs from per-instance entropy, while the host accepts one pending action and 128 unique
IDs per session, rechecks the current seeded record, tab origin, stored approval and exact-origin
permission, and writes before publishing only the matching site's finite plan. Enabling selects an
already validated saved setting or a packaged static default; disabling carries no settings.

The closed ShadowRoot contains only fixed labels, booleans and native keyboard controls. Its host and
listeners use a generation resource ledger with construction rollback, reverse disposal and
ownership-aware page replacement behavior. Unit gates cover forged identity, duplicate/late results,
flood and pending contention, lifecycle cancellation, default/saved settings, write failure and two
document/origin isolation. Chromium operates two tools by keyboard, observes trusted-sidebar sync,
keeps a second origin untouched, replaces the host from the page, navigates and restarts the worker,
then proves revoke and disable cleanup with unchanged unrelated state.

OneWeb passes typecheck, full lint, **549/549 unit tests**, the reproducible **20-file SDK** gate,
production Chromium build, **24/24 Chromium E2E** scenarios and `git diff --check`. RepoLens remains
unchanged on **34 tests** and its offline **14-file vendor** gate, with only the expected existing SDK
contract drift. Phase 7C-D follows as a separate decision/gate stage; no new tool or legacy migration
is included in 7C-C.

##### Phase 7C-D — Remaining generic-tool decisions and Chromium/Firefox gates — Complete

Re-evaluate only the deferred night-mode and spacing-inspection candidates against the accepted
runtime and product controls. Each remains no-go unless it has a static schema, reversible ownership
and a browser-parity isolation gate. Prove two origins, several tools and both control surfaces do not
alter unrelated modules, grants, permissions or state in Chromium and Firefox.

[`ADR-0019`](adr/0019-page-toolbox-remaining-tools-and-browser-parity.md) fixes the active decision
boundary. Neither deferred concept enters the current catalog: night mode lacks a product-quality,
accessible and frame-safe visual contract, while spacing inspection would require a new geometry,
overlay and performance subsystem. The legacy remote request plus `eval` path remains permanently
rejected. Phase 7C-D therefore adds no fourth tool and concentrates its implementation work on real
Firefox build/lifecycle evidence for the accepted three-tool catalog and two finite controls.

**Phase 7C-D status (2026-09-02): Complete.** The packaged catalog remains exactly password
visibility, explicit free-page edit and finite selection/copy release. Night mode is no-go for the
current catalog because its visual/accessibility/frame contract is not product-quality; spacing
inspection is no-go because safe geometry, overlay, invalidation and interaction ownership require
a separate reviewed subsystem. The legacy remote `spacingjs` request plus `eval` is permanently
rejected.

The Firefox gate runs the production artifact through `web-ext`, discovers its temporary
`moz-extension://` origin, controls the real browser through repository-only RDP/Marionette
orchestration and exercises the real `sidebar_action`, packaged content runtime and exact-origin
lifecycle. Test code pre-grants the two fixture origins in Firefox's real temporary permission store;
no test message, debug global, static match or production hook is added. Chromium remains responsible
for the real permission-request UI gate.

Firefox retained an explicit non-default-port host pattern without matching the corresponding page.
OneWeb therefore fails closed and never broadens such a grant to all ports. The Firefox gate uses
enforceable exact origins on the default port, `http://127.0.0.1` and `http://localhost`. Firefox
origins with explicit non-default ports remain unsupported until the browser can enforce the
required boundary.

OneWeb passes typecheck, full lint, **554/554 unit tests**, the reproducible **20-file SDK** gate,
production Chromium build, **24/24 Chromium E2E**, production Firefox build, strict Firefox manifest
validation and the **1/1 Firefox lifecycle/isolation gate**. RepoLens remains unchanged on its
**34-test/14-file offline vendor** baseline with only the expected SDK drift. Both writable
repositories pass `git diff --check`; `one-tampermonkey` remains clean and read-only at
`448bf86d031881b3df687a6bcda416acd39307fa`.

#### Phase 7D — Pre-release identity and history cleanup — Local Complete

OneWeb has not been released and has no users, so it has no legacy migration obligation. The earlier
migration guide, notice-only README template, retirement manifest, `legacy-final` tag plan and 7D-A/
7D-B/7D-C workflow are removed. [`ADR-0020`](adr/0020-pre-release-clean-slate.md) fixes the clean-slate
decision.

- Keep only the immutable Phase 7A technical audit and Page Toolbox ADRs that explain the clean-room
  rewrite and permanently rejected security boundaries.
- Treat the three Page Toolbox tools as new OneWeb functionality. Add no GM storage importer,
  settings compatibility, userscript protocol, migration UI or fourth tool.
- Normalize the private root package and Firefox add-on identity to OneWeb before release. Keep the
  factual repository URL until an explicitly authorized GitHub rename can update the remote and
  homepage atomically.
- Verify production source and artifacts contain no `one-tampermonkey`, GM API, external Vue CDN,
  remote-eval, private-site or userscript dependency.
- Leave `one-tampermonkey` unchanged as historical reference. Its existing Git history is sufficient;
  a later explicit request may archive the GitHub repository directly without a tag or branch rewrite.

**Phase 7D gate:** OneWeb typecheck, full lint, unit, deterministic SDK, production Chromium and
Firefox builds, strict Firefox manifest validation, complete Chromium E2E, real Firefox lifecycle
gate and `git diff --check` pass with the normalized identities. RepoLens passes its existing offline
protection without a vendor sync. The legacy repository stays clean at its audited commit. Phase 7
then closes without a compatibility or migration product.

**Phase 7D local status (2026-09-03): Complete.** The root package is `one-web`; the stable Firefox
development/self-distribution ID is `one-web@juckz.local`; the RepoLens integration sample and current
documentation use OneWeb as the host identity. A new build-integrated gate validates those identities
and scans 25 Page Toolbox source/complete-extension artifact files for legacy userscript, GM, CDN,
remote-eval and private-network markers on both browser artifacts.

The unnecessary migration guide, legacy README template, retirement manifest, `legacy-final` tag
plan and staged 7D-A/B/C workflow are gone. OneWeb passes typecheck, full lint, **558/558 unit tests**,
the reproducible **20-file SDK** gate, both identity scans, production Chromium build, **24/24
Chromium E2E**, production Firefox build, strict manifest validation and the **1/1 real Firefox
lifecycle/isolation gate**. RepoLens passes **34/34** and its offline **14-file vendor** gate without
a vendor sync; both writable repositories pass `git diff --check`. `one-tampermonkey` remains clean
at `448bf86d031881b3df687a6bcda416acd39307fa`.

Phase 7 product/code work is closed. At that checkpoint the GitHub repository still used the
`one-webext` URL and the historical prototype remained unarchived. Phase 8 sequences those external
administrative actions behind a reviewable local checkpoint; neither action creates compatibility
work.

Across Phase 7, never migrate `GM_xmlhttpRequest` plus `eval`, an external Vue CDN, hard-coded
intranet sites or global listeners that cannot be disposed. RepoLens, Bookmark Doctor, Clash
Control and Browser Journal keep their current module shapes.

## 6. Current repository boundaries

OneWeb is the sole source, test and release entry for the host, packaged builtins and the current
private module SDK. Packaged modules remain isolated source areas inside this repository; Clash
Control and Page Toolbox are not separate products or repositories. Publishing or extracting the
SDK would require its own future release decision and is not part of Phase 8.

The maintained repository boundary is:

```text
one-web                     # host, packaged builtins and private module SDK
repolens-starter            # independent RepoLens remote module and portable SDK vendor
one-tampermonkey            # read-only historical prototype; direct archive pending Phase 8C
```

Other remote modules remain independently deployed web applications discovered through manifest
URLs. They do not share OneWeb source or receive an extension/browser execution path.

## 7. Phase 8 — Pre-release convergence and `0.1.0` readiness

Phase 8 performs no feature expansion. It converts the intentionally large Phase 0–7 working trees
into an auditable release candidate, then handles the two explicitly authorized remote repository
operations in isolation. [`ADR-0021`](adr/0021-pre-release-convergence.md) fixes the ordering.

### Phase 8A — Pre-release working-tree convergence and stable checkpoint — Complete (2026-09-03)

- Protect the OneWeb and RepoLens working trees and keep `one-tampermonkey` read-only.
- Reproduce the Phase 7 baseline before changing current documentation or verification scripts.
- Remove stale current-product language that promises userscript migration, compatibility, tags or
  notice branches while retaining the Phase 7A audit, ADR-0020 and permanent rejection evidence.
- Verify the canonical `one-web` package identity and `one-web@juckz.local` Firefox ID, and scan
  production source/artifacts for rejected userscript, GM, CDN, remote-eval and private-site markers.
- Record an ordered, reviewable commit proposal without committing or synchronizing the RepoLens
  SDK vendor.
- Inventory links and path hints that must change only after the remote repository is renamed.

The working-tree baseline, audit result, deferred rename inventory, proposed commits and exact gates
are recorded in [`phase-8a-pre-release.md`](checkpoints/phase-8a-pre-release.md).

**Phase 8A status:** Current docs no longer plan a migration product, preservation tag, notice branch
or settings export. The Phase 7A audit, ADR-0020 and permanent unsafe-design rejection remain. The
identity gate now also scans root package metadata and reports **26 production files** for both
browser builds. OneWeb passes typecheck, full lint, **558/558 unit tests**, the reproducible
**20-file SDK** gate, Chromium production build, **24/24 Chromium E2E**, Firefox production build,
manifest validation with **0 errors / 0 notices / 0 warnings**, and the **1/1 real Firefox gate**.
RepoLens passes **34/34** and its offline **14-file vendor** gate; the accepted
`typedCapabilities.storage.module` drift remains explicit. Both writable repositories pass
`git diff --check`, no commit or vendor sync was made, and `one-tampermonkey` remains clean at the
audited commit. Phase 8B is the next separately authorized stage.

### Phase 8B — Atomic GitHub repository rename and link update — Complete (2026-09-03)

After separate authorization, rename `JuckZ/one-webext` to `JuckZ/one-web` first. Only after the new
remote exists, update the local Git remote, package homepage, packaged Logo link, current docs and
RepoLens integration path hints together, then verify that no newly written link is unresolved.
Historical audit citations need not be rewritten merely to hide their original path.

**Phase 8B status:** The GitHub repository is `JuckZ/one-web`; the checkout directory and root
package are `one-web`; the Firefox ID is `one-web@juckz.local`; current links point to the verified
new remote; and RepoLens uses `integrations/one-web/`. Product/protocol identifiers remain OneWeb,
`oneweb.module`, `dev.oneweb.*` and `@oneweb/module-sdk`.

### Phase 8C — Direct historical repository archive — Complete (2026-09-03)

After separate authorization, archive `JuckZ/one-tampermonkey` directly. Do not add a tag, migration
guide, notice-only branch, default-branch rewrite, importer, compatibility layer or release campaign.
The existing Git history and immutable Phase 7A audit remain the historical record.

**Phase 8C status:** `JuckZ/one-tampermonkey` is archived at
`448bf86d031881b3df687a6bcda416acd39307fa`. The local checkout remains clean and no tag, branch,
notice, importer or compatibility change was created.

### Phase 8D — Fresh clone/build/install and `0.1.0` release-candidate acceptance — Complete (2026-09-03)

From fresh temporary clones with frozen dependencies, reproduce the OneWeb and RepoLens gates,
build Chromium and Firefox artifacts, install each production artifact in a clean browser profile,
and verify the canonical identity plus core module isolation. Only this phase may prepare the root
`0.1.0` release candidate; publishing remains a separately authorized external action.

The exact clean-clone, packaging and evidence procedure is tracked in
[`phase-8d-release-candidate.md`](checkpoints/phase-8d-release-candidate.md).

**Phase 8D status:** Commit `b5055864de36c058203ffc16111a209a4a7b06c9` passed frozen install,
typecheck, full lint, **558/558 unit tests**, the reproducible **20-file SDK** gate, production builds,
the **28-file identity/runtime scan** for each browser, **24/24 Chromium E2E**, Firefox manifest lint
with **0 errors / 0 notices / 0 warnings**, and the **1/1 real Firefox gate** from a new clone and new
browser profiles. The final 12-file Chromium ZIP and Firefox XPI passed content and security review;
their exact SHA-256 values are recorded in the checkpoint. RepoLens passes **34/34** plus its offline
**14-file vendor** gate while the accepted SDK drift remains explicit. Phase 8 is complete. Formal
release, GitHub Release creation and browser-store upload require separate authorization.
