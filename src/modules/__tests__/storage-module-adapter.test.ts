import type { CapabilityRpcSessionBinding, RemoteFrameModuleManifest } from '@oneweb/module-sdk'
import {
  createStorageModuleClearRequestEnvelope,
  createStorageModuleReadRequestEnvelope,
  createStorageModuleReplaceRequestEnvelope,
  STORAGE_MODULE_DOCUMENT_MAX_BYTES,
} from '@oneweb/module-sdk'
import { ModuleManager } from '../manager'
import { ModuleRegistry, MODULES_STORAGE_KEY } from '../registry'
import {
  getStorageModuleDocumentStorageKey,
  STORAGE_MODULE_DOCUMENT_STORAGE_PREFIX,
  StorageModuleAdapter,
} from '../storage-module-adapter'

class MemoryStorage {
  state: Record<string, unknown> = {}
  failNextDocumentSetFor: string | null = null
  blockDocumentSetFor: string | null = null
  blockedDocumentSet = false
  private releaseBlockedSet: (() => void) | null = null

  async get(_key: string) {
    return structuredClone(this.state)
  }

  async set(items: Record<string, unknown>) {
    const [key] = Object.keys(items)
    if (key === this.failNextDocumentSetFor) {
      this.failNextDocumentSetFor = null
      throw new Error('synthetic storage failure')
    }
    if (key === this.blockDocumentSetFor) {
      this.blockDocumentSetFor = null
      this.blockedDocumentSet = true
      await new Promise<void>(resolve => this.releaseBlockedSet = resolve)
      this.releaseBlockedSet = null
      this.blockedDocumentSet = false
    }
    this.state = { ...this.state, ...structuredClone(items) }
  }

  async remove(key: string) {
    const next = { ...this.state }
    delete next[key]
    this.state = next
  }

  releaseSet() {
    this.releaseBlockedSet?.()
  }
}

const alphaBinding = Object.freeze({
  moduleId: 'dev.oneweb.storage.alpha',
  sessionId: 'session_storage_adapter_alpha_12345678901234567890',
  generation: 3,
})
const betaBinding = Object.freeze({
  moduleId: 'dev.oneweb.storage.beta',
  sessionId: 'session_storage_adapter_beta_123456789012345678901',
  generation: 7,
})

function manifest(moduleId: string, capabilities: RemoteFrameModuleManifest['capabilities'] = ['storage.module']): RemoteFrameModuleManifest {
  const origin = moduleId === alphaBinding.moduleId ? 'https://alpha.example' : 'https://beta.example'
  return {
    manifest_version: 1,
    runtime: 'remote-frame',
    id: moduleId,
    name: moduleId,
    version: '1.0.0',
    description: 'Storage adapter fixture',
    icon_url: `${origin}/icon.png`,
    entry_url: `${origin}/embed`,
    matches: [`${origin}/*`],
    contexts: [],
    context_fields: {},
    capabilities,
    activation: 'manual',
    min_host_version: '0.0.1',
    bridge: { protocol: 'oneweb.module', version: 1 },
  }
}

async function install(
  registry: ModuleRegistry,
  moduleId: string,
  grantedCapabilities: RemoteFrameModuleManifest['capabilities'] = ['storage.module'],
) {
  const installed = await registry.installUserModule({
    manifest: manifest(moduleId),
    sourceUrl: `${new URL(manifest(moduleId).entry_url).origin}/manifest.json`,
    grantedContextFields: {},
    grantedCapabilities,
  })
  expect(installed.ok).toBe(true)
  if (!installed.ok)
    throw new Error('Expected installed storage fixture')
  return installed.record
}

function identity(binding: CapabilityRpcSessionBinding, requestId: string) {
  return { ...binding, requestId }
}

function readRequest(binding: CapabilityRpcSessionBinding, requestId = 'request_storage_adapter_read') {
  return createStorageModuleReadRequestEnvelope(identity(binding, requestId))
}

function entropySequence() {
  let value = 0
  return () => new Uint8Array(24).fill(++value)
}

async function harness() {
  const storage = new MemoryStorage()
  let timestamp = 0
  const registry = new ModuleRegistry({
    storage,
    now: () => `2026-08-30T00:00:${String(timestamp++).padStart(2, '0')}.000Z`,
  })
  await install(registry, alphaBinding.moduleId)
  await install(registry, betaBinding.moduleId)
  const adapter = new StorageModuleAdapter({ registry, storage, entropy: entropySequence() })
  return { adapter, registry, storage }
}

function expectSuccess<Result>(result: { ok: boolean, result?: Result }): asserts result is { ok: true, result: Result } {
  expect(result.ok).toBe(true)
}

