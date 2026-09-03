# ADR-0003: Browser Journal retention is explicit, bounded and local

- **Status:** Accepted
- **Date:** 2026-08-29
- **Scope:** Browser Journal completed-session retention only

## Context

Phase 5A proves that OneWeb can safely observe one explicitly started active-tab session without
history access or persistent collection. It intentionally loses the session when the MV3 worker is
restarted. That behavior protects users from implicit logging, but it also means an intentionally
recorded result cannot be reviewed later.

Durability changes the privacy boundary. Active-tab titles and URLs can reveal interests, accounts
and private resources even without cookies or page bodies. A useful next step therefore needs a
finite retention contract, data minimization, explicit deletion and no route to remote modules.

## Decision

Phase 5B permits only explicit local saving of the current stopped, non-empty session:

- The trusted background owns the session and constructs the saved projection. The UI submits no
  entry, title, URL, tab/window identifier, retention duration or storage key.
- A saved entry contains only activation/navigation kind, occurrence time, bounded title and the
  already canonicalized HTTP(S) URL. Tab/window IDs, live session ID and recording authority are not
  retained as journal content.
- State uses schema version 1 under `oneweb.module-state.v1:dev.oneweb.browser-journal`. It contains
  at most ten saved sessions and at most 100 entries per session.
- A saved session expires seven days after its save time. Expired or malformed records are pruned on
  worker startup and archive read/mutation; Phase 5B adds no alarm or persistent background job.
- Stop, disable, shutdown and worker suspension never auto-save. Worker startup remains stopped and
  does not resume capture.
- The user can delete one saved session or explicitly confirm clearing all saved sessions. Disabling
  the module clears ephemeral authority but keeps deliberately saved data available for review and
  deletion.
- The controller serializes save/delete/clear. Storage failure leaves live session authority and
  every Registry record, permission and other module namespace unchanged.

No new browser permission is required. The decision does not permit browser-history import,
`history`/`sessions`, active-session persistence, automatic capture/save, search, export, summary,
notification or synchronization.

## Threat model

The primary risks are silent persistence, forged page-supplied records, unbounded accumulation,
stale UI operations, malformed old state, cross-module disclosure and deletion that is incomplete or
ambiguous. The mitigation is an input-free save operation over a background-owned stopped snapshot,
strict normalized projection, count/time bounds, one dedicated namespace, serialized mutations and
stable failures. Delete accepts only a bounded saved-session identifier; clear-all requires an exact
confirmation literal.

Saved text remains untrusted. It is returned only to the packaged management page and inserted with
text nodes. It cannot enter generic context messages, remote frames, logs, URLs, page storage or
another builtin controller.

## Consequences

- An explicitly saved session survives worker restart; an unsaved or active session still does not.
- Seven-day expiry is enforced when the worker starts or the archive is accessed, not by a new timer.
- Disabling is reversible and does not silently destroy saved data; users retain explicit deletion.
- Search, export and longer/configurable retention require another decision because they widen data
  exposure or accumulation.

## Acceptance evidence

Pure state/projection tests verify schema-v1 normalization, saved-entry minimization, malformed and
expired record pruning, the ten-session/100-entry limits and stable ordering. Controller and protocol
tests verify input-free save, duplicate save, serialized delete/clear, storage failures,
disable-during-write cancellation and payload validation. Packaged UI tests verify disabled archive
access, explicit clear confirmation and hostile text remaining inert.

Real Chromium verifies that stop alone writes nothing, explicit save survives worker restart without
live identifiers, saved content remains safe text, one session can be deleted, clear-all requires
confirmation and disabling retains only the deliberate archive. RepoLens, Bookmark Doctor, Clash
Control and two installed remote modules keep their records, namespaces and origin permissions.

At acceptance, typecheck, full-repository lint, all 316 unit tests, the production Chromium build,
all 16 Chromium E2E scenarios and `git diff --check` pass.
