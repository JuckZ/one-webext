# ADR-0015: Page Toolbox dual-site and multi-tool isolation gate

- **Status:** Accepted (Phase 7B-D Complete)
- **Date:** 2026-09-01
- **Scope:** Conformance evidence for two origins, multiple tools and unrelated OneWeb principals

## Context

ADR-0014 accepts three reversible packaged tools and proves each behavior on one exact origin.
Before adding a product UI or more tools, OneWeb must prove that the common controller, protocol,
generation model, DOM ownership state and resource ledger remain isolated when two sites and
several tools are live simultaneously. This phase must not acquire new authority to make the test
easier.

## Decision

Phase 7B-D is a test-first hardening gate with these fixed invariants:

1. Two normalized exact HTTP(S) origins have independent site documents, browser grants, tabs,
   authenticated ports, session nonces, navigation IDs, generations and plan revisions. The host
   still derives every identity from the active tab and authenticated sender.
2. Each active tool has a separate derived binding, seven-state reducer, resource ledger and shared
   ownership token chain. A settings update publishes only that origin's canonical site document;
   enable/disable of one tool leaves peer tools active.
3. Port failure, stale acknowledgement, malformed plan, DOM ownership replacement, navigation,
   revocation and module disable are first-terminal-wins. Cleanup is best effort but cannot remove or
   restore a resource owned by a newer generation, peer tool or page.
4. Revoking one Page Toolbox site removes only that site entry and sessions. Its exact permission is
   released only if no packaged builtin or installed remote record uses the same origin. Probe
   failure retains permission conservatively.
5. Before/after evidence snapshots every unrelated builtin and two installed remote module records,
   grants, update candidates and timestamps; protected namespaced state; browser permissions; and
   all extension storage outside the intentional Page Toolbox/Registry keys.

The reusable unit harness must provide two host ports and two DOM documents. Chromium must approve
two different fixture origins, enable different overlapping tool sets, update them independently,
replace one navigation, inject a one-side failure and revoke one side while the peer continues to
work. The fixture code remains ordinary untrusted page content and never enters the extension
execution environment.

## Threat model

- **Cross-origin plan replacement:** a caller cannot name an origin; current-tab derivation and
  authenticated session binding ensure a plan for origin A is never posted to origin B.
- **Shared mutable coordinator state:** plan revision is stored per host session, generation is bound
  to the tab/navigation, and settings are keyed by normalized origin. Tests compare the peer state
  after every operation.
- **Cross-tool cleanup:** shared DOM ownership records contain the current token plus the original
  page prior value. Older ledgers skip newer ownership; the final owner restores the root prior.
- **Failure fan-out:** a throw or disconnect is caught at its session/tool boundary. It cannot clear
  another port, ledger, timer, observer or site entry.
- **Permission collision:** shared-origin remote/builtin users retain the browser grant even after
  Page Toolbox revocation; unrelated origins are never included in a remove request.
- **Evidence blind spots:** both logical records and physical storage/permission snapshots are
  compared, including timestamps and update metadata, so isolation cannot be claimed from DOM state
  alone.

## Rejected alternatives

- Adding a multi-site UI, Shadow DOM surface or settings editor for the test: deferred to Phase 7C.
- Adding debug messages or a generic DOM inspection bridge: this would expand production authority.
- Sharing a single plan revision across tabs/origins: one site could invalidate another's command.
- Clearing all Page Toolbox sessions on one-site failure: violates per-binding isolation.
- Releasing an exact origin without checking builtin and remote users: may break another principal.

## Phase boundary

Phase 7B-D may add reusable two-origin fixtures, isolation assertions and the smallest production
fix required by a failing gate. It must not add tools, settings schema, browser permission, runtime
message, management UI, Shadow DOM, network behavior, legacy migration or repository retirement.
Phase 7C remains out of scope until this gate is complete.

## Acceptance evidence

The controller harness runs two authenticated host ports and proves site-specific plan updates,
stale acknowledgement teardown, continued peer updates and one-origin revocation preserve the
second session, generation, plan revision, state and permission. The DOM harness runs overlapping
tools in two documents, injects a page-owned style replacement, contains failure to that tool and
drains one document without modifying the other.

The real Chromium gate installs two remote modules on distinct origins, approves both Page Toolbox
sites, runs overlapping three-tool plans, updates and navigates only one side, preserves a
page-owned replacement, revokes one site while the other remains interactive, and finally disables
the builtin to drain the peer. Registry records, grants, update metadata, timestamps, module-local
state, browser permissions, remote request counts and all non-Page-Toolbox storage remain identical.

At acceptance OneWeb passes typecheck, full-repository lint, all 496 unit tests, the deterministic
20-file SDK package/export gate, production Chromium build, all 22 Chromium E2E scenarios and
`git diff --check`. No production runtime, catalog, protocol or permission change was needed beyond
Phase 7B-C. RepoLens remains on its protected 34-test/14-file offline vendor baseline with the
documented expected SDK drift; `one-tampermonkey` remains clean and read-only.
