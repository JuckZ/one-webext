# Phase 8A pre-release working-tree checkpoint

Date: 2026-09-03

This is a documentation checkpoint for two intentionally uncommitted repositories. It is not a Git
commit and does not claim that either working tree can be reconstructed from `HEAD` alone.

## Protected baseline

| Repository                             | Branch / base HEAD                                  | Initial Phase 8A working-tree scope                                     | Protection                                        |
| -------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| `/home/juck/Projects/one-webext`       | `main` / `062c8e74d8141bef54d87d7ea1f31148e47cffa5` | 53 paths: 23 tracked modifications/additions, 6 deletions, 24 untracked | No reset, clean, checkout-overwrite or commit     |
| `/home/juck/Projects/repolens-starter` | `main` / `c994ac74f0c61bb1b3a90fed9f315e8768b724b8` | 23 paths: 14 tracked modifications, 9 untracked                         | No reset, clean, vendor sync, overwrite or commit |
| `/home/juck/Projects/one-tampermonkey` | `main` / `448bf86d031881b3df687a6bcda416acd39307fa` | Clean, with no tags                                                     | Strictly read-only                                |

The OneWeb remote remains `git@github.com:JuckZ/one-webext.git`. RepoLens has no configured Git
remote in this checkout. Generated browser artifacts, SDK `dist`, Playwright output and caches are
ignored and are not part of the protected source diff.

## Reproduced entry baseline

Before Phase 8A edits, the protected workspaces passed:

```text
OneWeb pnpm typecheck                              pass
OneWeb pnpm lint                                   pass
OneWeb pnpm test                                   558 / 558
OneWeb pnpm verify:module-sdk                      reproducible 20-file package
OneWeb pnpm build                                  Chromium production + identity gate
OneWeb EXTENSION_PATH="$PWD/extension" pnpm test:e2e  24 / 24 Chromium
OneWeb pnpm verify:firefox                         Firefox build + identity gate
                                                     manifest 0 errors/notices/warnings
                                                     real lifecycle gate 1 / 1
RepoLens pnpm check                                34 / 34 + offline 14-file vendor
Both writable repositories git diff --check        pass
```

`pnpm verify:oneweb -- /home/juck/Projects/one-webext` in RepoLens fails only on the already accepted
cross-repository drift: current OneWeb adds `typedCapabilities.storage.module` and its later SDK
files, while RepoLens intentionally retains its reviewed 14-file vendor. Phase 8A does not sync it.

An initial Chromium invocation without `EXTENSION_PATH` selected a stale default artifact and was
stopped after its identity assertion exposed the mismatch. The required explicit command above was
then run against the freshly built production artifact and passed all 24 scenarios; no source change
was made in response to the stale-artifact run.

## Clean-slate audit result

- No GM storage importer, old-settings compatibility schema, migration UI, userscript protocol,
  retirement manifest, preservation tag workflow or notice-only branch exists in the product.
- Page Toolbox contains exactly three default-off, clean-room OneWeb tools: password visibility,
  explicit free-page edit and finite selection/copy release. They are not a compatibility layer.
- The Phase 7A source audit and Page Toolbox ADRs remain as technical evidence. ADR-0020 remains the
  authoritative decision rejecting a fictional legacy product obligation.
- Current source and built artifacts are checked for Tampermonkey/GM APIs, userscript build tooling,
  external CDN code, remote `eval` and hard-coded private-site URLs. Phase 8B subsequently normalized
  the root package to `one-web` and Firefox ID to `one-web@juckz.local`; display name stays `OneWeb`.
- Historical mentions in the audit and ADRs are evidence or explicit rejection statements, not a
  supported migration path. Stale positive plans for tags, notices and settings export were removed.

## Deferred Phase 8B rename inventory

Do not change these while `JuckZ/one-webext` is the real remote:

