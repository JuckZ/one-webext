# Browser Extension Architecture Roadmap

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

## Upgrade backlog

- Split `src/background/main.ts` into menu, commands, debugger, DNR, side panel, and messaging modules.
- Convert broad host permissions into optional host permissions where product flows allow it.
- Add contract tests for message payloads and storage migrations.
- Raise coverage thresholds as critical background/content logic gains tests.
