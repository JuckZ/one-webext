# ADR-0022: Keep Send to OpenList a server-backed resource inbox

- **Status:** Accepted (Phase 9 Complete)
- **Date:** 2026-09-03
- **Scope:** Post-RC product boundary, API compatibility, data contracts and threat model

## Context

OneWeb needs a low-maintenance way to hand user-selected resource addresses to an existing download
service. Implementing website-specific private APIs in the extension would require cookies,
referers, request interception and continuous adaptation to undocumented protocols. Moving file
bytes through the browser would also duplicate OpenList/AList download, upload, task and storage
responsibilities.

The accepted `v0.1.0-rc.1` tag and its browser archives are frozen. Send to OpenList is post-RC work
on a separate branch; it cannot change that tag, its evidence or its artifacts.

## Current compatibility evidence

The audit was performed on 2026-09-03 against these immutable upstream references:

- OpenList release [`v4.2.6`](https://github.com/OpenListTeam/OpenList/releases/tag/v4.2.6), commit
  [`2bdf16d5967d0a403f67d809efd5a418b8f5bd30`](https://github.com/OpenListTeam/OpenList/tree/2bdf16d5967d0a403f67d809efd5a418b8f5bd30).
- AList release [`v3.64.0`](https://github.com/AlistGo/alist/releases/tag/v3.64.0), commit
  [`3e49fa4630e668beb76a81e8dd8d55db80b37a69`](https://github.com/AlistGo/alist/tree/3e49fa4630e668beb76a81e8dd8d55db80b37a69).
- OpenList documentation commit
  [`6da7ecadcfa668db33355f60aa8c26cd6ff9fe25`](https://github.com/OpenListTeam/OpenList-Docs/commit/6da7ecadcfa668db33355f60aa8c26cd6ff9fe25),
  including its explicit warning that offline-download permission can reach resources from the
  server's network context.
- Current official documentation entry points:
  [OpenList API](https://doc.oplist.org/api/apidocs),
  [OpenList offline download](https://doc.oplist.org/guide/advanced/offline-download),
  [AList authentication](https://alistgo.com/guide/api/auth.html),
  [AList filesystem API](https://alistgo.com/guide/api/fs.html), and
  [AList task API](https://alistgo.com/guide/api/task.html).

The source, rather than an generated example, is authoritative where the two disagree:

- Both route `GET /api/me`, `/api/public/offline_download_tools`,
  `POST /api/fs/add_offline_download`, `GET /api/task/offline_download/undone|done`, and
  `POST /api/task/offline_download/cancel?tid=...`. See the pinned
  [OpenList routes](https://github.com/OpenListTeam/OpenList/blob/2bdf16d5967d0a403f67d809efd5a418b8f5bd30/server/router.go#L70-L108)
  and [AList routes](https://github.com/AlistGo/alist/blob/3e49fa4630e668beb76a81e8dd8d55db80b37a69/server/router.go#L70-L114).
- `Authorization` is the raw configured API token or raw JWT string. The middleware passes the
  header directly to constant-time API-token comparison or JWT parsing; it does not strip a
  `Bearer ` prefix. See [OpenList authentication](https://github.com/OpenListTeam/OpenList/blob/2bdf16d5967d0a403f67d809efd5a418b8f5bd30/server/middlewares/auth.go#L17-L70)
  and [AList authentication](https://github.com/AlistGo/alist/blob/3e49fa4630e668beb76a81e8dd8d55db80b37a69/server/middlewares/auth.go#L22-L102).
- AList additionally derives and enforces a device session from `Client-Id`; OpenList does not.
  The common connector may send one host-derived, stable, non-secret `Client-Id` per profile, which
  OpenList ignores. Callers cannot set this header.
- OpenList tool discovery accepts `path` and adds a native destination-storage tool when relevant;
  AList returns all ready tools and ignores the query. See
  [OpenList tool discovery](https://github.com/OpenListTeam/OpenList/blob/2bdf16d5967d0a403f67d809efd5a418b8f5bd30/internal/offline_download/tool/tools.go#L28-L61)
  and [AList tool discovery](https://github.com/AlistGo/alist/blob/3e49fa4630e668beb76a81e8dd8d55db80b37a69/internal/offline_download/tool/tools.go#L26-L35).
  Tool names are therefore dynamic data, never a OneWeb enum.
- Both add handlers accept `{ urls, path, tool, delete_policy }`, loop over `urls`, and return the
  tasks accumulated so far only after the loop. An error stops the loop without rolling back tasks
  already added. See the pinned [OpenList handler](https://github.com/OpenListTeam/OpenList/blob/2bdf16d5967d0a403f67d809efd5a418b8f5bd30/server/handles/offline_download.go#L520-L581)
  and [AList handler](https://github.com/AlistGo/alist/blob/3e49fa4630e668beb76a81e8dd8d55db80b37a69/server/handles/offline_download.go#L333-L386).
- Task `undone` and `done` return complete arrays with no pagination contract. `cancel` identifies
  one task with the `tid` query parameter. OneWeb must cap response bytes and item count locally.
- Both pinned task handlers expose the same `id`, `name`, numeric `state`, status, progress,
  timestamps, total bytes, creator and error fields, apart from the Go type used for creator role.
  OneWeb's pure projection keeps only bounded task ID/name/state/status/progress/total-bytes/error
  data and deliberately drops creator identity, role and timestamps. See the pinned
  [OpenList task projection](https://github.com/OpenListTeam/OpenList/blob/2bdf16d5967d0a403f67d809efd5a418b8f5bd30/server/handles/task.go#L19-L67)
  and [AList task projection](https://github.com/AlistGo/alist/blob/3e49fa4630e668beb76a81e8dd8d55db80b37a69/server/handles/task.go#L17-L65).
- Application success and failure are normally wrapped as `{ code, message, data }` while the HTTP
  status remains 200. The connector must validate both transport and application status and must
  never expose an upstream message as trusted UI or log text.
- `SimpleHttp` may complete by direct server-side `PutURL` and return no task object. A successful
  add response with an empty `tasks` array is therefore accepted-without-task-id, not a protocol
  failure.

The generated examples found during discovery included a `Bearer` example and an older hard-coded
tool list. Both are rejected as compatibility contracts because the current pinned middleware and
tool registry demonstrate different behavior.

## Decision

### Product and trust boundary

`dev.oneweb.send-to-openlist` is one packaged builtin. It is a resource inbox, not a cloud-drive
adapter. The browser discovers, normalizes and displays addresses; the user confirms a destination
path and one server-returned tool; the trusted background calls a fixed connector; OpenList/AList
owns downloading, transfer, persistence and task execution.

The extension never transports file bytes, cookies, referers or page-provided headers. It never
intercepts site requests or implements Baidu, Quark, 115, Aliyun or other private APIs. Their share
links remain ordinary HTTP(S) candidates and may fail with a server-not-supported result.

### Fixed connector surface

The connector has exactly five operation families: verify an existing token with `/api/me`, discover
tools, add one resource, list undone/done offline-download tasks, and cancel one reviewed task. The
method, path, headers and JSON body are host-owned constants. A caller can supply only a validated
profile ID, candidate ID, destination path, selected returned tool and reviewed task ID.

Authentication means checking a user-provided token, not accepting a username/password or calling a
login endpoint. Every add request contains exactly one URL and a host-owned
`delete_policy: "delete_on_upload_succeed"`; the server's batch shape is never exposed. At most two
adds may be in flight and at most 50 deduplicated candidates may be selected. A transport failure
after dispatch is `outcome-unknown`; it is never retried automatically.

The task lists are server authority. OneWeb has no persistent task queue, no polling and no retry.
Cancellation requires a short-lived, single-use review plan bound to profile, exact origin,
connection generation and a task from the latest normalized undone snapshot.

Canonical results repeat request ID, operation and complete authority. Success data has one finite
shape per operation; errors contain one stable code and never an upstream message. The accepted
codes include validation, module/lifecycle, permission/grant, authentication, transport,
HTTP/application rejection, response-bound and ambiguous-write failures. They never contain the
upstream message.

### Profiles and secrets

The non-secret profile schema is an array from version 1, capped at eight profiles, while the MVP UI
shows one active profile. A profile contains only version, ID, label and canonical exact HTTP(S)
origin. HTTP is permitted for common self-hosted deployments but must carry an explicit cleartext
token warning unless the origin is loopback; HTTPS is recommended.

Tokens are separate trusted-background records under a host-derived physical key. They are local
only and never enter sync storage, profiles, candidates, commands, results, DOM, URL, logs, Registry,
generic module state, context bridge or remote-frame. The UI must state that extension local storage
is not an OS-grade key vault and recommend a dedicated minimum-permission account. Deleting a
profile, removing/reinstalling the builtin or revoking its origin grant clears the corresponding
token. Disabling retains configuration but cancels all transient authority. Worker restart retains
explicitly stored profile/token data, loses in-flight authority and never reconnects or retries.

### Candidate contract and quotas

`ResourceCandidate` contains only stable ID, URL, kind, source and optional title. Supported schemes
are `http`, `https`, `magnet` and `ed2k`. HTTP(S) fragments are removed while the remaining serialized
URL, including query order and escaping, is preserved so signed query strings are not rewritten.
Credentials and control characters are rejected. `blob:`, `data:`, `javascript:`, `file:` and every
other scheme are rejected.

Limits are fixed at 8 KiB per URL, 512 bytes per title, 12 KiB per candidate, 200 discovered
candidates / 512 KiB total discovery data, and 50 selected candidates / 256 KiB per submission
batch. IDs are deterministic deduplication labels, never authorization tokens.

Destination paths are limited to 2 KiB, dynamic tool names to 256 bytes and 128 items, task IDs to
512 bytes, task lists to 1,024 items, upstream display fields to 512 bytes and any normalized
response to 512 KiB. These are client memory and display bounds, not upstream pagination semantics.

All candidate text is untrusted and is rendered only as text. Discovery never submits. Context menu,
current-page and page-scan sources are deferred to Phase 9D and must use explicit user gestures,
`activeTab + scripting`, top frame only, with no persistent content script or static `<all_urls>`.

### SSRF decision

Explicit local-use targets are hard-blocked from submission in the MVP: `localhost` and its
subdomains, single-label and `.local`/`.internal`/`.home.arpa` names, and literal loopback, private,
link-local, unspecified, multicast or reserved IPv4/IPv6 addresses. The classifier must operate on
the URL parser's canonical hostname so alternative IPv4 forms such as integer, hexadecimal and
short dotted notation cannot bypass literal checks.

Ordinary hostnames remain `server-policy-required`, because DNS can resolve or rebind to a private
address after browser validation and the resource server can redirect. Magnet and ed2k addresses are
opaque peer/server inputs and carry the same warning. OneWeb's warning and hard block reduce obvious
mistakes; neither can claim to enforce OpenList/AList egress policy. Safe redirect resolution, DNS
pinning and destination filtering belong to the OpenList/AList administrator and outbound network.

Connector requests themselves go only to the profile's approved exact origin. Redirects are rejected
instead of forwarding a token, and candidate data cannot select an API origin, path, method,
Authorization value, `Client-Id` or other header.

## Threat model

- **Confused deputy:** canonical commands derive profile/origin, endpoint, method, headers and secret
  from authenticated builtin state. No remote module or page can call the connector.
- **Credential disclosure:** profile and candidate clones reject unknown fields; secret-bearing
  objects are never returned or logged. Response text is untrusted and bounded.
- **Server-side request forgery:** explicit local-use addresses are blocked, but DNS, redirects and
  opaque peer protocols remain server-side risks and are labelled as such.
- **Partial and ambiguous writes:** each add has one URL; first-terminal-wins records success,
  failure or outcome-unknown. No automatic retry can duplicate a task.
- **Stale authority:** every command binds profile ID, exact origin and lifecycle generation.
  Disable, remove, grant revocation, profile replacement and worker restart invalidate old commands.
- **Flooding and memory pressure:** fixed string, item, body and response limits apply before cloning
  or state insertion; only two writes may be active.
- **Task cancellation substitution:** cancel plans bind a freshly listed task and expire after one
  use. Arbitrary task IDs cannot be submitted directly.
- **Untrusted text:** titles, URLs, tool names, paths, task fields and upstream messages never become
  HTML or executable content.

## Explicit non-goals

Phase 9 does not add page cookies, referers, custom headers, arbitrary HTTP methods or paths,
browser-side file download/upload, HEAD probes, automatic polling/retry, a persistent queue,
private-site adapters, XHR interception, DRM/MSE/blob capture, WebDAV upload, remote code, script or
expression execution, or generic network capability.

A future site adapter is considered only when an official stable API needs no page cookie/XHR,
fits a static finite schema and can be disabled independently.

## Phase boundary

Phase 9A added only documentation and browser-independent pure validators, normalizers, classifiers,
canonical command/result constructors, a two-write submission reducer and a single-use cancellation
review reducer. It did not change extension permissions or manifest, access browser/chrome, DOM,
network, storage or a real secret, or add product UI.

Phase 9B added the packaged builtin record and trusted-background PoC only. The connector uses the
fixed `/api/me`, `/api/public/offline_download_tools?path=...` and
`/api/fs/add_offline_download` endpoints. Tool discovery is public upstream, so it deliberately does
not carry `Authorization`; authenticated endpoints use the raw token and a host-derived non-secret
`Client-Id`. Profile metadata and the installation-bound token occupy separate `storage.local`
records. A worker restart restores only the disconnected profile/token-presence snapshot, revokes
stale capability authority, and performs no network request.

Phase 9C added the smallest one-profile management surface and the remaining fixed task operations:
explicit `undone`/`done` reads and reviewed cancellation. Manual URL input is normalized and shown
before any submission; server tools and paths are reviewed explicitly; every add has an independent
terminal result. Cancellation consumes a short-lived token, re-reads the authoritative undone list,
and rejects replaced, stale or repeated authority. The UI renders all candidate, task and upstream
text with `textContent`, stores no local task queue, and never polls or retries. Browser resource
entry points were kept separate for Phase 9D.

Phase 9D added only explicit browser discovery. Three fixed context menus collect page, link or
media addresses when the builtin is enabled. The management surface can capture the current page or
run one fixed packaged scanner through `activeTab + scripting`, targeting frame `0` only. Results
are normalized into a worker-memory inbox and rendered for review; discovery never calls the
connector. The manifest adds `contextMenus` but no host grant, resident content script or
`<all_urls>`. Navigation data cannot add headers, cookies, methods, endpoint paths or code.

Phase 9E closed the MVP without adding a provider-specific implementation. The same fixed connector
passes separate pinned OpenList and AList fixtures; AList's device-session requirement is satisfied
only by a host-derived, non-secret `Client-Id`, and both services continue to supply tool names
dynamically. The versioned profile collection supports up to eight exact-origin profiles and
separate per-profile token records while the UI exposes one active profile. Switching or deleting a
profile, revoking one origin, disabling the builtin, replacing its installation identity or
restarting the worker affects only the bound authority and never triggers an automatic request.
Because this packaged builtin is protected, ordinary module removal is safely refused; the tested
installation-identity replacement path clears its own profiles and tokens. Chromium and Firefox
production gates cover service differences, discovery, token non-disclosure, lifecycle cleanup and
unchanged state for every existing builtin and remote module.
