# Page Toolbox legacy audit and pure contract

- **Phase:** 7A
- **Audit date:** 2026-08-30
- **Legacy snapshot:** `one-tampermonkey@448bf86d031881b3df687a6bcda416acd39307fa`
- **Legacy repository policy:** read-only during 7A
- **Implementation status:** contract only; no OneWeb runtime, permission, UI or tool code

## 1. Evidence boundary

The legacy product is one Vite/Vue userscript. `src/main.ts` registers nine menu items in one global
entry, while `FloatingBall.vue` mixes a floating surface with site-specific click replay. The build
matches every HTTP(S) page, executes at `document-body`, downloads Vue from jsDelivr and updates the
script from GitHub. `package.json` has no real test gate: its `test` command only prints `hello`.

Evidence references below use the immutable audit snapshot:

- `one-tampermonkey@448bf86:README.md:3-19` — installation and advertised feature list.
- `one-tampermonkey@448bf86:package.json:6-31` — independent build stack and placeholder test.
- `one-tampermonkey@448bf86:vite.config.ts:17-39` — all-sites metadata, remote update and external
  Vue CDN.
- `one-tampermonkey@448bf86:src/main.ts:7-128` — top-window assumptions, GM storage/menu host and
  incomplete lifecycle abstraction.
- `one-tampermonkey@448bf86:src/main.ts:134-418` — page tools and menu registration.
- `one-tampermonkey@448bf86:src/components/FloatingBall.vue:1-123` — click recorder, site automation,
  interval and remote image.
- `one-tampermonkey@448bf86:src/util.ts:1-95` — custom URL matcher, DOM-wide rewrite and external
  store redirects.

No legacy code is copied by Phase 7A. Paths provide evidence, not a production dependency.

## 2. Classification vocabulary

- **Direct migration:** behavior and implementation already fit the Page Toolbox boundary. No
  audited tool qualifies.
- **Rewrite then migrate:** user value is retained, but implementation must use the common runtime,
  resource ledger and deterministic disposal.
- **Defer:** concept may be useful, but another capability or threat model must land first.
- **Remove:** behavior is private, ineffective, remotely executable, over-broad or too destructive
  for the default product.

## 3. Unified legacy migration matrix

The compact columns below cover the full review rubric. “Feature and evidence” records the code
entry and dependencies; “Privilege, network and sensitive data” records existing OneWeb permission
reuse as well as remote-code/CDN and data exposure; “DOM read/write scope” plus “Resources,
reversibility and cleanup” record global listeners, styles, DOM side effects and deterministic
cleanup; the remaining columns record user value, site coupling, Chromium/Firefox differences,
migration cost and the direct/rewrite/defer/remove decision.

