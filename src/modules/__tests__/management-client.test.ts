import { ModuleManagementClient } from '../management-client'
import { createModuleManagementResponse } from '../management-protocol'
import { createRepoLensSeed } from '../seeds/repolens'

function repoLensRecord(enabled = true) {
  const seed = createRepoLensSeed('http://127.0.0.1:4747')
  return {
    manifest: seed.manifest,
    enabled,
    source: 'seeded' as const,
    grantedContexts: seed.grantedContexts,
    grantedContextFields: seed.grantedContextFields,
    grantedCapabilities: seed.grantedCapabilities,
    update: null,
    installedAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
}

describe('module management client', () => {
  it('uses only the versioned management requests and validates matching responses', async () => {
    const record = repoLensRecord()
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'MODULE_LIST') {
        return createModuleManagementResponse(message.type, {
          ok: true,
          operation: 'list',
          modules: [record],
        })
      }
      if (message.type === 'MODULE_SET_ENABLED') {
        return createModuleManagementResponse(message.type, {
          ok: true,
          operation: 'set-enabled',
          changed: true,
          record: repoLensRecord(message.enabled),
        })
      }
      if (message.type === 'MODULE_UPDATE_CHECK') {
        return createModuleManagementResponse(message.type, {
          ok: true,
          operation: 'update-check',
          record,
        })
      }
      if (message.type === 'MODULE_UPDATE_APPROVE') {
        return createModuleManagementResponse(message.type, {
          ok: true,
          operation: 'update-approve',
          changed: true,
          record,
        })
      }
      if (message.type === 'MODULE_UPDATE_APPLY') {
        return createModuleManagementResponse(message.type, {
          ok: true,
          operation: 'update-apply',
          record,
        })
      }
      return createModuleManagementResponse(message.type, {
        ok: false,
        operation: 'remove',
        changed: false,
        reason: 'protected-seed',
      })
    })
    const client = new ModuleManagementClient({ sendMessage })

    await expect(client.list()).resolves.toEqual([record])
    await expect(client.setEnabled(record.manifest.id, false)).resolves.toMatchObject({
      ok: true,
      operation: 'set-enabled',
      record: { enabled: false },
    })
    await expect(client.checkUpdate(record.manifest.id)).resolves.toMatchObject({
      ok: true,
      operation: 'update-check',
      record: { manifest: { id: record.manifest.id } },
    })
    await expect(client.approveUpdate(record.manifest.id, 'a'.repeat(64), {
      approvedContextFields: { 'page.metadata': ['title'] },
      approvedCapabilities: ['clipboard.write'],
    })).resolves.toMatchObject({ ok: true, operation: 'update-approve' })
    await expect(client.applyUpdate(record.manifest.id)).resolves.toMatchObject({
      ok: true,
      operation: 'update-apply',
    })
    await expect(client.remove(record.manifest.id)).resolves.toEqual({
      ok: false,
      operation: 'remove',
      changed: false,
      reason: 'protected-seed',
    })
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'MODULE_LIST',
      'MODULE_SET_ENABLED',
      'MODULE_UPDATE_CHECK',
      'MODULE_UPDATE_APPROVE',
      'MODULE_UPDATE_APPLY',
      'MODULE_REMOVE',
    ])
  })

  it('distinguishes transport failures from malformed background responses', async () => {
    const transportFailure = new ModuleManagementClient({
      sendMessage: async () => Promise.reject(new Error('offline')),
    })
    await expect(transportFailure.list()).rejects.toMatchObject({
      code: 'transport-error',
    })

    const invalidResponse = new ModuleManagementClient({
      sendMessage: async () => ({ channel: 'oneweb.module-management', version: 1, type: 'FORGED' }),
    })
    await expect(invalidResponse.list()).rejects.toMatchObject({
      code: 'invalid-response',
    })
  })

  it('requests only the exact manifest origin before preparing an install', async () => {
    const manifestUrl = 'https://modules.example/catalog/oneweb.json?channel=stable'
    const manifest = createRepoLensSeed('https://modules.example').manifest
    if (manifest.runtime !== 'remote-frame')
      throw new Error('Expected a remote-frame fixture')
    const review = {
      manifest,
      manifestUrl,
      manifestDigest: 'a'.repeat(64),
      originPattern: 'https://modules.example/*',
    }
    const permissions = {
      request: vi.fn(async () => true),
    }
    const sendMessage = vi.fn(async message => createModuleManagementResponse(message.type, {
      ok: true,
      operation: 'install-prepare',
      review,
    }))
    const client = new ModuleManagementClient({ sendMessage, permissions })

    const pending = client.prepareInstall(manifestUrl)
    expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://modules.example/*'] })
    expect(sendMessage).not.toHaveBeenCalled()
    await expect(pending).resolves.toEqual({ ok: true, operation: 'install-prepare', review })
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'MODULE_INSTALL_PREPARE',
      manifestUrl,
    }))
  })

  it('does not contact the background when origin permission is denied', async () => {
    const sendMessage = vi.fn()
    const client = new ModuleManagementClient({
      sendMessage,
      permissions: { request: vi.fn(async () => false) },
    })

    await expect(client.prepareInstall('https://modules.example/manifest.json')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('validates confirm and cancel install responses', async () => {
    const record = {
      ...repoLensRecord(),
      source: 'user' as const,
      sourceUrl: 'https://modules.example/manifest.json',
    }
    const sendMessage = vi.fn(async (message) => {
      if (message.type === 'MODULE_INSTALL_CONFIRM') {
        return createModuleManagementResponse(message.type, {
          ok: true,
          operation: 'install-confirm',
          record,
        })
      }
      return createModuleManagementResponse(message.type, {
        ok: true,
        operation: 'install-cancel',
        releasedOrigin: true,
      })
    })
    const client = new ModuleManagementClient({ sendMessage })
    const selection = {
      grantedContextFields: { 'github.repository': ['repo'] },
      grantedCapabilities: [],
    }

    await expect(client.confirmInstall(
      'https://modules.example/manifest.json',
      'b'.repeat(64),
      selection,
    )).resolves.toMatchObject({ ok: true, operation: 'install-confirm' })
    await expect(client.cancelInstall('https://modules.example/manifest.json')).resolves.toEqual({
      ok: true,
      operation: 'install-cancel',
      releasedOrigin: true,
    })
    expect(sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'MODULE_INSTALL_CONFIRM',
      expectedDigest: 'b'.repeat(64),
      ...selection,
    }))
    expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'MODULE_INSTALL_CANCEL',
    }))
  })
})
