# ADR-0004: Browser Journal archive review stays local, bounded and selection-only

- **Status:** Accepted
- **Date:** 2026-08-29
- **Scope:** Browser Journal packaged archive-review experience only

## Context

Phase 5B proves explicit local retention, but its first UI expands every saved session and only shows
the first ten entries from each. With ten sessions of up to 100 entries, that view is both noisy and
incomplete. The product question for Phase 5C is whether the existing bounded archive can become
usefully reviewable without adding a search database, new protocol authority or data movement.

Titles and URLs remain sensitive even though they were explicitly saved. Search, export, summaries
and synchronization would create new indexes, derived content or disclosure paths. They are not
necessary to test the value of reviewing at most ten locally retained sessions.

## Decision

Phase 5C adds a pure local presentation and selection model over the existing archive:

- Sessions are presented newest-first with entry count, recording range, save time and exact
  seven-day expiry derived from existing normalized fields.
- The packaged page keeps one selected saved-session ID in memory. A valid selection survives local
  rerender; a missing, deleted or pruned selection falls back to the newest remaining session.
- The archive index stays compact. Only the selected session is expanded, and its complete already
  bounded set of at most 100 entries is rendered as text.
- Saving selects the newly saved session. Deleting the selected session chooses the newest remaining
  session; clearing produces an empty state. Disabled mode retains the same review/delete surface
  without restoring any tab listener.
- Selection is not persisted and is never sent to the background except when the user invokes the
  existing identifier-only delete operation. Protocol version 2, schema version 1 and archive
  mutations remain unchanged.

No search, filtering index, export, summary, sync, history import, recording restoration, automatic
save or background timer is authorized.

## Threat model

Risks are rendering all retained sensitive text at once, treating a stale selection as authority,
reviving deleted content during rerender, creating executable DOM from saved fields or silently
turning review state into a new persistent profile. Controls are a pure immutable projection, one
ephemeral selection, archive-authoritative reconciliation, strict count bounds and text-node-only
rendering. The background remains authoritative for normalization, expiry and deletion.

## Consequences

- Users can inspect every entry in one deliberately saved session without an incomplete ten-entry
  preview or a page containing the full ten-session archive at once.
- Page or worker restart defaults to the newest retained session; no cross-device or long-lived UI
  preference is implied.
- Search, export, summaries and synchronization remain separate product/security decisions.

## Acceptance evidence

Pure presentation tests verify empty state, newest-first ordering, exact seven-day expiry, valid and
stale selection, immutable cloned output and hostile text. Packaged UI tests verify a compact index,
one selected detail, all 12 fixture entries rather than a ten-entry preview, explicit selection,
delete fallback, clear and disabled review.

Real Chromium creates two explicit saved sessions, defaults to the newest, selects the older session,
restarts the worker, deletes the older session, retains the newer session while disabled and keeps
all other module records, namespaces and origin permissions unchanged. Saved text remains inert.

At acceptance, typecheck, full-repository lint, all 321 unit tests, the production Chromium build,
all 16 Chromium E2E scenarios and `git diff --check` pass.
