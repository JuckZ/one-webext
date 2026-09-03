# ADR-0012: Page Toolbox pure runtime and resource ledger

- **Status:** Accepted (Phase 7B-A Complete)
- **Date:** 2026-08-31
- **Scope:** Pure data validation, generation lifecycle and abstract cleanup accounting only

## Context

Phase 7A fixed Page Toolbox as one default-off packaged builtin whose tools run only in a
user-approved exact HTTP(S) top frame and are selected by a static packaged descriptor/schema
allowlist. The legacy userscript demonstrates why cleanup cannot depend on feature discipline: it
loses listener identities, timers, prior DOM values and lifecycle authority.

Before exact-origin injection or tool code exists, OneWeb needs a browser- and DOM-independent model
that can be fuzzed and reasoned about without granting page authority. Phase 7B-A therefore cannot
import or call browser/chrome APIs, global DOM types, content registration, ModuleFrameHost,
Registry, dispatcher, UI or page code.

## Decision

Implement Page Toolbox contracts under one builtin-local source boundary:

1. Validate and canonically clone immutable `PageToolDescriptorV1` values. The descriptor fixes
   exact-origin applicability, exact-origin grant, top frame, isolated world, default off, finite DOM
   access declarations and a static settings schema ID/version. It contains no source, selector
   program, URL, browser method, message name or executable value.
2. Validate the complete settings document atomically: at most 64 normalized exact origins, 16
   unique tools per site, 2 KiB canonical JSON per tool settings value, 8 KiB per site, 64 KiB total,
   depth 8 and 1,024 nodes. Schema validation is injected only as a static host-owned catalog keyed
   by descriptor ID/schema ID/version. Unknown tools/schemas and non-JSON values fail closed.
3. Validate and clone one runtime binding over module ID, tool ID, exact origin, tab, top frame,
   navigation and positive generation. Binding identity is canonical and cannot be replaced by a
   lifecycle command.
4. Reduce only the seven Phase 7A states: `inactive`, `applying`, `active`, `updating`, `disposing`,
   `disposed`, `failed`. Commands and completions must match the current binding/generation and
   operation token. Apply/update/dispose are idempotent, updates publish settings atomically, the
   first terminal cause wins, and late or cross-generation completion has no authority.
5. Define an abstract resource ledger for listener, timer, observer, abort, owned node/style and DOM
   prior-value restoration entries. Disposal drains entries exactly once in reverse registration
   order. Restoration receives an ownership predicate and may restore only when the current value is
   still owned; detached or externally replaced values are skipped rather than overwritten.

The production contract depends only on pure injected callbacks. A test adapter may use strings and
plain objects to prove ordering, ownership and failure behavior; it is not a DOM implementation and
is not bundled into the extension runtime.

## Threat model

- **Code/data confusion:** functions, symbols, accessors, prototypes, scripts, selectors/actions,
  URLs and arbitrary messages are rejected or removed by canonical JSON cloning.
- **Authority substitution:** origin, module, tool, frame, navigation and generation are validated as
  one binding; commands cannot submit replacement identity.
- **Quota bypass:** byte, depth and node limits apply to canonical UTF-8 JSON, including structural
  keys, before state publication. Duplicate normalized origins/tool IDs are rejected.
- **Stale work:** wrong generation/token, duplicate completion, completion after dispose and
  concurrent terminal causes cannot mutate accepted state.
- **Partial update:** candidate settings remain separate until update succeeds; failure preserves the
  last active snapshot or proceeds to terminal disposal without publishing a partial value.
- **Cleanup collision:** reverse-order, exactly-once draining and ownership checks prevent a stale
  tool from overwriting newer page or peer-tool changes.
- **Cross-instance cleanup:** each ledger is bound to one immutable binding; entries and disposal
  results cannot be transferred between origins, tools or generations.

## Phase boundary

Phase 7B-A adds only pure contracts, reducers, a pure resource adapter and unit tests. It does not
modify the extension manifest or permissions, background dispatcher, ModuleFrameHost, Registry,
management UI, content scripts, site permissions, RepoLens vendor or `one-tampermonkey`. Exact-origin
permission coordination and page lifecycle messaging begin only in Phase 7B-B; real tools begin only
in Phase 7B-C.

## Acceptance evidence

The implementation is confined to `src/modules/builtin/page-toolbox/` and has no browser/chrome,
DOM-global, injection or host-runtime import. Thirty-one focused tests cover canonical descriptor,
settings and binding validation; every quota; hostile/accessor input; cross-origin/tool/generation
authority; duplicate and concurrent lifecycle commands; rollback, terminal and late completion;
reverse cleanup, ownership replacement, adapter failure and ledger-instance isolation.

At acceptance, OneWeb passes typecheck, full-repository lint, all 461 unit tests, the reproducible
20-file SDK package/export gate, production Chromium build, all 19 existing Chromium scenarios and
`git diff --check`. RepoLens is unchanged and passes its 34 tests plus offline 14-file vendor gate;
its expected unsynchronized `typedCapabilities.storage.module`/artifact drift remains explicit. The
legacy repository is unchanged and clean at `448bf86d031881b3df687a6bcda416acd39307fa`.

Phase 7B-B subsequently completed under ADR-0013. Phase 7B-C is now the next boundary. This
decision still does not itself authorize tool PoCs, Shadow DOM UI or later work.