| Feature and evidence                                         | User value and site assumptions                                                                                       | Trigger                                                               | DOM read/write scope                                                                                                             | Privilege, network and sensitive data                                                                                                        | Resources, reversibility and cleanup                                                                                                        | Chromium/Firefox notes                                                                         | Minimum migration cost                                 | Decision                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GM menu and per-domain settings (`main.ts:7-128`)            | Useful enable/disable model; assumes `window.top.location` is readable and domain is sufficient identity              | Userscript menu toggle, some changes require reload notification      | Menu host is external; feature callbacks can touch the whole document                                                            | `GM_getValue`, `GM_setValue`, `GM_notification`, register/unregister menu; settings reveal enabled tools per host                            | Anonymous `load` listener cannot be removed; toggling can re-register and re-apply; no generation or teardown                               | GM availability and menu UX differ by manager/browser                                          | Medium                                                 | **Rewrite then migrate as common infrastructure**, not a tool; exact origin replaces domain keys and OneWeb UI replaces GM menus                  |
| Remove selection/copy restrictions (`main.ts:134-206`)       | High general value; contains an unrelated `doc.iocoder.cn` cookie-bypass branch                                       | Menu toggle; legacy default off and asks for reload                   | Reads computed style on every element, writes inline `user-select`, captures ten mouse/keyboard/copy events on the document root | `GM_addStyle`; same-origin fetch, cookie read/write and console output in the site-specific branch; page text and cookie state are sensitive | Global capture listeners and inline mutations are never restored; fetched work has no cancellation                                          | Portable DOM/CSS core; isolated-world event behavior can differ, cookie branch is unacceptable | Medium/high                                            | **Rewrite then migrate** only the narrow selection/copy core; remove cookie/fetch branch and most captured events; 7B go candidate                |
| Floating surface (`main.ts:164-173`, `FloatingBall.vue`)     | General launcher concept is useful, but implementation is beta and “just for me”; embeds site selectors               | Menu toggle mounts immediately; internal actions record/replay clicks | Appends an unscoped Vue root, colors clicked elements, queries and clicks arbitrary selectors, auto-clicks an agreement button   | External GitHub avatar; page selector/click history in page `localStorage`; recorded behavior can reveal user workflow                       | Vue app/root are never unmounted; interval has no timeout/teardown; repeated apply duplicates UI; click listener is removed only after save | CSS collision and page APIs vary; remote image/CSP behavior differs                            | High                                                   | **Rewrite then migrate later** only the generic launcher as Shadow DOM in 7C; **remove** click replay and auto-ack behavior from the default tool |
| Disable analytics globals (`main.ts:208-231`)                | Claimed privacy value but explicitly marked unverified; assumes specific Baidu, Google and Sensors globals            | Menu, default on                                                      | Writes page-global names only; does not observe network completion                                                               | No GM call, but correct behavior would require main-world or request-blocking authority                                                      | No original values or dispose path; later page scripts can recreate globals                                                                 | Isolated extension worlds will not reliably affect page globals; browser privacy APIs differ   | High                                                   | **Remove** current feature; reconsider only as a separate privacy/network proposal with measurable behavior                                       |
| Reveal commented/internal report content (`main.ts:233-307`) | Private operational value only; hard-codes four intranet IP/port routes, report IDs, Chinese DOM IDs and frame layout | Menu toggle plus 2 s/3 s delayed work                                 | Traverses same-origin nested frames, installs an `onclick`, changes table cells and converts comment text with `innerHTML`       | Reads private report DOM and writes globals `_win`, `btn`, `docB`; no declared network but content is sensitive internal data                | Timers are not tracked; globals, handler, replaced comments and styles cannot be restored                                                   | Cross-origin frames fail; internal routes and enterprise policies differ                       | High                                                   | **Remove from public Page Toolbox**; no hard-coded intranet site pack in OneWeb                                                                   |
| Password visibility (`main.ts:308-329`)                      | High, simple page utility; assumes password inputs present at initial scan                                            | Legacy menu default on; triple click reveals until mouseleave         | Selects password inputs and changes only their `type`; does not read values                                                      | No GM/network use; password values are sensitive even though legacy code does not transmit them                                              | Anonymous click/mouseleave listeners cannot be removed; timers untracked; dynamic inputs ignored; original type not ledgered                | DOM behavior is portable; form frameworks may replace nodes                                    | Low/medium                                             | **Rewrite then migrate** with explicit opt-in, node ledger, dynamic-node boundary and disposal; 7B go candidate                                   |
| Element spacing inspection (`main.ts:330-343`)               | Useful developer tool on arbitrary sites                                                                              | Menu command                                                          | Unknown because implementation is downloaded at runtime                                                                          | `GM_xmlhttpRequest` fetches `https://unpkg.com/spacingjs`, then `eval`s response as code                                                     | No digest, size limit, cancellation, instance handle or cleanup                                                                             | Userscript/network/CSP semantics differ; violates OneWeb packaged-code and MV3 boundaries      | Medium if safe library is bundled, otherwise unbounded | **Defer** the concept; **remove** remote request/eval implementation. A future version must bundle reviewed code and expose dispose               |
| Free page edit (`main.ts:345-348`, `401-414`)                | High, understandable manual utility on most HTML pages                                                                | Menu/access key, legacy toggle                                        | Sets `document.body.contenteditable`                                                                                             | No GM/network beyond menu/settings; edited page text is sensitive and must remain local                                                      | “Unregister” writes the current boolean rather than restoring the previous attribute; no navigation or body-replacement handling            | Portable DOM core; designMode/contenteditable behavior varies slightly                         | Low                                                    | **Rewrite then migrate** with explicit activation and exact prior-attribute restoration; 7B go candidate                                          |
| Quick search (`main.ts:350-355`)                             | Moderate value; currently only npm search and contains a selection `toString` bug                                     | Menu command                                                          | Reads current selection                                                                                                          | `GM_openInTab` sends selection text to an external search URL; selection is sensitive                                                        | One-shot, but no reviewed destination plan or cancellation                                                                                  | Tab-opening and user gesture semantics differ                                                  | Medium/high                                            | **Defer** until a host-generated, reviewed `tabs.open`/search-plan contract exists                                                                |
| Night mode (`main.ts:357-392`)                               | Moderate but weak visual quality; assumes opacity inversion is acceptable everywhere                                  | Menu toggle                                                           | Scans style tags, adds/removes global `html/body` CSS and attempts every child frame                                             | No GM/network; page appearance only                                                                                                          | Identifies style by text instead of owned marker; `arguments.callee` is unsafe in modules; frame changes are not ledgered                   | Frame access and rendering differ; conflicts with native/site dark themes                      | Medium/high                                            | **Defer** pending a reversible, owned-style design and product-quality comparison                                                                 |
| Store redirect/search helper (`util.ts:47-95`)               | Separate extension-download product idea, not part of advertised runtime menu; assumes crxsoso service                | Function is not imported or called                                    | Replaces the entire `document.body.innerHTML`, destroying listeners and state                                                    | Opens or rewrites URLs to `crxsoso.com`; installs a permissive default Trusted Types policy; user input may contain sensitive URLs           | Irreversible whole-body rewrite; no cleanup or navigation authority                                                                         | Store URLs, policies and Trusted Types differ                                                  | High                                                   | **Remove** from Page Toolbox                                                                                                                      |
| URL matcher (`util.ts:1-19`)                                 | Internal helper only                                                                                                  | Called by private report tool                                         | No DOM mutation                                                                                                                  | No privilege/network                                                                                                                         | Pure, but implements a non-standard wildcard dialect and lacks conformance tests                                                            | Browser match-pattern behavior differs from this regex                                         | Low                                                    | **Remove implementation** and reuse OneWeb's reviewed match/origin normalization                                                                  |
| Vue/Vite starter UI (`App.vue`, `HelloWorld.vue`, assets)    | No product value; disconnected starter content                                                                        | Not used by production entry                                          | Demo DOM only                                                                                                                    | External documentation/image links                                                                                                           | No product lifecycle                                                                                                                        | Not relevant                                                                                   | None                                                   | **Remove** during retirement; do not migrate                                                                                                      |

