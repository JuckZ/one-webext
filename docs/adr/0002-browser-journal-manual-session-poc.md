# ADR-0002: Browser Journal starts as a manual memory-only session

- **Status:** Accepted
- **Date:** 2026-08-29
- **Scope:** Phase 5A candidate decision and proof of concept only

## Context

OneWeb has four remaining candidate modules. Header Rules needs privileged declarative network
mutation; Socket Inspector needs a sensitive, browser-coupled developer surface; Privacy Cleaner
performs potentially irreversible browsing-data deletion. Browser Journal can answer a narrower
product question using the host's existing tab lifecycle: can a user explicitly record one browsing
session without creating a permanent history collector?

The legacy home prototype reads browser history and recently closed sessions. It is evidence of a
possible workflow, not a contract to migrate. Importing it would require broader permissions and
would mix pre-existing history with a session that the user deliberately starts.

## Decision

Phase 5A selects Browser Journal as the only implementation candidate and limits it to a packaged
`builtin` manual-session PoC:

- Recording starts and stops only through explicit actions in the trusted packaged management page.
- The trusted background observes active-tab activation and navigation only after start. It never
  queries browser history, recently closed sessions or events from before the start.
- Incognito tabs and non-HTTP(S), credential-bearing or malformed URLs are excluded. URLs lose their
  fragment and titles/URLs are length-bounded before entering the model.
- Consecutive equivalent entries are collapsed and the session retains at most 100 normalized
  entries, discarding the oldest first.
- Session authority and entries exist only in service-worker memory. Worker startup, module disable
  or lifecycle cancellation returns to stopped with no entries or listener. An ordinary user stop
  detaches observation but keeps the current ephemeral list until the next start or worker restart.
- The UI can request start, stop and status only. It cannot submit a tab event, URL, title, path or
  entry. Every displayed value is untrusted text.
- Journal data never enters extension storage, module Registry records, namespaced module state,
  logs, URLs, the generic context bridge, remote frames or another builtin's controller.

The PoC reuses the manifest's existing `tabs` permission. It does not request `history`, `sessions`
or a generic observation/network capability, and it does not imply background-resident or durable
collection.

## Threat model

Sensitive inputs are active-tab titles and URLs. The main risks are collecting without a current
gesture-backed session, including private windows, persisting more than the user expects, leaking
entries across module boundaries, accepting forged entries from a page, and retaining listeners
after stop or lifecycle invalidation.

The background controller is the sole authority for event ingestion and owns listener attachment.
Trusted management-page sender validation protects the narrow protocol. Normalization, capacity and
deduplication are pure and testable. Lifecycle hooks synchronously invalidate recording authority
before returning. MV3 worker memory loss is a security property for this phase, not a recovery error.

## Consequences

- Phase 5A can validate the interaction and privacy boundary without a retention database or new
  browser permission.
- Refreshing or suspending the worker may lose the current session, which the UI must describe as
  stopped rather than attempting recovery or automatic recording.
- Durable retention, history import, search, export, summaries and synchronization require a later
  accepted ADR covering finite retention, deletion, storage protection and any additional permission.
- This decision does not authorize Header Rules, Socket Inspector or Privacy Cleaner.

## Acceptance evidence

Pure model, controller, protocol, event-source, UI and cross-principal tests prove normalization,
incognito/inactive/malformed exclusion, duplicate and 100-entry limits, listener ownership, trusted
request shape, disable/permission invalidation and worker-start behavior. The Chromium scenario
records only after start, renders hostile title text without executable DOM, stops without accepting
later navigation, audits extension/local/session storage, reloads the worker to stopped/empty and
preserves RepoLens, Bookmark Doctor, Clash Control and two installed remote modules.

At acceptance, typecheck, full-repository lint, all 304 unit tests, the production Chromium build,
all 15 Chromium E2E scenarios and `git diff --check` pass. Phase 5B remains a separate product and
retention decision.
