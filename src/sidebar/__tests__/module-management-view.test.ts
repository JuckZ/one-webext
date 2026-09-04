import {
  type BookmarkDoctorWorkspaceState,
  type BookmarkRepairPlan,
  type BookmarkRestorePlan,
  type BookmarkScanSnapshot,
  createBookmarkDoctorSeed,
} from '~/modules/builtin/bookmark-doctor'
import {
  type ClashConnectionPreparation,
  type ClashConnectionStatus,
  type ClashProxySwitchPlan,
  type ClashReadOnlySnapshot,
  createClashControlSeed,
} from '~/modules/builtin/clash-control'
import type { ClashControlResult } from '~/modules/builtin/clash-control/protocol'
import {
  createPageToolboxSeed,
  type PageToolboxControlSnapshotV1,
} from '~/modules/builtin/page-toolbox'
import {
  createSendToOpenListSeed,
  type ResourceCandidateV1,
  type SendToOpenListConnectionSnapshotV1,
} from '~/modules/builtin/send-to-openlist'
import type { ModuleInstallReview } from '~/modules/installer'
import type {
  ModuleInstallCancelManagementResult,
  ModuleInstallConfirmManagementResult,
  ModuleInstallPrepareManagementResult,
  ModuleRemoveManagementResult,
  ModuleSetEnabledManagementResult,
  ModuleUpdateApplyManagementResult,
  ModuleUpdateApproveManagementResult,
  ModuleUpdateCheckManagementResult,
} from '~/modules/management-client'
import { createRepoLensSeed } from '~/modules/seeds/repolens'
import type {
  InstalledModuleRecord,
  ModuleUpdateApprovalSnapshot,
  RemoteFrameModuleManifest,
} from '~/modules/types'
import {
  type BookmarkDoctorActions,
  type ClashControlActions,
  type ModuleManagementActions,
  ModuleManagementView,
  type PageToolboxActions,
  type SendToOpenListActions,
} from '../module-management-view'