The shared legacy lifecycle also has a concrete correctness defect: `MenuItem.register()` at
`main.ts:115` registers a `document` listener whose callback evaluates `this.fun!` without invoking
it. Password visibility is configured through this `lifeStage: 'load'` path, so its default-on
handler is effectively not applied; `load` is also attached to `document` rather than `window`.
This broken behavior is evidence for a clean-room lifecycle, not behavior to preserve.

Existing OneWeb authority is reusable only through the common host: `tabs` may identify the
authenticated top-frame/navigation binding, `storage` may hold the finite module-local settings,
and the existing optional HTTP(S) host-permission mechanism may request one exact origin. None of
those permissions are exposed to tool code. Password visibility, free-page edit and narrowed
selection/copy need no browser-data or network permission. Night mode would use the same DOM-only
boundary but remains deferred for product/reversibility reasons. Quick search cannot reuse a real
`tabs.open` handler because none exists; spacing, analytics mutation, intranet/report automation,
click replay and store redirect would require rejected or separately reviewed authority and receive
no permission reuse.

## 4. 7B go/no-go result

Repository evidence supports exactly three first PoC tools, all as clean-room rewrites behind the
common runtime:

1. **Password visibility — Go.** It has a narrow DOM boundary and no required browser/network
   privilege. The PoC must never read or report `input.value`, must track original types and must
   remove all listeners/timers.
2. **Explicit free-page edit — Go.** It needs no capability beyond the authorized page runtime. The
   PoC must preserve whether `contenteditable` was absent or its exact prior value and restore it on
   every teardown.
3. **Selection/copy release — Conditional go.** Preserve only the CSS/select/copy value. Remove the
   `doc.iocoder.cn` cookie/fetch branch and do not capture generic mouse or keyboard events. The PoC
   may install only named, ledgered listeners necessary for `copy`, `contextmenu` or `selectstart`.

