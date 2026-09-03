# ADR-0020: OneWeb starts clean without a legacy migration product

- **Status:** Accepted (Phase 7D local cleanup complete)
- **Date:** 2026-09-03
- **Scope:** Pre-release identity cleanup and `one-tampermonkey` historical boundary

## Context

OneWeb is a new, unreleased product with no users to migrate. Phase 7A audited
`one-tampermonkey@448bf86d031881b3df687a6bcda416acd39307fa`, and Phase 7B/7C implemented three
accepted ideas as clean-room Page Toolbox tools. No old code, setting, storage schema or runtime was
made compatible with OneWeb.

The earlier retirement plan incorrectly treated the prototype as an installed legacy product. Its
migration guide, notice-only branch, preservation tag and staged retirement workflow would create
process and compatibility obligations for users who do not exist. That work is unnecessary and
would obscure the more important pre-release identity cleanup.

## Decision

- Page Toolbox is new OneWeb functionality, not a compatibility layer. Its catalog remains exactly
  password visibility, explicit free-page edit and finite selection/copy release.
- OneWeb will not implement a GM storage importer, old-settings schema, userscript compatibility
  protocol, migration UI, legacy release channel or dual-product support policy.
- The detailed Phase 7A audit and Page Toolbox security ADRs remain as engineering evidence: they
  explain the clean-room rewrite and permanently reject all-sites authority, external Vue CDN,
  `GM_xmlhttpRequest + eval`, hard-coded private sites, click replay and unowned global listeners.
- `one-tampermonkey` remains an unchanged historical repository. Its existing commit and Git history
  are sufficient; no extra `legacy-final` tag, notice-only default branch or migration campaign is
  required. Archiving the GitHub repository can be a single separately authorized external action.
- Phase 7D is simplified to pre-release identity and history cleanup: normalize the local package
  and Firefox add-on identities to OneWeb, remove current-product copy that promises old identities,
  verify production artifacts contain no legacy implementation/dependency, and close Phase 7.
- The GitHub repository name and homepage change only atomically with a separately authorized remote
  rename. Until that action occurs, the existing URL remains factual and is not a compatibility
  promise.

The private root package is named `one-web`. The stable Firefox development/self-distribution ID is
`one-web@juckz.local`; it replaces the misleading RepoLens/One WebExt identifier before release.
RepoLens remains a module name and does not define the host product identity.

## Rejected alternatives

- Inventing user-data migration or compatibility support for a product with no users.
- Keeping migration guides, README templates, retirement manifests or staged tag/notice workflows.
- Adding a legacy importer merely because old GM settings exist in prototype code.
- Copying or preserving rejected userscript behavior inside Page Toolbox.
- Renaming a GitHub repository URL in manifests and docs before the remote target exists.
- Deleting Git history; an ordinary repository archive already preserves the prototype for reference.

## Phase boundary

Phase 7D may change local product/package/add-on naming, tests and current architecture/roadmap text.
It must not add a Page Toolbox tool, permission, storage migration, compatibility API or legacy source
dependency. It does not modify `one-tampermonkey`, synchronize the RepoLens SDK vendor, rename a
remote repository or archive an external project without explicit authorization.

## Acceptance evidence

Accepted on 2026-09-03. The unnecessary migration guide, notice template, retirement manifest,
preservation tag and staged 7D-A/B/C plan are removed. The private root package is `one-web`, the
Firefox ID is `one-web@juckz.local`, and current OneWeb/RepoLens integration copy no longer presents
RepoLens or One WebExt as the host identity.

A deterministic pre-release gate checks the canonical package/manifest identities and scans 25
Page Toolbox source/complete-extension artifact files for Tampermonkey, GM API, userscript build, external CDN,
remote `eval` and hard-coded private-network markers. It passes on both Chromium and Firefox
production artifacts. OneWeb passes typecheck, full-repository lint, **558/558 unit tests**, the
reproducible **20-file SDK** gate, production Chromium build, **24/24 Chromium E2E**, production
Firefox build, strict manifest validation and the **1/1 real Firefox lifecycle/isolation gate**.
RepoLens passes **34/34 tests** and its offline **14-file vendor** gate without a vendor sync; the
known `typedCapabilities.storage.module` artifact drift remains explicit. Both writable repositories
pass `git diff --check`, and `one-tampermonkey` remains clean at the audited commit.

The product/code portion of Phase 7 is complete. Renaming the actual GitHub repository and archiving
the historical prototype are two narrowly scoped external administrative actions that were not
performed and do not create a migration product.
