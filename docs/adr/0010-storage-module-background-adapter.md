# ADR-0010: Bind `storage.module` to one trusted-background adapter

- **Status:** Accepted (Phase 6E-C Complete)
- **Date:** 2026-08-30
- **Scope:** Narrow `storage.local` PoC only; no general storage or browser-method bridge

## Context

Phase 6E-B accepted finite `read`, whole-document `replace` and whole-document `clear` schemas,
bounded JSON-like data, host revisions and pure lifecycle/CAS rules. It intentionally did not decide
how a remote-frame session reaches persistent storage. Running a storage handler inside an extension
page would give that page direct storage authority and would not survive MV3 worker lifecycle rules.
Accepting a caller key, area, namespace or browser method would turn OneWeb into a confused deputy.

The PoC must preserve a document across worker restart while invalidating the old session. It must
also prevent a stale frame, removed installation, revoked grant or one module's concurrent writer
from reading or mutating another principal.

## Decision

Use one host-only adapter instantiated in the trusted background with an injected, fixed
`storage.local`-shaped interface. A versioned extension-only protocol has exactly three actions:
open an authenticated session binding, execute one canonical `storage.module` request, and close the
same binding. The protocol contains no physical key, prefix, storage area, next revision or arbitrary
method field.

FrameHost remains responsible for exact frame source/origin authentication. After accepting
`MODULE_HELLO`, it generates the session nonce and generation, asks the background to register that
binding, and constructs operation-specific handlers that rebuild canonical storage envelopes. The
background trusts only an extension-page sender, validates the binding again, and rechecks the
current Registry record on every request: the record must exist, be enabled, declare
`storage.module` and still grant it. A replacement session atomically invalidates the previous
binding for that module.

The physical key is derived inside the adapter from the authenticated module ID. Stored bytes use a
host-only envelope containing schema version, current installation identity (`installedAt`), opaque
revision and canonical bounded document. A different installation identity overwrites inaccessible
stale bytes with a new empty document/revision, so a failed legacy cleanup cannot leak into a
reinstall. The storage area is the adapter dependency and never data.

Each module has an independent serialized queue. Read materializes an absent installation document;
replace and clear use the accepted expected-revision CAS rule and rotate a revision generated from
host entropy. Different module queues may progress independently. Storage errors return only stable
RPC codes and never raw browser messages or stored data.

Disable, grant revocation, frame teardown and background restart invalidate session authority but do
not erase the document. Removal invalidates the session and deletes exactly the removed module's
derived record. Reinstall requires a new session and installation identity and begins empty. Update
keeps `installedAt`, so a compatible update retains the document while declaration/grant reduction
immediately blocks access.

## Threat model and rejected alternatives

- Forged module/session/generation, stale ports and replacement sessions are rejected before storage
  access; worker restart has no restored session table and therefore cannot auto-reconnect.
- Request identity and operation are canonical; payloads cannot add a key, namespace, area, method,
  other module ID or next revision.
- Per-module serialization prevents lost updates; expected revision detects stale writers. A module
  cannot consume or cancel another module's queue or authority.
- Stored records are validated and cloned before use. Malformed current-installation bytes fail
  closed; stale-installation bytes are replaced with a fresh empty state.
- Semantic secrets cannot be recognized structurally. Documents stay in local storage and never
  enter Registry records, logs, diagnostics, context bridge, DOM or another namespace.
- A content-page adapter, direct remote-frame storage access, generic `storage.get/set`, caller keys,
  a catch-all browser dispatcher and SDK-owned browser APIs are rejected.

## Consequences

Phase 6E-C adds one real capability implementation but no new browser permission: OneWeb already
uses `storage`. The public SDK retains only the Phase 6E-B pure contract; adapter, protocol, key
derivation, Registry checks and browser API dependency remain host-private. RepoLens does not consume
the capability and its vendor remains unchanged. Page Toolbox and every other capability remain out
of scope.