No default-on behavior carries forward. Every tool starts disabled until Page Toolbox is enabled,
the exact site is granted and the user explicitly enables the tool for that site.

| Candidate               | Minimum permission/authority                                                                                    | Allowed PoC behavior                                                                                | Prohibited behavior                                                                                                    | Disposal and isolation acceptance                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Password visibility     | Enabled builtin plus user-approved exact HTTP(S) origin; no browser-data or network permission                  | After enable, an explicit per-field gesture may temporarily change only that tracked input's `type` | Reading/persisting/logging `value`, automatic page-wide reveal, remote assets or MAIN-world execution                  | Restore each still-owned exact prior `type`; remove listeners/timers; navigation, revoke or failure leaves other sites/tools/modules byte-for-byte unchanged |
| Explicit free-page edit | Enabled builtin plus user-approved exact HTTP(S) origin; no browser-data or network permission                  | Explicitly toggle the top document body's `contenteditable` attribute                               | Reading/persisting edited text, `designMode`, editing commands, HTML injection or silently enabling on navigation      | Restore exact prior presence/value, including an absent attribute; body replacement and teardown cannot overwrite newer page/tool changes                    |
| Selection/copy release  | Enabled builtin plus user-approved exact HTTP(S) origin; no cookie, network or generic event-capture permission | Apply owned `user-select` restoration and only the minimum named listeners proven necessary in 7B   | `doc.iocoder.cn` branch, cookies, fetch, generic mouse/keyboard capture, arbitrary selectors/actions or page text copy | Remove owned styles/listeners and restore only owned prior values; failure or disposal cannot alter another origin, tool or module                           |

If the selected Chromium/Firefox injection adapter requires `scripting`, Phase 7B must review that
manifest change separately. It is not a tool grant, and it does not weaken the exact-origin gate.

## 5. Packaged builtin manifest draft

The existing OneWeb builtin manifest shape is sufficient for the Phase 7A draft. Site access is not
encoded as a static all-sites match or remote capability:

```json
{
  "manifest_version": 1,
  "runtime": "builtin",
  "id": "dev.oneweb.page-toolbox",
  "name": "Page Toolbox",
  "version": "0.1.0",
  "description": "Explicit, reversible tools for the current website",
  "icon_path": "/assets/icon-128.png",
  "entry_id": "page-toolbox",
  "matches": [],
  "contexts": [],
  "context_fields": {},
  "capabilities": [],
  "activation": "manual",
  "min_host_version": "0.0.1"
}
```

`matches: []` is intentional: it grants no page access. A separate host-private packaged-page
descriptor binds this seeded builtin to reviewed tool IDs and an exact-origin authorization model.
Remote manifests cannot select an entry ID, register a page implementation or submit JavaScript.

## 6. Pure tool descriptor contract

Descriptors are immutable versioned data, not executable code:

```text
interface PageToolDescriptorV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly title: string
  readonly description: string
  readonly siteScope: 'user-approved-exact-http-origin'
  readonly requiredSiteGrant: 'exact-origin'
  readonly runAt: 'document-start' | 'document-idle'
  readonly frames: 'top'
  readonly defaultEnabled: false
  readonly domAccess: readonly ('read' | 'attributes' | 'styles' | 'listeners' | 'owned-nodes')[]
  readonly requiresMainWorld: false
  readonly settingsSchemaId: string
  readonly settingsSchemaVersion: 1
}
```

Phase 7B may add a pure validator, but these boundaries are fixed now:

- `id` selects only an implementation in Page Toolbox's build-time internal allowlist.
- No descriptor contains source text, source URL, import, expression, selector script, browser
  method, arbitrary message type or remote resource.
- `frames` is top-only for the initial platform. Child-frame support requires a separate review.
- `requiresMainWorld` is false; the first runtime stays in an isolated extension content world.
- `siteScope` and `requiredSiteGrant` are fixed literals. A descriptor cannot widen applicability;
  the host derives the normalized exact origin from the authenticated top-frame binding and checks
  the user's Page Toolbox grant.
- `settingsSchemaId` and version select only a static host allowlist paired with the tool ID. A
  caller cannot supply a schema, parser, URL, selector/action program or arbitrary message.
