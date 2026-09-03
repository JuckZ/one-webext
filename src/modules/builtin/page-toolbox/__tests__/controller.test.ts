import type {
  PageToolboxHostPort,
  PageToolboxRuntimeBindingV1,
  PageToolboxSettingsV1,
  PageToolboxStateDocumentV2,
} from '..'
import type { InstalledModuleRecord } from '../../../types'
import {
  createDefaultPageToolboxSettings,
  createPageToolboxControlToggle,
  createPageToolboxHello,
  createPageToolboxReady,
  createPageToolboxSeed,
  createPageToolboxStateStore,
  createPageToolboxSynced,
  PAGE_TOOLBOX_PORT_NAME,
  PageToolboxController,
} from '..'
import { getModuleLocalStateStorageKey } from '../../../module-state'

class ListenerEvent<Listener extends (..._args: any[]) => void> {
  readonly listeners = new Set<Listener>()
  addListener = (listener: Listener) => this.listeners.add(listener)
  removeListener = (listener: Listener) => this.listeners.delete(listener)
  emit(...args: Parameters<Listener>) {
    for (const listener of [...this.listeners])
      listener(...args)
  }
}

function toolboxRecord(enabled = true): InstalledModuleRecord {
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

function settingsFor(...origins: string[]): PageToolboxSettingsV1 {
  return {
    schemaVersion: 1,
    sites: Object.fromEntries(origins.map(origin => [origin, {
      enabledToolIds: [],
      toolSettings: {},
    }])),
  }
}

function createHostPort({
  tabId = 1,
  url = 'https://alpha.example/path',
  extensionId = 'extension-id',
  frameId = 0,
  documentId = 'doc-alpha',
} = {}) {
  const onMessage = new ListenerEvent<(_message: unknown) => void>()
  const onDisconnect = new ListenerEvent<() => void>()
  const messages: unknown[] = []
  let disconnected = false
  const port: PageToolboxHostPort = {
    name: PAGE_TOOLBOX_PORT_NAME,
    sender: { id: extensionId, frameId, url, documentId, tab: { id: tabId, url } },
    onMessage,
    onDisconnect,
    postMessage: vi.fn(message => messages.push(structuredClone(message))),
    disconnect: vi.fn(() => {
      if (disconnected)
        return
      disconnected = true
      onDisconnect.emit()
    }),
  }
  return { messages, onDisconnect, onMessage, port }
}

function createHarness(initialSettings: unknown = createDefaultPageToolboxSettings()) {
  let record = toolboxRecord(true)
  let stored: unknown = initialSettings === null ? null : structuredClone(initialSettings)
  let now = '2026-08-31T00:00:00.000Z'
  let entropy = 0
  const tabs = new Map<number, { id: number, title?: string, url: string }>([
    [1, { id: 1, title: 'Alpha page', url: 'https://alpha.example/path' }],
    [2, { id: 2, title: 'Beta page', url: 'https://beta.example/home' }],
  ])
  let activeTabId = 1
  const grantedOrigins = new Set<string>()
  let extraRecords: InstalledModuleRecord[] = []
  const registry = {
    get: vi.fn(async () => structuredClone(record)),
    list: vi.fn(async () => structuredClone([record, ...extraRecords])),
  }
  const permissions = {
    contains: vi.fn(async ({ origins }: { origins: string[] }) => origins.every(origin => grantedOrigins.has(origin))),
    remove: vi.fn(async ({ origins }: { origins: string[] }) => {
      for (const origin of origins)
        grantedOrigins.delete(origin)
      return true
    }),
  }
  const tabBoundary = {
    query: vi.fn(async (query: { active?: boolean, currentWindow?: boolean }) => (
      query.active ? [structuredClone(tabs.get(activeTabId)!)] : [...tabs.values()].map(tab => structuredClone(tab))
    )),
    get: vi.fn(async (tabId: number) => {
      const tab = tabs.get(tabId)
      if (!tab)
        throw new Error('tab missing')
      return structuredClone(tab)
    }),
  }
  const state = {
    read: vi.fn(async () => structuredClone(stored)),
    write: vi.fn(async (value: PageToolboxStateDocumentV2) => {
      stored = structuredClone(value)
    }),
  }
  const injection = { inject: vi.fn(async () => undefined) }
  const originInUse = vi.fn(async () => false)
  const controller = new PageToolboxController({
    registry,
    permissions,
    tabs: tabBoundary,
    injection,
    state,
    extensionId: 'extension-id',
    now: () => now,
    entropy: () => new Uint8Array(24).fill(++entropy),
    originInUse,
  })
  return {
    controller,
    grantedOrigins,
    injection,
    originInUse,
    permissions,
    registry,
    state,
    tabs,
    tabBoundary,
    getStored: () => {
      const value = structuredClone(stored)
      return value
        && typeof value === 'object'
        && 'settings' in value
        ? structuredClone(value.settings) as PageToolboxSettingsV1
        : value as PageToolboxSettingsV1 | null
    },
    getStoredDocument: () => structuredClone(stored),
    setActiveTab: (tabId: number) => activeTabId = tabId,
    setExtraRecords: (records: InstalledModuleRecord[]) => extraRecords = structuredClone(records),
    setNow: (value: string) => now = value,
    setRecord: (value: InstalledModuleRecord) => record = structuredClone(value),
  }
}

async function approveAlpha(harness: ReturnType<typeof createHarness>) {
  const prepared = await harness.controller.prepareCurrentSite()
  if (!prepared.ok || prepared.operation !== 'prepare')
    throw new Error('expected preparation')
  harness.grantedOrigins.add(prepared.preparation.originPattern)
  const confirmed = await harness.controller.confirmCurrentSite(prepared.preparation.token)
  if (!confirmed.ok || confirmed.operation !== 'confirm')
    throw new Error('expected confirmation')
  return confirmed
}

async function connectPort(controller: PageToolboxController, portHarness: ReturnType<typeof createHostPort>, byte = 9) {
  expect(controller.acceptPort(portHarness.port)).toBe(true)
  portHarness.onMessage.emit(createPageToolboxHello(byte.toString(16).padStart(2, '0').repeat(24)))
  await vi.waitFor(() => expect(portHarness.messages).toHaveLength(1))
  const init = portHarness.messages[0] as {
    sessionNonce: string
    binding: PageToolboxRuntimeBindingV1
  }
  portHarness.onMessage.emit(createPageToolboxReady(init.sessionNonce, init.binding))
  return init
}

function emitControlToggle(
  portHarness: ReturnType<typeof createHostPort>,
  init: { sessionNonce: string, binding: PageToolboxRuntimeBindingV1 },
  actionId: string,
  toolId: 'free-page-edit' | 'password-visibility' | 'selection-copy-release',
  enabled: boolean,
) {
  portHarness.onMessage.emit(createPageToolboxControlToggle(
    init.sessionNonce,
    init.binding,
    actionId,
    toolId,
    enabled,
  ))
}

async function waitForControlResult(portHarness: ReturnType<typeof createHostPort>, actionId: string) {
  await vi.waitFor(() => expect(portHarness.messages.some(message => (
    (message as { type?: string, actionId?: string }).type === 'PAGE_TOOLBOX_CONTROL_RESULT'
    && (message as { actionId?: string }).actionId === actionId
  ))).toBe(true))
  return portHarness.messages.find(message => (
    (message as { type?: string, actionId?: string }).type === 'PAGE_TOOLBOX_CONTROL_RESULT'
    && (message as { actionId?: string }).actionId === actionId
  ))
}

describe('page Toolbox exact-origin controller', () => {
  it('uses the dedicated module-local namespace without touching peer state', async () => {
    const values: Record<string, unknown> = {
      'oneweb.module-state.v1:dev.oneweb.bookmark-doctor': { sentinel: 'bookmark' },
    }
    const storage = {
      get: vi.fn(async (key: string) => Object.hasOwn(values, key) ? { [key]: structuredClone(values[key]) } : {}),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, structuredClone(items))
      }),
    }
    const store = createPageToolboxStateStore(storage)
    const state: PageToolboxStateDocumentV2 = {
      schemaVersion: 2,
      settings: settingsFor('https://alpha.example'),
      siteRevisions: { 'https://alpha.example': 0 },
    }
    await store.write(state)
    expect(await store.read()).toEqual(state)
    expect(getModuleLocalStateStorageKey('dev.oneweb.page-toolbox'))
      .toBe('oneweb.module-state.v1:dev.oneweb.page-toolbox')
    expect(values['oneweb.module-state.v1:dev.oneweb.bookmark-doctor']).toEqual({ sentinel: 'bookmark' })
  })

  it('prepares only the active top-frame origin and confirms only after exact permission exists', async () => {
    const harness = createHarness()
    const prepared = await harness.controller.prepareCurrentSite()
    expect(prepared).toMatchObject({
      ok: true,
      operation: 'prepare',
      preparation: {
        exactOrigin: 'https://alpha.example',
        originPattern: 'https://alpha.example/*',
      },
    })
    if (!prepared.ok || prepared.operation !== 'prepare')
      throw new Error('expected preparation')
    await expect(harness.controller.confirmCurrentSite(prepared.preparation.token)).resolves.toEqual({
      ok: false,
      operation: 'confirm',
      reason: 'permission-missing',
    })
    expect(harness.state.write).not.toHaveBeenCalled()
    expect(harness.injection.inject).not.toHaveBeenCalled()

    const confirmed = await approveAlpha(harness)
    expect(confirmed).toMatchObject({ changed: true, injected: true })
    expect(harness.getStored()).toEqual(settingsFor('https://alpha.example'))
    expect(harness.getStoredDocument()).toMatchObject({
      schemaVersion: 2,
      siteRevisions: { 'https://alpha.example': 0 },
    })
    expect(harness.injection.inject).toHaveBeenCalledWith(1)
  })

  it('projects unsupported, disabled, unapproved and ready current-site control states as safe text', async () => {
    const unsupported = createHarness()
    unsupported.tabs.get(1)!.url = 'chrome://extensions/'
    unsupported.tabs.get(1)!.title = '<img src=x>\u0000 hostile'
    await expect(unsupported.controller.controlStatus()).resolves.toMatchObject({
      ok: true,
      operation: 'control-status',
      snapshot: {
        access: 'unsupported',
        exactOrigin: null,
        pageTitle: '<img src=x> hostile',
        revision: 0,
        siteSettings: null,
      },
    })

    const disabled = createHarness()
    disabled.setRecord(toolboxRecord(false))
    disabled.permissions.contains.mockRejectedValue(new Error('disabled modules do not need a permission check'))
    await expect(disabled.controller.controlStatus()).resolves.toMatchObject({
      ok: true,
      snapshot: { access: 'module-disabled', exactOrigin: 'https://alpha.example' },
    })
    expect(disabled.permissions.contains).not.toHaveBeenCalled()

    const unapproved = createHarness()
    await expect(unapproved.controller.controlStatus()).resolves.toMatchObject({
      ok: true,
      snapshot: { access: 'site-unapproved', exactOrigin: 'https://alpha.example', revision: 0 },
    })

    const ready = createHarness(settingsFor('https://alpha.example'))
    ready.grantedOrigins.add('https://alpha.example/*')
    await expect(ready.controller.controlStatus()).resolves.toMatchObject({
      ok: true,
      snapshot: {
        access: 'ready',
        exactOrigin: 'https://alpha.example',
        revision: 0,
        siteSettings: { enabledToolIds: [], toolSettings: {} },
      },
    })
    expect(ready.state.write).not.toHaveBeenCalled()
  })

  it('fails control projection closed when exact permission status cannot be checked', async () => {
    const harness = createHarness()
    harness.permissions.contains.mockRejectedValueOnce(new Error('permission backend failed'))
    await expect(harness.controller.controlStatus()).resolves.toEqual({
      ok: false,
      operation: 'control-status',
      reason: 'permission-check-failed',
    })
  })

  it('serializes whole-site CAS, advances accepted no-op revisions and returns the current conflict snapshot', async () => {
    const harness = createHarness()
    await approveAlpha(harness)
    const enabled = {
      enabledToolIds: ['password-visibility'] as const,
      toolSettings: { 'password-visibility': { gesture: 'double-click' } },
    }
    await expect(harness.controller.replaceCurrentSiteSettings({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS',
      expectedRevision: 0,
      siteSettings: enabled,
    })).resolves.toMatchObject({
      ok: true,
      operation: 'replace-site-settings',
      changed: true,
      snapshot: { revision: 1, siteSettings: enabled },
    })
    const afterFirst = structuredClone(harness.getStoredDocument())

    await expect(harness.controller.replaceCurrentSiteSettings({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS',
      expectedRevision: 0,
      siteSettings: { enabledToolIds: [], toolSettings: {} },
    })).resolves.toMatchObject({
      ok: false,
      operation: 'replace-site-settings',
      reason: 'revision-conflict',
      snapshot: { revision: 1, siteSettings: enabled },
    })
    expect(harness.getStoredDocument()).toEqual(afterFirst)

    await expect(harness.controller.replaceCurrentSiteSettings({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS',
      expectedRevision: 1,
      siteSettings: enabled,
    })).resolves.toMatchObject({
      ok: true,
      changed: false,
      snapshot: { revision: 2 },
    })
    expect(harness.getStoredDocument()).toMatchObject({
      siteRevisions: { 'https://alpha.example': 2 },
    })
  })

  it('keeps persisted and in-memory revision authority unchanged when replacement storage fails', async () => {
    const harness = createHarness()
    await approveAlpha(harness)
    const before = structuredClone(harness.getStoredDocument())
    harness.state.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(harness.controller.replaceCurrentSiteSettings({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS',
      expectedRevision: 0,
      siteSettings: {
        enabledToolIds: ['free-page-edit'],
        toolSettings: { 'free-page-edit': { mode: 'rich-text' } },
      },
    })).resolves.toEqual({
      ok: false,
      operation: 'replace-site-settings',
      reason: 'settings-write-failed',
    })
    expect(harness.getStoredDocument()).toEqual(before)
    await expect(harness.controller.controlStatus()).resolves.toMatchObject({
      ok: true,
      snapshot: { revision: 0, siteSettings: { enabledToolIds: [] } },
    })
  })

  it('maintains independent site revisions across replacement and permission revocation', async () => {
    const harness = createHarness(settingsFor('https://alpha.example', 'https://beta.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    harness.grantedOrigins.add('https://beta.example/*')
    await harness.controller.status()
    await harness.controller.replaceCurrentSiteSettings({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS',
      expectedRevision: 0,
      siteSettings: {
        enabledToolIds: ['free-page-edit'],
        toolSettings: { 'free-page-edit': { mode: 'plain-text' } },
      },
    })
    expect(harness.getStoredDocument()).toMatchObject({
      siteRevisions: { 'https://alpha.example': 1, 'https://beta.example': 0 },
    })

    harness.grantedOrigins.delete('https://alpha.example/*')
    await harness.controller.handlePermissionsRemoved({ origins: ['https://alpha.example/*'] })
    expect(harness.getStoredDocument()).toMatchObject({
      siteRevisions: { 'https://beta.example': 0 },
      settings: { sites: { 'https://beta.example': expect.any(Object) } },
    })
  })

  it('binds confirmation to one short-lived token, tab and navigation', async () => {
    const harness = createHarness()
    const prepared = await harness.controller.prepareCurrentSite()
    if (!prepared.ok || prepared.operation !== 'prepare')
      throw new Error('expected preparation')
    harness.grantedOrigins.add(prepared.preparation.originPattern)
    harness.tabs.get(1)!.url = 'https://beta.example/replaced'
    await expect(harness.controller.confirmCurrentSite(prepared.preparation.token)).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-preparation',
    })
    await expect(harness.controller.confirmCurrentSite(prepared.preparation.token)).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-preparation',
    })

    harness.tabs.get(1)!.url = 'https://alpha.example/path'
    const expiring = await harness.controller.prepareCurrentSite()
    if (!expiring.ok || expiring.operation !== 'prepare')
      throw new Error('expected preparation')
    harness.setNow(expiring.preparation.expiresAt)
    await expect(harness.controller.confirmCurrentSite(expiring.preparation.token)).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-preparation',
    })
  })

  it('authenticates sender, frame, current origin, challenge and generation before ready', async () => {
    const harness = createHarness(settingsFor('https://alpha.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    await harness.controller.status()
    const port = createHostPort()
    const init = await connectPort(harness.controller, port)
    expect(init.binding).toMatchObject({
      exactOrigin: 'https://alpha.example',
      tabId: 1,
      frameId: 0,
      navigationId: 'document:doc-alpha',
      generation: 1,
    })
    await expect(harness.controller.status()).resolves.toMatchObject({
      ok: true,
      snapshot: { sessions: [{ tabId: 1, phase: 'ready', generation: 1 }] },
    })

    for (const rejected of [
      createHostPort({ extensionId: 'evil-extension' }),
      createHostPort({ frameId: 2 }),
    ]) {
      expect(harness.controller.acceptPort(rejected.port)).toBe(false)
      expect(rejected.port.disconnect).toHaveBeenCalledOnce()
    }
    const wrongOrigin = createHostPort({ url: 'https://evil.example/path' })
    expect(harness.controller.acceptPort(wrongOrigin.port)).toBe(true)
    wrongOrigin.onMessage.emit(createPageToolboxHello('0b'.repeat(24)))
    await vi.waitFor(() => expect(wrongOrigin.port.disconnect).toHaveBeenCalledOnce())
  })

  it('isolates navigation teardown and generations across two tabs and origins', async () => {
    const harness = createHarness(settingsFor('https://alpha.example', 'https://beta.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    harness.grantedOrigins.add('https://beta.example/*')
    await harness.controller.status()
    const alpha = createHostPort()
    const beta = createHostPort({ tabId: 2, url: 'https://beta.example/home', documentId: 'doc-beta' })
    await connectPort(harness.controller, alpha, 7)
    await connectPort(harness.controller, beta, 8)

    harness.controller.handleTabUpdated(1, { status: 'loading', url: 'https://alpha.example/next' })
    expect(alpha.messages.at(-1)).toMatchObject({ type: 'PAGE_TOOLBOX_DISPOSE', reason: 'navigation' })
    expect(alpha.port.disconnect).toHaveBeenCalledOnce()
    expect(beta.port.disconnect).not.toHaveBeenCalled()
    await expect(harness.controller.status()).resolves.toMatchObject({
      ok: true,
      snapshot: { sessions: [{ tabId: 2, phase: 'ready', generation: 2 }] },
    })

    harness.tabs.get(1)!.url = 'https://alpha.example/next'
    harness.controller.handleTabUpdated(1, { status: 'complete' })
    await vi.waitFor(() => expect(harness.injection.inject).toHaveBeenCalledWith(1))
  })

  it('keeps two origins, plan revisions and tool failures independently authoritative', async () => {
    const harness = createHarness(settingsFor('https://alpha.example', 'https://beta.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    harness.grantedOrigins.add('https://beta.example/*')
    await harness.controller.status()
    const alpha = createHostPort()
    const beta = createHostPort({ tabId: 2, url: 'https://beta.example/home', documentId: 'doc-beta' })
    const alphaInit = await connectPort(harness.controller, alpha, 7)
    const betaInit = await connectPort(harness.controller, beta, 8)

    harness.setActiveTab(1)
    await harness.controller.setCurrentSiteTool({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'free-page-edit',
      enabled: true,
      settings: { mode: 'rich-text' },
    })
    expect(alpha.messages.at(-1)).toMatchObject({
      type: 'PAGE_TOOLBOX_SYNC',
      planRevision: 2,
      tools: [{ toolId: 'free-page-edit' }],
    })
    expect(beta.messages).toHaveLength(1)

    harness.setActiveTab(2)
    await harness.controller.setCurrentSiteTool({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'selection-copy-release',
      enabled: true,
      settings: { selection: true, copy: true, contextMenu: false },
    })
    expect(beta.messages.at(-1)).toMatchObject({
      type: 'PAGE_TOOLBOX_SYNC',
      planRevision: 2,
      tools: [{ toolId: 'selection-copy-release' }],
    })
    expect(alpha.messages).toHaveLength(2)

    alpha.onMessage.emit(createPageToolboxSynced(
      alphaInit.sessionNonce,
      alphaInit.binding,
      99,
    ))
    expect(alpha.port.disconnect).toHaveBeenCalledOnce()
    expect(beta.port.disconnect).not.toHaveBeenCalled()
    await expect(harness.controller.status()).resolves.toMatchObject({
      ok: true,
      snapshot: {
        sessions: [{
          exactOrigin: 'https://beta.example',
          generation: betaInit.binding.generation,
          planRevision: 2,
        }],
      },
    })

    await harness.controller.setCurrentSiteTool({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'password-visibility',
      enabled: true,
      settings: { gesture: 'double-click' },
    })
    expect(beta.messages.at(-1)).toMatchObject({
      type: 'PAGE_TOOLBOX_SYNC',
      planRevision: 3,
      tools: [
        { toolId: 'password-visibility' },
        { toolId: 'selection-copy-release' },
      ],
    })

    harness.setActiveTab(1)
    await expect(harness.controller.revokeCurrentSite()).resolves.toMatchObject({
      ok: true,
      changed: true,
      releasedOrigin: true,
    })
    expect(harness.getStored()).toMatchObject({
      sites: {
        'https://beta.example': {
          enabledToolIds: ['password-visibility', 'selection-copy-release'],
        },
      },
    })
    expect(harness.grantedOrigins.has('https://alpha.example/*')).toBe(false)
    expect(harness.grantedOrigins.has('https://beta.example/*')).toBe(true)
    expect(beta.port.disconnect).not.toHaveBeenCalled()
  })

  it('persists and synchronizes only finite current-site tool plans', async () => {
    const harness = createHarness()
    await approveAlpha(harness)
    const port = createHostPort()
    const init = await connectPort(harness.controller, port)
    expect((port.messages[0] as { tools: unknown[] }).tools).toEqual([])

    await expect(harness.controller.setCurrentSiteTool({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'password-visibility',
      enabled: true,
      settings: { gesture: 'double-click' },
    })).resolves.toMatchObject({
      ok: true,
      operation: 'set-tool',
      changed: true,
      synchronized: 1,
    })
    expect(port.messages.at(-1)).toMatchObject({
      type: 'PAGE_TOOLBOX_SYNC',
      planRevision: 2,
      sessionNonce: init.sessionNonce,
      tools: [{ toolId: 'password-visibility', settings: { gesture: 'double-click' } }],
    })
    expect(harness.getStored()).toMatchObject({
      sites: {
        'https://alpha.example': {
          enabledToolIds: ['password-visibility'],
          toolSettings: { 'password-visibility': { gesture: 'double-click' } },
        },
      },
    })

    await harness.controller.setCurrentSiteTool({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'password-visibility',
      enabled: true,
      settings: { gesture: 'triple-click' },
    })
    expect(port.messages.at(-1)).toMatchObject({
      type: 'PAGE_TOOLBOX_SYNC',
      planRevision: 3,
      tools: [{ settings: { gesture: 'triple-click' } }],
    })

    await harness.controller.setCurrentSiteTool({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'password-visibility',
      enabled: false,
    })
    expect(port.messages.at(-1)).toMatchObject({ type: 'PAGE_TOOLBOX_SYNC', planRevision: 4, tools: [] })
    expect(harness.getStored()?.sites['https://alpha.example'].enabledToolIds).toEqual([])
  })

  it('derives Shadow toggles from packaged defaults or saved settings and never accepts settings from content', async () => {
    const defaults = createHarness()
    await approveAlpha(defaults)
    const defaultPort = createHostPort()
    const defaultInit = await connectPort(defaults.controller, defaultPort)
    emitControlToggle(defaultPort, defaultInit, 'shadow:1:default', 'password-visibility', true)
    await expect(waitForControlResult(defaultPort, 'shadow:1:default')).resolves.toMatchObject({
      ok: true,
      changed: true,
    })
    expect(defaults.getStored()).toMatchObject({
      sites: {
        'https://alpha.example': {
          enabledToolIds: ['password-visibility'],
          toolSettings: { 'password-visibility': { gesture: 'double-click' } },
        },
      },
    })

    const saved = createHarness({
      schemaVersion: 1,
      sites: {
        'https://alpha.example': {
          enabledToolIds: [],
          toolSettings: { 'password-visibility': { gesture: 'triple-click' } },
        },
      },
    })
    saved.grantedOrigins.add('https://alpha.example/*')
    await saved.controller.status()
    const savedPort = createHostPort()
    const savedInit = await connectPort(saved.controller, savedPort, 10)
    emitControlToggle(savedPort, savedInit, 'shadow:2:saved', 'password-visibility', true)
    await waitForControlResult(savedPort, 'shadow:2:saved')
    expect(saved.getStored()).toMatchObject({
      sites: {
        'https://alpha.example': {
          enabledToolIds: ['password-visibility'],
          toolSettings: { 'password-visibility': { gesture: 'triple-click' } },
        },
      },
    })
    emitControlToggle(savedPort, savedInit, 'shadow:2:disable', 'password-visibility', false)
    await waitForControlResult(savedPort, 'shadow:2:disable')
    expect(saved.getStored()?.sites['https://alpha.example']).toMatchObject({
      enabledToolIds: [],
      toolSettings: { 'password-visibility': { gesture: 'triple-click' } },
    })
  })

  it('bounds replay, concurrent actions and total action IDs without changing peer authority', async () => {
    const harness = createHarness(settingsFor('https://alpha.example', 'https://beta.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    harness.grantedOrigins.add('https://beta.example/*')
    await harness.controller.status()
    const alpha = createHostPort()
    const beta = createHostPort({ tabId: 2, url: 'https://beta.example/home', documentId: 'doc-beta' })
    const alphaInit = await connectPort(harness.controller, alpha, 7)
    await connectPort(harness.controller, beta, 8)
    let releaseWrite!: () => void
    const blockedWrite = new Promise<void>(resolve => releaseWrite = resolve)
    harness.state.write.mockImplementationOnce(() => blockedWrite)
    emitControlToggle(alpha, alphaInit, 'shadow:1:pending', 'free-page-edit', true)
    await vi.waitFor(() => expect(harness.state.write).toHaveBeenCalledOnce())

    emitControlToggle(alpha, alphaInit, 'shadow:1:pending', 'free-page-edit', true)
    expect(alpha.messages.filter(message => (
      (message as { type?: string, actionId?: string }).type === 'PAGE_TOOLBOX_CONTROL_RESULT'
      && (message as { actionId?: string }).actionId === 'shadow:1:pending'
    ))).toEqual([])
    for (let index = 2; index <= 128; index += 1) {
      emitControlToggle(alpha, alphaInit, `shadow:1:flood:${index}`, 'password-visibility', true)
    }
    await expect(waitForControlResult(alpha, 'shadow:1:flood:2')).resolves.toMatchObject({
      ok: false,
      reason: 'action-active',
    })
    emitControlToggle(alpha, alphaInit, 'shadow:1:overflow', 'password-visibility', true)
    await expect(waitForControlResult(alpha, 'shadow:1:overflow')).resolves.toMatchObject({
      ok: false,
      reason: 'action-limit',
    })
    expect(beta.messages).toHaveLength(1)
    releaseWrite()
    await vi.waitFor(() => expect(alpha.messages.some(message => (
      (message as { type?: string, actionId?: string, ok?: boolean }).type === 'PAGE_TOOLBOX_CONTROL_RESULT'
      && (message as { actionId?: string }).actionId === 'shadow:1:pending'
      && (message as { ok?: boolean }).ok === true
    ))).toBe(true))
    emitControlToggle(alpha, alphaInit, 'shadow:1:pending', 'free-page-edit', true)
    await vi.waitFor(() => expect(alpha.messages.filter(message => (
      (message as { type?: string, actionId?: string }).type === 'PAGE_TOOLBOX_CONTROL_RESULT'
      && (message as { actionId?: string }).actionId === 'shadow:1:pending'
    )).at(-1)).toMatchObject({ ok: false, reason: 'action-replayed' }))
    expect(beta.messages).toHaveLength(1)
  })

  it('synchronizes only the bound origin and keeps another origin writable after a Shadow action', async () => {
    const harness = createHarness(settingsFor('https://alpha.example', 'https://beta.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    harness.grantedOrigins.add('https://beta.example/*')
    await harness.controller.status()
    const alpha = createHostPort()
    const beta = createHostPort({ tabId: 2, url: 'https://beta.example/home', documentId: 'doc-beta' })
    const alphaInit = await connectPort(harness.controller, alpha, 7)
    const betaInit = await connectPort(harness.controller, beta, 8)
    emitControlToggle(alpha, alphaInit, 'shadow:alpha:edit', 'free-page-edit', true)
    await waitForControlResult(alpha, 'shadow:alpha:edit')
    expect(alpha.messages.some(message => (message as { type?: string }).type === 'PAGE_TOOLBOX_SYNC')).toBe(true)
    expect(beta.messages).toHaveLength(1)

    emitControlToggle(beta, betaInit, 'shadow:beta:copy', 'selection-copy-release', true)
    await waitForControlResult(beta, 'shadow:beta:copy')
    expect(harness.getStored()).toMatchObject({
      sites: {
        'https://alpha.example': { enabledToolIds: ['free-page-edit'] },
        'https://beta.example': { enabledToolIds: ['selection-copy-release'] },
      },
    })
  })

  it('drops late control completion after navigation and preserves persisted and peer state on failures', async () => {
    const harness = createHarness(settingsFor('https://alpha.example', 'https://beta.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    harness.grantedOrigins.add('https://beta.example/*')
    await harness.controller.status()
    const alpha = createHostPort()
    const beta = createHostPort({ tabId: 2, url: 'https://beta.example/home', documentId: 'doc-beta' })
    const alphaInit = await connectPort(harness.controller, alpha, 7)
    await connectPort(harness.controller, beta, 8)
    let releasePermission!: (_value: boolean) => void
    const blockedPermission = new Promise<boolean>(resolve => releasePermission = resolve)
    harness.permissions.contains.mockImplementationOnce(() => blockedPermission)
    const before = structuredClone(harness.getStoredDocument())
    const permissionChecks = harness.permissions.contains.mock.calls.length
    emitControlToggle(alpha, alphaInit, 'shadow:alpha:stale', 'free-page-edit', true)
    await vi.waitFor(() => expect(harness.permissions.contains.mock.calls.length).toBeGreaterThan(permissionChecks))
    harness.controller.handleTabUpdated(1, { status: 'loading', url: 'https://alpha.example/next' })
    releasePermission(true)
    await vi.waitFor(() => expect(alpha.port.disconnect).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(alpha.messages.filter(message => (
      (message as { type?: string }).type === 'PAGE_TOOLBOX_CONTROL_RESULT'
    ))).toEqual([])
    expect(harness.getStoredDocument()).toEqual(before)
    expect(beta.port.disconnect).not.toHaveBeenCalled()

    harness.setActiveTab(2)
    harness.state.write.mockRejectedValueOnce(new Error('disk full'))
    const betaSession = (await harness.controller.status())
    expect(betaSession).toMatchObject({ ok: true })
    const betaInit = beta.messages[0] as { sessionNonce: string, binding: PageToolboxRuntimeBindingV1 }
    emitControlToggle(beta, betaInit, 'shadow:beta:failure', 'password-visibility', true)
    await expect(waitForControlResult(beta, 'shadow:beta:failure')).resolves.toMatchObject({
      ok: false,
      reason: 'settings-write-failed',
    })
    expect(harness.getStoredDocument()).toEqual(before)
  })

  it('rejects tool changes before exact site approval without mutating lifecycle state', async () => {
    const harness = createHarness()
    await expect(harness.controller.setCurrentSiteTool({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'free-page-edit',
      enabled: true,
      settings: { mode: 'rich-text' },
    })).resolves.toEqual({ ok: false, operation: 'set-tool', reason: 'permission-missing' })
    expect(harness.state.write).not.toHaveBeenCalled()
    expect(harness.injection.inject).not.toHaveBeenCalled()
  })

  it('deletes only revoked-origin state and authority when browser permission disappears', async () => {
    const harness = createHarness(settingsFor('https://alpha.example', 'https://beta.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    harness.grantedOrigins.add('https://beta.example/*')
    await harness.controller.status()
    const alpha = createHostPort()
    const beta = createHostPort({ tabId: 2, url: 'https://beta.example/home', documentId: 'doc-beta' })
    await connectPort(harness.controller, alpha)
    await connectPort(harness.controller, beta, 10)

    harness.grantedOrigins.delete('https://alpha.example/*')
    await harness.controller.handlePermissionsRemoved({ origins: ['https://alpha.example/*'] })
    expect(harness.getStored()).toEqual(settingsFor('https://beta.example'))
    expect(alpha.port.disconnect).toHaveBeenCalledOnce()
    expect(beta.port.disconnect).not.toHaveBeenCalled()
    await expect(harness.controller.status()).resolves.toMatchObject({
      ok: true,
      snapshot: {
        approvedOrigins: ['https://beta.example'],
        sessions: [{ tabId: 2 }],
      },
    })
  })

  it('retains shared remote and builtin origins during explicit current-site revoke', async () => {
    const remote = toolboxRecord()
    remote.source = 'user'
    remote.manifest = {
      manifest_version: 1,
      runtime: 'remote-frame',
      id: 'dev.oneweb.remote-peer',
      name: 'Peer',
      version: '1.0.0',
      description: 'Peer',
      icon_url: 'https://alpha.example/icon.png',
      entry_url: 'https://alpha.example/embed',
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: [],
      activation: 'manual',
      min_host_version: '0.0.1',
      bridge: { protocol: 'oneweb.module', version: 1 },
    }
    remote.sourceUrl = 'https://alpha.example/manifest.json'
    const remoteHarness = createHarness(settingsFor('https://alpha.example'))
    remoteHarness.grantedOrigins.add('https://alpha.example/*')
    remoteHarness.setExtraRecords([remote])
    await expect(remoteHarness.controller.revokeCurrentSite()).resolves.toMatchObject({
      ok: true,
      changed: true,
      releasedOrigin: false,
    })
    expect(remoteHarness.permissions.remove).not.toHaveBeenCalled()

    const builtinHarness = createHarness(settingsFor('https://alpha.example'))
    builtinHarness.grantedOrigins.add('https://alpha.example/*')
    builtinHarness.originInUse.mockResolvedValue(true)
    await builtinHarness.controller.revokeCurrentSite()
    expect(builtinHarness.originInUse).toHaveBeenCalledWith('https://alpha.example/*')
    expect(builtinHarness.permissions.remove).not.toHaveBeenCalled()
  })

  it('disables all live authority while retaining settings and reconciles fresh injection on enable', async () => {
    const harness = createHarness(settingsFor('https://alpha.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    await harness.controller.status()
    const port = createHostPort()
    await connectPort(harness.controller, port)
    harness.setRecord(toolboxRecord(false))
    expect(harness.controller.handleInstalledRecordChanged(toolboxRecord(false))).toBe(true)
    expect(port.messages.at(-1)).toMatchObject({ type: 'PAGE_TOOLBOX_DISPOSE', reason: 'disabled' })
    expect(harness.getStored()).toEqual(settingsFor('https://alpha.example'))

    harness.setRecord(toolboxRecord(true))
    harness.controller.handleInstalledRecordChanged(toolboxRecord(true))
    await vi.waitFor(() => expect(harness.injection.inject).toHaveBeenCalledWith(1))
  })

  it('worker startup drops stale missing grants and injects only approved matching tabs', async () => {
    const harness = createHarness(settingsFor('https://alpha.example', 'https://beta.example'))
    harness.grantedOrigins.add('https://alpha.example/*')
    await expect(harness.controller.startup()).resolves.toBe(true)
    expect(harness.getStored()).toEqual(settingsFor('https://alpha.example'))
    expect(harness.injection.inject).toHaveBeenCalledTimes(1)
    expect(harness.injection.inject).toHaveBeenCalledWith(1)
    await expect(harness.controller.status()).resolves.toMatchObject({
      ok: true,
      snapshot: { approvedOrigins: ['https://alpha.example'], sessions: [] },
    })
  })

  it('fails closed on malformed persisted state without mutating or injecting', async () => {
    const malformed = { schemaVersion: 1, sites: { '*://*/*': { enabledToolIds: [], toolSettings: {} } } }
    const harness = createHarness(malformed as unknown as PageToolboxSettingsV1)
    harness.grantedOrigins.add('https://alpha.example/*')
    await expect(harness.controller.startup()).resolves.toBe(false)
    await expect(harness.controller.status()).resolves.toEqual({
      ok: false,
      operation: 'status',
      reason: 'settings-read-failed',
    })
    expect(harness.state.write).not.toHaveBeenCalled()
    expect(harness.injection.inject).not.toHaveBeenCalled()
  })
})
