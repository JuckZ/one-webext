# Post-Phase 9 release-convergence checkpoint

Date: 2026-09-04

Status: Commit sequence complete; RC2 execution awaits explicit authorization

This checkpoint is not a Phase 10 and adds no product work. It records the review and release
boundary after Phase 9 so the uncommitted feature can be committed and accepted as a new release
candidate only after separate authorization.

## Protected state

- At review entry, OneWeb was on `codex/phase-9a-openlist-contract` at committed base
  `96f7d05440b5a9559cf956f742e2097f9bb271e1`, with all Phase 9 source, tests and documentation
  unstaged and uncommitted. The separately authorized commit sequence below was later completed on
  the same branch without merging or rebasing.
- Annotated tag `v0.1.0-rc.1` remains object
  `97d37a191b0cf89686e337f9cb3aeb10f970763e` and resolves to pre-Phase-9 source
  `b5055864de36c058203ffc16111a209a4a7b06c9`.
- RC1 artifacts remain under `artifacts/rc/v0.1.0-rc.1/`. The Chromium ZIP SHA-256 is
  `0f5e3b0f30166e3e792646f2a13cb8892629e9820b5134a23cc5ad034208fa60`; the Firefox XPI SHA-256 is
  `28500594902fde401f824ae0838e390988243fcf3c83cad515d6a8738d14b1a3`. Neither file is an input to
  a future RC2 build.
- RepoLens remains on its existing dirty `main` checkout at
  `c994ac74f0c61bb1b3a90fed9f315e8768b724b8`. Its 14-file SDK vendor is not synchronized; the
  ADR-accepted `typedCapabilities.storage.module` drift is non-blocking.
- The archived `one-tampermonkey` checkout remains clean at
  `448bf86d031881b3df687a6bcda416acd39307fa`. It receives no tag, migration layer or compatibility
  change.

## Read-only Phase 9 review

The review covered every tracked and untracked Phase 9 path, the current Chromium production tree,
package metadata, ignored-output boundaries, permissions, imports and sensitive-string surfaces.

| Surface                     | Result                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source and generated files  | All implementation and tests are under reviewed `src/`, `e2e/` and `scripts/` paths. `extension/dist`, generated `extension/manifest.json`, SDK `dist` and `artifacts/` remain ignored and must never be staged. No source map, private-key or environment file was added.                                                                             |
| Dependencies                | `package.json`, `pnpm-lock.yaml` and SDK package metadata are unchanged. New production files import only OneWeb-local modules and platform APIs; no `file:`, `link:`, sibling-checkout or absolute-path dependency was added.                                                                                                                         |
| Permissions                 | The only manifest permission delta is `contextMenus`. Existing `activeTab + scripting` drives explicit top-frame discovery. Existing optional `http://*/*` and `https://*/*` declarations permit runtime exact-origin requests; there is no static `<all_urls>` grant or new resident content script.                                                  |
| Connector                   | The service origin is a validated profile exact origin. Method, endpoint, `Authorization`, host-derived AList `Client-Id`, response cap, redirect refusal and body shape are fixed by trusted code. Candidate/page data cannot select them.                                                                                                            |
| Secret                      | Production state stores a Token only in the installation/profile-bound `storage.local` secret record and transient trusted-background memory. Profile, command/result, Registry, discovery, UI and module presentation shapes contain no Token. Synthetic test tokens occur only in local fixtures and are absent from the production tree.            |
| Text and code injection     | Candidate, title, path, tool and task fields use text nodes/form values. No Send to OpenList production path uses HTML injection, remote code, `eval`, page Cookie/Referer/header transfer or a provider-private API.                                                                                                                                  |
| URL and SSRF boundary       | Signed HTTP(S) path/query serialization is retained while fragments are removed. Explicit local-use literals/names are blocked at submission. DNS, redirect and peer-protocol egress remain explicitly assigned to OpenList/AList deployment policy rather than overstated as a browser guarantee.                                                     |
| Absolute paths and identity | No Phase 9 production source or production artifact contains a user-home or temporary-workspace path. The existing Firefox test runner fallback `/usr/bin/firefox` is tooling-only; `file:///tmp/openlist` is a negative validator fixture. Product identity remains OneWeb / `one-web` / `one-web@juckz.local`.                                       |
| Documentation               | ADR-0022, roadmap, architecture and Phase 9A–9E checkpoints agree that the feature is post-RC, disabled by default, uses one shared fixed connector, and closes without polling, retry, persistent task queue or private-provider fallback. Protected-builtin removal is refusal; installation-identity replacement is the tested state-clearing path. |