- Settings are finite tool-specific data. They cannot contain DOM snapshots, page text, cookies,
  credentials or executable selectors/actions.

The packaged implementation interface is narrow and never crosses a remote-frame boundary:

```text
interface PageToolImplementation<Settings> {
  apply(context: PageToolApplyContext, settings: Readonly<Settings>): PageToolHandle
}

interface PageToolHandle<Settings> {
  update(settings: Readonly<Settings>): void
  dispose(reason: PageToolDisposeReason): void
}
```

`apply`, `update` and `dispose` must be idempotent. A duplicate apply for the same
module/origin/tab/frame/navigation/tool/generation binding returns or reuses the same authority; it
must not add a second listener, timer, observer, node or style. An update either changes owned
resources atomically or disposes and reapplies. Dispose is terminal for that generation, including
when cleanup itself encounters a detached or hostile DOM node.

The pure lifecycle state for one full runtime binding is finite:

```text
inactive -> applying -> active -> updating -> active
                  \          \             \
                   failed     disposing ----> disposed
```

- `inactive`, `applying`, `active`, `updating`, `disposing`, `disposed` and `failed` are the only
  states. Only the current generation may transition.
- Repeated apply/update/dispose commands are idempotent. A concurrent terminal cause is
  first-terminal-wins; late completion, timer, observer or message work is ignored.
- Update publishes new settings only after all owned mutations succeed. On failure it rolls back
  through the ledger or disposes the instance; a partially updated `active` state is forbidden.
- Disable, exact-origin revocation, navigation, frame/port loss, module removal or worker restart
  invalidates the generation and drives any non-terminal instance through `disposing` to
  `disposed`. Cleanup failure is recorded as `failed` but cannot restore authority.
- `disposed` and `failed` are terminal authority states for their generation. `failed` still drains
  the ledger best-effort, but never permits update or reuse. Reinstall or re-enable must create a
  fresh binding and generation before another apply; it cannot revive removed handles.

## 7. Authority, state and injection model

Three independent conditions are required before any tool runs:

1. the seeded Page Toolbox record is enabled;
2. the user explicitly grants the current normalized HTTP(S) exact origin;
3. the tool is enabled in that origin's finite Page Toolbox settings.

The settings draft is local-only and host-owned:

```text
interface PageToolboxStateV1 {
  readonly schemaVersion: 1
  readonly sites: Readonly<Record<string, {
    readonly enabledToolIds: readonly string[]
    readonly toolSettings: Readonly<Record<string, PageToolSettingsDocumentV1>>
  }>>
}
```

The logical local namespace is the existing generic module-local key
`oneweb.module-state.v1:dev.oneweb.page-toolbox`; trusted OneWeb code derives the physical key and
normalized exact-origin map keys. Page code cannot name another origin/module namespace or access
storage directly. The v1 document accepts at most 64 exact-origin site entries, 16 unique enabled
tool IDs per site, 2 KiB of canonical UTF-8 JSON per tool settings document, 8 KiB per site and
64 KiB for the complete state. Settings are JSON-like finite data with maximum depth 8 and 1,024
nodes for the complete state; only the static schema paired with a descriptor may reduce those
limits further. Duplicate origins/tool IDs, non-finite or non-JSON values and quota overflow fail
closed with no silent eviction or partial mutation.

No wildcard grant is persisted and no static `<all_urls>` content script is accepted. Phase 7B must
decide and test the narrow Chromium/Firefox injection adapter—dynamic registration or explicit
programmatic injection—while preserving the same exact-origin authority. Any required `scripting`
permission is a separately reviewed manifest change in 7B, not an assumption made by 7A.

Disabling Page Toolbox retains its finite local preferences but disposes all page authority. An
explicit site-grant revocation deletes that origin's Page Toolbox binding and settings; the shared
origin coordinator removes the browser permission only when no other builtin or remote module still
uses it. Worker restart, extension update or runtime port loss preserves valid local settings but
invalidates every live generation; reconciliation may apply a stored selection only after the
enabled record, exact-origin grant, schema and current navigation are revalidated into a fresh
generation. The protected seeded builtin has no user removal/reinstall path; extension uninstall or
data reset creates a new installation with empty, default-off state.

