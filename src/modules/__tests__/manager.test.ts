import type { ModuleInstaller } from '../installer'
import {
  isModuleManagementRequest,
  isModuleManagementResponse,
  isTrustedModuleManagementSender,
  ONEWEB_MODULE_MANAGEMENT_CHANNEL,
  ONEWEB_MODULE_MANAGEMENT_VERSION,
} from '../management-protocol'
import { ModuleManager } from '../manager'
import { ModuleRegistry, type ModuleStorageArea } from '../registry'
import { createRepoLensSeed } from '../seeds/repolens'

class MemoryStorage implements ModuleStorageArea {
  state: Record<string, unknown> = {}

  async get(_key: string) {
    return structuredClone(this.state)
  }

  async set(items: Record<string, unknown>) {
    this.state = { ...this.state, ...structuredClone(items) }
  }
}

describe('module management boundary', () => {
  const listRequest = {
    channel: ONEWEB_MODULE_MANAGEMENT_CHANNEL,
    version: ONEWEB_MODULE_MANAGEMENT_VERSION,
    type: 'MODULE_LIST',
  } as const

  it('accepts only versioned management operations with valid install grants', () => {
    expect(isModuleManagementRequest(listRequest)).toBe(true)
    expect(isModuleManagementRequest({ ...listRequest, version: 2 })).toBe(false)
    expect(isModuleManagementRequest({ ...listRequest, type: 'MODULE_INSTALL', manifestUrl: 'https://example.com' })).toBe(false)
    expect(isModuleManagementRequest({
      ...listRequest,
      type: 'MODULE_SET_ENABLED',
      moduleId: 'dev.juck.repolens',
      enabled: false,
    })).toBe(true)
    expect(isModuleManagementRequest({
      ...listRequest,
      type: 'MODULE_SET_ENABLED',
      moduleId: 'dev.juck.repolens',
      enabled: 'false',
    })).toBe(false)
    expect(isModuleManagementRequest({
      ...listRequest,
      type: 'MODULE_UPDATE_CHECK',
      moduleId: 'dev.juck.repolens',
    })).toBe(true)
    expect(isModuleManagementRequest({
      ...listRequest,
      type: 'MODULE_UPDATE_CHECK',
      moduleId: '',
    })).toBe(false)
    const approveRequest = {
      ...listRequest,
      type: 'MODULE_UPDATE_APPROVE',
      moduleId: 'dev.juck.repolens',
      expectedDigest: 'a'.repeat(64),
      approvedContextFields: { 'page.metadata': ['title'] },
      approvedCapabilities: ['clipboard.write'],
    }
    expect(isModuleManagementRequest(approveRequest)).toBe(true)
    expect(isModuleManagementRequest({ ...approveRequest, expectedDigest: 'forged' })).toBe(false)
    expect(isModuleManagementRequest({
      ...approveRequest,
      approvedContextFields: { 'page.body': ['text'] },
    })).toBe(false)
    expect(isModuleManagementRequest({
      ...approveRequest,
      approvedCapabilities: ['browser.call'],
    })).toBe(false)
    expect(isModuleManagementRequest({
      ...listRequest,
      type: 'MODULE_UPDATE_APPLY',
      moduleId: 'dev.juck.repolens',
    })).toBe(true)

    const confirmRequest = {
      ...listRequest,
      type: 'MODULE_INSTALL_CONFIRM',
      manifestUrl: 'https://modules.example/manifest.json',
      expectedDigest: 'a'.repeat(64),
      grantedContextFields: { 'github.repository': ['repo'] },
      grantedCapabilities: ['tabs.open'],
    }
    expect(isModuleManagementRequest({
      ...listRequest,
      type: 'MODULE_INSTALL_PREPARE',
      manifestUrl: 'https://modules.example/manifest.json',
    })).toBe(true)
    expect(isModuleManagementRequest(confirmRequest)).toBe(true)
    expect(isModuleManagementRequest({
      ...confirmRequest,
      expectedDigest: 'forged',
    })).toBe(false)
    expect(isModuleManagementRequest({
      ...confirmRequest,
      grantedContextFields: { 'page.body': ['text'] },
    })).toBe(false)
    expect(isModuleManagementRequest({
      ...confirmRequest,
      grantedCapabilities: ['browser.call'],
    })).toBe(false)
  })

  it('allows management only from an extension page owned by OneWeb', () => {
    const extensionId = 'oneweb-id'
    const extensionBaseUrl = `chrome-extension://${extensionId}/`
    expect(isTrustedModuleManagementSender({
      id: extensionId,
      url: `${extensionBaseUrl}sidebar/index.html`,
      tab: { id: 1 },
    }, extensionId, extensionBaseUrl)).toBe(true)
    expect(isTrustedModuleManagementSender({
      id: extensionId,
      url: 'https://github.com/example/repo',
      tab: { id: 1 },
    }, extensionId, extensionBaseUrl)).toBe(false)
    expect(isTrustedModuleManagementSender({
      id: 'another-extension',
      url: 'chrome-extension://another-extension/options.html',
    }, extensionId, extensionBaseUrl)).toBe(false)
  })

  it('routes list and lifecycle mutations through the background manager', async () => {
    const seed = createRepoLensSeed('http://127.0.0.1:4747')
    const onInstalledRecordChanged = vi.fn()
    const manager = new ModuleManager(new ModuleRegistry({
      storage: new MemoryStorage(),
      seeds: [seed],
      now: () => '2026-08-27T10:00:00.000Z',
    }), undefined, { onInstalledRecordChanged })

    const listed = await manager.handle(listRequest)
    expect(isModuleManagementResponse(listed)).toBe(true)
    expect(listed).toMatchObject({
      requestType: 'MODULE_LIST',
      result: { ok: true, operation: 'list', modules: [{ manifest: { id: seed.manifest.id } }] },
    })

    const disabled = await manager.handle({
      ...listRequest,
      type: 'MODULE_SET_ENABLED',
      moduleId: seed.manifest.id,
      enabled: false,
    })
    expect(disabled).toMatchObject({
      requestType: 'MODULE_SET_ENABLED',
      result: { ok: true, operation: 'set-enabled', changed: true, record: { enabled: false } },
    })
    expect(onInstalledRecordChanged).toHaveBeenCalledWith(expect.objectContaining({
      manifest: expect.objectContaining({ id: seed.manifest.id }),
      enabled: false,
    }))

    const protectedRemoval = await manager.handle({
      ...listRequest,
      type: 'MODULE_REMOVE',
      moduleId: seed.manifest.id,
    })
    expect(protectedRemoval).toMatchObject({
      requestType: 'MODULE_REMOVE',
      result: { ok: false, operation: 'remove', changed: false, reason: 'protected-seed' },
    })
    expect(isModuleManagementResponse({
      ...protectedRemoval,
      requestType: 'MODULE_LIST',
    })).toBe(false)
  })

  it('returns the final record after a lifecycle hook performs module-local cleanup', async () => {
    const seed = createRepoLensSeed('http://127.0.0.1:4747')
    seed.manifest.capabilities = ['tabs.open']
    seed.grantedCapabilities = ['tabs.open']
    const registry = new ModuleRegistry({
      storage: new MemoryStorage(),
      seeds: [seed],
      now: () => '2026-08-29T05:00:00.000Z',
    })
    const manager = new ModuleManager(registry, undefined, {
      async onInstalledRecordChanged(record) {
        await registry.setCapabilityGrant(record.manifest.id, 'tabs.open', false)
      },
    })

    await expect(manager.setEnabled(seed.manifest.id, false)).resolves.toMatchObject({
      ok: true,
      operation: 'set-enabled',
      record: {
        enabled: false,
        grantedCapabilities: [],
      },
    })
  })

  it('routes prepare, confirm and cancel through the background installer', async () => {
    const seed = createRepoLensSeed('https://modules.example')
    if (seed.manifest.runtime !== 'remote-frame')
      throw new Error('Expected a remote-frame seed')
    const manifestUrl = 'https://modules.example/manifest.json'
    const digest = 'c'.repeat(64)
    const record = {
      manifest: { ...seed.manifest, id: 'dev.juck.installable' },
      enabled: true,
      source: 'user' as const,
      sourceUrl: manifestUrl,
      grantedContexts: ['github.repository'] as const,
      grantedContextFields: { 'github.repository': ['repo'] },
      grantedCapabilities: [],
      update: null,
      installedAt: '2026-08-27T10:00:00.000Z',
      updatedAt: '2026-08-27T10:00:00.000Z',
    }
    const installer = {
      prepare: vi.fn(async () => ({
        ok: true as const,
        review: {
          manifest: record.manifest,
          manifestUrl,
          manifestDigest: digest,
          originPattern: 'https://modules.example/*',
        },
      })),
      confirm: vi.fn(async () => ({ ok: true as const, record })),
      cancel: vi.fn(async () => true),
      checkForUpdate: vi.fn(async () => ({ ok: true as const, record })),
      releaseRemovedRecord: vi.fn(async () => true),
    } as unknown as ModuleInstaller
    const manager = new ModuleManager(new ModuleRegistry({ storage: new MemoryStorage() }), installer)

    const prepared = await manager.handle({
      ...listRequest,
      type: 'MODULE_INSTALL_PREPARE',
      manifestUrl,
    })
    expect(prepared).toMatchObject({
      requestType: 'MODULE_INSTALL_PREPARE',
      result: { ok: true, operation: 'install-prepare', review: { manifestUrl } },
    })
    expect(isModuleManagementResponse(prepared)).toBe(true)
    expect(isModuleManagementResponse({
      ...prepared,
      result: {
        ok: true,
        operation: 'install-prepare',
        review: {
          manifest: record.manifest,
          manifestUrl,
          manifestDigest: 'forged',
          originPattern: 'https://modules.example/*',
        },
      },
    })).toBe(false)

    const confirmed = await manager.handle({
      ...listRequest,
      type: 'MODULE_INSTALL_CONFIRM',
      manifestUrl,
      expectedDigest: digest,
      grantedContextFields: { 'github.repository': ['repo'] },
      grantedCapabilities: [],
    })
    expect(confirmed).toMatchObject({
      requestType: 'MODULE_INSTALL_CONFIRM',
      result: { ok: true, operation: 'install-confirm', record: { manifest: { id: 'dev.juck.installable' } } },
    })
    expect(isModuleManagementResponse(confirmed)).toBe(true)
    expect(installer.confirm).toHaveBeenCalledWith(manifestUrl, digest, {
      grantedContextFields: { 'github.repository': ['repo'] },
      grantedCapabilities: [],
    })

    await expect(manager.handle({
      ...listRequest,
      type: 'MODULE_INSTALL_CANCEL',
      manifestUrl,
    })).resolves.toMatchObject({
      result: { ok: true, operation: 'install-cancel', releasedOrigin: true },
    })
    expect(installer.cancel).toHaveBeenCalledWith(manifestUrl)

    const updateChecked = await manager.handle({
      ...listRequest,
      type: 'MODULE_UPDATE_CHECK',
      moduleId: record.manifest.id,
    })
    expect(updateChecked).toMatchObject({
      requestType: 'MODULE_UPDATE_CHECK',
      result: {
        ok: true,
        operation: 'update-check',
        record: { manifest: { id: record.manifest.id } },
      },
    })
    expect(isModuleManagementResponse(updateChecked)).toBe(true)
    expect(installer.checkForUpdate).toHaveBeenCalledWith(record.manifest.id)
    expect(isModuleManagementResponse({
      ...updateChecked,
      result: { ok: false, operation: 'update-check', reason: 'forged' },
    })).toBe(false)
  })

  it('releases a removed user module origin through the installer', async () => {
    const seed = createRepoLensSeed('https://modules.example')
    if (seed.manifest.runtime !== 'remote-frame')
      throw new Error('Expected a remote-frame seed')
    const registry = new ModuleRegistry({ storage: new MemoryStorage() })
    const installed = await registry.installUserModule({
      manifest: { ...seed.manifest, id: 'dev.juck.removable' },
      sourceUrl: 'https://modules.example/manifest.json',
      grantedContextFields: { 'github.repository': ['repo'] },
      grantedCapabilities: [],
    })
    if (!installed.ok)
      throw new Error('Expected an installed fixture')
    const installer = {
      releaseRemovedRecord: vi.fn(async () => true),
    } as unknown as ModuleInstaller
    const onInstalledRecordRemoved = vi.fn(async () => {})
    const manager = new ModuleManager(registry, installer, { onInstalledRecordRemoved })

    await expect(manager.remove(installed.record.manifest.id)).resolves.toMatchObject({
      ok: true,
      operation: 'remove',
    })
    expect(onInstalledRecordRemoved).toHaveBeenCalledWith(installed.record)
    expect(installer.releaseRemovedRecord).toHaveBeenCalledWith(installed.record)
  })

  it('routes explicit update approval and application through background-owned mutations', async () => {
    const seed = createRepoLensSeed('https://modules.example')
    const digest = 'd'.repeat(64)
    const record = {
      manifest: seed.manifest,
      enabled: true,
      source: 'user' as const,
      sourceUrl: 'https://modules.example/manifest.json',
      grantedContexts: seed.grantedContexts,
      grantedContextFields: seed.grantedContextFields,
      grantedCapabilities: seed.grantedCapabilities,
      update: null,
      installedAt: '2026-08-27T10:00:00.000Z',
      updatedAt: '2026-08-27T10:00:00.000Z',
    }
    const registry = {
      approveModuleUpdate: vi.fn(async () => ({ ok: true as const, changed: true as const, record })),
    } as unknown as ModuleRegistry
    const installer = {
      applyUpdate: vi.fn(async () => ({ ok: true as const, record })),
    } as unknown as ModuleInstaller
    const onInstalledRecordChanged = vi.fn(async () => {})
    const manager = new ModuleManager(registry, installer, { onInstalledRecordChanged })

    const approved = await manager.handle({
      ...listRequest,
      type: 'MODULE_UPDATE_APPROVE',
      moduleId: record.manifest.id,
      expectedDigest: digest,
      approvedContextFields: { 'github.repository': ['url'] },
      approvedCapabilities: [],
    })
    expect(approved).toMatchObject({
      requestType: 'MODULE_UPDATE_APPROVE',
      result: { ok: true, operation: 'update-approve', changed: true },
    })
    expect(isModuleManagementResponse(approved)).toBe(true)
    expect(registry.approveModuleUpdate).toHaveBeenCalledWith(record.manifest.id, digest, {
      approvedContextFields: { 'github.repository': ['url'] },
      approvedCapabilities: [],
    })

    const applied = await manager.handle({
      ...listRequest,
      type: 'MODULE_UPDATE_APPLY',
      moduleId: record.manifest.id,
    })
    expect(applied).toMatchObject({
      requestType: 'MODULE_UPDATE_APPLY',
      result: { ok: true, operation: 'update-apply' },
    })
    expect(isModuleManagementResponse(applied)).toBe(true)
    expect(installer.applyUpdate).toHaveBeenCalledWith(record.manifest.id)
    expect(onInstalledRecordChanged).toHaveBeenCalledWith(record)
    expect(isModuleManagementResponse({
      ...applied,
      result: { ok: false, operation: 'update-apply', reason: 'forged' },
    })).toBe(false)
  })
})
