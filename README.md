# one-webext · RepoLens bridge

one-webext is the local, packaged browser bridge for RepoLens. Chrome and Edge use the native
Side Panel; Firefox uses `sidebar_action`. The panel embeds only the remote RepoLens `/embed`
page, while all extension privileges stay in the packaged background and content-script code.

## Local development

Start RepoLens first:

```bash
cd /home/juck/Projects/repolens-starter
npm start
```

Build Chromium and load `artifacts/chromium/` as an unpacked extension:

```bash
cd /home/juck/Projects/one-webext
pnpm build
```

Add the resulting `chrome-extension://<id>` to RepoLens `EXTENSION_ORIGINS`, then restart
RepoLens. The unpacked artifact in this workspace currently resolves to:

```text
chrome-extension://hocpddkhengjbakplaimbjkncmcjofhj
```

Build, lint and package Firefox separately:

```bash
pnpm build:firefox
pnpm manifest:validate
pnpm pack:xpi
```

Firefox uses the stable add-on ID `repolens@one-webext.local`; its temporary local
`moz-extension://<uuid>` must also be added to RepoLens `EXTENSION_ORIGINS` for local testing.
The packaged XPI is `extension.xpi` and the unpacked files are preserved in `artifacts/firefox/`.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
PLAYWRIGHT_HTML_OPEN=never pnpm test:e2e
PW_BROWSER_CHANNEL=msedge PLAYWRIGHT_HTML_OPEN=never pnpm test:e2e
```

The browser test loads a real extension, visits a real GitHub repository, exercises SPA route
changes and exact-duplicate navigation, opens the packaged 420px panel page, verifies the iframe
handshake, rejects a forged origin, confirms cached-summary-first behavior, and triggers a deep
analysis. Firefox additionally uses a `tabs.onUpdated` URL fallback so MV3 event-page suspension
cannot drop a full-navigation context update; SPA transitions still use the content script.

## Data and security boundaries

```text
GitHub Content Script
  owner/repo + URL + pageType only
        ↓ runtime message
Background / Service Worker
  validates GitHub sender, stores per-tab context, removes duplicates
        ↓ runtime message
Packaged Side Panel / Firefox Sidebar
  strict targetOrigin + protocol v1 + one-time session nonce
        ↓ postMessage
RepoLens /embed
  sandboxed remote origin, no chrome/browser API access
```

- No iframe or report UI is injected into GitHub's DOM.
- The content script never reads or uploads page text, README content, private code, or form data.
- The manifest grants only `activeTab`, `storage`, `tabs`, and Chromium `sidePanel`, plus exact
  GitHub and RepoLens host permissions.
- RepoLens `/embed` checks exact `event.origin`, `event.source`, protocol version and nonce.
- Production uses HTTPS, explicit extension origins, `AUTH_MODE=session`, a one-time authorization
  code and a short-lived Bearer session. The GitHub Token, search credentials and model credentials
  remain server-only.

Implementation details and remaining deployment considerations are documented in
[`docs/architecture.md`](docs/architecture.md).
