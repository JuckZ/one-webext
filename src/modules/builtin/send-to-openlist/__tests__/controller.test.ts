import type { InstalledModuleRecord, ModuleCapabilityId } from '../../../types'
import type { SendToOpenListConnectorBoundary } from '../controller'
import { normalizeResourceCandidate } from '../candidate'
import { SendToOpenListConnectorError } from '../connector'
import {
  SEND_TO_OPENLIST_CAPABILITY,
  SEND_TO_OPENLIST_MODULE_ID,
} from '../contracts'
import { SendToOpenListController } from '../controller'
import { createSendToOpenListSeed } from '../manifest'
import { createSendToOpenListProfileStore, SEND_TO_OPENLIST_PROFILES_STORAGE_KEY, SEND_TO_OPENLIST_SECRET_KEY_PREFIX } from '../profile-store'

function moduleRecord(enabled = true): InstalledModuleRecord {
  return {
    manifest: createSendToOpenListSeed().manifest,
    enabled,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
    update: null,
    installedAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  }
}

function createHarness(connectorOverrides: Partial<SendToOpenListConnectorBoundary> = {}) {
  let record = moduleRecord()
  let time = '2026-09-03T00:00:00.000Z'
  const origins = new Set<string>()
  const storageState: Record<string, unknown> = { unrelated: { kept: true } }
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(storageState[key]) })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(storageState, structuredClone(items))
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys])
        delete storageState[key]
    }),
  }
  let inFlight = 0
  let maximumInFlight = 0
  const connector: SendToOpenListConnectorBoundary = {
    verify: vi.fn(async () => ({ authenticated: true as const })),
    discoverTools: vi.fn(async () => ['SimpleHttp', 'qBittorrent']),
    addResource: vi.fn(async (_origin, _profileId, _token, input) => {
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return `task-${input.url.at(-1)}`
    }),
    listTasks: vi.fn(async () => []),
    cancelTask: vi.fn(async () => ({ cancelled: true as const })),
    ...connectorOverrides,
  }
  const registry = {
    get: vi.fn(async () => structuredClone(record)),
    list: vi.fn(async () => [structuredClone(record)]),
    setCapabilityGrant: vi.fn(async (
      moduleId: string,
      capability: ModuleCapabilityId,
      granted: boolean,
    ) => {
      if (moduleId !== SEND_TO_OPENLIST_MODULE_ID || capability !== SEND_TO_OPENLIST_CAPABILITY)
        return { ok: false as const, changed: false as const, reason: 'not-found' as const }
      const grantedCapabilities = granted ? [SEND_TO_OPENLIST_CAPABILITY] : []
      const changed = JSON.stringify(grantedCapabilities) !== JSON.stringify(record.grantedCapabilities)
      record = { ...record, grantedCapabilities }
      return { ok: true as const, changed, record: structuredClone(record) }
    }),
  }
  const permissions = {
    contains: vi.fn(async ({ origins: requested }: { origins: string[] }) => requested.every(origin => origins.has(origin))),
    remove: vi.fn(async ({ origins: removed }: { origins: string[] }) => {
      const changed = removed.some(origin => origins.delete(origin))
      return changed
    }),
  }
  const controller = new SendToOpenListController({
    registry,
    permissions,
    store: createSendToOpenListProfileStore(storage),
    connector,
    createToken: () => 'preparation-token-1234567890',
    now: () => time,
  })
  return {
    connector,
    controller,
    origins,
    permissions,
    registry,
    storageState,
    getRecord: () => structuredClone(record),
    maximumInFlight: () => maximumInFlight,
    setRecord: (next: InstalledModuleRecord) => record = structuredClone(next),
    setTime: (next: string) => time = next,
  }
}

const profile = {
  schemaVersion: 1 as const,
  id: 'primary',
  label: 'Home server',
  controllerOrigin: 'https://openlist.example',
}

async function connect(harness: ReturnType<typeof createHarness>, token = 'private-token') {
  const prepared = await harness.controller.prepare(profile)
  if (!prepared.ok)
    throw new Error(prepared.reason)
  harness.origins.add(prepared.value.originPattern)
  const connected = await harness.controller.connect(prepared.value, token)
  if (!connected.ok)
    throw new Error(connected.reason)
  return connected.value
}

