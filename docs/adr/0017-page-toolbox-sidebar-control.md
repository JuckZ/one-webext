# ADR-0017: Page Toolbox trusted sidebar current-site control

- **Status:** Accepted (Phase 7C-B Complete)
- **Date:** 2026-09-02
- **Scope:** Host-derived product snapshots, persistent per-site revisions, CAS settings and trusted UI

## Context

ADR-0016 accepts a pure current-site presentation/reducer contract. The Phase 7B controller already
supports explicit exact-origin preparation/confirmation and individual packaged tool changes, but
its stored settings have no durable revision. Connecting a product UI directly to that mutation
would allow two sidebars—or a sidebar surviving a service-worker restart—to overwrite one another.
It would also tempt the UI to supply a target origin or reach module-local storage directly.

## Decision

Add two closed management operations to the existing versioned, extension-only Page Toolbox channel:

1. current-site product status takes no target input and returns the ADR-0016 snapshot;
2. current-site whole-settings replace takes only `expectedRevision` and one complete finite
   `PageToolSiteSettingsV1` document.

For status, the trusted background queries the active tab and derives its bounded title and
normalized top-frame HTTP(S) origin. It reads the seeded Page Toolbox record, the module-local state
and the browser exact-origin permission. The closed access projection is `unsupported`,
`module-disabled`, `site-unapproved` or `ready`. A missing module, failed tab query, failed storage
read or failed permission check remains an explicit stable error rather than a fabricated ready
snapshot.

For replacement, the background serial queue rechecks initialization, enabled seeded record,
current active tab, stored site approval and current browser exact-origin permission. It validates
the complete site document against the packaged catalog and existing byte/depth/node/tool quotas.
The caller cannot submit an origin, tab/frame ID, module ID, storage area/key, plan revision,
navigation ID or lifecycle generation. An exact revision match atomically replaces only the derived
site, advances its durable revision by one, writes before publishing, and synchronizes only sessions
for that origin. A mismatch returns the current host-derived snapshot as a conflict and performs no
write or lifecycle update. An accepted no-op replacement still advances once: it is an explicit CAS
commit and keeps the reducer's terminal semantics deterministic.

The physical module-local value becomes a schema-2 state document containing the existing validated
schema-1 settings document and an exact-key map of non-negative safe-integer per-site revisions.
Every settings site has exactly one revision and no revision exists without a site. A legacy
settings-only value is accepted as revision zero per site in memory and remains byte-untouched until
the next actual mutation. Approval creates revision zero. Explicit revoke and permission removal
delete that site's settings and revision. Disable/re-enable and worker restart retain both. Revision
exhaustion fails closed.

The trusted sidebar uses the ADR-0016 reducer. Site approval remains a separate user gesture:
prepare returns one short-lived active-tab-bound token and exact origin pattern, the extension page
requests only that pattern, then confirm rechecks the token/tab/origin/permission. Ready controls are
generated only from the three packaged descriptors. Draft edits are local; save, discard, reload and
revoke are explicit. All page-derived title/origin values use text nodes/interpolation.

## Threat model

- **Confused site deputy:** status and mutation messages contain no target. Background active-tab
  derivation and revalidation prevent a stale panel from naming another origin.
- **Lost update/restart replay:** durable per-site revisions and serialized CAS reject an old draft
  before and after MV3 worker restart. Conflict is a terminal no-write state.
- **Cross-site mutation:** the state reducer derives one origin and changes only its settings/revision;
  lifecycle sync filters the same origin. A peer site stays byte-for-byte stable.
- **Permission drift:** every status/save checks the current exact-origin browser permission. Revoke
  or permission loss removes only matching authority and uses the conservative shared-origin release
  coordinator.
- **Settings escape:** the protocol accepts only the static catalog schema and quotas. No arbitrary
  ID, selector, event, CSS, HTML, script, expression, URL or DOM command can enter storage/runtime.
- **Untrusted display content:** title and origin are bounded text only and never become HTML, a
  navigation target, CSS, a log or a remote-frame context.
- **Partial commit:** storage write completes before in-memory publish or content synchronization.
  Failure leaves the accepted state, revision and sessions unchanged.

## Rejected alternatives

- Keeping revisions only in service-worker memory.
- A global revision that makes independent origins conflict.
- Letting the UI read/write the module-local key or submit an origin/tab ID.
- Individual last-write-wins tool toggles as the product save protocol.
- Reusing content lifecycle plan revisions as storage revisions.
- Adding the Shadow DOM launcher while the trusted control plane is still under review.

## Phase boundary

Phase 7C-B adds the revisioned state wrapper/migration, two narrow management operations, a
dedicated client, trusted module-management-card controls, unit tests and a current-site Chromium
gate. It must not add a Shadow root/page launcher, page-originated permission/storage authority, a
new tool, arbitrary selector/action settings, remote-module access, static `<all_urls>`, network
behavior or legacy repository migration. Phase 7C-C remains next.

## Acceptance evidence

Accepted on 2026-09-02. Pure state, protocol, client, controller and presentation tests cover legacy
schema-1 migration without read-time writeback, strict schema-2 wrapper/revision validation,
revision-zero approval, status access projection, whole-site success/no-op/conflict/exhaustion,
storage failure, hostile text, exact preparation-origin validation, permission loss, disable/restart
retention and two-site/session isolation. The trusted card has explicit loading, unsupported,
disabled, unapproved, ready, saving, stale and error presentations; site approval remains a separate
prepare/confirm gesture and conflict never retries or overwrites automatically.

The new production Chromium gate uses two independent management pages holding the same loaded
revision. One page saves a complete finite document, the stale peer is rejected without changing the
first result, and a manual reload observes the winning state. The same scenario changes active exact
origin, returns, revokes the site, verifies packaged DOM cleanup and compares unrelated Registry,
module-local state and browser permissions. The existing two-origin/multi-tool and worker lifecycle
scenarios remain passing.

OneWeb passes typecheck, full-repository lint, all **531 unit tests**, the deterministic **20-file**
SDK package/reproducibility/export gate, a production Chromium build, all **23 Chromium E2E**
scenarios against the fresh `extension/` artifact and `git diff --check`. RepoLens remains unchanged
and passes **34 tests**, its offline **14-file** vendored-SDK gate and `git diff --check`; the
cross-repository verifier continues to report only the intentionally unsynchronized
`typedCapabilities.storage.module`/artifact drift fixed by the earlier ADR. `one-tampermonkey`
remains unmodified and read-only. Phase 7C-C is the next boundary.
