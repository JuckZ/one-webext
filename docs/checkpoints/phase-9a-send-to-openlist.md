# Phase 9A Send to OpenList API and contract checkpoint

Date: 2026-09-03

## Frozen starting point

Phase 9 is post-RC work on `codex/phase-9a-openlist-contract`. Annotated tag `v0.1.0-rc.1` still
resolves to `b5055864de36c058203ffc16111a209a4a7b06c9`; its Chromium/Firefox archives and Phase 8D
evidence are not inputs to this branch and must not be rewritten.

At entry, OneWeb was clean at `96f7d05440b5a9559cf956f742e2097f9bb271e1`. RepoLens retained its
protected uncommitted work and reviewed 14-file SDK vendor. `one-tampermonkey` remained clean and
archived at `448bf86d031881b3df687a6bcda416acd39307fa`. None of those protected states is migrated or
cleaned by Phase 9A.

## API audit snapshot

The current release and source evidence is pinned in
[`ADR-0022`](../adr/0022-send-to-openlist-resource-inbox.md). The compatibility result is:

- raw `Authorization` token, not a caller-selected scheme or header;
- host-generated stable `Client-Id` for current AList device-session compatibility;
- common fixed endpoint paths for identity, tool discovery, one-item add, undone/done task lists and
  one-task cancel;
- path-aware tool discovery in OpenList versus ready-tool discovery in AList;
- one URL per OneWeb add despite the upstream array shape, because upstream processing can partially
  succeed before returning an error;
- no task-list pagination in either pinned handler, requiring response limits rather than invented
  page parameters;
- HTTP transport 200 can carry an application error code;
- successful direct `SimpleHttp` handling can return no task ID;
- server messages, tool names, paths and tasks are untrusted data, not stable enums or UI markup.

## Phase 9 plan

- **9A — API compatibility audit, product contract and threat model — Complete.** Documentation plus
  pure profile/candidate/command/result/lifecycle models only.
- **9B — Trusted connector and single-profile PoC.** Exact-origin permission, local secret record,
  fixed endpoint adapter, identity check, tool discovery and one-item adds with concurrency two,
  tested only against hostile local fixtures before any product UI.
- **9C — Manual submission and task-management MVP.** One active profile, manual paste,
  destination/tool review, per-item outcomes, explicit task refresh and reviewed cancellation; no
  polling, retry or persistent queue.
- **9D — Browser resource entry points.** User-gesture context menus, current page and temporary
  top-frame scan through existing `activeTab + scripting`; deduplication, quotas, text safety and
  SSRF presentation; no site-private adapter or resident content script.
- **9E — Cross-browser, dual-service and module-isolation gate.** Chromium/Firefox plus pinned
  OpenList/AList fixtures, lifecycle/permission/worker restart, secret non-disclosure, two-origin
  isolation and unchanged RepoLens/other builtins/remote modules.

## Phase 9A exit criteria

- The roadmap, architecture and ADR contain the maintenance boundary, API evidence, complete threat
  model, SSRF decision, lifecycle semantics, non-goals and 9A–9E stages.
- Pure models reject arbitrary origin/path/method/header/identity input, unsafe schemes, credentials,
  malformed and oversized data, stale generations and over-quota batches.
- Signed HTTP(S) queries remain byte-for-byte unchanged while fragments are removed.
- Literal and syntactically suspicious local-use targets are classified and cannot enter a canonical
  submission command; DNS/redirect risk remains explicitly server-owned.
- Unit tests cover normalization, deduplication, quotas, immutable clones, state races and instance
  isolation without any browser/chrome, DOM, network, storage or secret dependency.
- OneWeb proportional gates and RepoLens offline protection pass; no vendor sync or archived-repo
  modification occurs.

## Delivered pure model

`src/modules/builtin/send-to-openlist/` now fixes only browser-independent data authority:

- strict, immutable non-secret profile arrays and exact HTTP(S) origin normalization;
- candidate normalization that removes only HTTP(S) fragments, preserves signed query bytes,
  creates non-authoritative stable IDs, deduplicates and enforces discovery/submission quotas;
- explicit hostname, canonical IPv4/IPv6 and opaque-protocol SSRF classifications, with local-use
  hard blocks separated from server-owned DNS/redirect/peer-protocol policy;
- canonical fixed-operation commands that have no method, endpoint, header, Authorization or generic
  request escape hatch, plus dynamic reviewed-tool and reviewed-task binding;
- bounded tool/task response projection and stable message-free errors;
- a two-in-flight submission reducer with first-terminal-wins and `outcome-unknown` for interrupted
  dispatched writes;
- a two-minute, single-use cancel review plan bound to exact authority, generation, latest undone
  snapshot and reviewed task.

The directory is not imported by the Registry, background, UI or browser manifest. It performs no
network, permission, storage, DOM or browser/chrome operation and handles no real token.

## Exit evidence

The completed post-edit gate is:

```text
OneWeb pnpm typecheck                                      pass
OneWeb pnpm lint                                           pass
OneWeb pnpm test                                           623 / 623 (65 Phase 9A)
OneWeb pnpm verify:module-sdk                              reproducible 20-file package
OneWeb pnpm build                                          Chromium production + identity gate
                                                            28 production files
OneWeb EXTENSION_PATH="$PWD/extension" pnpm test:e2e       24 / 24 Chromium
RepoLens pnpm check                                        34 / 34 + offline 14-file vendor
RepoLens pnpm verify:oneweb-vendor                         offline 14-file vendor pass
Both writable repositories git diff --check                pass
```

The first Chromium command intentionally omitted the documented `EXTENSION_PATH`, selected the old
checked-in `artifacts/chromium` directory and failed its manifest identity assertion. After the
Playwright Chromium runtime was restored, the required explicit production path above passed all 24
scenarios. No product source was changed in response to that stale-artifact diagnostic.

RepoLens's cross-repository verifier continues to fail only on the ADR-accepted unsynchronized
`typedCapabilities.storage.module` contract/artifact drift. Its production code and 14-file vendor
were not modified. `one-tampermonkey` remains clean at `448bf86d031881b3df687a6bcda416acd39307fa`
and GitHub reports it archived. The frozen RC archives retain SHA-256
`0f5e3b0f30166e3e792646f2a13cb8892629e9820b5134a23cc5ad034208fa60` (Chromium) and
`28500594902fde401f824ae0838e390988243fcf3c83cad515d6a8738d14b1a3` (Firefox).

## Status

**Complete (2026-09-03).** Work remains uncommitted on
`codex/phase-9a-openlist-contract`; `v0.1.0-rc.1` still resolves to
`b5055864de36c058203ffc16111a209a4a7b06c9`. Phase 9B, the trusted connector and
single-profile PoC against local OpenList/AList fixtures, is next and requires separate execution.