The runtime binding includes module ID, tab ID, frame ID, exact origin, navigation ID and a monotonic
generation. Cross-origin navigation, same-document SPA route change, disable, permission revocation,
frame teardown, runtime port loss or extension update advances/invalidates the generation and
disposes affected tools before another apply. Same-origin SPA changes re-evaluate tool eligibility;
they do not inherit arbitrary DOM handles from the previous navigation.

## 8. Common resource ledger and recovery semantics

Every implementation receives one runtime-owned resource ledger. It must register:

- event target, event name, exact listener and options;
- timeout/interval ID;
- observer and abort controller;
- owned style or DOM node with an unforgeable instance marker;
- mutated node/property and its exact prior presence/value;
- framework mount/unmount callback, if a later tool needs one.

Dispose drains the ledger in reverse order and is safe to repeat. Tools may not install anonymous
untracked listeners, global timers, page-window globals, whole-body `innerHTML`, externally loaded
scripts or DOM changes that cannot be attributed and restored. A hostile page may remove or replace
owned nodes; cleanup treats absence as success and never restores over a newer page/tool change it
does not own.

Tool resources are partitioned by the full runtime binding. One tool cannot cancel, update or claim
another tool's listeners, nodes, settings or markers. Conflicting writes to the same page property
must fail closed or be coordinated by a common ownership stack; last-writer restoration is rejected.

## 9. Threat model and data boundary

- **Remote-code substitution:** `GM_xmlhttpRequest + eval`, dynamic import, remote Vue/CDN scripts,
  caller code and script URLs are rejected. Only OneWeb build artifacts execute.
- **Confused deputy:** remote-frame modules and page scripts cannot request “run code”, name a
  packaged entry or acquire Page Toolbox authority through generic typed RPC/context messages.
- **Forged page/runtime messages:** sender tab/frame, exact origin, navigation and generation are
  checked by the future narrow protocol. Page `window.postMessage` is not authority.
- **DOM clobbering:** DOM values, prototypes, selectors, attributes and events are untrusted. No
  element identity, HTML or page text is trusted merely because it came from the current document.
- **Sensitive content:** passwords, selection, edited text, cookies, click paths and private report
  data never enter storage unless a later tool-specific contract explicitly allows finite settings.
  They never enter logs, Registry, generic context bridge, remote-frame modules or another module.
- **Stale lifecycle:** late timers, observers, promises and messages after navigation/dispose are
  ignored through abort/generation checks.
- **Duplicate application:** idempotence and the resource ledger prevent duplicated listeners,
  mounts or styles across retries, SPA transitions and worker restart.
- **CSS/DOM collision:** owned nodes/styles use scoped instance markers. Shadow DOM is deferred to
  7C and cannot be assumed by the 7B runtime contract.
- **Permission overreach:** exact HTTP(S) origin and top frame only; no static all-sites access,
  implicit iframe inheritance, file/data/browser pages or arbitrary URL patterns.
- **Cross-browser drift:** the adapter owns Chromium/Firefox differences in injection persistence,
  permission removal and worker restart. Tool code does not branch on privileged browser APIs.

## 10. Shared foundations required before 7B tools

Phase 7B must build these common pieces before any feature implementation:

1. pure descriptor/state/binding validators and canonical clones;
2. exact-origin permission coordinator and a narrow, injectable page-registration adapter;
3. versioned background-to-content lifecycle protocol with sender and generation validation;
4. one top-frame packaged runtime host with an internal build-time tool allowlist;
5. resource ledger, ownership markers, abort/dispose orchestration and duplicate-apply sentinel;
6. SPA/full-navigation detector that invalidates stale handles without exposing page data;
7. two-origin/two-tool conformance fixtures and permission/storage isolation snapshots.

No individual tool may implement its own injection, host-permission request, storage access,
navigation generation, message authentication or disposal registry.

## 11. Historical repository boundary

OneWeb is the single source, test and release repository. The historical repository does not become
a package, submodule, subtree, sibling dependency or bidirectional mirror.

- **7A:** keep `one-tampermonkey` byte-for-byte read-only and record the immutable audit commit.
- **7B/7C:** reimplement accepted behavior inside OneWeb with new contracts and tests; do not import
  historical paths or maintain a shared production dependency.
- **After the local gates:** archive the old repository directly only when separately authorized.
  Do not create a preservation tag, notice-only branch, migration campaign or compatibility layer.