function moduleRecord(source: 'seeded' | 'user', name = 'RepoLens'): InstalledModuleRecord {
  const seed = createRepoLensSeed('http://127.0.0.1:4747')
  return {
    manifest: {
      ...seed.manifest,
      id: source === 'seeded' ? seed.manifest.id : 'dev.juck.fixture',
      name,
    },
    enabled: true,
    source,
    ...(source === 'user' ? { sourceUrl: 'http://127.0.0.1:4747/.well-known/oneweb-module.json' } : {}),
    grantedContexts: seed.grantedContexts,
    grantedContextFields: seed.grantedContextFields,
    grantedCapabilities: seed.grantedCapabilities,
    update: null,
    installedAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
}

function bookmarkDoctorRecord(granted = false, repairs = false): InstalledModuleRecord {
  const seed = createBookmarkDoctorSeed()
  return {
    manifest: seed.manifest,
    enabled: true,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [
      ...(granted ? ['bookmarks.read' as const] : []),
      ...(repairs ? ['bookmarks.write' as const] : []),
    ],
    update: null,
    installedAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  }
}

function clashControlRecord(granted = false): InstalledModuleRecord {
  const seed = createClashControlSeed()
  return {
    manifest: seed.manifest,
    enabled: true,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: granted ? ['clash.status.read'] : [],
    update: null,
    installedAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  }
}

function pageToolboxRecord(enabled = true): InstalledModuleRecord {
  const seed = createPageToolboxSeed()
  return {
    manifest: seed.manifest,
    enabled,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
    update: null,
    installedAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
  }
}

function sendToOpenListRecord(): InstalledModuleRecord {
  return {
    manifest: createSendToOpenListSeed().manifest,
    enabled: true,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
    update: null,
    installedAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
  }
}

function pageToolboxSnapshot(
  access: PageToolboxControlSnapshotV1['access'],
  revision = 0,
  pageTitle = 'Alpha <script>not-executed</script>',
): PageToolboxControlSnapshotV1 {
  const ready = access === 'ready'
  return {
    schemaVersion: 1,
    revision,
    pageTitle,
    exactOrigin: access === 'unsupported' ? null : 'https://alpha.example',
    access,
    siteSettings: ready
      ? { enabledToolIds: [], toolSettings: {} }
      : null,
  }
}

function createPageToolboxActions(snapshot = pageToolboxSnapshot('site-unapproved')): PageToolboxActions {
  const preparation = {
    token: 'a'.repeat(48),
    exactOrigin: 'https://alpha.example',
    originPattern: 'https://alpha.example/*',
    expiresAt: '2026-09-02T00:01:00.000Z',
  }
  return {
    status: vi.fn(async () => ({ ok: true as const, operation: 'control-status' as const, snapshot })),
    prepare: vi.fn(async () => ({ ok: true as const, operation: 'prepare' as const, preparation })),
    confirm: vi.fn(async () => ({
      ok: true as const,
      operation: 'confirm' as const,
      changed: true,
      injected: true,
      preparation,
    })),
    replace: vi.fn(async (_expectedRevision, siteSettings) => ({
      ok: true as const,
      operation: 'replace-site-settings' as const,
      changed: true,
      synchronized: 1,
      snapshot: {
        ...pageToolboxSnapshot('ready', snapshot.revision + 1),
        siteSettings,
      },
    })),
    revoke: vi.fn(async () => ({
      ok: true as const,
      operation: 'revoke' as const,
      changed: true,
      releasedOrigin: true,
    })),
  }
}

function clashSwitchSnapshot(): ClashReadOnlySnapshot {
  return {
    version: 1,
    controllerOrigin: 'http://127.0.0.1:19090',
    generation: 4,
    refreshedAt: '2026-08-29T01:00:00.000Z',
    implementation: 'Clash.Meta',
    controllerVersion: '1.20.0',
    mode: 'rule',
    proxyGroups: [{
      name: 'GLOBAL <img data-clash-switch-xss src=x>',
      type: 'Selector',
      selectedNode: 'Node A',
      nodes: [
        { name: 'Node A', type: 'Vmess', alive: true },
        { name: 'Node B <script>ignored</script>', type: 'Shadowsocks', alive: false },
      ],
    }],
  }
}

function clashSwitchPlan(): ClashProxySwitchPlan {
  const snapshot = clashSwitchSnapshot()
  return {
    version: 1,
    token: 'ui-switch-token-never-rendered',
    controllerOrigin: snapshot.controllerOrigin,
    generation: snapshot.generation,
    snapshotVersion: snapshot.version,
    snapshotRefreshedAt: snapshot.refreshedAt,
    groupName: snapshot.proxyGroups[0]!.name,
    groupType: snapshot.proxyGroups[0]!.type,
    originalNode: snapshot.proxyGroups[0]!.selectedNode,
    targetNode: snapshot.proxyGroups[0]!.nodes[1]!.name,
    createdAt: '2026-08-29T01:00:10.000Z',
    expiresAt: '2026-08-29T01:01:10.000Z',
  }
}

function connectedClashStatus(snapshot = clashSwitchSnapshot()) {
  const status: ClashConnectionStatus = {
    controllerOrigin: snapshot.controllerOrigin,
    implementation: snapshot.implementation,
    version: snapshot.controllerVersion,
    mode: snapshot.mode,
    connectedAt: '2026-08-29T00:59:00.000Z',
  }
  return {
    ok: true as const,
    operation: 'status' as const,
    connection: {
      phase: 'connected' as const,
      generation: snapshot.generation,
      profile: { version: 1 as const, controllerOrigin: snapshot.controllerOrigin },
      status,
    },
    status,
    readState: { status: 'ready' as const, snapshot, diagnostic: null },
  }
}

function deferredClashResult() {
  let resolve!: (_value: ClashControlResult) => void
  const promise = new Promise<ClashControlResult>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createBookmarkDoctorActions(): BookmarkDoctorActions {
  return {
    authorize: vi.fn(async () => ({ ok: false as const, operation: 'authorize' as const, reason: 'permission-missing' as const })),
    prepare: vi.fn(async () => ({ ok: false as const, operation: 'prepare' as const, reason: 'permission-missing' as const })),
    start: vi.fn(async () => ({ ok: false as const, operation: 'start' as const, reason: 'permission-missing' as const })),
    status: vi.fn(async () => null),
    stop: vi.fn(async () => ({ ok: true as const, operation: 'stop' as const, changed: false, snapshot: null })),
    authorizeRepairs: vi.fn(async () => ({ ok: false as const, operation: 'authorize-repairs' as const, reason: 'permission-missing' as const })),
    prepareRepair: vi.fn(async () => ({ ok: false as const, operation: 'prepare-repair' as const, reason: 'permission-missing' as const })),
    confirmRepairs: vi.fn(async () => ({ ok: true as const, operation: 'confirm-repairs' as const, results: [] })),
    workspaceState: vi.fn(async () => ({ ok: true as const, operation: 'workspace-state' as const, state: { ignoredBookmarks: [], deletionBackups: [] } })),
    unignore: vi.fn(async () => ({ ok: false as const, operation: 'unignore' as const, reason: 'permission-missing' as const })),
    clearLocalData: vi.fn(async () => ({ ok: false as const, operation: 'clear-local-data' as const, reason: 'permission-missing' as const })),
    prepareRestore: vi.fn(async () => ({ ok: false as const, operation: 'prepare-restore' as const, reason: 'permission-missing' as const })),
    confirmRestore: vi.fn(async confirmation => ({ ok: false as const, operation: 'confirm-restore' as const, token: confirmation.token, reason: 'permission-missing' as const })),
    revoke: vi.fn(async () => ({ ok: false as const, operation: 'revoke' as const, reason: 'permission-missing' as const })),
  }
}

function createClashControlActions(): ClashControlActions {
  return {
    prepare: vi.fn(async () => ({
      ok: false as const,
      operation: 'prepare' as const,
      reason: 'invalid-controller-url' as const,
    })),
    connect: vi.fn(async () => ({
      ok: false as const,
      operation: 'connect' as const,
      reason: 'network-failure' as const,
    })),
    status: vi.fn(async () => ({
      ok: true as const,
      operation: 'status' as const,
      connection: {
        phase: 'disconnected' as const,
        generation: 0,
        profile: null,
      },
      status: null,
      readState: { status: 'empty' as const, snapshot: null, diagnostic: null },
    })),
    refresh: vi.fn(async () => ({
      ok: false as const,
      operation: 'refresh' as const,
      reason: 'connection-required' as const,
    })),
    prepareProxySwitch: vi.fn(async () => ({
      ok: false as const,
      operation: 'prepare-proxy-switch' as const,
      reason: 'switch-snapshot-required' as const,
    })),
    confirmProxySwitch: vi.fn(async () => ({
      ok: false as const,
      operation: 'confirm-proxy-switch' as const,
      reason: 'switch-plan-not-found' as const,
    })),
    disconnect: vi.fn(async () => ({
      ok: false as const,
      operation: 'disconnect' as const,
      reason: 'module-disabled' as const,
    })),
  }
}

function installReview(
  name = 'Installable',
  description = 'A reviewed fixture module',
): ModuleInstallReview {
  const seed = createRepoLensSeed('https://modules.example')
  if (seed.manifest.runtime !== 'remote-frame')
    throw new Error('Expected a remote-frame fixture')
  return {
    manifest: {
      ...seed.manifest,
      id: 'dev.juck.installable',
      name,
      description,
      capabilities: ['tabs.open'],
    },
    manifestUrl: 'https://modules.example/.well-known/oneweb-module.json',
    manifestDigest: 'a'.repeat(64),
    originPattern: 'https://modules.example/*',
  }
}

function recordFromReview(
  review: ModuleInstallReview,
  grantedContextFields = { 'github.repository': ['repo', 'pageType'] },
): InstalledModuleRecord {
  return {
    manifest: review.manifest,
    enabled: true,
    source: 'user',
    sourceUrl: review.manifestUrl,
    grantedContexts: ['github.repository'],
    grantedContextFields,
    grantedCapabilities: [],
    update: null,
    installedAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
}

const updateDigest = 'b'.repeat(64)

function recordWithUpdate(
  record: InstalledModuleRecord,
  candidateManifest: RemoteFrameModuleManifest,
  approvalSnapshot: ModuleUpdateApprovalSnapshot | null = null,
): InstalledModuleRecord {
  return {
    ...record,
    update: {
      candidateManifest,
      candidateSourceUrl: record.sourceUrl!,
      normalizedManifestDigest: updateDigest,
      checkedAt: '2026-08-27T09:00:00.000Z',
      approvalStatus: approvalSnapshot
        ? 'approved' as const
        : candidateManifest.id === record.manifest.id ? 'pending' as const : 'rejected' as const,
      approvedManifestDigest: approvalSnapshot ? updateDigest : null,
      approvalSnapshot,
    },
  }
}

function createRoot() {
  const root = document.createElement('section')
  root.innerHTML = `
    <p data-testid="module-manager-status"></p>
    <div data-module-list></div>
    <div data-testid="remove-module-dialog" hidden>
      <span data-remove-module-name></span>
      <button data-cancel-remove>取消</button>
      <button data-confirm-remove>确认</button>
    </div>
    <button data-testid="add-module">添加</button>
    <div data-testid="install-module-dialog" hidden>
      <div data-install-entry>
        <input data-manifest-url />
        <button data-prepare-install>读取</button>
      </div>
      <div data-install-review hidden>
        <span data-install-mark></span>
        <span data-install-name></span>
        <span data-install-description></span>
        <dl data-install-access></dl>
        <div data-install-grants></div>
        <button data-cancel-install>取消</button>
        <button data-confirm-install>安装</button>
      </div>
      <button data-close-install>关闭</button>
      <p data-testid="install-module-status"></p>
    </div>
  `
  document.body.replaceChildren(root)
  return root
}

function createClient(records: InstalledModuleRecord[]) {
  const client: ModuleManagementActions = {
    list: vi.fn(async () => records),
    setEnabled: vi.fn(async (moduleId, enabled): Promise<ModuleSetEnabledManagementResult> => ({
      ok: true,
      operation: 'set-enabled',
      changed: true,
      record: { ...records.find(record => record.manifest.id === moduleId)!, enabled },
    })),
    remove: vi.fn(async (moduleId): Promise<ModuleRemoveManagementResult> => ({
      ok: true,
      operation: 'remove',
      changed: true,
      removed: records.find(record => record.manifest.id === moduleId)!,
    })),
    prepareInstall: vi.fn(async (): Promise<ModuleInstallPrepareManagementResult> => ({
      ok: false,
      operation: 'install-prepare',
      reason: 'fetch-failed',
    })),
    confirmInstall: vi.fn(async (): Promise<ModuleInstallConfirmManagementResult> => ({
      ok: false,
      operation: 'install-confirm',
      reason: 'fetch-failed',
    })),
    cancelInstall: vi.fn(async (): Promise<ModuleInstallCancelManagementResult> => ({
      ok: true,
      operation: 'install-cancel',
      releasedOrigin: false,
    })),
    checkUpdate: vi.fn(async (): Promise<ModuleUpdateCheckManagementResult> => ({
      ok: false,
      operation: 'update-check',
      reason: 'fetch-failed',
    })),
    approveUpdate: vi.fn(async (): Promise<ModuleUpdateApproveManagementResult> => ({
      ok: false,
      operation: 'update-approve',
      changed: false,
      reason: 'no-update-candidate',
    })),
    applyUpdate: vi.fn(async (): Promise<ModuleUpdateApplyManagementResult> => ({
      ok: false,
      operation: 'update-apply',
      reason: 'fetch-failed',
    })),
  }
  return client
}

describe('module management view', () => {
  it('keeps Send to OpenList profile review, manual candidates and submission explicit', async () => {
    const profile = { schemaVersion: 1 as const, id: 'primary', label: 'Home', controllerOrigin: 'https://openlist.example' }
    const preparation = {
      token: 'preparation-token-not-rendered',
      profile,
      originPattern: 'https://openlist.example/*',
      generation: 2,
      expiresAt: '2026-09-04T00:02:00.000Z',
    }
    let connection: SendToOpenListConnectionSnapshotV1 = {
      phase: 'disconnected' as const,
      generation: 1,
      profile: null,
      hasStoredToken: false,
    }
    const actions: SendToOpenListActions = {
      status: vi.fn(async () => ({ ok: true, value: connection })),
      prepare: vi.fn(async () => ({ ok: true, value: preparation })),
      connect: vi.fn(async () => {
        connection = {
          phase: 'connected',
          generation: 2,
          profile,
          hasStoredToken: true,
          connectedAt: '2026-09-04T00:00:00.000Z',
        }
        return { ok: true, value: connection }
      }),
      discoverTools: vi.fn(async () => ({ ok: true, value: ['<img data-tool-xss src=x>', 'SimpleHttp'] })),
      submit: vi.fn(async (candidates: readonly ResourceCandidateV1[]) => ({
        ok: true,
        value: {
          schemaVersion: 1,
          authority: { moduleId: 'dev.oneweb.send-to-openlist', profileId: 'primary', controllerOrigin: profile.controllerOrigin, generation: 2 },
          status: 'completed',
          entries: candidates.map(candidate => ({ candidate, status: 'accepted', taskId: null })),
          inFlight: 0,
        },
      })),
      listTasks: vi.fn(async () => ({ ok: false, reason: 'network-failed' })),
      prepareCancel: vi.fn(async () => ({ ok: false, reason: 'operation-not-allowed' })),
      confirmCancel: vi.fn(async () => ({ ok: false, reason: 'operation-not-allowed' })),
      disconnect: vi.fn(async () => ({ ok: true, value: {} })),
      deleteProfile: vi.fn(async () => ({ ok: true, value: {} })),
    }
    vi.spyOn(window, 'prompt').mockReturnValue('secret-not-rendered')
    const root = createRoot()
    const view = new ModuleManagementView({ root, client: createClient([sendToOpenListRecord()]), sendToOpenList: actions })
    await view.refresh()

    root.querySelector<HTMLInputElement>('[data-testid="send-openlist-profile-label"]')!.value = 'Home'
    root.querySelector<HTMLInputElement>('[data-testid="send-openlist-origin"]')!.value = profile.controllerOrigin
    root.querySelector<HTMLButtonElement>('[data-testid="send-openlist-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="send-openlist-connection-review"]')).not.toBeNull())
    expect(root.innerHTML).not.toContain(preparation.token)
    root.querySelector<HTMLButtonElement>('[data-testid="send-openlist-connect"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="send-openlist-manual-input"]')).not.toBeNull())
    expect(root.innerHTML).not.toContain('secret-not-rendered')

    root.querySelector<HTMLTextAreaElement>('[data-testid="send-openlist-manual-input"]')!.value = [
      'https://cdn.example/file?sig=a%2Bb#drop',
      'https://cdn.example/file?sig=a%2Bb#other',
    ].join('\n')
    root.querySelector<HTMLButtonElement>('[data-testid="send-openlist-parse"]')!.click()
    expect(root.querySelectorAll('[data-send-candidate-id]')).toHaveLength(1)
    expect(root.textContent).toContain('https://cdn.example/file?sig=a%2Bb')
    root.querySelector<HTMLButtonElement>('[data-testid="send-openlist-tools"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="send-openlist-tool"]')).not.toBeNull())
    expect(root.querySelector('img[data-tool-xss]')).toBeNull()
    root.querySelector<HTMLButtonElement>('[data-testid="send-openlist-submit"]')!.click()
    await vi.waitFor(() => expect(actions.submit).toHaveBeenCalledOnce())
    expect(actions.submit).toHaveBeenCalledWith(
      [expect.objectContaining({ url: 'https://cdn.example/file?sig=a%2Bb' })],
      '/',
      '<img data-tool-xss src=x>',
    )
  })

  it('keeps Page Toolbox exact-origin preparation and confirmation as separate trusted UI actions', async () => {
    const pageToolbox = createPageToolboxActions()
    vi.mocked(pageToolbox.status)
      .mockResolvedValueOnce({
        ok: true,
        operation: 'control-status',
        snapshot: pageToolboxSnapshot('site-unapproved'),
      })
      .mockResolvedValueOnce({
        ok: true,
        operation: 'control-status',
        snapshot: pageToolboxSnapshot('ready'),
      })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([pageToolboxRecord()]),
      pageToolbox,
    })
    await view.refresh()

    const panel = root.querySelector<HTMLElement>('[data-testid="page-toolbox-control"]')!
    expect(panel.dataset.state).toBe('site-unapproved')
    expect(panel.textContent).toContain('Alpha <script>not-executed</script>')
    expect(panel.querySelector('script')).toBeNull()
    expect(pageToolbox.confirm).not.toHaveBeenCalled()

    panel.querySelector<HTMLButtonElement>('[data-testid="page-toolbox-prepare-site"]')!.click()
    await vi.waitFor(() => expect(pageToolbox.prepare).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('[data-testid="page-toolbox-site-review"]')).not.toBeNull())
    const review = root.querySelector<HTMLElement>('[data-testid="page-toolbox-site-review"]')!
    expect(review.textContent).toContain('https://alpha.example')
    expect(root.textContent).not.toContain('a'.repeat(48))
    expect(pageToolbox.confirm).not.toHaveBeenCalled()

    review.querySelector<HTMLButtonElement>('[data-testid="page-toolbox-confirm-site"]')!.click()
    await vi.waitFor(() => expect(pageToolbox.confirm).toHaveBeenCalledWith(expect.objectContaining({
      exactOrigin: 'https://alpha.example',
      originPattern: 'https://alpha.example/*',
    })))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="page-toolbox-control"]')?.getAttribute('data-state')).toBe('ready'))
    expect(pageToolbox.status).toHaveBeenCalledTimes(2)
  })

  it('edits only the three finite Page Toolbox controls and saves one complete revisioned document', async () => {
    const snapshot = pageToolboxSnapshot('ready', 7)
    const pageToolbox = createPageToolboxActions(snapshot)
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([pageToolboxRecord()]),
      pageToolbox,
    })
    await view.refresh()

    const passwordEnabled = root.querySelector<HTMLInputElement>(
      '[data-tool-id="password-visibility"] input[data-page-toolbox-enabled]',
    )!
    passwordEnabled.checked = true
    passwordEnabled.dispatchEvent(new Event('change', { bubbles: true }))
    const gesture = root.querySelector<HTMLSelectElement>(
      '[data-tool-id="password-visibility"] select[data-page-toolbox-setting="gesture"]',
    )!
    gesture.value = 'triple-click'
    gesture.dispatchEvent(new Event('change', { bubbles: true }))

    const releaseEnabled = root.querySelector<HTMLInputElement>(
      '[data-tool-id="selection-copy-release"] input[data-page-toolbox-enabled]',
    )!
    releaseEnabled.checked = true
    releaseEnabled.dispatchEvent(new Event('change', { bubbles: true }))
    const contextMenu = root.querySelector<HTMLInputElement>(
      '[data-tool-id="selection-copy-release"] input[data-page-toolbox-setting="contextMenu"]',
    )!
    contextMenu.checked = false
    contextMenu.dispatchEvent(new Event('change', { bubbles: true }))

    root.querySelector<HTMLButtonElement>('[data-testid="page-toolbox-save"]')!.click()
    await vi.waitFor(() => expect(pageToolbox.replace).toHaveBeenCalledOnce())
    expect(pageToolbox.replace).toHaveBeenCalledWith(7, {
      enabledToolIds: ['password-visibility', 'selection-copy-release'],
      toolSettings: {
        'password-visibility': { gesture: 'triple-click' },
        'free-page-edit': { mode: 'rich-text' },
        'selection-copy-release': { selection: true, copy: true, contextMenu: false },
      },
    })
    await vi.waitFor(() => expect(root.querySelector('[data-testid="page-toolbox-control-message"]')?.textContent).toContain('原子保存'))
    expect(root.querySelector('[data-testid="page-toolbox-save"]')?.hasAttribute('disabled')).toBe(true)
    expect(JSON.stringify(vi.mocked(pageToolbox.replace).mock.calls)).not.toContain('origin')
  })

  it('shows Page Toolbox CAS conflicts as stale without overwriting or automatically retrying', async () => {
    const initial = pageToolboxSnapshot('ready', 3)
    const current = {
      ...pageToolboxSnapshot('ready', 4),
      siteSettings: {
        enabledToolIds: ['free-page-edit'] as const,
        toolSettings: { 'free-page-edit': { mode: 'plain-text' } },
      },
    }
    const pageToolbox = createPageToolboxActions(initial)
    vi.mocked(pageToolbox.status)
      .mockResolvedValueOnce({ ok: true, operation: 'control-status', snapshot: initial })
      .mockResolvedValueOnce({ ok: true, operation: 'control-status', snapshot: current })
    vi.mocked(pageToolbox.replace).mockResolvedValueOnce({
      ok: false,
      operation: 'replace-site-settings',
      reason: 'revision-conflict',
      snapshot: current,
    })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([pageToolboxRecord()]),
      pageToolbox,
    })
    await view.refresh()
    const enabled = root.querySelector<HTMLInputElement>(
      '[data-tool-id="password-visibility"] input[data-page-toolbox-enabled]',
    )!
    enabled.checked = true
    enabled.dispatchEvent(new Event('change', { bubbles: true }))
    root.querySelector<HTMLButtonElement>('[data-testid="page-toolbox-save"]')!.click()

    await vi.waitFor(() => expect(root.querySelector('[data-testid="page-toolbox-control"]')?.getAttribute('data-state')).toBe('stale'))
    expect(pageToolbox.replace).toHaveBeenCalledTimes(1)
    expect(pageToolbox.status).toHaveBeenCalledTimes(1)
    expect(root.querySelector('[data-testid="page-toolbox-control-message"]')?.textContent).toContain('其他位置变化')

    root.querySelector<HTMLButtonElement>('[data-testid="page-toolbox-refresh"]')!.click()
    await vi.waitFor(() => expect(pageToolbox.status).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="page-toolbox-control"]')?.getAttribute('data-state')).toBe('ready'))
    expect(root.querySelector<HTMLInputElement>(
      '[data-tool-id="free-page-edit"] input[data-page-toolbox-enabled]',
    )?.checked).toBe(true)
  })

  it('connects and renders a manual Clash snapshot as text without putting secrets or markup in the DOM', async () => {
    const secret = 'phase4a-ui-secret-never-rendered'
    const initial = clashControlRecord(false)
    const connectedRecord = clashControlRecord(true)
    const preparation: ClashConnectionPreparation = {
      controllerOrigin: 'http://127.0.0.1:19090',
      originPattern: 'http://127.0.0.1:19090/*',
      token: 'clash-preparation-1',
      generation: 1,
      expiresAt: '2026-08-28T00:02:00.000Z',
    }
    const status: ClashConnectionStatus = {
      controllerOrigin: preparation.controllerOrigin,
      implementation: 'Clash.Meta',
      version: '1.19.0',
      mode: 'rule',
      connectedAt: '2026-08-28T00:00:01.000Z',
    }
    const client = createClient([initial])
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.prepare).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare',
      preparation,
    })
    vi.mocked(clashControl.connect).mockResolvedValueOnce({
      ok: true,
      operation: 'connect',
      status,
      record: connectedRecord,
    })
    const snapshot: ClashReadOnlySnapshot = {
      version: 1,
      controllerOrigin: preparation.controllerOrigin,
      generation: preparation.generation,
      refreshedAt: '2026-08-28T00:01:00.000Z',
      implementation: 'Clash.Meta',
      controllerVersion: '1.20.0',
      mode: 'global',
      proxyGroups: [{
        name: '<img data-clash-xss src=x>',
        type: 'Selector',
        selectedNode: 'Node <script>not-executed</script>',
        nodes: [{
          name: 'Node <script>not-executed</script>',
          type: 'Vmess',
          alive: true,
        }],
      }],
    }
    vi.mocked(clashControl.refresh).mockResolvedValueOnce({
      ok: true,
      operation: 'refresh',
      snapshot,
    })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(secret)
    const root = createRoot()
    const onRecordChanged = vi.fn()
    const view = new ModuleManagementView({ root, client, clashControl, onRecordChanged })
    await view.refresh()

    const input = root.querySelector<HTMLInputElement>('[data-testid="clash-controller-url"]')!
    input.value = preparation.controllerOrigin
    root.querySelector<HTMLButtonElement>('[data-testid="clash-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-control-review"]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-testid="clash-connect"]')!.click()

    await vi.waitFor(() => expect(clashControl.connect).toHaveBeenCalledWith(preparation, secret))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-control-status"]')?.textContent).toContain('1.19.0'))
    expect(root.querySelector('[data-testid="clash-control-status"]')?.textContent).toContain('rule')
    root.querySelector<HTMLButtonElement>('[data-testid="clash-refresh"]')!.click()
    await vi.waitFor(() => expect(clashControl.refresh).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-read-state"]')?.textContent).toContain('global'))
    expect(root.querySelector('[data-testid="clash-proxy-groups"]')?.textContent).toContain('<img data-clash-xss src=x>')
    expect(root.querySelector('[data-testid="clash-proxy-groups"]')?.textContent).toContain('Node <script>not-executed</script>')
    expect(root.querySelector('[data-testid="clash-proxy-groups"] img')).toBeNull()
    expect(root.querySelector('[data-testid="clash-proxy-groups"] script')).toBeNull()
    expect(root.innerHTML).not.toContain(secret)
    expect(root.textContent).not.toContain(secret)
    expect([...root.querySelectorAll<HTMLInputElement>('input')].map(value => value.value)).not.toContain(secret)
    expect(onRecordChanged).toHaveBeenCalledWith(connectedRecord)
    prompt.mockRestore()
  })

  it('labels the last in-memory Clash snapshot stale after a failed manual refresh', async () => {
    const record = clashControlRecord(true)
    const status: ClashConnectionStatus = {
      controllerOrigin: 'http://127.0.0.1:19090',
      implementation: 'Clash.Meta',
      version: '1.19.0',
      mode: 'rule',
      connectedAt: '2026-08-28T00:00:01.000Z',
    }
    const snapshot: ClashReadOnlySnapshot = {
      version: 1,
      controllerOrigin: status.controllerOrigin,
      generation: 1,
      refreshedAt: '2026-08-28T00:01:00.000Z',
      implementation: status.implementation,
      controllerVersion: status.version,
      mode: status.mode,
      proxyGroups: [],
    }
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.status).mockResolvedValueOnce({
      ok: true,
      operation: 'status',
      connection: {
        phase: 'connected',
        generation: 1,
        profile: { version: 1, controllerOrigin: status.controllerOrigin },
        status,
      },
      status,
      readState: {
        status: 'stale',
        snapshot,
        diagnostic: { code: 'network-failure', occurredAt: '2026-08-28T00:02:00.000Z' },
      },
    })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client: createClient([record]), clashControl })
    await view.refresh()
    expect(root.querySelector('[data-testid="clash-read-state"]')?.getAttribute('data-state')).toBe('stale')
    expect(root.querySelector('[data-testid="clash-read-state"]')?.textContent).toContain('过期快照')
  })

  it('keeps Clash node review and token-only confirmation separate, then invalidates the snapshot', async () => {
    const snapshot = clashSwitchSnapshot()
    const plan = clashSwitchPlan()
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.status).mockResolvedValueOnce(connectedClashStatus(snapshot))
    vi.mocked(clashControl.prepareProxySwitch).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare-proxy-switch',
      plan,
    })
    vi.mocked(clashControl.confirmProxySwitch).mockResolvedValueOnce({
      ok: true,
      operation: 'confirm-proxy-switch',
      groupName: plan.groupName,
      previousNode: plan.originalNode,
      selectedNode: plan.targetNode,
    })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([clashControlRecord(true)]),
      clashControl,
      now: () => '2026-08-29T01:00:30.000Z',
    })
    await view.refresh()

    const select = root.querySelector<HTMLSelectElement>('[data-testid="clash-switch-target"]')!
    expect(select.value).toBe(plan.targetNode)
    expect(select.textContent).toContain(plan.targetNode)
    expect(root.querySelector('[data-testid="clash-proxy-groups"] img')).toBeNull()
    expect(root.querySelector('[data-testid="clash-proxy-groups"] script')).toBeNull()
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-prepare"]')!.click()

    await vi.waitFor(() => expect(clashControl.prepareProxySwitch).toHaveBeenCalledWith(
      plan.groupName,
      plan.targetNode,
    ))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-switch-review"]')).not.toBeNull())
    const review = root.querySelector<HTMLElement>('[data-testid="clash-switch-review"]')!
    expect(review.dataset.state).toBe('ready')
    expect(review.textContent).toContain(plan.groupName)
    expect(review.textContent).toContain(plan.originalNode)
    expect(review.textContent).toContain(plan.targetNode)
    expect(review.textContent).toContain(plan.expiresAt)
    expect(review.textContent).not.toContain(plan.token)
    expect(review.querySelector('img')).toBeNull()
    expect(review.querySelector('script')).toBeNull()
    expect(clashControl.confirmProxySwitch).not.toHaveBeenCalled()

    review.querySelector<HTMLButtonElement>('[data-testid="clash-switch-confirm"]')!.click()
    await vi.waitFor(() => expect(clashControl.confirmProxySwitch).toHaveBeenCalledWith(plan.token))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-switch-review"]')).toBeNull())
    expect(root.querySelector('[data-testid="clash-read-state"]')?.getAttribute('data-state')).toBe('empty')
    expect(root.querySelector('[data-testid="clash-control-message"]')?.textContent).toContain('旧快照已失效')
    expect(clashControl.refresh).not.toHaveBeenCalled()
    expect(root.textContent).not.toContain(plan.token)
  })

  it('blocks an expired Clash review locally without spending its token', async () => {
    const snapshot = clashSwitchSnapshot()
    const plan = clashSwitchPlan()
    let now = '2026-08-29T01:00:30.000Z'
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.status).mockResolvedValueOnce(connectedClashStatus(snapshot))
    vi.mocked(clashControl.prepareProxySwitch).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare-proxy-switch',
      plan,
    })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([clashControlRecord(true)]),
      clashControl,
      now: () => now,
    })
    await view.refresh()
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-switch-review"]')).not.toBeNull())

    now = plan.expiresAt
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-confirm"]')!.click()
    expect(clashControl.confirmProxySwitch).not.toHaveBeenCalled()
    expect(root.querySelector('[data-testid="clash-switch-review"]')?.getAttribute('data-state')).toBe('expired')
    expect(root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-confirm"]')?.disabled).toBe(true)
    expect(root.querySelector('[data-testid="clash-control-message"]')?.textContent).toContain('已过期')

    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-cancel"]')!.click()
    expect(root.querySelector('[data-testid="clash-switch-review"]')).toBeNull()
    expect(root.querySelector('[data-testid="clash-switch-target"]')).not.toBeNull()
  })

  it('reports an ambiguous Clash switch without retrying or automatically refreshing', async () => {
    const snapshot = clashSwitchSnapshot()
    const plan = clashSwitchPlan()
    const initialStatus = connectedClashStatus(snapshot)
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.status)
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce({
        ...initialStatus,
        readState: { status: 'empty', snapshot: null, diagnostic: null },
      })
    vi.mocked(clashControl.prepareProxySwitch).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare-proxy-switch',
      plan,
    })
    vi.mocked(clashControl.confirmProxySwitch).mockResolvedValueOnce({
      ok: false,
      operation: 'confirm-proxy-switch',
      reason: 'switch-outcome-unknown',
    })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([clashControlRecord(true)]),
      clashControl,
      now: () => '2026-08-29T01:00:30.000Z',
    })
    await view.refresh()
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-switch-review"]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-confirm"]')!.click()

    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-control-message"]')?.textContent).toContain('无法确认是否执行'))
    expect(clashControl.confirmProxySwitch).toHaveBeenCalledOnce()
    expect(clashControl.refresh).not.toHaveBeenCalled()
    expect(root.querySelector('[data-testid="clash-switch-review"]')).toBeNull()
    expect(root.querySelector('[data-testid="clash-read-state"]')?.getAttribute('data-state')).toBe('empty')
  })

  it('drops a pending Clash switch review when the builtin is disabled', async () => {
    const snapshot = clashSwitchSnapshot()
    const plan = clashSwitchPlan()
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.status).mockResolvedValueOnce(connectedClashStatus(snapshot))
    vi.mocked(clashControl.prepareProxySwitch).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare-proxy-switch',
      plan,
    })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([clashControlRecord(true)]),
      clashControl,
      now: () => '2026-08-29T01:00:30.000Z',
    })
    await view.refresh()
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-switch-review"]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-testid="module-toggle"]')!.click()

    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-switch-review"]')).toBeNull())
    expect(root.querySelector('[data-testid="clash-control"]')?.textContent).toContain('模块已停用')
    expect(clashControl.confirmProxySwitch).not.toHaveBeenCalled()
  })

  it('does not publish a late Clash review after a newer lifecycle status refresh', async () => {
    const snapshot = clashSwitchSnapshot()
    const plan = clashSwitchPlan()
    const delayedPrepare = deferredClashResult()
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.status)
      .mockResolvedValueOnce(connectedClashStatus(snapshot))
      .mockResolvedValueOnce({
        ok: true,
        operation: 'status',
        connection: {
          phase: 'disconnected',
          generation: snapshot.generation + 1,
          profile: { version: 1, controllerOrigin: snapshot.controllerOrigin },
        },
        status: null,
        readState: { status: 'empty', snapshot: null, diagnostic: null },
      })
    vi.mocked(clashControl.prepareProxySwitch).mockReturnValueOnce(delayedPrepare.promise)
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([clashControlRecord(true)]),
      clashControl,
      now: () => '2026-08-29T01:00:30.000Z',
    })
    await view.refresh()
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-prepare"]')!.click()
    await vi.waitFor(() => expect(clashControl.prepareProxySwitch).toHaveBeenCalledOnce())

    await view.refresh()
    delayedPrepare.resolve({ ok: true, operation: 'prepare-proxy-switch', plan })
    await Promise.resolve()
    await Promise.resolve()

    expect(root.querySelector('[data-testid="clash-switch-review"]')).toBeNull()
    expect(root.querySelector('[data-testid="clash-control-status"]')).toBeNull()
    expect(root.querySelector('[data-testid="clash-control-message"]')?.textContent).not.toContain('审查已建立')
  })

  it('does not publish a late Clash switch success after disable supersedes confirmation', async () => {
    const snapshot = clashSwitchSnapshot()
    const plan = clashSwitchPlan()
    const delayedConfirmation = deferredClashResult()
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.status).mockResolvedValueOnce(connectedClashStatus(snapshot))
    vi.mocked(clashControl.prepareProxySwitch).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare-proxy-switch',
      plan,
    })
    vi.mocked(clashControl.confirmProxySwitch).mockReturnValueOnce(delayedConfirmation.promise)
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: createClient([clashControlRecord(true)]),
      clashControl,
      now: () => '2026-08-29T01:00:30.000Z',
    })
    await view.refresh()
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-switch-review"]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-testid="clash-switch-confirm"]')!.click()
    await vi.waitFor(() => expect(clashControl.confirmProxySwitch).toHaveBeenCalledOnce())

    root.querySelector<HTMLButtonElement>('[data-testid="module-toggle"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-control"]')?.textContent).toContain('模块已停用'))
    delayedConfirmation.resolve({
      ok: true,
      operation: 'confirm-proxy-switch',
      groupName: plan.groupName,
      previousNode: plan.originalNode,
      selectedNode: plan.targetNode,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(root.querySelector('[data-testid="clash-switch-review"]')).toBeNull()
    expect(root.querySelector('[data-testid="clash-control-message"]')?.textContent).not.toContain('旧快照已失效')
    expect(root.querySelector('[data-testid="clash-control"]')?.textContent).toContain('模块已停用')
  })

  it('cancels Clash secret entry before any permission or background connect operation', async () => {
    const record = clashControlRecord(false)
    const preparation: ClashConnectionPreparation = {
      controllerOrigin: 'http://localhost:9090',
      originPattern: 'http://localhost:9090/*',
      token: 'clash-preparation-cancel',
      generation: 1,
      expiresAt: '2026-08-28T00:02:00.000Z',
    }
    const client = createClient([record])
    const clashControl = createClashControlActions()
    vi.mocked(clashControl.prepare).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare',
      preparation,
    })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, clashControl })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="clash-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="clash-connect"]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-testid="clash-connect"]')!.click()
    expect(clashControl.connect).not.toHaveBeenCalled()
    expect(root.querySelector('[data-testid="clash-control-message"]')?.textContent).toContain('已取消')
    prompt.mockRestore()
  })

  it('runs the minimal Bookmark Doctor review flow and renders untrusted results as text', async () => {
    const initial = bookmarkDoctorRecord(false)
    const authorized = bookmarkDoctorRecord(true)
    const client = createClient([initial])
    const bookmarkDoctor = createBookmarkDoctorActions()
    const preparation = {
      token: 'preparation-1',
      total: 2,
      skipped: 1,
      originPatterns: ['https://example.com/*'],
    }
    const snapshot: BookmarkScanSnapshot = {
      runId: 'run-1',
      status: 'completed',
      total: 2,
      completed: 2,
      startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z',
      results: [
        {
          entryId: 'entry-1',
          bookmarkId: '1',
          parentId: 'folder-1',
          index: 0,
          folderPath: ['Fixtures'],
          title: '<img src=x onerror=alert(1)>',
          url: 'https://example.com/?q=<script>alert(2)</script>',
          outcome: 'reachable',
          httpStatus: 200,
        },
        {
          entryId: 'entry-2',
          bookmarkId: '2',
          parentId: 'folder-1',
          index: 1,
          folderPath: ['Fixtures'],
          title: 'Missing',
          url: 'https://example.com/missing',
          outcome: 'http-error',
          httpStatus: 404,
        },
      ],
    }
    vi.mocked(bookmarkDoctor.authorize).mockResolvedValueOnce({ ok: true, operation: 'authorize', record: authorized })
    vi.mocked(bookmarkDoctor.prepare).mockResolvedValueOnce({ ok: true, operation: 'prepare', preparation })
    vi.mocked(bookmarkDoctor.start).mockResolvedValueOnce({ ok: true, operation: 'start', snapshot })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, bookmarkDoctor })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-authorize"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.authorize).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-prepare"]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-doctor-plan"]')?.textContent).toContain('2 条链接'))
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-start"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.start).toHaveBeenCalledWith(preparation))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-doctor-results"]')?.textContent).toContain('HTTP 错误 1'))

    root.querySelector<HTMLButtonElement>('[data-filter="all"]')!.click()
    const results = root.querySelector<HTMLElement>('[data-testid="bookmark-doctor-results"]')!
    expect(results.querySelector('img')).toBeNull()
    expect(results.querySelector('script')).toBeNull()
    expect(results.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(results.textContent).toContain('https://example.com/?q=<script>alert(2)</script>')
  })

  it('exposes stop-only control for an in-memory active scan', async () => {
    const record = bookmarkDoctorRecord(true)
    const client = createClient([record])
    const bookmarkDoctor = createBookmarkDoctorActions()
    const scanning: BookmarkScanSnapshot = {
      runId: 'run-active',
      status: 'scanning',
      total: 8,
      completed: 2,
      startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: null,
      results: [],
    }
    const stopped = { ...scanning, status: 'stopped' as const, completedAt: '2026-08-28T00:00:01.000Z' }
    vi.mocked(bookmarkDoctor.status).mockResolvedValueOnce(scanning)
    vi.mocked(bookmarkDoctor.stop).mockResolvedValueOnce({
      ok: true,
      operation: 'stop',
      changed: true,
      snapshot: stopped,
    })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, bookmarkDoctor })
    await view.refresh()

    expect(root.querySelector('[data-testid="bookmark-doctor-results"]')?.textContent).toContain('2 / 8')
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-stop"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.stop).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-doctor-results"]')?.textContent).toContain('已停止'))
    expect(root.querySelector('[data-testid="bookmark-stop"]')).toBeNull()
  })

  it('keeps repair authorization separate and renders an untrusted update plan as text', async () => {
    const record = bookmarkDoctorRecord(true)
    const authorized = { ...record, grantedCapabilities: ['bookmarks.read', 'bookmarks.write'] as InstalledModuleRecord['grantedCapabilities'] }
    const client = createClient([record])
    const bookmarkDoctor = createBookmarkDoctorActions()
    const snapshot: BookmarkScanSnapshot = {
      runId: 'repair-results',
      status: 'completed',
      total: 1,
      completed: 1,
      startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z',
      results: [{
        entryId: 'repair-entry',
        bookmarkId: 'bookmark-1',
        parentId: 'folder-1',
        index: 0,
        folderPath: ['Fixtures'],
        title: '<img src=x onerror=alert(1)>',
        url: 'https://example.com/?q=<script>alert(2)</script>',
        outcome: 'http-error',
        httpStatus: 404,
      }],
    }
    const plan: BookmarkRepairPlan = {
      token: 'repair-update',
      operation: 'update',
      createdAt: '2026-08-28T00:00:00.000Z',
      expiresAt: '2026-08-28T00:02:00.000Z',
      before: {
        bookmarkId: 'bookmark-1',
        parentId: 'folder-1',
        index: 0,
        title: '<img src=x onerror=alert(1)>',
        url: 'https://example.com/?q=<script>alert(2)</script>',
      },
      proposed: { title: 'Reviewed title', url: 'https://fixed.example/' },
      confirmation: 'reviewed',
    }
    vi.mocked(bookmarkDoctor.authorizeRepairs).mockResolvedValueOnce({
      ok: true,
      operation: 'authorize-repairs',
      record: authorized,
    })
    vi.mocked(bookmarkDoctor.prepareRepair).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare-repair',
      plan,
    })
    vi.mocked(bookmarkDoctor.confirmRepairs).mockResolvedValueOnce({
      ok: true,
      operation: 'confirm-repairs',
      results: [{ ok: true, token: plan.token, operation: 'update' }],
    })
    vi.mocked(bookmarkDoctor.status).mockResolvedValueOnce(snapshot)
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, bookmarkDoctor })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-authorize-repairs"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-result-update"]')).not.toBeNull())
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-result-update"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-repair-draft"]')).not.toBeNull())
    root.querySelector<HTMLInputElement>('[data-testid="bookmark-repair-title"]')!.value = 'Reviewed title'
    root.querySelector<HTMLInputElement>('[data-testid="bookmark-repair-url"]')!.value = 'https://fixed.example/'
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-repair-prepare"]')!.click()

    await vi.waitFor(() => expect(bookmarkDoctor.prepareRepair).toHaveBeenCalledWith({
      operation: 'update',
      bookmarkId: 'bookmark-1',
      changes: { title: 'Reviewed title', url: 'https://fixed.example/' },
    }))
    const review = root.querySelector<HTMLElement>('[data-testid="bookmark-repair-review"]')!
    expect(review.querySelector('img')).toBeNull()
    expect(review.querySelector('script')).toBeNull()
    expect(review.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(review.textContent).toContain('<script>alert(2)</script>')
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-repair-confirm"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.confirmRepairs).toHaveBeenCalledWith([
      { token: plan.token, confirmation: 'reviewed' },
    ]))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-doctor-message"]')?.textContent).toContain('修复已执行'))
  })

  it('requires a separate destructive checkbox before confirming delete', async () => {
    const record = bookmarkDoctorRecord(true, true)
    const client = createClient([record])
    const bookmarkDoctor = createBookmarkDoctorActions()
    const snapshot: BookmarkScanSnapshot = {
      runId: 'delete-results',
      status: 'completed',
      total: 1,
      completed: 1,
      startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: '2026-08-28T00:00:01.000Z',
      results: [{
        entryId: 'delete-entry',
        bookmarkId: 'bookmark-delete',
        parentId: 'folder-1',
        index: 0,
        folderPath: ['Fixtures'],
        title: 'Delete me',
        url: 'https://delete.example/',
        outcome: 'http-error',
        httpStatus: 404,
      }],
    }
    const plan: BookmarkRepairPlan = {
      token: 'repair-delete',
      operation: 'delete',
      createdAt: '2026-08-28T00:00:00.000Z',
      expiresAt: '2026-08-28T00:02:00.000Z',
      before: {
        bookmarkId: 'bookmark-delete',
        parentId: 'folder-1',
        index: 0,
        title: 'Delete me',
        url: 'https://delete.example/',
      },
      proposed: { deleted: true },
      confirmation: 'delete-confirmed',
    }
    vi.mocked(bookmarkDoctor.prepareRepair).mockResolvedValueOnce({
      ok: true,
      operation: 'prepare-repair',
      plan,
    })
    vi.mocked(bookmarkDoctor.confirmRepairs).mockResolvedValueOnce({
      ok: true,
      operation: 'confirm-repairs',
      results: [{ ok: true, token: plan.token, operation: 'delete' }],
    })
    vi.mocked(bookmarkDoctor.status).mockResolvedValueOnce(snapshot)
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, bookmarkDoctor })
    await view.refresh()
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-result-delete"]')!.click()
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-repair-prepare"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-repair-delete-confirmation"]')).not.toBeNull())

    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-repair-confirm"]')!.click()
    expect(bookmarkDoctor.confirmRepairs).not.toHaveBeenCalled()
    expect(root.querySelector('[data-testid="bookmark-doctor-message"]')?.textContent).toContain('必须勾选')
    root.querySelector<HTMLInputElement>('[data-testid="bookmark-repair-delete-confirmation"]')!.checked = true
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-repair-confirm"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.confirmRepairs).toHaveBeenCalledWith([
      { token: plan.token, confirmation: 'delete-confirmed' },
    ]))
  })

  it('unignores and restores local records through separate reviewed operations', async () => {
    const record = bookmarkDoctorRecord(true, true)
    const client = createClient([record])
    const bookmarkDoctor = createBookmarkDoctorActions()
    const backup = {
      repairToken: 'backup-token',
      bookmarkId: 'deleted-bookmark',
      parentId: 'folder-1',
      index: 1,
      title: '<img src=x onerror=alert(1)>',
      url: 'https://deleted.example/',
      deletedAt: '2026-08-28T00:00:00.000Z',
    }
    const initialState: BookmarkDoctorWorkspaceState = {
      ignoredBookmarks: [{
        bookmarkId: 'ignored-bookmark',
        title: 'Ignored',
        url: 'https://ignored.example/',
        ignoredAt: '2026-08-28T00:00:00.000Z',
      }],
      deletionBackups: [backup],
    }
    const backupOnly: BookmarkDoctorWorkspaceState = { ignoredBookmarks: [], deletionBackups: [backup] }
    const restorePlan: BookmarkRestorePlan = {
      token: 'restore-plan',
      createdAt: '2026-08-28T00:01:00.000Z',
      expiresAt: '2026-08-28T00:03:00.000Z',
      backup,
      confirmation: 'reviewed',
    }
    vi.mocked(bookmarkDoctor.workspaceState)
      .mockResolvedValueOnce({ ok: true, operation: 'workspace-state', state: initialState })
      .mockResolvedValueOnce({ ok: true, operation: 'workspace-state', state: { ignoredBookmarks: [], deletionBackups: [] } })
    vi.mocked(bookmarkDoctor.unignore).mockResolvedValueOnce({ ok: true, operation: 'unignore', state: backupOnly })
    vi.mocked(bookmarkDoctor.prepareRestore).mockResolvedValueOnce({ ok: true, operation: 'prepare-restore', plan: restorePlan })
    vi.mocked(bookmarkDoctor.confirmRestore).mockResolvedValueOnce({ ok: true, operation: 'confirm-restore', token: restorePlan.token })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, bookmarkDoctor })
    await view.refresh()

    const local = root.querySelector<HTMLElement>('[data-testid="bookmark-local-diagnostics"]')!
    expect(local.querySelector('img')).toBeNull()
    expect(local.textContent).toContain('<img src=x onerror=alert(1)>')
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-unignore"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.unignore).toHaveBeenCalledWith('ignored-bookmark'))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-local-diagnostics"]')?.textContent).toContain('忽略 0'))

    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-restore-prepare"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.prepareRestore).toHaveBeenCalledWith('backup-token'))
    const review = root.querySelector<HTMLElement>('[data-testid="bookmark-restore-review"]')!
    expect(review.querySelector('img')).toBeNull()
    expect(review.textContent).toContain('<img src=x onerror=alert(1)>')
    review.querySelector<HTMLButtonElement>('[data-testid="bookmark-restore-confirm"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.confirmRestore).toHaveBeenCalledWith({
      token: restorePlan.token,
      confirmation: 'reviewed',
    }))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-local-diagnostics"]')?.textContent).toContain('恢复 0'))
  })

  it('requires explicit confirmation before clearing only Bookmark Doctor local records', async () => {
    const record = bookmarkDoctorRecord(true, true)
    const client = createClient([record])
    const bookmarkDoctor = createBookmarkDoctorActions()
    const state: BookmarkDoctorWorkspaceState = {
      ignoredBookmarks: [{
        bookmarkId: 'ignored-bookmark',
        title: 'Ignored',
        url: 'https://ignored.example/',
        ignoredAt: '2026-08-28T00:00:00.000Z',
      }],
      deletionBackups: [],
    }
    vi.mocked(bookmarkDoctor.workspaceState).mockResolvedValueOnce({ ok: true, operation: 'workspace-state', state })
    vi.mocked(bookmarkDoctor.clearLocalData).mockResolvedValueOnce({
      ok: true,
      operation: 'clear-local-data',
      state: { ignoredBookmarks: [], deletionBackups: [] },
    })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, bookmarkDoctor })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-local-clear"]')!.click()
    expect(bookmarkDoctor.clearLocalData).not.toHaveBeenCalled()
    expect(root.querySelector('[data-testid="bookmark-doctor-message"]')?.textContent).toContain('必须明确确认')
    root.querySelector<HTMLInputElement>('[data-testid="bookmark-local-clear-confirmation"]')!.checked = true
    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-local-clear"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.clearLocalData).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-local-diagnostics"]')?.textContent).toContain('忽略 0 · 恢复 0'))
  })

  it('stops presenting scan data after centralized bookmark permission revocation', async () => {
    const record = bookmarkDoctorRecord(true, true)
    const revoked = bookmarkDoctorRecord(false, false)
    const client = createClient([record])
    const bookmarkDoctor = createBookmarkDoctorActions()
    vi.mocked(bookmarkDoctor.status).mockResolvedValueOnce({
      runId: 'active-before-revoke',
      status: 'scanning',
      total: 1,
      completed: 0,
      results: [],
      startedAt: '2026-08-28T00:00:00.000Z',
      completedAt: null,
    })
    vi.mocked(bookmarkDoctor.revoke).mockResolvedValueOnce({ ok: true, operation: 'revoke', record: revoked })
    const root = createRoot()
    const onRecordChanged = vi.fn()
    const view = new ModuleManagementView({ root, client, bookmarkDoctor, onRecordChanged })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="bookmark-revoke"]')!.click()
    await vi.waitFor(() => expect(bookmarkDoctor.revoke).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('[data-testid="bookmark-authorize"]')).not.toBeNull())
    expect(root.querySelector('[data-testid="bookmark-doctor-results"]')).toBeNull()
    expect(onRecordChanged).toHaveBeenCalledWith(revoked)
  })

  it('renders manifest copy as text, protects the seed and toggles through the client', async () => {
    const record = moduleRecord('seeded', '<img src=x onerror=alert(1)>')
    const client = createClient([record])
    const onRecordChanged = vi.fn()
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, onRecordChanged })

    await view.refresh()
    const card = root.querySelector<HTMLElement>('[data-module-id="dev.juck.repolens"]')!
    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelector('.module-card-name')?.textContent).toBe(record.manifest.name)
    expect(card.querySelector<HTMLButtonElement>('[data-testid="module-remove"]')?.disabled).toBe(true)
    expect(card.querySelector('.module-details')?.textContent).toContain('GitHub 仓库')

    card.querySelector<HTMLButtonElement>('[data-testid="module-toggle"]')!.click()
    await vi.waitFor(() => expect(client.setEnabled).toHaveBeenCalledWith(record.manifest.id, false))
    await vi.waitFor(() => expect(onRecordChanged).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })))
    expect(root.querySelector('[data-module-id="dev.juck.repolens"] [role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('requires confirmation before removing a user module', async () => {
    const record = moduleRecord('user', 'Fixture')
    const client = createClient([record])
    const onRecordRemoved = vi.fn()
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, onRecordRemoved })
    await view.refresh()

    const removeButton = root.querySelector<HTMLButtonElement>('[data-testid="module-remove"]')!
    const dialog = root.querySelector<HTMLElement>('[data-testid="remove-module-dialog"]')!
    removeButton.click()
    expect(dialog.hidden).toBe(false)
    root.querySelector<HTMLButtonElement>('[data-cancel-remove]')!.click()
    expect(dialog.hidden).toBe(true)
    expect(client.remove).not.toHaveBeenCalled()

    removeButton.click()
    root.querySelector<HTMLButtonElement>('[data-confirm-remove]')!.click()
    await vi.waitFor(() => expect(client.remove).toHaveBeenCalledWith(record.manifest.id))
    await vi.waitFor(() => expect(onRecordRemoved).toHaveBeenCalledWith(record))
    expect(dialog.hidden).toBe(true)
    expect(root.querySelector('[data-module-id="dev.juck.fixture"]')).toBeNull()
  })

  it('reviews text-only manifest copy and installs only selected grants', async () => {
    const review = installReview(
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(2)>',
    )
    const installed = recordFromReview(review)
    const client = createClient([])
    vi.mocked(client.prepareInstall).mockResolvedValueOnce({
      ok: true,
      operation: 'install-prepare',
      review,
    })
    vi.mocked(client.confirmInstall).mockResolvedValueOnce({
      ok: true,
      operation: 'install-confirm',
      record: installed,
    })
    const onRecordInstalled = vi.fn()
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, onRecordInstalled })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="add-module"]')!.click()
    const dialog = root.querySelector<HTMLElement>('[data-testid="install-module-dialog"]')!
    const input = root.querySelector<HTMLInputElement>('[data-manifest-url]')!
    input.value = review.manifestUrl
    root.querySelector<HTMLButtonElement>('[data-prepare-install]')!.click()

    await vi.waitFor(() => expect(client.prepareInstall).toHaveBeenCalledWith(review.manifestUrl))
    await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-install-review]')!.hidden).toBe(false))
    expect(dialog.querySelector('img')).toBeNull()
    expect(dialog.querySelector('[data-install-name]')?.textContent).toBe(review.manifest.name)
    expect(dialog.querySelector('[data-install-description]')?.textContent).toBe(review.manifest.description)
    expect(dialog.textContent).toContain('https://modules.example')

    root.querySelector<HTMLInputElement>('input[data-context-field="url"]')!.checked = false
    root.querySelector<HTMLInputElement>('input[data-capability="tabs.open"]')!.checked = false
    root.querySelector<HTMLButtonElement>('[data-confirm-install]')!.click()

    await vi.waitFor(() => expect(client.confirmInstall).toHaveBeenCalledWith(
      review.manifestUrl,
      review.manifestDigest,
      {
        grantedContextFields: { 'github.repository': ['repo', 'pageType'] },
        grantedCapabilities: [],
      },
    ))
    await vi.waitFor(() => expect(onRecordInstalled).toHaveBeenCalledWith(installed))
    expect(dialog.hidden).toBe(true)
    expect(root.querySelector('[data-module-id="dev.juck.installable"]')).not.toBeNull()
  })

  it('cancels a reviewed install without adding a module record', async () => {
    const review = installReview()
    const client = createClient([])
    vi.mocked(client.prepareInstall).mockResolvedValueOnce({
      ok: true,
      operation: 'install-prepare',
      review,
    })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="add-module"]')!.click()
    root.querySelector<HTMLInputElement>('[data-manifest-url]')!.value = review.manifestUrl
    root.querySelector<HTMLButtonElement>('[data-prepare-install]')!.click()
    await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-install-review]')!.hidden).toBe(false))
    root.querySelector<HTMLButtonElement>('[data-cancel-install]')!.click()

    await vi.waitFor(() => expect(client.cancelInstall).toHaveBeenCalledWith(review.manifestUrl))
    expect(root.querySelector<HTMLElement>('[data-testid="install-module-dialog"]')!.hidden).toBe(true)
    expect(client.confirmInstall).not.toHaveBeenCalled()
    expect(root.querySelector('[data-module-id="dev.juck.installable"]')).toBeNull()
  })

  it('requires a fresh review after any failed install confirmation', async () => {
    const review = installReview()
    const client = createClient([])
    vi.mocked(client.prepareInstall).mockResolvedValueOnce({
      ok: true,
      operation: 'install-prepare',
      review,
    })
    vi.mocked(client.confirmInstall).mockResolvedValueOnce({
      ok: false,
      operation: 'install-confirm',
      reason: 'fetch-failed',
    })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="add-module"]')!.click()
    root.querySelector<HTMLInputElement>('[data-manifest-url]')!.value = review.manifestUrl
    root.querySelector<HTMLButtonElement>('[data-prepare-install]')!.click()
    await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-install-review]')!.hidden).toBe(false))
    root.querySelector<HTMLButtonElement>('[data-confirm-install]')!.click()

    await vi.waitFor(() => expect(root.querySelector<HTMLElement>('[data-install-entry]')!.hidden).toBe(false))
    expect(root.querySelector<HTMLElement>('[data-install-review]')!.hidden).toBe(true)
    expect(root.querySelector('[data-module-id="dev.juck.installable"]')).toBeNull()
    expect(root.querySelector('[data-testid="install-module-status"]')?.textContent).toBe('无法读取远程 manifest')
  })

  it('checks and applies a safe update without rendering untrusted copy as markup', async () => {
    const record = moduleRecord('user', 'Fixture')
    const candidate: RemoteFrameModuleManifest = {
      ...record.manifest as RemoteFrameModuleManifest,
      version: '0.2.0',
      name: '<img src=x onerror=alert(1)>',
      description: '<svg onload=alert(2)>',
    }
    const checked = recordWithUpdate(record, candidate)
    checked.update!.approvalStatus = 'not-required'
    const applied: InstalledModuleRecord = {
      ...checked,
      manifest: candidate,
      update: null,
      updatedAt: '2026-08-27T10:00:00.000Z',
    }
    const client = createClient([record])
    vi.mocked(client.checkUpdate).mockResolvedValueOnce({
      ok: true,
      operation: 'update-check',
      record: checked,
    })
    vi.mocked(client.applyUpdate).mockResolvedValueOnce({
      ok: true,
      operation: 'update-apply',
      record: applied,
    })
    const onRecordChanged = vi.fn()
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, onRecordChanged })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="module-update-check"]')!.click()
    await vi.waitFor(() => expect(client.checkUpdate).toHaveBeenCalledWith(record.manifest.id))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="module-update-state"]')?.textContent).toBe('安全更新'))
    const updatePanel = root.querySelector<HTMLElement>('[data-testid="module-update"]')!
    expect(updatePanel.querySelector('img')).toBeNull()
    expect(updatePanel.querySelector('svg')).toBeNull()
    expect(updatePanel.textContent).toContain(candidate.name)
    expect(updatePanel.querySelector('[data-testid="module-update-approve"]')).toBeNull()

    updatePanel.querySelector<HTMLButtonElement>('[data-testid="module-update-apply"]')!.click()
    await vi.waitFor(() => expect(client.applyUpdate).toHaveBeenCalledWith(record.manifest.id))
    await vi.waitFor(() => expect(onRecordChanged).toHaveBeenCalledWith(applied))
    expect(root.querySelector('[data-module-id="dev.juck.fixture"]')?.textContent).toContain('0.2.0')
    expect(root.querySelector('[data-testid="module-manager-status"]')?.textContent)
      .toBe(`${candidate.name} 已更新至 0.2.0`)
  })

  it('shows a loading state and disables module actions while checking', async () => {
    const record = moduleRecord('user', 'Fixture')
    const candidate = { ...record.manifest as RemoteFrameModuleManifest, version: '0.2.0' }
    const checked = recordWithUpdate(record, candidate)
    checked.update!.approvalStatus = 'not-required'
    let resolveCheck!: (_result: ModuleUpdateCheckManagementResult) => void
    const pendingCheck = new Promise<ModuleUpdateCheckManagementResult>((resolve) => {
      resolveCheck = resolve
    })
    const client = createClient([record])
    vi.mocked(client.checkUpdate).mockImplementationOnce(async () => pendingCheck)
    const root = createRoot()
    const view = new ModuleManagementView({ root, client })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="module-update-check"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="module-update-message"]')?.textContent)
      .toBe('正在从固定来源检查候选…'))
    expect(root.querySelector<HTMLButtonElement>('[data-testid="module-update-check"]')?.disabled).toBe(true)
    expect(root.querySelector<HTMLButtonElement>('[data-testid="module-toggle"]')?.disabled).toBe(true)

    resolveCheck({ ok: true, operation: 'update-check', record: checked })
    await vi.waitFor(() => expect(root.querySelector('[data-testid="module-update-state"]')?.textContent)
      .toBe('安全更新'))
    expect(root.querySelector<HTMLButtonElement>('[data-testid="module-update-check"]')?.disabled).toBe(false)
  })

  it('keeps expanded-access approval separate and sends only selected new grants', async () => {
    const record = moduleRecord('user', 'Fixture')
    const candidate: RemoteFrameModuleManifest = {
      ...record.manifest as RemoteFrameModuleManifest,
      version: '0.2.0',
      matches: [...record.manifest.matches, 'https://example.com/*'],
      contexts: [...record.manifest.contexts, 'page.metadata'],
      context_fields: {
        ...record.manifest.context_fields,
        'page.metadata': ['title', 'description'],
      },
      capabilities: ['clipboard.write'],
      activation: 'suggest',
    }
    const pending = recordWithUpdate(record, candidate)
    const snapshot: ModuleUpdateApprovalSnapshot = {
      approvedManifestDigest: updateDigest,
      approvedMatches: candidate.matches,
      approvedActivation: candidate.activation,
      approvedContextFields: { 'page.metadata': ['title'] },
      approvedCapabilities: ['clipboard.write'],
      approvedAt: '2026-08-27T10:00:00.000Z',
    }
    const approved = recordWithUpdate(record, candidate, snapshot)
    const client = createClient([pending])
    vi.mocked(client.approveUpdate).mockResolvedValueOnce({
      ok: true,
      operation: 'update-approve',
      changed: true,
      record: approved,
    })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client })
    await view.refresh()

    const panel = root.querySelector<HTMLElement>('[data-testid="module-update"]')!
    expect(panel.textContent).toContain('https://example.com/*')
    expect(panel.textContent).toContain('页面元数据')
    expect(panel.textContent).toContain('手动启用 → 页面建议')
    const title = panel.querySelector<HTMLInputElement>('input[data-update-context-field="title"]')!
    const description = panel.querySelector<HTMLInputElement>('input[data-update-context-field="description"]')!
    const capability = panel.querySelector<HTMLInputElement>('input[data-update-capability="clipboard.write"]')!
    expect([title.checked, description.checked, capability.checked]).toEqual([false, false, false])
    title.checked = true
    capability.checked = true
    panel.querySelector<HTMLButtonElement>('[data-testid="module-update-approve"]')!.click()

    await vi.waitFor(() => expect(client.approveUpdate).toHaveBeenCalledWith(
      record.manifest.id,
      updateDigest,
      {
        approvedContextFields: { 'page.metadata': ['title'] },
        approvedCapabilities: ['clipboard.write'],
      },
    ))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="module-update-state"]')?.textContent)
      .toBe('已审批，等待应用'))
    expect(root.querySelector('[data-testid="module-update-approve"]')).toBeNull()
    expect(root.querySelector('[data-testid="module-update-apply"]')).not.toBeNull()
    expect(client.applyUpdate).not.toHaveBeenCalled()
  })

  it('renders rejected candidates as text-only diagnostics without approval or apply controls', async () => {
    const record = moduleRecord('user', 'Fixture')
    const candidate: RemoteFrameModuleManifest = {
      ...record.manifest as RemoteFrameModuleManifest,
      id: 'dev.evil.replacement',
      name: '<img src=x onerror=alert(1)>',
    }
    const rejected = recordWithUpdate(record, candidate)
    const client = createClient([rejected])
    const root = createRoot()
    const view = new ModuleManagementView({ root, client })
    await view.refresh()

    const panel = root.querySelector<HTMLElement>('[data-testid="module-update"]')!
    expect(panel.querySelector('img')).toBeNull()
    expect(panel.textContent).not.toContain(candidate.name)
    expect(panel.textContent).toContain('模块 ID 发生变化')
    expect(panel.querySelector('[data-testid="module-update-approve"]')).toBeNull()
    expect(panel.querySelector('[data-testid="module-update-apply"]')).toBeNull()
  })

  it('refreshes after failed checks or approvals that invalidate the local candidate', async () => {
    const record = moduleRecord('user', 'Fixture')
    const candidate: RemoteFrameModuleManifest = {
      ...record.manifest as RemoteFrameModuleManifest,
      capabilities: ['clipboard.write'],
    }
    const pending = recordWithUpdate(record, candidate)

    const checkClient = createClient([record])
    vi.mocked(checkClient.list).mockResolvedValueOnce([record]).mockResolvedValueOnce([record])
    const checkRoot = createRoot()
    const checkView = new ModuleManagementView({ root: checkRoot, client: checkClient })
    await checkView.refresh()
    checkRoot.querySelector<HTMLButtonElement>('[data-testid="module-update-check"]')!.click()
    await vi.waitFor(() => expect(checkClient.list).toHaveBeenCalledTimes(2))
    expect(checkRoot.querySelector('[data-testid="module-update-message"]')?.textContent)
      .toBe('无法读取远程 manifest，请稍后重试')

    const approveClient = createClient([pending])
    vi.mocked(approveClient.list).mockResolvedValueOnce([pending]).mockResolvedValueOnce([record])
    vi.mocked(approveClient.approveUpdate).mockResolvedValueOnce({
      ok: false,
      operation: 'update-approve',
      changed: false,
      reason: 'update-candidate-changed',
    })
    const approveRoot = createRoot()
    const approveView = new ModuleManagementView({ root: approveRoot, client: approveClient })
    await approveView.refresh()
    approveRoot.querySelector<HTMLButtonElement>('[data-testid="module-update-approve"]')!.click()
    await vi.waitFor(() => expect(approveClient.list).toHaveBeenCalledTimes(2))
    expect(approveRoot.querySelector('[data-testid="module-update-apply"]')).toBeNull()
    expect(approveRoot.querySelector('[data-testid="module-update-message"]')?.textContent)
      .toBe('候选已过期，请重新检查并审查')
  })

  it('marks application-time replacement stale and requires another manual check', async () => {
    const record = moduleRecord('user', 'Fixture')
    const candidate = { ...record.manifest as RemoteFrameModuleManifest, version: '0.2.0' }
    const checked = recordWithUpdate(record, candidate)
    checked.update!.approvalStatus = 'not-required'
    const client = createClient([checked])
    vi.mocked(client.applyUpdate).mockResolvedValueOnce({
      ok: false,
      operation: 'update-apply',
      reason: 'update-candidate-changed',
    })
    const root = createRoot()
    const view = new ModuleManagementView({ root, client })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="module-update-apply"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="module-update-state"]')?.textContent)
      .toBe('候选已过期'))
    expect(root.querySelector('[data-testid="module-update-apply"]')).toBeNull()
    expect(root.querySelector('[data-testid="module-update-message"]')?.textContent)
      .toBe('候选已过期，请重新检查并审查')
    expect(root.querySelector('[data-testid="module-update-check"]')).not.toBeNull()
  })
})