No blocking mismatch was found. This conclusion authorizes neither staging nor release.

## Proposed reviewable commit sequence

The sequence below is dependency ordered. Shared files marked **hunks** must be staged by the named
concern; staging the complete file in an earlier commit would collapse browser discovery into the
connector or make an intermediate commit depend on files that are not present yet. Ignored build
outputs are excluded from every commit.

### 1. Pure resource-inbox contracts

- **Goal:** establish browser-independent schemas, canonicalization, quotas, SSRF decisions,
  command/results, submission reducer and cancellation review model.
- **Files:**
  - `src/modules/builtin/send-to-openlist/{contracts,validation,candidate,commands,results,submission,cancel-plan}.ts`
  - `src/modules/builtin/send-to-openlist/__tests__/{validation,candidate,commands,results,submission,cancel-plan}.test.ts`
- **Independent review:** these files use no browser/chrome API, network, DOM, storage or real
  secret. They are the dependency root for all later commits.
- **Suggested message:** `feat(openlist): define resource inbox contracts`
- **Minimum gate:** typecheck, lint and the six named unit-test files.

### 2. Fixed upstream connector

- **Goal:** add only the bounded OpenList/AList HTTP adapter, including fixed paths/methods/headers,
  raw Token use, host-derived `Client-Id`, redirects denied, response limits and ambiguous-write
  classification.
- **Files:**
  - `src/modules/builtin/send-to-openlist/connector.ts`
  - `src/modules/builtin/send-to-openlist/__tests__/connector.test.ts`
- **Independent review:** the connector depends only on commit 1 and is not registered or reachable
  from the extension yet.
- **Suggested message:** `feat(openlist): add the fixed trusted connector`
- **Minimum gate:** typecheck, lint and `connector.test.ts`.

### 3. Profile-secret and lifecycle authority

- **Goal:** add the disabled builtin descriptor, separated profile/secret storage, exact-origin and
  generation-bound controller, two-profile isolation, controlled concurrency and task authority.
- **Files:**
  - `src/modules/types.ts`
  - the exhaustive capability label in `src/sidebar/module-presentation.ts`
  - `src/modules/builtin/send-to-openlist/{manifest,profile-store,controller}.ts`
  - `src/modules/builtin/send-to-openlist/__tests__/{profile-store,controller}.test.ts`
- **Independent review:** the controller remains unregistered, so this commit reviews storage and
  lifecycle authority without exposing a message or UI surface.
- **Suggested message:** `feat(openlist): add profile-bound connector authority`
- **Minimum gate:** typecheck, lint and the profile-store/controller tests.

### 4. Trusted protocol and host registration

- **Goal:** register the disabled builtin and expose its versioned management protocol only to the
  existing trusted module-management sender boundary.
- **Files and hunks:**
  - `src/modules/builtin/send-to-openlist/{protocol,client}.ts`
  - initial exports in `src/modules/builtin/send-to-openlist/index.ts`, excluding discovery and
    context-menu exports until commit 6
  - `src/modules/builtin/send-to-openlist/__tests__/protocol.test.ts`
  - `src/modules/default-registry.ts`
  - connector/profile/controller imports, construction, origin-use coordination, startup,
    lifecycle, permission-removal and non-discovery message routes in `src/background/main.ts`
- **Independent review:** it makes the background capability reachable but does not add the product
  form or page-discovery privilege.
- **Suggested message:** `feat(openlist): register the trusted management protocol`
- **Minimum gate:** typecheck, lint, protocol/controller tests and the complete unit suite.

### 5. Manual review and task-management UI

- **Goal:** add the one-active-profile management surface, manual paste, explicit destination/tool
  review, per-item outcomes, manual task reads and separate cancellation confirmation.
- **Files and hunks:**
  - `src/sidebar/send-to-openlist-presentation.ts`
  - `src/sidebar/__tests__/send-to-openlist-presentation.test.ts`
  - `src/sidebar/main.ts`
  - manual profile/connect/submit/task/cancel rendering and actions in
    `src/sidebar/module-management-view.ts`
  - matching non-discovery test hunks in
    `src/sidebar/__tests__/module-management-view.test.ts`
  - Send to OpenList panel styles in `src/sidebar/sidebar.css`