Prototype GM storage is not migration input. OneWeb has no released users, imports no old settings,
and starts Page Toolbox default-off with explicit exact-origin approval.

## 12. Phase boundary

Phase 7A changes documentation only. It does not add Page Toolbox to the Registry, modify a manifest
or permission, build a content runtime, copy old source, mount a UI, persist site settings, execute a
tool, alter E2E fixtures, tag/archive the legacy repository or synchronize RepoLens.

**Phase 7A status (2026-08-30): Complete.** The audit fixes the complete feature evaluation matrix, builtin
manifest draft, pure descriptor and lifecycle contract, exact-origin authorization, threat model,
single-source repository boundary and three clean-room 7B PoC candidates. OneWeb passes typecheck, full-repository
lint, all 430 unit tests, the deterministic 20-file SDK package/export gate, production Chromium
build, all 19 Chromium scenarios against the freshly built `extension/` artifact and `git diff
--check`. RepoLens remains unchanged and passes all 34 tests plus its offline 14-file vendor gate and
`git diff --check`; the cross-repository verifier continues to report the expected unsynchronized
`typedCapabilities.storage.module`/artifact drift. The legacy repository remains clean and unchanged
at
`448bf86d031881b3df687a6bcda416acd39307fa`.

Phase 7B-A, the pure validator/lifecycle/resource-ledger foundation, is complete. Phase 7B-B,
**Exact-origin injection and lifecycle channel**, is next. Tool PoCs remain deferred to 7B-C after
the injection and authenticated generation boundary pass their own review.

## 13. Phase 7C-D decision addendum

The Phase 7A matrix above is an immutable audit of the decision at that checkpoint. Phase 7C-D has
now resolved its two deferred generic concepts without changing that historical record:

- **Night mode — no-go for the current catalog.** A finite palette or strength setting would not
  make whole-page inversion accessible, frame-safe or compatible with site/browser themes. It may
  return only as a separate clean-room appearance proposal with visual and accessibility gates.
- **Element spacing inspection — no-go for the current catalog.** Safe hit testing, box geometry,
  zoom/scroll invalidation, overlays, interaction ownership and teardown require a distinct reviewed
  subsystem. The legacy `GM_xmlhttpRequest` plus downloaded `spacingjs` `eval` path is permanently
  rejected and is not migration input.

The final Page Toolbox catalog therefore remains exactly `password-visibility`, `free-page-edit`
and `selection-copy-release`. No fourth descriptor, permission, generic DOM/code/network bridge or
legacy source entered OneWeb.

Chromium continues to prove the real user-facing exact-origin permission flow. The new Firefox gate
uses a production temporary installation and repository-only browser automation to pre-grant two
fixture origins in the real extension permission store before exercising the normal product
prepare/confirm, injection, trusted-sidebar, closed-Shadow, disable and revoke paths. No production
test hook was added. Firefox retained explicit non-default-port permission patterns without matching
their page URIs; OneWeb fails closed instead of broadening authority to every port. The Firefox gate
uses enforceable default-port exact origins `http://127.0.0.1` and `http://localhost`, while
non-default-port Firefox sites remain unsupported under this exact-origin contract.

**Phase 7C-D status (2026-09-02): Complete.** OneWeb passes typecheck, full lint, 554/554 unit
tests, the deterministic 20-file SDK package/export gate, production Chromium and Firefox builds,
24/24 Chromium E2E scenarios, strict Firefox manifest validation and the 1/1 real Firefox
two-origin/three-tool lifecycle and isolation gate. RepoLens remains unchanged on 34 tests and its
offline 14-file vendor gate with the expected explicit SDK drift. The legacy repository remains
clean and read-only at `448bf86d031881b3df687a6bcda416acd39307fa`. Phase 7D is the next separate
stage; no tag, migration notice, external retirement action or archive was performed here.

Phase 7D is now simplified by
[`ADR-0020`](adr/0020-pre-release-clean-slate.md). OneWeb is unreleased and has no users, so there is
no GM data migration, compatibility contract, notice-only branch, preservation tag or staged
retirement campaign. This audit remains only as technical evidence for the clean-room rewrite and
permanent rejection list. The untouched prototype repository may be archived directly through a
separately authorized external action.