| Current location                            | Current factual value                           | Phase 8B action after remote rename                                                         |
| ------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| OneWeb `.git/config`                        | `git@github.com:JuckZ/one-webext.git`           | Set origin to `https://github.com/JuckZ/one-web.git`, then fetch/verify                     |
| OneWeb `package.json`                       | `https://github.com/juckz/one-webext`           | Change homepage to the verified `JuckZ/one-web` URL                                         |
| OneWeb `src/components/Logo.vue`            | current `JuckZ/one-webext` GitHub link          | Change with the homepage in the same patch                                                  |
| OneWeb brand/roadmap/ADR current-state text | says the old URL is still factual               | Mark the atomic rename complete; retain historical evidence where useful                    |
| RepoLens `integrations/one-webext/`         | existing integration directory and README links | Rename to `integrations/one-web/` and update README plus `src/oneweb-contract.mjs` together |
| RepoLens path examples                      | previously used `/path/to/oneweb`               | Use `/path/to/one-web`                                                                      |

The historical `file:../one-webext` warnings in ADR-0005/0006/0007 describe a rejected dependency
shape; they are not live links. Old checkpoint paths describe the checkout that actually existed and
should not be rewritten. Test regexes that reject `one-webext` sibling paths remain security gates.

## Recommended commit sequence

No commit is created in Phase 8A. When commits are explicitly authorized, stage shared files such as
`src/background/main.ts`, `src/sidebar/main.ts`, `src/manifest.ts`, `package.json`, the two E2E files
and the roadmap by semantic hunk and run the relevant gate after every commit.

1. **`feat(platform): establish the OneWeb module host and management lifecycle`**
   Core `src/modules/` manifest, registry, manager, installer, update, context, FrameHost and
   management protocol files; RepoLens seed/provider extraction; obsolete `src/repolens/` generic
   implementations as deletions; background/sidebar integration hunks; core unit and E2E fixtures;
   module-platform architecture and Phase 0–2 roadmap/ADRs. This is the base for every later commit.
2. **`feat(bookmarks): add the isolated Bookmark Doctor builtin`**
   `src/modules/builtin/bookmark-doctor/`, bookmark isolation tests, sidebar presentation/UI hunks,
   optional `bookmarks` manifest hunk and Phase 3 docs/E2E cases. Depends on commit 1.
3. **`feat(clash): add loopback-only Clash Control`**
   Clash builtin, shared builtin-origin coordination, sidebar presentation/UI hunks, Phase 4 ADR and
   fixed localhost fixture/E2E cases. Depends on commits 1–2 for shared-origin isolation.
4. **`feat(journal): add explicit finite Browser Journal sessions`**
   Browser Journal builtin, presentation/UI, local retention and isolation tests, Phase 5 ADRs and
   E2E cases. Depends on commit 1.
5. **`feat(sdk): add the reproducible module SDK and typed RPC foundation`**
   `packages/module-sdk/`, SDK/client/dispatcher/runtime tests and adapters, TypeScript/Vitest/package
   build hunks, Phase 6A–6D ADRs and conformance E2E cases. Depends on commit 1.
6. **`feat(storage): add the isolated storage.module capability`**
   SDK storage contract, trusted storage adapter/controller/client/protocol, storage isolation tests,
   Phase 6E ADRs and E2E case. Depends on commit 5.
7. **`feat(toolbox): add the packaged Page Toolbox and three clean-room tools`**
   Page Toolbox builtin/content runtime, presentation/UI and styles, `scripting` plus optional-host
   manifest hunks, dedicated Vite entry, Phase 7A audit and ADR-0011 through ADR-0019, Chromium and
   Firefox lifecycle gates. Depends on commits 1–3 because exact-origin use is coordinated.
8. **`chore(identity): adopt the OneWeb pre-release identity and checkpoint`**
   OneWeb brand assets/copy, package/display identity, Firefox ID, identity verifier/tests, ADR-0020,
   ADR-0021 and Phase 8A current docs/checkpoint. Keep the still-factual GitHub URL unchanged. Depends
   on commit 7 so the artifact scan covers the complete Page Toolbox bundle.
