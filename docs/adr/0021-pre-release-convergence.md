# ADR-0021: Sequence pre-release convergence before remote administration

- **Status:** Accepted (Phase 8 Complete)
- **Date:** 2026-09-03
- **Scope:** Protected working-tree checkpoint, repository identity ordering and `0.1.0` readiness

## Context

OneWeb and RepoLens contain intentionally uncommitted work spanning the complete Phase 0–7 product
path. The working trees are valid but too large to treat an unreviewed bulk commit as a release
checkpoint. At the Phase 8A boundary OneWeb was still hosted at `JuckZ/one-webext`; its final
pre-release project identity is `one-web`, while its product-facing name remains OneWeb.

The product is unreleased and has no users. Repository naming and the historical
`one-tampermonkey` prototype therefore create operational cleanup work, not data migration or
compatibility requirements.

## Decision

1. Phase 8A first records and verifies the protected local state. It may correct current docs and
   strengthen pre-release checks, but must not commit, reset, clean, synchronize the RepoLens vendor
   or mutate the historical repository.
2. Historical evidence is intentionally narrow: keep the Phase 7A feature audit, Page Toolbox ADRs,
   ADR-0020 and the permanent rejection of GM/remote-code/private-site/unowned-listener designs.
   Delete or correct plans for migration guides, importers, compatibility schemas, preservation tags,
   notice branches or staged legacy releases.
3. Keep the current `JuckZ/one-webext` URL and local checkout path factual until Phase 8B. Rename the
   GitHub repository first; only after the new target exists may code, remotes and current docs switch
   to `JuckZ/one-web` as one verified change. The root package, local checkout and Firefox ID follow
   the same `one-web` spelling.
4. Phase 8C archives `JuckZ/one-tampermonkey` directly. It creates no tag, branch rewrite, migration
   notice system, importer or compatibility layer.
5. Phase 8D accepts the `0.1.0` release candidate only after clean-clone dependency installation,
   builds, browser installation and complete gates succeed. Publishing remains separately
   authorized.

## Operational risks controlled

- **Unrecoverable local loss:** document both HEADs and working-tree scope; do not use destructive Git
  commands or assume the uncommitted state can be reconstructed from `HEAD`.
- **Dead-link window:** do not update homepage, Logo or docs before the GitHub rename succeeds.
- **Review collapse:** propose semantic commits and stage shared integration files by hunk rather than
  committing the complete multi-phase diff as one change.
- **False compatibility burden:** distinguish immutable engineering evidence from a supported legacy
  product or user-data contract.
- **Vendor ambiguity:** retain RepoLens's reviewed 14-file offline artifact and keep the known
  `typedCapabilities.storage.module` drift explicit until a separately scoped consumer decision.

## Phase boundary

Phase 8A changes only current documentation and narrowly related pre-release verification. It does
not add a module, tool, capability, permission, runtime path or compatibility behavior. It performs
no GitHub rename, repository archive, package publication, version release or RepoLens vendor sync.

The exact working-tree inventory, proposed commit sequence and Phase 8B–8D runbooks live in
[`../checkpoints/phase-8a-pre-release.md`](../checkpoints/phase-8a-pre-release.md).

## Acceptance evidence

Accepted on 2026-09-03. Stale positive tag, migration-notice and GM-settings export plans were
removed, while the Phase 7A audit, clean-room Page Toolbox architecture and permanent rejection list
remain. The root package identity is `one-web`, the Firefox ID is `one-web@juckz.local`, and the
build-integrated scan now includes package metadata plus 25 Page Toolbox source/artifact files.

OneWeb passes typecheck, full-repository lint, **558/558 unit tests**, the reproducible **20-file SDK**
gate, production Chromium build, **24/24 Chromium E2E**, production Firefox build, strict manifest
validation with **0 errors / 0 notices / 0 warnings**, the **1/1 real Firefox lifecycle gate** and
`git diff --check`. RepoLens passes **34/34**, its offline **14-file vendor** gate and
`git diff --check`; its accepted `typedCapabilities.storage.module` artifact drift remains explicit.
The historical repository remains clean at `448bf86d031881b3df687a6bcda416acd39307fa` with no tags.
No commit, vendor sync, GitHub rename, archive or release was performed. Phase 8B is next.

## Phase 8B naming supplement

Accepted on 2026-09-03 after explicit user authorization. The final technical project spelling is
`one-web`, not `oneweb`: GitHub repository `JuckZ/one-web`, local checkout directory `one-web`, root
package `one-web` and Firefox ID `one-web@juckz.local`. Product display name `OneWeb`, protocol
identifier `oneweb.module`, module IDs and private SDK scope `@oneweb` remain unchanged because they
are product/protocol identities rather than repository paths. The remote was renamed before any live
link or local path was changed.

## Phase 8C archive supplement

Accepted on 2026-09-03 after explicit user authorization. `JuckZ/one-tampermonkey` is archived
directly at the audited commit. Its local checkout remains clean and no tag, notice branch, migration
document, importer, compatibility release or source change was added. Phase 8D is the only active
stage.

## Phase 8D release-candidate supplement

Accepted on 2026-09-03 after explicit user authorization. The first clean-clone attempt exposed an
empty Chromium ZIP caused by a non-recursive `extension/*` packaging command. That artifact was
rejected, the command was replaced with the reviewed `web-ext build` path, and all acceptance work
was restarted from a new clone of commit `b5055864de36c058203ffc16111a209a4a7b06c9`.

The new clone passed frozen install, typecheck, lint, **558/558 unit tests**, the reproducible
**20-file SDK** gate, both production builds and identity scans, **24/24 Chromium E2E**, Firefox
manifest validation with **0 errors / 0 notices / 0 warnings**, and the **1/1 real Firefox gate**.
Both final browser archives passed integrity, identity, dependency, absolute-path, development-file,
secret-marker and rejected-runtime inspection. RepoLens retained its reviewed offline vendor and
reproduced its accepted drift. Phase 8 is complete; an RC tag may identify the accepted commit, but
no GitHub Release, store submission or formal release is authorized by this decision.