function candidate(index: number) {
  const normalized = normalizeResourceCandidate({ url: `https://cdn.example/file-${index}`, source: 'manual' })
  if (!normalized.ok)
    throw new Error(normalized.code)
  return normalized.value
}

describe('send to OpenList trusted controller', () => {
  it('binds preparation, exact-origin permission, session and grant', async () => {
    const harness = createHarness()
    const prepared = await harness.controller.prepare(profile)
    expect(prepared).toMatchObject({
      ok: true,
      value: { profile, originPattern: 'https://openlist.example/*', generation: 2 },
    })
    if (!prepared.ok)
      return
    harness.origins.add(prepared.value.originPattern)
    await expect(harness.controller.connect(prepared.value, 'private-token')).resolves.toMatchObject({
      ok: true,
      value: { phase: 'connected', profile, hasStoredToken: true },
    })
    expect(harness.getRecord().grantedCapabilities).toEqual([SEND_TO_OPENLIST_CAPABILITY])
    expect(JSON.stringify(await harness.controller.status())).not.toContain('private-token')
    expect(JSON.stringify(harness.getRecord())).not.toContain('private-token')
  })

  it('rejects stale preparations, missing permission and authentication failures', async () => {
    const harness = createHarness({
      verify: async () => Promise.reject(new SendToOpenListConnectorError('authentication-failed')),
    })
    const first = await harness.controller.prepare(profile)
    const second = await harness.controller.prepare(profile)
    if (!first.ok || !second.ok)
      throw new Error('expected preparations')
    harness.origins.add(second.value.originPattern)
    await expect(harness.controller.connect(first.value, 'token')).resolves.toMatchObject({
      ok: false,
      reason: 'lifecycle-invalidated',
    })
    const third = await harness.controller.prepare(profile)
    if (!third.ok)
      throw new Error(third.reason)
    harness.origins.add(third.value.originPattern)
    await expect(harness.controller.connect(third.value, 'token')).resolves.toMatchObject({
      ok: false,
      reason: 'authentication-failed',
    })
    expect(harness.getRecord().grantedCapabilities).toEqual([])
  })

  it('discovers tools dynamically then submits one URL per request with at most two in flight', async () => {
    const resolvers: Array<() => void> = []
    let current = 0
    let maximum = 0
    const harness = createHarness({
      addResource: vi.fn(async (_origin, _profileId, _token, input) => {
        current += 1
        maximum = Math.max(maximum, current)
        await new Promise<void>(resolve => resolvers.push(resolve))
        current -= 1
        return `task:${input.url}`
      }),
    })
    await connect(harness)
    await expect(harness.controller.discoverTools('/downloads')).resolves.toEqual({
      ok: true,
      value: ['SimpleHttp', 'qBittorrent'],
    })
    const submitting = harness.controller.submit(
      [candidate(1), candidate(2), candidate(3)],
      '/downloads',
      'SimpleHttp',
    )
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    expect(maximum).toBe(2)
    resolvers.shift()!()
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers.splice(0).forEach(resolve => resolve())
    await expect(submitting).resolves.toMatchObject({
      ok: true,
      value: { status: 'completed', inFlight: 0 },
    })
    expect(harness.connector.addResource).toHaveBeenCalledTimes(3)
  })

  it('rejects unreviewed tools, changed destinations and local-use candidates', async () => {
    const harness = createHarness()
    await connect(harness)
    await harness.controller.discoverTools('/downloads')
    await expect(harness.controller.submit([candidate(1)], '/other', 'SimpleHttp')).resolves.toMatchObject({
      ok: false,
      reason: 'operation-not-allowed',
    })
    await expect(harness.controller.submit([candidate(1)], '/downloads', 'caller-tool')).resolves.toMatchObject({
      ok: false,
      reason: 'operation-not-allowed',
    })
    const local = normalizeResourceCandidate({ url: 'http://127.1/admin', source: 'manual' })
    if (!local.ok)
      throw new Error(local.code)
    await expect(harness.controller.submit([local.value], '/downloads', 'SimpleHttp')).resolves.toEqual({
      ok: false,
      reason: 'local-use-blocked',
    })
    expect(harness.connector.addResource).not.toHaveBeenCalled()
  })

  it('invalidates writes on disable and clears only its secret and grant', async () => {
    let resolveWrite: (() => void) | undefined
    const harness = createHarness({
      addResource: vi.fn(async () => {
        await new Promise<void>(resolve => resolveWrite = resolve)
        return 'late-task'
      }),
    })
    await connect(harness)
    await harness.controller.discoverTools('/downloads')
    const pending = harness.controller.submit([candidate(1)], '/downloads', 'SimpleHttp')
    await vi.waitFor(() => expect(resolveWrite).toBeTypeOf('function'))
    const disabled = { ...harness.getRecord(), enabled: false }
    harness.setRecord(disabled)
    const lifecycle = harness.controller.handleInstalledRecordChanged(disabled)
    resolveWrite!()
    await lifecycle
    await expect(pending).resolves.toMatchObject({ ok: true, value: { status: 'invalidated' } })
    expect(harness.storageState.unrelated).toEqual({ kept: true })
    expect(harness.getRecord().grantedCapabilities).toEqual([])
  })

  it('clears persisted authority on worker restart but never reconnects automatically', async () => {
    const harness = createHarness()
    await connect(harness)
    const callsBeforeRestart = vi.mocked(harness.connector.verify).mock.calls.length
    const restarted = new SendToOpenListController({
      registry: harness.registry,
      permissions: harness.permissions,
      store: createSendToOpenListProfileStore({
        get: async key => ({ [key]: structuredClone(harness.storageState[key]) }),
        set: async items => void Object.assign(harness.storageState, structuredClone(items)),
        remove: async (keys) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete harness.storageState[key]
        },
      }),
      connector: harness.connector,
    })
    await restarted.startup()
    await expect(restarted.status()).resolves.toMatchObject({
      phase: 'disconnected',
      profile,
      hasStoredToken: true,
    })
    expect(vi.mocked(harness.connector.verify).mock.calls).toHaveLength(callsBeforeRestart)
    expect(harness.getRecord().grantedCapabilities).toEqual([])
  })

  it('keeps a shared origin permission when another owner is active', async () => {
    const harness = createHarness()
    const controller = new SendToOpenListController({
      registry: harness.registry,
      permissions: harness.permissions,
      store: createSendToOpenListProfileStore({
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      }),
      connector: harness.connector,
      createToken: () => 'preparation-token-1234567890',
      now: () => '2026-09-03T00:00:00.000Z',
      originInUse: async () => true,
    })
    const prepared = await controller.prepare(profile)
    if (!prepared.ok)
      throw new Error(prepared.reason)
    harness.origins.add(prepared.value.originPattern)
    await controller.connect(prepared.value, 'token')
    await controller.disconnect()
    expect(harness.origins).toContain('https://openlist.example/*')
    expect(harness.permissions.remove).not.toHaveBeenCalled()
  })

  it('switches and deletes one profile without changing the peer profile or secret', async () => {
    const harness = createHarness()
    await connect(harness, 'primary-token')
    const peer = {
      ...profile,
      id: 'peer',
      label: 'Peer server',
      controllerOrigin: 'https://alist.example',
    }
    const prepared = await harness.controller.prepare(peer)
    if (!prepared.ok)
      throw new Error(prepared.reason)
    expect(harness.origins).not.toContain('https://openlist.example/*')
    harness.origins.add(prepared.value.originPattern)
    await expect(harness.controller.connect(prepared.value, 'peer-token')).resolves.toMatchObject({
      ok: true,
      value: { profile: peer },
    })
    expect(harness.storageState[SEND_TO_OPENLIST_PROFILES_STORAGE_KEY]).toMatchObject({
      activeProfileId: 'peer',
      profiles: [profile, peer],
    })
    expect(JSON.stringify(harness.storageState[`${SEND_TO_OPENLIST_SECRET_KEY_PREFIX}primary`])).toContain('primary-token')

    await harness.controller.deleteProfile()
    await expect(harness.controller.status()).resolves.toMatchObject({
      phase: 'disconnected',
      profile,
      hasStoredToken: true,
    })
    expect(harness.storageState[`${SEND_TO_OPENLIST_SECRET_KEY_PREFIX}peer`]).toBeUndefined()
    expect(JSON.stringify(harness.storageState[`${SEND_TO_OPENLIST_SECRET_KEY_PREFIX}primary`])).toContain('primary-token')
    expect(harness.storageState.unrelated).toEqual({ kept: true })
  })

  it('clears all profile secrets on disable while retaining both profile records', async () => {
    const harness = createHarness()
    await connect(harness, 'primary-token')
    const store = createSendToOpenListProfileStore({
      get: async key => ({ [key]: structuredClone(harness.storageState[key]) }),
      set: async items => void Object.assign(harness.storageState, structuredClone(items)),
      remove: async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys])
          delete harness.storageState[key]
      },
    })
    await store.saveVerified({ ...profile, id: 'peer', controllerOrigin: 'https://alist.example' }, 'peer-token', moduleRecord().installedAt)
    const disabled = { ...harness.getRecord(), enabled: false }
    harness.setRecord(disabled)
    await harness.controller.handleInstalledRecordChanged(disabled)

    expect(harness.storageState[SEND_TO_OPENLIST_PROFILES_STORAGE_KEY]).toMatchObject({ profiles: expect.any(Array) })
    expect(JSON.stringify(harness.storageState)).not.toContain('primary-token')
    expect(JSON.stringify(harness.storageState)).not.toContain('peer-token')
    expect(harness.getRecord().grantedCapabilities).toEqual([])
  })

  it('treats an installation identity change as reinstall and clears only its profiles', async () => {
    const harness = createHarness()
    await connect(harness, 'private-token')
    const reinstalled = {
      ...harness.getRecord(),
      installedAt: '2026-09-04T01:00:00.000Z',
      updatedAt: '2026-09-04T01:00:00.000Z',
    }
    harness.setRecord(reinstalled)
    await harness.controller.handleInstalledRecordChanged(reinstalled)

    await expect(harness.controller.status()).resolves.toMatchObject({
      phase: 'disconnected',
      profile: null,
      hasStoredToken: false,
    })
    expect(harness.storageState[SEND_TO_OPENLIST_PROFILES_STORAGE_KEY]).toBeUndefined()
    expect(harness.storageState.unrelated).toEqual({ kept: true })
    expect(harness.getRecord().grantedCapabilities).toEqual([])
  })

  it('lists tasks explicitly and cancels only a fresh reviewed undone task once', async () => {
    const task = {
      id: 'task-1',
      name: '<img data-xss src=x>',
      state: 1,
      status: 'running',
      progress: 5,
      totalBytes: 100,
      error: '',
    }
    const harness = createHarness({ listTasks: vi.fn(async () => [task]) })
    await connect(harness)
    const listed = await harness.controller.listTasks('undone')
    expect(listed).toMatchObject({
      ok: true,
      value: { list: 'undone', tasks: [task] },
    })
    const prepared = await harness.controller.prepareCancel('task-1')
    if (!prepared.ok)
      throw new Error(prepared.reason)
    await expect(harness.controller.confirmCancel(prepared.value.token)).resolves.toEqual({
      ok: true,
      value: { taskId: 'task-1' },
    })
    expect(harness.connector.cancelTask).toHaveBeenCalledTimes(1)
    await expect(harness.controller.confirmCancel(prepared.value.token)).resolves.toEqual({
      ok: false,
      reason: 'operation-not-allowed',
    })
    expect(harness.connector.cancelTask).toHaveBeenCalledTimes(1)
  })

  it('rejects substituted or stale cancellation without issuing a write', async () => {
    const task = { id: 'task-1', name: '', state: 1, status: '', progress: 0, totalBytes: 0, error: '' }
    const tasks = [task]
    const harness = createHarness({ listTasks: vi.fn(async () => structuredClone(tasks)) })
    await connect(harness)
    await harness.controller.listTasks('undone')
    await expect(harness.controller.prepareCancel('other-task')).resolves.toEqual({
      ok: false,
      reason: 'operation-not-allowed',
    })
    const prepared = await harness.controller.prepareCancel('task-1')
    if (!prepared.ok)
      throw new Error(prepared.reason)
    harness.setTime('2026-09-03T00:03:00.000Z')
    await expect(harness.controller.confirmCancel(prepared.value.token)).resolves.toEqual({
      ok: false,
      reason: 'lifecycle-invalidated',
    })
    expect(harness.connector.cancelTask).not.toHaveBeenCalled()
  })
})