9. **RepoLens — `feat(oneweb): adopt the portable OneWeb module runtime`**
   RepoLens bridge/server/embed changes, integration contract lock, reviewed 14-file vendored SDK,
   provenance scripts/tests/docs and the `node_modules/` ignore rule. This is a separate-repository
   commit and must preserve independent clone/run behavior. Record the later `storage.module` drift;
   do not silently mix a new vendor sync into this commit.

## Deferred atomic runbooks

### Phase 8B — GitHub rename and links

1. Re-run status, diff and complete gates; confirm no pending external operation.
2. Rename `JuckZ/one-webext` to `JuckZ/one-web` through an explicitly authorized GitHub action.
3. Verify the new repository URL and default branch before changing any local reference.
4. Update and verify the OneWeb remote, homepage, Logo link and current docs in one change.
5. Rename the RepoLens integration path and all live references together; do not touch its vendor.
6. Search both repositories for live old URLs/paths, preserving only historical evidence and reject
   tests; run both complete gates and `git diff --check`.

### Phase 8C — Historical repository archive

1. Confirm `/home/juck/Projects/one-tampermonkey` is still clean at the audited commit.
2. Archive `JuckZ/one-tampermonkey` through one explicitly authorized GitHub action.
3. Verify read-only archive state. Do not create a tag, migration notice, importer, compatibility
   release, branch rewrite or local source change.

### Phase 8D — `0.1.0` release-candidate acceptance

1. Clone OneWeb and RepoLens into new temporary directories from their canonical remotes.
2. Install with frozen lockfiles and no sibling/file dependencies; verify the RepoLens offline vendor.
3. Run typecheck, lint, unit, deterministic SDK, Chromium build/identity/E2E, Firefox
   build/identity/manifest/real-browser and both diff checks from the clean clones.
4. Install Chromium and Firefox production artifacts in clean profiles and smoke-test module
   management plus RepoLens, Bookmark Doctor, Clash Control, Browser Journal and Page Toolbox
   isolation without development servers except documented fixtures.
5. Set/verify the root release-candidate version `0.1.0`, inspect packaged file lists and scan for
   secrets, absolute paths, remote code and stale product identity. Publishing is not implicit.

## Phase 8A status

**Complete (2026-09-03).** The final OneWeb working-tree summary remains 53 status paths (23 tracked
modifications/additions, 6 deletions and 24 untracked roots). RepoLens is now 23 status paths (15
tracked modifications and 8 untracked roots) because `.gitignore` excludes, but does not delete, its
dependency directory. The historical repository remains byte-for-byte clean at the audited commit.

The post-edit gate passes OneWeb typecheck, full lint, **558/558 unit tests**, reproducible **20-file
SDK**, Chromium production build and **26-file identity scan**, **24/24 Chromium E2E**, Firefox
production build and identity scan, strict manifest validation with **0 errors / 0 notices / 0
warnings**, the **1/1 real Firefox lifecycle/isolation gate**, and `git diff --check`. RepoLens passes
**34/34**, its offline **14-file vendor** gate and `git diff --check`; the separately run cross-repo
verifier reports only the accepted `typedCapabilities.storage.module`/artifact drift.

No commit, reset, clean, vendor sync, GitHub action, archive, tag or release occurred. Phase 8B,
**GitHub repository atomic rename and link update**, is the next separately authorized stage.

## Phase 8B outcome

Completed on 2026-09-03 after explicit authorization. GitHub was renamed first and verified at
`https://github.com/JuckZ/one-web`; only then were the checkout directory, HTTPS Git remote, root
package, homepage, Logo link, Firefox ID and RepoLens `integrations/one-web/` path updated. Protocol
and module identities remain stable. Phase 8A's initial paths above remain as historical checkpoint
facts rather than live instructions.
