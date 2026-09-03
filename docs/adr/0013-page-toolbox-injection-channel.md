# ADR-0013: Page Toolbox exact-origin injection and lifecycle channel

- **Status:** Accepted (Phase 7B-B Complete)
- **Date:** 2026-08-31
- **Scope:** Exact-origin permission coordination, fixed packaged injection and an empty-tool authenticated lifecycle channel

## Context

ADR-0011 fixes Page Toolbox as one default-off packaged builtin and ADR-0012 fixes its pure
descriptor, settings, binding, lifecycle and resource-ledger model. Phase 7B-B must reach a real
top-frame document without turning optional host access into static all-sites execution, allowing a
remote module to inject code, or carrying stale authority across navigation and MV3 worker restart.

The two practical MV3 choices are persistent `scripting.registerContentScripts` registrations and
explicit `scripting.executeScript`. Both require the `scripting` API permission. A persistent
registration adds a second browser-owned authorization inventory that must be migrated and removed
across disable, revocation and extension updates. Explicit injection keeps the current Registry,
module-local settings, browser optional host permission and live port as the complete authority and
can be reconciled per navigation.

## Decision

Use a narrow Chromium/Firefox adapter around `scripting.executeScript`:

1. The adapter contains one constant packaged file path. It accepts only a validated numeric tab ID
   and always targets frame `0` in the isolated world. It has no function, code, argument, URL,
   caller-selected file, `allFrames` or MAIN-world escape hatch.
2. Add `scripting` to the extension's required API permissions. This permits use of the injection
   API but grants no website. Actual page authority still requires a user-approved optional
   `http://origin/*` or `https://origin/*` exact-origin permission. Static `<all_urls>` and static
   Page Toolbox content matches remain absent.
3. Seed the ordinary protected, disabled `page-toolbox` packaged entry through the generic Registry
   path. Persist only the validated finite Page Toolbox settings document in its existing
   module-local namespace. An empty site entry records explicit approval during 7B-B; no tool is
   enabled until 7B-C.
4. A trusted extension-page request prepares only the browser's current active tab; callers cannot
   submit an origin, URL, tab/frame identity, file or script. Confirmation is bound to a short-lived
   preparation token and succeeds only after the exact permission is independently present. Site
   revocation removes that site's local entry, invalidates its sessions and conservatively releases
   the exact permission only when no other builtin or installed remote module uses it.
5. The injected runtime opens the dedicated named extension port and emits one bounded high-entropy
   HELLO challenge. The background accepts only its own extension sender, a real tab, frame `0`, a
   normalized HTTP(S) sender URL and the same current tab origin. It then rechecks the enabled seed,
   validated local site entry and browser exact-origin permission before returning INIT with the
   echoed challenge, a fresh memory-only session nonce, navigation identity and generation.
6. The content runtime accepts one matching INIT and replies READY. The only other host command is
   DISPOSE and the only content terminal acknowledgement is DISPOSED. Every envelope is versioned,
   exact-key validated and bound to the canonical module/session/navigation/generation identity.
   No page `postMessage`, context bridge, typed capability RPC, generic runtime message, DOM
   command, selector, settings payload or tool behavior crosses this channel.
7. Disable, exact-origin removal, cross- or same-origin navigation, tab removal, port loss and
   extension/worker restart invalidate the affected memory authority. Startup may query existing
   tabs and reinject a new generation only after all current checks pass. No automatic permission
   prompt or persistent content registration occurs.

## Threat model

- **Confused deputy / arbitrary injection:** callers cannot choose target origin, tab, frame, file,
  function, world or arguments; preparation derives the active top-frame URL and confirmation is
  digest-like token-bound to it.
- **Overbroad site access:** `scripting` is not sufficient without the exact optional host grant,
  enabled builtin and local site entry. Wildcard stored site grants and `<all_urls>` are rejected.
- **Page or remote-module forgery:** normal page JavaScript has no extension port. Sender extension
  ID, tab, frame, URL and current tab are checked; remote-frame code cannot select the port or the
  packaged entry through its manifest, context bridge or RPC catalog.
- **Replay and stale authority:** HELLO challenge, session nonce, navigation identity and generation
  are memory-only and exact-bound. Duplicate INIT/READY, wrong identity and late messages are
  ignored or disconnect the offending session. Restart creates a new nonce authority.
- **Navigation race:** both sender URL and a fresh tab lookup must match the approved exact origin;
  tab updates invalidate the old port before reinjection after the next complete navigation.
- **Permission release collision:** the builtin origin coordinator and installed remote-module URL
  scan retain a grant used by another principal. Probe/read failure retains permission
  conservatively.
- **Protocol growth:** exact validators reject unknown keys and message types. The empty-tool 7B-B
  runtime has no DOM mutation, data capture, HTML rendering, fetch or browser capability.

## Rejected alternatives

- Persistent `registerContentScripts` registrations: unnecessary second durable authority and more
  difficult revocation/restart reconciliation for this manual default-off product.
- A static all-sites content script or `<all_urls>` host permission: violates explicit site consent.
- `tabs.executeScript`, MAIN-world functions, caller-selected files or code strings: obsolete or
  create an injection escape hatch.
- Page `postMessage`, generic DOM commands or reuse of the remote-frame bridge: exposes the packaged
  page authority to untrusted page/remote data.

## Phase boundary

Phase 7B-B may seed Page Toolbox, store empty approved site entries, add the reviewed `scripting`
permission, inject the fixed empty-tool runtime and prove lifecycle teardown. It does not implement
password visibility, free-page edit, selection/copy release or any other tool; does not add Shadow
DOM or per-site product UI; and does not change RepoLens, its vendor, or `one-tampermonkey`.

Phase 7B-C remains the first tool PoC stage.

## Acceptance evidence

The implementation uses a dedicated 5.88 KiB production content artifact and the built-manifest
gate proves it is not statically registered. Artifact inspection proves the runtime contains the
named Page Toolbox lifecycle port but no `executeScript`, storage, permission request, fetch,
remote-frame handshake or management-protocol route. Unit coverage includes exact envelope and
accessor rejection, fixed-file/frame injection, runtime init/dispose races, token expiry/navigation,
sender/frame/origin authentication, two-tab generation isolation, permission removal, disable,
startup reconciliation, malformed state and bidirectional builtin/remote origin retention.

At acceptance, OneWeb passes typecheck, full-repository lint, all 481 unit tests, the reproducible
20-file SDK package/export gate, production Chromium build, all 20 Chromium E2E scenarios and
`git diff --check`. RepoLens remains unchanged and passes all 34 tests plus its offline 14-file
vendor gate; its pre-existing `typedCapabilities.storage.module`/artifact drift remains the only
cross-repository diagnostic. `one-tampermonkey` remains unmodified, clean and read-only at
`448bf86d031881b3df687a6bcda416acd39307fa`.
