# OneWeb Architecture Roadmap

The long-term product architecture treats RepoLens as the first remote module rather than a
hard-coded product identity. The module model, trust boundaries, manifest format and evolution
plan are specified in [`module-platform-architecture.md`](module-platform-architecture.md).

## Current RepoLens implementation

The active product path is intentionally narrow:

1. `src/modules/providers/github-repository-observer.ts` observes GitHub History API, Turbo and
   PJAX navigation with a short debounce. It emits a provider update or an explicit removal when a
   SPA route stops being a repository.
2. `src/background/main.ts` delegates source validation, normalization, per-tab state and dedupe to
   `ContextBroker`, then sends a generic active-tab snapshot to the panel. A URL-only
   `tabs.onUpdated` fallback covers Firefox MV3 event-page suspension during full navigation.
3. `src/sidebar/main.ts` selects the seeded RepoLens record and delegates the remote iframe to
   `ModuleFrameHost`. The host verifies the initial window message, transfers a nonce-protected
   `MessageChannel`, and sends only the intersection of provider output, manifest
   `context_fields`, and installed field grants. The iframe is sandboxed and cannot use extension
   APIs.
4. RepoLens `/embed` shows a cached summary first. Deep analysis happens after dwell time or when
   the user presses the button.

Chromium artifacts use `side_panel`; Firefox artifacts remove that key and add `sidebar_action`.
The build defines `__FIREFOX__` so Chromium-only APIs are removed from the Firefox bundle rather
than merely guarded at runtime. Firefox packages must pass `web-ext lint --warnings-as-errors`.

## Target stack

- **Manifest V3 first**, with Firefox compatibility isolated behind manifest generation branches.
- **Vue 3 + Vite + TypeScript** for extension pages, background/service worker, content scripts, and DevTools surfaces.
- **Strict TypeScript** with bundler module resolution, isolated modules, modern ES targets, and incremental type checking.
- **Vitest + Vue Test Utils + V8 coverage** for unit/component tests.
- **Playwright extension E2E** for Chromium smoke tests against the built `extension/` directory.
- **GitHub Actions quality gates** for install, typecheck, lint, coverage, build, artifact upload, and optional store publishing.

## Architecture principles

1. Keep privileged extension logic in background modules and expose narrow message contracts to pages/content scripts.
2. Treat manifest permissions as product surface area: prefer optional permissions and explicit user activation for sensitive APIs.
3. Keep content scripts idempotent so repeated injection cannot mount duplicated UI or listeners.
4. Keep build configs DRY by sharing Vite defaults and using small entry-specific configs only for output shape.
5. Run typecheck, lint, coverage, and build in CI before producing extension artifacts.

Clash Control follows the same trust split. Phase 4A selected a packaged builtin connector through
[`ADR-0001`](adr/0001-clash-control-packaged-builtin.md): the trusted background alone can attach a
one-shot secret to fixed read-only localhost endpoints, while remote frames retain only the generic
field-filtered context bridge.

## Upgrade backlog

- Split `src/background/main.ts` into menu, commands, debugger, DNR, side panel, and messaging modules.
- Convert broad host permissions into optional host permissions where product flows allow it.
- Add contract tests for message payloads and storage migrations.
- Raise coverage thresholds as critical background/content logic gains tests.