- **Independent review:** no page scan, context menu or manifest permission is included. Untrusted
  server and candidate fields remain text-only.
- **Suggested message:** `feat(openlist): add manual resource inbox management`
- **Minimum gate:** typecheck, lint, presentation/management-view tests and full unit tests.

### 6. Explicit browser discovery

- **Goal:** add only fixed context menus, current-page capture and user-triggered packaged top-frame
  scanning into the bounded in-memory review inbox.
- **Files and hunks:**
  - `src/modules/builtin/send-to-openlist/{discovery,context-menu}.ts`
  - discovery/context-menu exports appended to
    `src/modules/builtin/send-to-openlist/index.ts`
  - `src/modules/builtin/send-to-openlist/__tests__/{discovery,context-menu}.test.ts`
  - `contextMenus` permission in `src/manifest.ts`
  - discovery construction, context-menu registration/click and discovery message routes in
    `src/background/main.ts`
  - discovery rendering/actions and matching tests in
    `src/sidebar/module-management-view.ts` and
    `src/sidebar/__tests__/module-management-view.test.ts`
- **Independent review:** browser entry is isolated from the fixed connector and never submits
  automatically. It adds no host grant or resident script.
- **Suggested message:** `feat(openlist): add explicit browser resource discovery`
- **Minimum gate:** typecheck, lint, discovery/context-menu/management-view tests, full unit tests and
  a Chromium production build with the identity/permission scan.

### 7. Cross-browser and dual-service conformance gates

- **Goal:** prove OpenList/AList differences, Chromium/Firefox behavior, permission/worker lifecycle,
  secret confinement and unchanged existing-module state.
- **Files:**
  - `e2e/{fixtures,basic.spec}.ts`
  - `scripts/verify-firefox-page-toolbox.ts`
  - `src/utils/__tests__/verify-firefox-page-toolbox.test.ts`
- **Independent review:** this commit changes fixtures and verification only after the complete
  production surface exists.
- **Suggested message:** `test(openlist): cover dual-service and browser isolation`
- **Minimum gate:** typecheck, lint, full unit tests, SDK reproducibility, Chromium/Firefox production
  builds, complete Chromium E2E, strict Firefox manifest lint and the real Firefox gates.

### 8. Architecture, phase evidence and release decision

- **Goal:** commit the audited upstream evidence, completed Phase 9 checkpoints and this release
  boundary after the code/test commits and their recorded gates are reproducible.
- **Files:**
  - `docs/adr/0022-send-to-openlist-resource-inbox.md`
  - `docs/checkpoints/phase-9a-send-to-openlist.md`
  - `docs/checkpoints/phase-9b-send-to-openlist-connector.md`
  - `docs/checkpoints/phase-9c-send-to-openlist-mvp.md`
  - `docs/checkpoints/phase-9d-send-to-openlist-browser-entry.md`
  - `docs/checkpoints/phase-9e-send-to-openlist-isolation.md`
  - `docs/checkpoints/post-phase-9-release-convergence.md`
  - Phase 9 sections in `docs/module-decomposition-roadmap.md` and
    `docs/module-platform-architecture.md`
- **Independent review:** it contains evidence and decisions only, with no runtime or permission
  change.
- **Suggested message:** `docs(openlist): record Phase 9 and RC2 boundary`
- **Minimum gate:** documentation lint/full lint and `git diff --check`.

Before each authorized commit, inspect both the staged diff and the remaining unstaged diff. An
intermediate commit must pass its listed gate; if hunk boundaries cannot keep it buildable, combine
only the adjacent dependent commits and record why rather than committing a broken tree.

## Commit execution record

The authorized sequence was executed on 2026-09-04 without merging adjacent commits:

| Order | Commit                                                               | Gate recorded before commit                                                                                                                                                                     |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `78cbd41` `feat(openlist): define resource inbox contracts`          | Isolated index tree: typecheck, lint and **65/65** pure contract tests.                                                                                                                         |
| 2     | `8c6de61` `feat(openlist): add the fixed trusted connector`          | Isolated index tree: typecheck, lint and **8/8** connector tests.                                                                                                                               |
| 3     | `0586a6e` `feat(openlist): add profile-bound connector authority`    | Isolated index tree: typecheck, lint and **17/17** profile-store/controller tests.                                                                                                              |
| 4     | `0811638` `feat(openlist): register the trusted management protocol` | Isolated index tree: typecheck, lint, **15/15** protocol/controller tests and **651/651** full unit tests.                                                                                      |
| 5     | `55e6e8a` `feat(openlist): add manual resource inbox management`     | Isolated index tree: typecheck, lint, **36/36** presentation/view tests and **657/657** full unit tests.                                                                                        |
| 6     | `c3025c3` `feat(openlist): add explicit browser resource discovery`  | Isolated index tree: typecheck, lint, **42/42** discovery/protocol/view tests, **665/665** full unit tests and the **28-file** Chromium production identity build.                              |
| 7     | `efc41ea` `test(openlist): cover dual-service and browser isolation` | Isolated index tree: typecheck, lint, **665/665** unit, **20-file** SDK, **28-file** Chromium build, **28/28** Chromium E2E, **28-file** Firefox build, manifest **0/0/0** and Firefox **2/2**. |
| 8     | `docs(openlist): record Phase 9 and RC2 boundary`                    | Documentation/full lint and `git diff --check`; its exact SHA is the commit containing this checkpoint.                                                                                         |

One dependency correction was required and kept the planned eight commits intact. Adding
`resources.openlist.submit` to the exhaustive `ModuleCapabilityId` union made the existing
`Record<ModuleCapabilityId, string>` presentation map fail typecheck until its one-line label was
present. That label therefore moved from planned commit 4 to commit 3. No runtime, permission or UI
surface moved with it.

The repository's ECC pre-commit hook conservatively classified explicit synthetic negative-test
values as generic credentials in commits 1, 3, 4 and 5. Before each one-command bypass, the staged
diff passed the standard private-key/API-token signature scan, contained no generated/secret file,
and the matching isolated tests proved the values were fixtures or non-rendering assertions. The
project-provided `ECC_SKIP_PRECOMMIT=1` was used only on those four individual `git commit` commands;
the hook was never disabled globally. Commits 2, 6, 7 and 8 used the normal hook path.

## `0.1.0-rc.2` decision

If OneWeb `0.1.0` includes Send to OpenList, its first eligible candidate is a new annotated
`v0.1.0-rc.2`. `v0.1.0-rc.1` must never be reused, moved, deleted, force-updated or re-signed. RC2
must identify the new reviewed Phase 9 source tip and produce independent evidence and artifacts.

After explicit commit and RC authorization:

1. Create the eight commits above in order, run each minimum gate and obtain one final reviewed,
   source-clean commit. Do not merge or push unless that action is also authorized.
2. Clone the canonical repository and exact reviewed commit into a new `mktemp -d` directory. Do not
   reuse the development checkout's dependencies, caches, artifacts or browser profiles.
3. Run `pnpm install --frozen-lockfile`; audit `package.json`, lockfile and installed graph for
   `file:`, `link:`, sibling-checkout and absolute-path dependencies.
4. Run `pnpm typecheck`, full `pnpm lint`, complete `pnpm test` and
   `pnpm verify:module-sdk`, requiring the expected reproducible 20-file SDK package.
5. Run the Chromium production build and identity/runtime scan, then all Chromium E2E in a fresh
   browser profile. Audit the effective manifest, permission delta, content scripts, generated
   files, CSP and optional exact-origin model.
6. Run `pnpm verify:firefox`, including the Firefox production build, identity scan, strict manifest
   validation and real temporary-install gates in a fresh Firefox profile.
7. Package independent RC2 archives under `artifacts/rc/v0.1.0-rc.2/`, using RC2-specific filenames.
   List archive entries and reject tests, source maps, caches, dev metadata, real/synthetic secrets,
   user-home paths, local dependencies, stale identity, GM/userscript code, external CDN, remote
   evaluation and unexpected executable surfaces.
8. Hash each archive with SHA-256 and write a new
   `docs/checkpoints/0.1.0-rc.2-release-candidate.md` evidence document that records the exact commit,
   dependency/test counts, browser versions, effective manifests, archive lists and hashes. Never
   copy an RC1 hash or overwrite its directory/evidence.
