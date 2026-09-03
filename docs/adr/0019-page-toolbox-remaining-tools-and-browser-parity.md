# ADR-0019: Page Toolbox remaining-tool decisions and browser parity gate

- **Status:** Accepted (Phase 7C-D Complete)
- **Date:** 2026-09-02
- **Scope:** Night-mode/spacing-inspection decision and Chromium/Firefox lifecycle parity

## Context

Phase 7C-C closes the authority-bearing Page Toolbox product path with exactly three clean-room,
packaged tools and two finite control surfaces. The legacy audit deferred two generic concepts:
night mode and element-spacing inspection. Deferral did not approve either implementation. The
legacy night mode owns no stable marker, mutates global rendering and recursively attempts child
frames; spacing inspection downloads `spacingjs` and evaluates its response. The latter is a
permanent security rejection, not a migration source.

Phase 7C-D must decide whether either concept belongs in the current catalog and prove that the
accepted three-tool runtime, trusted sidebar and closed Shadow control keep their exact-origin and
generation isolation in both supported browser families. It must not use the parity work as a reason
to add a generic DOM inspector, arbitrary selector/action language, remote code or broader host
permission.

## Candidate decision matrix

| Candidate                  | User value                                                                         | Finite static schema                         | Reversible ownership                                                                                                                                          | Browser/product risk                                                                                                      | PoC cost                                                   | Decision                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Night mode                 | Moderate convenience, but modern sites and browsers commonly provide native themes | A finite strength/palette schema is possible | One owned style can be ledgered, but restoring global rendering does not resolve site-owned filters, media, canvases, frames or native theme conflicts        | High visual breakage, accessibility/contrast risk and inconsistent top-frame/frame behavior                               | Medium for a CSS effect; high for product-quality behavior | **No-go for the current Page Toolbox catalog.** Reconsider only as a dedicated appearance product with visual/accessibility acceptance, not as the legacy opacity inversion.        |
| Element spacing inspection | Useful to a narrow developer audience                                              | A finite on/off schema is possible           | A rewrite could own overlay nodes/listeners/observers, but safe hit-testing, geometry invalidation, scroll/zoom and teardown require a new reviewed subsystem | High performance and interaction interference; Firefox/Chromium box-model and zoom behavior require dedicated conformance | High                                                       | **No-go for the current Page Toolbox catalog.** The remote request plus `eval` implementation is permanently rejected; any future inspector must be a separate clean-room proposal. |

The packaged catalog therefore remains exactly password visibility, explicit free edit and finite
selection/copy release. A theoretical finite schema is necessary but not sufficient: the candidate
must also have a product-quality effect, complete ownership model and browser-parity evidence before
production authority is added.

## Browser parity decision

Chromium remains the complete end-to-end product gate. Firefox receives a production Firefox build,
strict add-on lint, static manifest/artifact boundary checks and a real temporary-install smoke gate.
The real gate must use the shipped Firefox manifest and packaged content runtime, not a test-only
copy. It must prove an enabled, approved exact origin can create one closed top-frame control, apply
several existing tools, synchronize through both finite controls, keep a second origin unchanged and
drain owned DOM/listeners on revoke or disable. Unrelated Registry records, module namespaces,
extension permissions and storage remain unchanged.

Firefox-specific test orchestration may automate the browser only from repository test code. It may
not add production messages, debug globals, static matches, permissions, content scripts or a test
capability. Browser-family differences remain in the manifest adapter (`sidebar_action` versus
`side_panel`); Page Toolbox contracts and runtime code stay identical.

The Firefox gate pre-grants each fixture's exact origin through privileged repository-only browser
automation, then uses the production prepare/confirm, injection, sidebar and lifecycle paths. This
changes the real temporary extension permission store but adds no production test hook. Chromium E2E
continues to cover the user-facing permission request and confirmation flow.

Firefox testing also exposed a platform limitation that the authorization model must not hide. A
host permission containing an explicit non-default port is retained in Firefox's active permission
list, but does not match the corresponding page URI. OneWeb must fail closed for that origin; it must
not widen the grant to every port on the host. The parity gate therefore uses two distinct HTTP
origins on the default port, `http://127.0.0.1` and `http://localhost`, whose exact match patterns
are enforceable. Page Toolbox on Firefox does not claim support for origins with explicit
non-default ports until the browser can enforce that same exact-origin boundary.

## Rejected alternatives

- Porting the legacy opacity-inversion CSS or recursive frame logic.
- Bundling or fetching `spacingjs`, evaluating downloaded text or exposing a DOM-inspection bridge.
- Adding a generic selector, CSS, event, script, expression or overlay command to either control.
- Calling a jsdom-only test a Firefox product gate.
- Adding permanent Firefox-only production behavior solely for automation.
- Expanding the catalog before a candidate has its own threat model and acceptance evidence.

## Phase boundary

Phase 7C-D may record the two no-go decisions and add browser-parity build/test infrastructure for
the already accepted runtime and controls. It must not add a fourth tool, migrate legacy source,
change Page Toolbox permissions or perform external repository administration.

## Acceptance evidence

Accepted on 2026-09-02 with the catalog unchanged at three tools. OneWeb passes typecheck,
full-repository lint, **554/554 unit tests**, the reproducible **20-file SDK** package/export gate,
production Chromium build, **24/24 Chromium E2E** scenarios, production Firefox build, strict
Firefox manifest validation and the **1/1 real Firefox lifecycle gate**. The Firefox gate proves two
origins, all three tools, the trusted sidebar, closed Shadow control, disable/re-enable, revoke and
unrelated Registry/module namespace/permission/storage isolation through a temporary production
installation. RepoLens remains unchanged on its **34-test/14-file** offline vendor baseline with the
expected explicit SDK drift; both writable repositories pass `git diff --check`, and the legacy
repository remains clean at `448bf86d031881b3df687a6bcda416acd39307fa`.
