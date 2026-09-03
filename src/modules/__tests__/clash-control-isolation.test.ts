import type { RemoteFrameModuleManifest } from '../types'
import { createBookmarkDoctorSeed } from '../builtin/bookmark-doctor'
import {
  CLASH_CONTROL_CAPABILITY,
  CLASH_CONTROL_MODULE_ID,
  ClashControlController,
  createClashControlSeed,
} from '../builtin/clash-control'
import { ModuleManager } from '../manager'
import { getModuleLocalStateStorageKey } from '../module-state'
import { createRepoLensSeed } from '../seeds/repolens'
import {
  createConformanceModulePair,
  snapshotModule,
} from './fixtures/conformance-module-pair'

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('clash Control module isolation', () => {
  it('keeps RepoLens, Bookmark Doctor and two remote modules unchanged across success and failure', async () => {
    const clashSeed = createClashControlSeed()
    clashSeed.enabled = true
    const bookmarkSeed = createBookmarkDoctorSeed()
    bookmarkSeed.enabled = true
    bookmarkSeed.grantedCapabilities = ['bookmarks.read']
    const repoLensSeed = createRepoLensSeed('https://repolens.example')
    const harness = createConformanceModulePair([repoLensSeed, bookmarkSeed, clashSeed])
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)

    const alphaCandidate = {
      ...harness.primary.manifest,
      version: '0.2.0',
      description: 'Pending safe candidate retained during Clash operations',
    }
    const betaCandidate: RemoteFrameModuleManifest = {
      ...harness.secondary.manifest,
      version: '0.2.0',
      matches: [...harness.secondary.manifest.matches, 'https://news.example.com/*'],
      contexts: [...harness.secondary.manifest.contexts, 'page.selection'],
      context_fields: {
        ...harness.secondary.manifest.context_fields,
        'page.selection': ['text'],
      },
      capabilities: [...harness.secondary.manifest.capabilities, 'clipboard.write'],
      activation: 'suggest',
    }
    harness.primary.setManifest(alphaCandidate)
    harness.secondary.setManifest(betaCandidate)
    const [alphaChecked, betaChecked] = await Promise.all([
      harness.manager.checkUpdate(alpha.manifest.id),
      harness.manager.checkUpdate(beta.manifest.id),
    ])
    expect(alphaChecked).toMatchObject({
      ok: true,
      record: { update: { approvalStatus: 'not-required' } },
    })
    expect(betaChecked).toMatchObject({
      ok: true,
      record: { update: { approvalStatus: 'pending' } },
    })
    if (betaChecked.operation !== 'update-check' || !betaChecked.ok || !betaChecked.record.update)
      throw new Error('Expected beta update candidate')
    await expect(harness.manager.approveUpdate(
      beta.manifest.id,
      betaChecked.record.update.normalizedManifestDigest,
      {
        approvedContextFields: { 'page.selection': ['text'] },
        approvedCapabilities: ['clipboard.write'],
      },
    )).resolves.toMatchObject({
      ok: true,
      record: {
        update: {
          approvalStatus: 'approved',
          approvalSnapshot: {
            approvedManifestDigest: betaChecked.record.update.normalizedManifestDigest,
            approvedContextFields: { 'page.selection': ['text'] },
            approvedCapabilities: ['clipboard.write'],
          },
        },
      },
    })

    const moduleStateKeys = [
      repoLensSeed.manifest.id,
      alpha.manifest.id,
      beta.manifest.id,
      bookmarkSeed.manifest.id,
      clashSeed.manifest.id,
    ].map(getModuleLocalStateStorageKey)
    const bookmarkStateKey = getModuleLocalStateStorageKey(bookmarkSeed.manifest.id)
    await harness.storage.set(Object.fromEntries(moduleStateKeys.map((key, index) => [
      key,
      key === bookmarkStateKey
        ? {
            schemaVersion: 2,
            lastResult: null,
            ignoredBookmarks: [{
              bookmarkId: 'private-bookmark',
              title: 'Private bookmark',
              url: 'https://private.example/',
              ignoredAt: '2026-08-28T08:30:00.000Z',
            }],
            deletionBackups: [],
          }
        : { owner: index, privateValue: `module-state-${index}` },
    ])))
    const stateBefore = Object.fromEntries(moduleStateKeys.map(key => [
      key,
      structuredClone(harness.storage.state[key]),
    ]))
    const untouchedIds = [
      repoLensSeed.manifest.id,
      bookmarkSeed.manifest.id,
      alpha.manifest.id,
      beta.manifest.id,
    ]
    const before = new Map(await Promise.all(untouchedIds.map(async id => [
      id,
      snapshotModule(await harness.registry.get(id)),
    ] as const)))
    expect(await harness.permissions.contains({ origins: [harness.primary.originPattern] })).toBe(true)
    expect(await harness.permissions.contains({ origins: [harness.secondary.originPattern] })).toBe(true)

    const originPattern = 'http://127.0.0.1:19090/*'
    let selectedNode = 'Node A'
    let switchWrites = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        switchWrites += 1
        selectedNode = (JSON.parse(String(init.body)) as { name: string }).name
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/version'))
        return jsonResponse({ meta: true, version: '1.19.0' })
      if (url.endsWith('/configs'))
        return jsonResponse({ mode: 'rule' })
      return jsonResponse({
        proxies: {
          'GLOBAL': { type: 'Selector', now: selectedNode, all: ['Node A', 'Node B'] },
          'Node A': { type: 'Vmess', alive: true },
          'Node B': { type: 'Shadowsocks', alive: false },
        },
      })
    })
    const controller = new ClashControlController({
      registry: harness.registry,
      permissions: harness.permissions,
      fetch: fetcher,
      createToken: () => 'isolation-preparation',
      now: () => '2026-08-28T12:00:00.000Z',
    })
    await expect(controller.prepare('https://alpha.modules.example')).resolves.toEqual({
      ok: false,
      reason: 'controller-not-loopback',
    })
    expect(fetcher).not.toHaveBeenCalled()
    const prepared = await controller.prepare('http://127.0.0.1:19090')
    if (!prepared.ok)
      throw new Error('Expected Clash preparation')
    harness.permissions.granted.add(originPattern)
    await expect(controller.connect(prepared.preparation, 'isolated-secret')).resolves.toMatchObject({
      ok: true,
      record: { manifest: { id: CLASH_CONTROL_MODULE_ID }, grantedCapabilities: [CLASH_CONTROL_CAPABILITY] },
    })
    await expect(controller.refresh()).resolves.toMatchObject({
      ok: true,
      snapshot: {
        proxyGroups: [{ name: 'GLOBAL', selectedNode: 'Node A' }],
      },
    })
    const switchPlan = await controller.prepareProxySwitch('GLOBAL', 'Node B')
    if (!switchPlan.ok)
      throw new Error('Expected isolated switch plan')
    await expect(controller.confirmProxySwitch(switchPlan.plan.token)).resolves.toMatchObject({
      ok: true,
      groupName: 'GLOBAL',
      selectedNode: 'Node B',
    })
    expect(switchWrites).toBe(1)

    await expect(controller.refresh()).resolves.toMatchObject({
      ok: true,
      snapshot: { proxyGroups: [{ name: 'GLOBAL', selectedNode: 'Node B' }] },
    })
    const stalePlan = await controller.prepareProxySwitch('GLOBAL', 'Node A')
    if (!stalePlan.ok)
      throw new Error('Expected stale isolated switch plan')
    selectedNode = 'Node A'
    await expect(controller.confirmProxySwitch(stalePlan.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-stale',
    })
    expect(switchWrites).toBe(1)
    expect(JSON.stringify(await controller.readStatus())).not.toContain('isolated-secret')
    await expect(controller.disconnect()).resolves.toMatchObject({ ok: true, releasedOrigin: true })

    const rejectedController = new ClashControlController({
      registry: harness.registry,
      permissions: harness.permissions,
      fetch: vi.fn(async () => new Response(null, { status: 403 })),
      createToken: () => 'rejected-preparation',
      now: () => '2026-08-28T12:01:00.000Z',
    })
    const rejectedPreparation = await rejectedController.prepare('http://127.0.0.1:19090')
    if (!rejectedPreparation.ok)
      throw new Error('Expected rejected Clash preparation')
    harness.permissions.granted.add(originPattern)
    await expect(rejectedController.connect(rejectedPreparation.preparation, 'wrong-secret')).resolves.toEqual({
      ok: false,
      reason: 'authentication-failed',
    })

    for (const id of untouchedIds)
      expect(await harness.registry.get(id)).toEqual(before.get(id))
    for (const [key, value] of Object.entries(stateBefore))
      expect(harness.storage.state[key]).toEqual(value)
    expect(JSON.stringify(harness.storage.state)).not.toContain('isolated-secret')
    expect(JSON.stringify(harness.storage.state)).not.toContain('wrong-secret')
    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).origin).every(
      origin => origin === 'http://127.0.0.1:19090',
    )).toBe(true)
    expect(fetcher.mock.calls.map(([input]) => String(input)).join('\n')).not.toContain('isolated-secret')
    expect(fetcher.mock.calls.map(([input]) => String(input)).join('\n')).not.toContain('wrong-secret')
    expect(await harness.permissions.contains({ origins: [harness.primary.originPattern] })).toBe(true)
    expect(await harness.permissions.contains({ origins: [harness.secondary.originPattern] })).toBe(true)
    expect(await harness.permissions.contains({ origins: [originPattern] })).toBe(false)
    expect(harness.permissions.remove.mock.calls.every(([request]) => (
      request.origins.every(origin => origin === originPattern)
    ))).toBe(true)
    expect(await harness.registry.get(CLASH_CONTROL_MODULE_ID)).toMatchObject({
      grantedCapabilities: [],
      update: null,
    })
  })

  it('cancels a blocked switch on disable without changing another principal', async () => {
    const clashSeed = createClashControlSeed()
    clashSeed.enabled = true
    const bookmarkSeed = createBookmarkDoctorSeed()
    bookmarkSeed.enabled = true
    bookmarkSeed.grantedCapabilities = ['bookmarks.read', 'bookmarks.write']
    const repoLensSeed = createRepoLensSeed('https://repolens.example')
    const harness = createConformanceModulePair([repoLensSeed, bookmarkSeed, clashSeed])
    const alpha = await harness.install(harness.primary)
    const beta = await harness.install(harness.secondary)
    harness.primary.setManifest({ ...harness.primary.manifest, version: '0.2.0' })
    harness.secondary.setManifest({ ...harness.secondary.manifest, version: '0.2.0' })
    await Promise.all([
      harness.manager.checkUpdate(alpha.manifest.id),
      harness.manager.checkUpdate(beta.manifest.id),
    ])

    const untouchedIds = [
      repoLensSeed.manifest.id,
      bookmarkSeed.manifest.id,
      alpha.manifest.id,
      beta.manifest.id,
    ]
    const before = new Map(await Promise.all(untouchedIds.map(async id => [
      id,
      snapshotModule(await harness.registry.get(id)),
    ] as const)))
    const stateKeys = [...untouchedIds, CLASH_CONTROL_MODULE_ID].map(getModuleLocalStateStorageKey)
    await harness.storage.set(Object.fromEntries(stateKeys.map((key, index) => [
      key,
      { sentinel: `principal-${index}` },
    ])))
    const stateBefore = Object.fromEntries(stateKeys.map(key => [
      key,
      structuredClone(harness.storage.state[key]),
    ]))

    let proxyReads = 0
    let switchWrites = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (init?.method === 'PUT') {
        switchWrites += 1
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.endsWith('/version'))
        return Promise.resolve(jsonResponse({ meta: true, version: '1.19.0' }))
      if (url.endsWith('/configs'))
        return Promise.resolve(jsonResponse({ mode: 'rule' }))
      proxyReads += 1
      if (proxyReads === 1) {
        return Promise.resolve(jsonResponse({
          proxies: {
            'GLOBAL': { type: 'Selector', now: 'Node A', all: ['Node A', 'Node B'] },
            'Node A': { type: 'Vmess', alive: true },
            'Node B': { type: 'Shadowsocks', alive: true },
          },
        }))
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    })
    const originPattern = 'http://127.0.0.1:19091/*'
    const controller = new ClashControlController({
      registry: harness.registry,
      permissions: harness.permissions,
      fetch: fetcher,
      createToken: () => 'disable-isolation-plan',
      now: () => '2026-08-28T12:00:00.000Z',
    })
    const prepared = await controller.prepare('http://127.0.0.1:19091')
    if (!prepared.ok)
      throw new Error('Expected cancellable Clash preparation')
    harness.permissions.granted.add(originPattern)
    await expect(controller.connect(prepared.preparation, 'disable-secret')).resolves.toMatchObject({ ok: true })
    await expect(controller.refresh()).resolves.toMatchObject({ ok: true })
    const plan = await controller.prepareProxySwitch('GLOBAL', 'Node B')
    if (!plan.ok)
      throw new Error('Expected cancellable Clash switch plan')
    const confirmation = controller.confirmProxySwitch(plan.plan.token)
    await vi.waitFor(() => expect(proxyReads).toBe(2))

    const manager = new ModuleManager(harness.registry, harness.installer, {
      onInstalledRecordChanged: record => controller.handleInstalledRecordChanged(record),
    })
    await expect(manager.setEnabled(CLASH_CONTROL_MODULE_ID, false)).resolves.toMatchObject({
      ok: true,
      record: { enabled: false, grantedCapabilities: [] },
    })
    await expect(confirmation).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    expect(switchWrites).toBe(0)
    expect(await harness.permissions.contains({ origins: [originPattern] })).toBe(false)
    expect(await harness.permissions.contains({ origins: [harness.primary.originPattern] })).toBe(true)
    expect(await harness.permissions.contains({ origins: [harness.secondary.originPattern] })).toBe(true)
    for (const id of untouchedIds)
      expect(await harness.registry.get(id)).toEqual(before.get(id))
    for (const [key, value] of Object.entries(stateBefore))
      expect(harness.storage.state[key]).toEqual(value)
    expect(JSON.stringify(harness.storage.state)).not.toContain('disable-secret')
  })
})
