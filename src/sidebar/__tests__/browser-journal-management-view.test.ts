import type { BrowserJournalSnapshot } from '~/modules/builtin/browser-journal'
import { createBrowserJournalSeed } from '~/modules/builtin/browser-journal'
import type { BrowserJournalResult } from '~/modules/builtin/browser-journal/protocol'
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
import type { InstalledModuleRecord } from '~/modules/types'
import {
  type BrowserJournalActions,
  type ModuleManagementActions,
  ModuleManagementView,
} from '../module-management-view'

function journalRecord(enabled = true): InstalledModuleRecord {
  const seed = createBrowserJournalSeed()
  return {
    manifest: seed.manifest,
    enabled,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
    update: null,
    installedAt: '2026-08-29T08:00:00.000Z',
    updatedAt: '2026-08-29T08:00:00.000Z',
  }
}

function snapshot(status: BrowserJournalSnapshot['status'], withEntry = false): BrowserJournalSnapshot {
  return {
    version: 1,
    status,
    sessionId: status === 'recording' || withEntry ? 'journal-session' : null,
    startedAt: status === 'recording' || withEntry ? '2026-08-29T08:00:00.000Z' : null,
    stoppedAt: status === 'stopped' && withEntry ? '2026-08-29T08:01:00.000Z' : null,
    entries: withEntry
      ? [{
          id: 'journal-entry',
          kind: 'navigation',
          tabId: 7,
          windowId: 1,
          occurredAt: '2026-08-29T08:00:01.000Z',
          title: '<img data-journal-xss src=x> <script>ignored</script>',
          url: 'https://example.com/%3Cscript%3Enot-executed%3C/script%3E',
        }]
      : [],
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
      <div data-install-entry><input data-manifest-url /><button data-prepare-install>读取</button></div>
      <div data-install-review hidden>
        <span data-install-mark></span><span data-install-name></span><span data-install-description></span>
        <dl data-install-access></dl><div data-install-grants></div>
        <button data-cancel-install>取消</button><button data-confirm-install>安装</button>
      </div>
      <button data-close-install>关闭</button><p data-testid="install-module-status"></p>
    </div>
  `
  document.body.replaceChildren(root)
  return root
}

function managementClient(record: InstalledModuleRecord): ModuleManagementActions {
  return {
    list: vi.fn(async () => [record]),
    setEnabled: vi.fn(async (_moduleId, enabled): Promise<ModuleSetEnabledManagementResult> => ({
      ok: true,
      operation: 'set-enabled',
      changed: record.enabled !== enabled,
      record: { ...record, enabled },
    })),
    remove: vi.fn(async (): Promise<ModuleRemoveManagementResult> => ({
      ok: false,
      operation: 'remove',
      changed: false,
      reason: 'protected-seed',
    })),
    prepareInstall: vi.fn(async (): Promise<ModuleInstallPrepareManagementResult> => ({
      ok: false,
      operation: 'install-prepare',
      reason: 'installation-unavailable',
    })),
    confirmInstall: vi.fn(async (): Promise<ModuleInstallConfirmManagementResult> => ({
      ok: false,
      operation: 'install-confirm',
      reason: 'installation-unavailable',
    })),
    cancelInstall: vi.fn(async (): Promise<ModuleInstallCancelManagementResult> => ({
      ok: true,
      operation: 'install-cancel',
      releasedOrigin: false,
    })),
    checkUpdate: vi.fn(async (): Promise<ModuleUpdateCheckManagementResult> => ({
      ok: false,
      operation: 'update-check',
      reason: 'not-updateable',
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
      reason: 'not-updateable',
    })),
  }
}

function journalActions(statusResult = snapshot('stopped')): BrowserJournalActions {
  return {
    status: vi.fn(async (): Promise<BrowserJournalResult> => ({
      ok: true,
      operation: 'status',
      snapshot: statusResult,
    })),
    start: vi.fn(async (): Promise<BrowserJournalResult> => ({
      ok: true,
      operation: 'start',
      changed: true,
      snapshot: snapshot('recording', true),
    })),
    stop: vi.fn(async (): Promise<BrowserJournalResult> => ({
      ok: true,
      operation: 'stop',
      changed: true,
      snapshot: snapshot('stopped', true),
    })),
    archive: vi.fn(async (): Promise<BrowserJournalResult> => ({
      ok: true,
      operation: 'archive',
      state: { schemaVersion: 1, sessions: [] },
    })),
    save: vi.fn(async (): Promise<BrowserJournalResult> => ({
      ok: false,
      operation: 'save',
      reason: 'session-empty',
    })),
    deleteSaved: vi.fn(async (): Promise<BrowserJournalResult> => ({
      ok: false,
      operation: 'delete-saved',
      reason: 'saved-session-not-found',
    })),
    clearSaved: vi.fn(async (): Promise<BrowserJournalResult> => ({
      ok: true,
      operation: 'clear-saved',
      changed: false,
      state: { schemaVersion: 1, sessions: [] },
    })),
  }
}

describe('browser journal management view', () => {
  it('keeps start and stop explicit and renders untrusted entries only as text', async () => {
    const actions = journalActions()
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: managementClient(journalRecord()),
      browserJournal: actions,
    })
    await view.refresh()
    expect(root.querySelector('[data-testid="browser-journal-results"]')?.textContent).toContain('已停止 · 0 条')

    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-start"]')!.click()
    await vi.waitFor(() => expect(actions.start).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('[data-testid="browser-journal-results"]')?.textContent).toContain('记录中 · 1 条'))
    const results = root.querySelector<HTMLElement>('[data-testid="browser-journal-results"]')!
    expect(results.textContent).toContain('<img data-journal-xss src=x> <script>ignored</script>')
    expect(results.textContent).toContain('https://example.com/%3Cscript%3Enot-executed%3C/script%3E')
    expect(results.querySelector('img')).toBeNull()
    expect(results.querySelector('script')).toBeNull()

    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-stop"]')!.click()
    await vi.waitFor(() => expect(actions.stop).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelector('[data-testid="browser-journal-results"]')?.textContent).toContain('已停止 · 1 条'))
    expect(root.querySelector('[data-testid="browser-journal-message"]')?.textContent).toContain('后台重启')
  })

  it('shows a stable failure and clears the visible session after disable', async () => {
    const actions = journalActions(snapshot('recording', true))
    vi.mocked(actions.start).mockResolvedValueOnce({
      ok: false,
      operation: 'start',
      reason: 'lifecycle-cancelled',
    })
    vi.mocked(actions.status)
      .mockResolvedValueOnce({ ok: true, operation: 'status', snapshot: snapshot('recording', true) })
      .mockResolvedValueOnce({ ok: true, operation: 'status', snapshot: snapshot('stopped') })
    const client = managementClient(journalRecord())
    const root = createRoot()
    const view = new ModuleManagementView({ root, client, browserJournal: actions })
    await view.refresh()

    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-stop"]')!.click()
    await vi.waitFor(() => expect(actions.stop).toHaveBeenCalledOnce())
    vi.mocked(actions.stop).mockRejectedValueOnce(new Error('transport'))
    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-start"]')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-testid="browser-journal-message"]')?.textContent).toContain('生命周期'))

    root.querySelector<HTMLButtonElement>('[data-testid="module-toggle"]')!.click()
    await vi.waitFor(() => expect(client.setEnabled).toHaveBeenCalledWith('dev.oneweb.browser-journal', false))
    await vi.waitFor(() => expect(actions.status).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(root.querySelector('[data-testid="browser-journal"]')?.textContent).toContain('不会监听标签页'))
    expect(root.querySelector('[data-testid="browser-journal-results"]')).toBeNull()
  })

  it('keeps save explicit and renders, deletes and confirmed-clears retained text safely', async () => {
    const actions = journalActions(snapshot('stopped', true))
    const savedState = {
      schemaVersion: 1 as const,
      sessions: [{
        id: 'saved-ui-session',
        startedAt: '2026-08-29T08:00:00.000Z',
        stoppedAt: '2026-08-29T08:01:00.000Z',
        savedAt: '2026-08-29T08:02:00.000Z',
        entries: [{
          kind: 'navigation' as const,
          occurredAt: '2026-08-29T08:00:30.000Z',
          title: '<img data-saved-journal-xss src=x> <script>ignored</script>',
          url: 'https://example.com/%3Cscript%3Esaved%3C/script%3E',
        }],
      }],
    }
    vi.mocked(actions.save).mockResolvedValue({
      ok: true,
      operation: 'save',
      changed: true,
      savedSession: savedState.sessions[0]!,
      state: savedState,
    })
    vi.mocked(actions.deleteSaved).mockResolvedValue({
      ok: true,
      operation: 'delete-saved',
      changed: true,
      state: { schemaVersion: 1, sessions: [] },
    })
    vi.mocked(actions.clearSaved).mockResolvedValue({
      ok: true,
      operation: 'clear-saved',
      changed: true,
      state: { schemaVersion: 1, sessions: [] },
    })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: managementClient(journalRecord()),
      browserJournal: actions,
    })
    await view.refresh()
    expect(actions.save).not.toHaveBeenCalled()
    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-save"]')!.click()
    await vi.waitFor(() => expect(actions.save).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(
      root.querySelector('[data-testid="browser-journal-archive"]')?.textContent,
    ).toContain('<img data-saved-journal-xss src=x>'))
    expect(root.querySelector('[data-testid="browser-journal-archive"]')?.textContent).toContain('https://example.com/%3Cscript%3Esaved%3C/script%3E')
    expect(root.querySelector('[data-testid="browser-journal-archive"] img')).toBeNull()
    expect(root.querySelector('[data-testid="browser-journal-archive"] script')).toBeNull()

    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-delete-saved"]')!.click()
    await vi.waitFor(() => expect(actions.deleteSaved).toHaveBeenCalledWith('saved-ui-session'))
    await vi.waitFor(() => expect(root.querySelectorAll('[data-testid="browser-journal-saved-session"]')).toHaveLength(0))

    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-save"]')!.click()
    await vi.waitFor(() => expect(root.querySelectorAll('[data-testid="browser-journal-saved-session"]')).toHaveLength(1))
    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-clear-saved"]')!.click()
    expect(actions.clearSaved).not.toHaveBeenCalled()
    expect(root.querySelector('[data-testid="browser-journal-message"]')?.textContent).toContain('必须明确确认')
    root.querySelector<HTMLInputElement>('[data-testid="browser-journal-clear-confirmation"]')!.checked = true
    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-clear-saved"]')!.click()
    await vi.waitFor(() => expect(actions.clearSaved).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(root.querySelectorAll('[data-testid="browser-journal-saved-session"]')).toHaveLength(0))
  })

  it('keeps explicitly saved sessions visible and deletable while the module is disabled', async () => {
    const actions = journalActions()
    vi.mocked(actions.archive).mockResolvedValue({
      ok: true,
      operation: 'archive',
      state: {
        schemaVersion: 1,
        sessions: [{
          id: 'disabled-saved-session',
          startedAt: '2026-08-29T08:00:00.000Z',
          stoppedAt: '2026-08-29T08:01:00.000Z',
          savedAt: '2026-08-29T08:02:00.000Z',
          entries: [{
            kind: 'activation',
            occurredAt: '2026-08-29T08:00:30.000Z',
            title: 'Retained while disabled',
            url: 'https://example.com/retained',
          }],
        }],
      },
    })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: managementClient(journalRecord(false)),
      browserJournal: actions,
    })
    await view.refresh()
    expect(root.querySelector('[data-testid="browser-journal"]')?.textContent).toContain('此前明确保存的记录仍保留')
    expect(root.querySelector('[data-testid="browser-journal-archive"]')?.textContent).toContain('Retained while disabled')
    expect(root.querySelector('[data-testid="browser-journal-delete-saved"]')).not.toBeNull()
  })

  it('shows a newest-first index, complete selected detail and safe fallback after deletion', async () => {
    const actions = journalActions()
    const olderEntries = Array.from({ length: 12 }, (_, index) => ({
      kind: 'navigation' as const,
      occurredAt: new Date(Date.parse('2026-08-29T08:00:00.000Z') + index * 1000).toISOString(),
      title: `older-entry-${index}`,
      url: `https://example.com/older/${index}`,
    }))
    const newerSession = {
      id: 'newer-session',
      startedAt: '2026-08-29T09:00:00.000Z',
      stoppedAt: '2026-08-29T09:01:00.000Z',
      savedAt: '2026-08-29T09:02:00.000Z',
      entries: [{
        kind: 'activation' as const,
        occurredAt: '2026-08-29T09:00:30.000Z',
        title: 'newer-entry',
        url: 'https://example.com/newer',
      }],
    }
    const olderSession = {
      id: 'older-session',
      startedAt: '2026-08-29T08:00:00.000Z',
      stoppedAt: '2026-08-29T08:01:00.000Z',
      savedAt: '2026-08-29T08:02:00.000Z',
      entries: olderEntries,
    }
    vi.mocked(actions.archive).mockResolvedValue({
      ok: true,
      operation: 'archive',
      state: { schemaVersion: 1, sessions: [olderSession, newerSession] },
    })
    vi.mocked(actions.deleteSaved).mockResolvedValue({
      ok: true,
      operation: 'delete-saved',
      changed: true,
      state: { schemaVersion: 1, sessions: [newerSession] },
    })
    const root = createRoot()
    const view = new ModuleManagementView({
      root,
      client: managementClient(journalRecord()),
      browserJournal: actions,
    })
    await view.refresh()

    const choices = root.querySelectorAll<HTMLButtonElement>('[data-testid="browser-journal-saved-session-choice"]')
    expect(choices).toHaveLength(2)
    expect(choices[0]?.dataset.savedSessionId).toBe('newer-session')
    expect(choices[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(choices[0]?.textContent).toContain('到期 2026-09-05T09:02:00.000Z')
    expect(root.querySelector('[data-testid="browser-journal-saved-session"]')?.textContent).toContain('newer-entry')
    expect(root.querySelector('[data-testid="browser-journal-saved-session"]')?.textContent).not.toContain('older-entry-0')

    choices[1]!.click()
    await vi.waitFor(() => expect(
      root.querySelector<HTMLButtonElement>('[data-saved-session-id="older-session"]')?.getAttribute('aria-pressed'),
    ).toBe('true'))
    expect(root.querySelectorAll('[data-testid="browser-journal-saved-entries"] > li')).toHaveLength(12)
    expect(root.querySelector('[data-testid="browser-journal-saved-session"]')?.textContent).toContain('older-entry-11')
    expect(root.querySelector('[data-testid="browser-journal-saved-session"]')?.textContent).not.toContain('newer-entry')

    root.querySelector<HTMLButtonElement>('[data-testid="browser-journal-delete-saved"]')!.click()
    await vi.waitFor(() => expect(actions.deleteSaved).toHaveBeenCalledWith('older-session'))
    await vi.waitFor(() => expect(
      root.querySelector('[data-testid="browser-journal-saved-session"]')?.textContent,
    ).toContain('newer-entry'))
    expect(root.querySelectorAll('[data-testid="browser-journal-saved-session-choice"]')).toHaveLength(1)
  })
})