9. Require clean source status apart from ignored outputs and pass `git diff --check`. Only then may
   an explicitly authorized annotated `v0.1.0-rc.2` point at the tested commit. A GitHub Release,
   npm action, store upload or formal `0.1.0` release remains separately authorized.

The completed branch can become an RC2 acceptance input only after its normal push is verified and
the separate RC2 authorization is granted. The development checkout itself remains ineligible as
acceptance evidence; RC2 must still start from a fresh clone of the reviewed remote commit.

## Real OpenList/AList acceptance matrix

Real-service acceptance is required before formal release but is not authorized or possible from
the current repository-only review. It must use two isolated, disposable test instances and
separately supplied minimum-permission accounts/Tokens. Credentials must be entered interactively
into the trusted extension UI and must never appear in a shell command, environment variable, log,
URL, DOM, normal module state, test fixture, screenshot, recording or evidence document.

| Check             | OpenList instance                                                                                                                                      | AList instance                                                                      | Sanitized evidence                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Instance identity | Record exact release/build and deployment topology.                                                                                                    | Record exact release/build and deployment topology.                                 | Version, date, OneWeb RC2 commit and browser version only.                                                                       |
| Network boundary  | One approved exact origin; HTTPS preferred; no redirect; document proxy and egress policy.                                                             | Same, including whether a reverse proxy changes `Client-Id` handling.               | Origin may be redacted to scheme plus test label; record redirect result and outbound-policy description.                        |
| Authentication    | Dedicated minimum-permission Token; verify fixed `/api/me`.                                                                                            | Dedicated minimum-permission Token; verify `/api/me` plus host-derived `Client-Id`. | Stable OneWeb result/error code and sanitized request count; no header/body dump.                                                |
| Dynamic tools     | Query the fixed tool endpoint for a disposable target path.                                                                                            | Query the same endpoint and confirm AList-compatible result handling.               | Bounded returned tool names only after confirming they contain no private identifier.                                            |
| Single add        | Submit one controlled public test resource to a unique disposable directory with the selected returned tool.                                           | Same.                                                                               | Candidate kind, byte bounds, stable terminal class and redacted task identifier; never record a signed private URL.              |
| Task authority    | Manually read undone and done lists; confirm no polling or local persistent queue.                                                                     | Same.                                                                               | Item counts and normalized state transitions, with names/errors sanitized.                                                       |
| Reviewed cancel   | Create or select one disposable unfinished task, prepare a single-use review and explicitly cancel it.                                                 | Same.                                                                               | Plan expiry/consumption outcome and final server state; omit Token and sensitive task text.                                      |
| Permission revoke | Revoke only the instance exact-origin permission and confirm the matching Token/authority is cleared with no further request.                          | Repeat independently and prove the peer profile remains unchanged.                  | Sanitized before/after request counters and permission patterns, no storage dump.                                                |
| Worker restart    | Restart the MV3 worker after an established profile; confirm disconnected state, lost transient inbox/in-flight authority and zero automatic requests. | Same.                                                                               | Sanitized request counters and state labels only.                                                                                |
| Ambiguous write   | Through an isolated test proxy, terminate the connection only after the server may have accepted one add. Do not auto-retry.                           | Same.                                                                               | OneWeb `outcome-unknown`, proxy fault timing and subsequent manual server lookup using a unique non-secret test URL/task marker. |
| Cleanup           | Cancel remaining tasks, remove test files/directories, revoke/delete the test Token/account, delete the profile and revoke the origin grant.           | Same.                                                                               | Signed-off cleanup checklist and zero remaining test resources; no credential evidence.                                          |

The ambiguous-write check must be reconciled manually against server task/file state before another
submission. It must never turn into an automatic retry. Redirect and DNS/egress conditions must be
recorded because the browser's local-use classifier cannot enforce the service host's outbound
network policy.

### Blocking conditions

- No user-approved isolated OpenList and AList endpoints or minimum-permission test Tokens are
  available in this review. Do not request, invent or store credentials in the repository.
- Connecting to either real instance is an external action and requires explicit authorization plus
  a cleanup owner and disposable target directories.
- RC2 acceptance requires an authorized, committed source tip that can be cloned independently.

Until those conditions are resolved, the correct state is to retain the reviewed uncommitted Phase
9 work, leave RC1 frozen and stop before staging, tagging or contacting a real service.