describe('trusted background storage.module adapter', () => {
  it('reads, replaces and clears only one host-derived document with CAS revision rotation', async () => {
    const { adapter, storage } = await harness()
    expect(await adapter.openSession(alphaBinding)).toEqual({ ok: true, result: null })

    const first = await adapter.execute(alphaBinding, readRequest(alphaBinding))
    expectSuccess<{ revision: string, document: unknown }>(first)
    expect(first.result.document).toBeNull()
    const replaced = await adapter.execute(alphaBinding, createStorageModuleReplaceRequestEnvelope(
      identity(alphaBinding, 'request_storage_adapter_replace'),
      first.result.revision,
      { z: 2, a: ['local'] },
    ))
    expectSuccess<{ revision: string }>(replaced)
    expect(replaced.result.revision).not.toBe(first.result.revision)

    const read = await adapter.execute(alphaBinding, readRequest(alphaBinding, 'request_storage_adapter_read_2'))
    expectSuccess<{ revision: string, document: unknown }>(read)
    expect(read.result).toEqual({ revision: replaced.result.revision, document: { a: ['local'], z: 2 } })
    const cleared = await adapter.execute(alphaBinding, createStorageModuleClearRequestEnvelope(
      identity(alphaBinding, 'request_storage_adapter_clear'),
      read.result.revision,
    ))
    expectSuccess<{ revision: string }>(cleared)
    expect(cleared.result.revision).not.toBe(read.result.revision)

    const key = getStorageModuleDocumentStorageKey(alphaBinding.moduleId)
    expect(key).toBe(`${STORAGE_MODULE_DOCUMENT_STORAGE_PREFIX}${encodeURIComponent(alphaBinding.moduleId)}`)
    expect(storage.state[key]).toMatchObject({
      schemaVersion: 1,
      document: null,
      revision: cleared.result.revision,
    })
    expect(JSON.stringify(storage.state[key])).not.toContain('session_storage_adapter')
  })

  it('serializes same-module writers so one stale expected revision conflicts without lost update', async () => {
    const { adapter } = await harness()
    await adapter.openSession(alphaBinding)
    const initial = await adapter.execute(alphaBinding, readRequest(alphaBinding))
    expectSuccess<{ revision: string }>(initial)
    const [first, second] = await Promise.all([
      adapter.execute(alphaBinding, createStorageModuleReplaceRequestEnvelope(
        identity(alphaBinding, 'request_storage_adapter_cas_first'),
        initial.result.revision,
        { writer: 'first' },
      )),
      adapter.execute(alphaBinding, createStorageModuleReplaceRequestEnvelope(
        identity(alphaBinding, 'request_storage_adapter_cas_second'),
        initial.result.revision,
        { writer: 'second' },
      )),
    ])
    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, code: 'STORAGE_REVISION_CONFLICT' })
    const current = await adapter.execute(alphaBinding, readRequest(alphaBinding, 'request_storage_adapter_cas_read'))
    expectSuccess<{ document: unknown }>(current)
    expect(current.result.document).toEqual({ writer: 'first' })
  })

  it('rejects forged session/generation and replacement-session replay before storage access', async () => {
    const { adapter, storage } = await harness()
    await adapter.openSession(alphaBinding)
    expect(await adapter.execute(
      { ...alphaBinding, generation: alphaBinding.generation + 1 },
      readRequest({ ...alphaBinding, generation: alphaBinding.generation + 1 }),
    )).toEqual({ ok: false, code: 'SESSION_MISMATCH' })
    expect(await adapter.execute(alphaBinding, readRequest(betaBinding))).toEqual({
      ok: false,
      code: 'SESSION_MISMATCH',
    })

    const replacement = {
      ...alphaBinding,
      sessionId: 'session_storage_adapter_alpha_replacement_123456789012',
      generation: alphaBinding.generation + 1,
    }
    await adapter.openSession(replacement)
    expect(await adapter.execute(alphaBinding, readRequest(alphaBinding))).toEqual({
      ok: false,
      code: 'SESSION_MISMATCH',
    })
    expect(Object.keys(storage.state).filter(key => key.startsWith(STORAGE_MODULE_DOCUMENT_STORAGE_PREFIX))).toEqual([])
  })

  it('enforces declaration, grant and document quotas without a key or storage-method escape hatch', async () => {
    const { adapter, registry } = await harness()
    const ungranted = await registry.setCapabilityGrant(alphaBinding.moduleId, 'storage.module', false)
    expect(ungranted.ok).toBe(true)
    expect(await adapter.openSession(alphaBinding)).toEqual({ ok: false, code: 'CAPABILITY_NOT_ALLOWED' })

    const undeclaredId = 'dev.oneweb.storage.undeclared'
    await registry.installUserModule({
      manifest: manifest(undeclaredId, []),
      sourceUrl: 'https://beta.example/manifest.json',
      grantedContextFields: {},
      grantedCapabilities: [],
    })
    expect(await adapter.openSession({ ...betaBinding, moduleId: undeclaredId })).toEqual({
      ok: false,
      code: 'CAPABILITY_NOT_ALLOWED',
    })

    const oversized = 'x'.repeat(STORAGE_MODULE_DOCUMENT_MAX_BYTES)
    expect(() => createStorageModuleReplaceRequestEnvelope(
      identity(alphaBinding, 'request_storage_adapter_oversized'),
      'storage-revision-'.concat('01'.repeat(24)),
      oversized,
    )).toThrow('PAYLOAD_TOO_LARGE')
  })

  it('invalidates on grant revoke or disable while retaining inaccessible local data', async () => {
    const { adapter, registry, storage } = await harness()
    await adapter.openSession(alphaBinding)
    const read = await adapter.execute(alphaBinding, readRequest(alphaBinding))
    expectSuccess<{ revision: string }>(read)
    await adapter.execute(alphaBinding, createStorageModuleReplaceRequestEnvelope(
      identity(alphaBinding, 'request_storage_adapter_retained'),
      read.result.revision,
      { retained: true },
    ))
    const key = getStorageModuleDocumentStorageKey(alphaBinding.moduleId)
    const retained = structuredClone(storage.state[key])

    await registry.setCapabilityGrant(alphaBinding.moduleId, 'storage.module', false)
    expect(await adapter.execute(alphaBinding, readRequest(alphaBinding, 'request_storage_adapter_revoked')))
      .toEqual({ ok: false, code: 'CAPABILITY_NOT_ALLOWED' })
    expect(storage.state[key]).toEqual(retained)

    await registry.setCapabilityGrant(alphaBinding.moduleId, 'storage.module', true)
    const nextBinding = { ...alphaBinding, sessionId: 'session_storage_adapter_alpha_regrant_1234567890123' }
    await adapter.openSession(nextBinding)
    await registry.setEnabled(alphaBinding.moduleId, false)
    expect(await adapter.execute(nextBinding, readRequest(nextBinding))).toEqual({
      ok: false,
      code: 'SESSION_DESTROYED',
    })
    expect(storage.state[key]).toEqual(retained)
  })

  it('drops worker session authority but restores the same local document only after a fresh open', async () => {
    const { adapter, registry, storage } = await harness()
    await adapter.openSession(alphaBinding)
    const first = await adapter.execute(alphaBinding, readRequest(alphaBinding))
    expectSuccess<{ revision: string }>(first)
    await adapter.execute(alphaBinding, createStorageModuleReplaceRequestEnvelope(
      identity(alphaBinding, 'request_storage_adapter_restart_write'),
      first.result.revision,
      { survivesWorker: true },
    ))

    const restarted = new StorageModuleAdapter({ registry, storage, entropy: entropySequence() })
    expect(await restarted.execute(alphaBinding, readRequest(alphaBinding))).toEqual({
      ok: false,
      code: 'SESSION_DESTROYED',
    })
    const fresh = { ...alphaBinding, sessionId: 'session_storage_adapter_alpha_worker_fresh_123456789' }
    expect(await restarted.openSession(fresh)).toEqual({ ok: true, result: null })
    const restored = await restarted.execute(fresh, readRequest(fresh))
    expectSuccess<{ document: unknown }>(restored)
    expect(restored.result.document).toEqual({ survivesWorker: true })
  })

  it('removes only the deleted module document and makes reinstall start empty', async () => {
    const { adapter, registry, storage } = await harness()
    const manager = new ModuleManager(registry, undefined, {
      onInstalledRecordChanged: async (record) => {
        await adapter.handleInstalledRecordChanged(record.manifest.id)
      },
      onInstalledRecordRemoved: record => adapter.removeInstalledRecord(record.manifest.id),
    })
    await adapter.openSession(alphaBinding)
    await adapter.openSession(betaBinding)
    const alphaRead = await adapter.execute(alphaBinding, readRequest(alphaBinding))
    const betaRead = await adapter.execute(betaBinding, readRequest(betaBinding))
    expectSuccess<{ revision: string }>(alphaRead)
    expectSuccess<{ revision: string }>(betaRead)
    await adapter.execute(alphaBinding, createStorageModuleReplaceRequestEnvelope(
      identity(alphaBinding, 'request_storage_adapter_remove_alpha'),
      alphaRead.result.revision,
      { owner: 'alpha' },
    ))
    await adapter.execute(betaBinding, createStorageModuleReplaceRequestEnvelope(
      identity(betaBinding, 'request_storage_adapter_keep_beta'),
      betaRead.result.revision,
      { owner: 'beta' },
    ))

    const removed = await manager.remove(alphaBinding.moduleId)
    expect(removed.ok).toBe(true)
    expect(storage.state[getStorageModuleDocumentStorageKey(alphaBinding.moduleId)]).toBeUndefined()
    expect(storage.state[getStorageModuleDocumentStorageKey(betaBinding.moduleId)]).toMatchObject({
      document: { owner: 'beta' },
    })
    expect(await adapter.execute(alphaBinding, readRequest(alphaBinding))).toEqual({
      ok: false,
      code: 'SESSION_DESTROYED',
    })

    await install(registry, alphaBinding.moduleId)
    const reinstalledBinding = {
      ...alphaBinding,
      sessionId: 'session_storage_adapter_alpha_reinstalled_12345678901',
      generation: 1,
    }
    await adapter.openSession(reinstalledBinding)
    const reinstalled = await adapter.execute(reinstalledBinding, readRequest(reinstalledBinding))
    expectSuccess<{ document: unknown }>(reinstalled)
    expect(reinstalled.result.document).toBeNull()
  })

  it('keeps module queues, failures and every unrelated namespace isolated', async () => {
    const { adapter, storage } = await harness()
    storage.state['oneweb.module-state.v1:dev.oneweb.bookmark-doctor'] = { sentinel: 'bookmark' }
    storage.state['unrelated.key'] = { sentinel: 'global' }
    await adapter.openSession(alphaBinding)
    await adapter.openSession(betaBinding)
    const alphaRead = await adapter.execute(alphaBinding, readRequest(alphaBinding))
    const betaRead = await adapter.execute(betaBinding, readRequest(betaBinding))
    expectSuccess<{ revision: string }>(alphaRead)
    expectSuccess<{ revision: string }>(betaRead)
    const alphaKey = getStorageModuleDocumentStorageKey(alphaBinding.moduleId)
    storage.blockDocumentSetFor = alphaKey

    const blocked = adapter.execute(alphaBinding, createStorageModuleReplaceRequestEnvelope(
      identity(alphaBinding, 'request_storage_adapter_blocked_alpha'),
      alphaRead.result.revision,
      { owner: 'alpha' },
    ))
    await vi.waitFor(() => expect(storage.blockedDocumentSet).toBe(true))
    const beta = await adapter.execute(betaBinding, createStorageModuleReplaceRequestEnvelope(
      identity(betaBinding, 'request_storage_adapter_parallel_beta'),
      betaRead.result.revision,
      { owner: 'beta' },
    ))
    expect(beta.ok).toBe(true)
    storage.releaseSet()
    expect((await blocked).ok).toBe(true)

    storage.failNextDocumentSetFor = alphaKey
    const alphaCurrent = await adapter.execute(alphaBinding, readRequest(alphaBinding, 'request_storage_adapter_failure_read'))
    expectSuccess<{ revision: string }>(alphaCurrent)
    expect(await adapter.execute(alphaBinding, createStorageModuleReplaceRequestEnvelope(
      identity(alphaBinding, 'request_storage_adapter_failure_write'),
      alphaCurrent.result.revision,
      { shouldNotLand: true },
    ))).toEqual({ ok: false, code: 'OPERATION_FAILED' })
    expect(storage.state[getStorageModuleDocumentStorageKey(betaBinding.moduleId)]).toMatchObject({
      document: { owner: 'beta' },
    })
    expect(storage.state['oneweb.module-state.v1:dev.oneweb.bookmark-doctor']).toEqual({ sentinel: 'bookmark' })
    expect(storage.state['unrelated.key']).toEqual({ sentinel: 'global' })
    expect(storage.state[MODULES_STORAGE_KEY]).toBeDefined()
  })

  it('fails closed on malformed current-installation bytes and resets stale-installation bytes', async () => {
    const { adapter, registry, storage } = await harness()
    const key = getStorageModuleDocumentStorageKey(alphaBinding.moduleId)
    const record = await registry.get(alphaBinding.moduleId)
    if (!record)
      throw new Error('Missing alpha fixture')
    storage.state[key] = {
      schemaVersion: 1,
      installationId: record.installedAt,
      revision: 'forged',
      document: { private: 'must-not-return' },
    }
    await adapter.openSession(alphaBinding)
    expect(await adapter.execute(alphaBinding, readRequest(alphaBinding))).toEqual({
      ok: false,
      code: 'OPERATION_FAILED',
    })

    storage.state[key] = {
      schemaVersion: 1,
      installationId: 'old-installation',
      revision: 'forged',
      document: { private: 'old-installation' },
    }
    const freshBinding = { ...alphaBinding, sessionId: 'session_storage_adapter_alpha_stale_reset_123456789' }
    await adapter.openSession(freshBinding)
    const fresh = await adapter.execute(freshBinding, readRequest(freshBinding))
    expectSuccess<{ document: unknown }>(fresh)
    expect(fresh.result.document).toBeNull()
    expect(JSON.stringify(storage.state[key])).not.toContain('old-installation')
  })
})
