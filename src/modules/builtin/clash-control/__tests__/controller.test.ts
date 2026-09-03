import type { InstalledModuleRecord, ModuleCapabilityId } from '../../../types'
import type { ClashControllerProfileStore } from '../profile'
import { createRepoLensSeed } from '../../../seeds/repolens'
import {
  CLASH_CONTROL_CAPABILITY,
  CLASH_CONTROL_MODULE_ID,
  CLASH_CONTROL_RESPONSE_LIMIT_BYTES,
} from '../contracts'
import { ClashControlController } from '../controller'
import { createClashControlSeed } from '../manifest'

function clashRecord(enabled = true, granted = false): InstalledModuleRecord {
  const seed = createClashControlSeed()
  return {
    manifest: seed.manifest,
    enabled,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: granted ? [CLASH_CONTROL_CAPABILITY] : [],
    update: null,
    installedAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  }
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function proxyResponse(
  selectedNode = 'Node A',
  groupName = 'GLOBAL',
  nodeNames = ['Node A', 'Node B'],
) {
  return jsonResponse({
    proxies: {
      [groupName]: { type: 'Selector', now: selectedNode, all: nodeNames },
      'Node A': { type: 'Vmess', alive: true },
      'Node B': { type: 'Shadowsocks', alive: false },
      'Node C': { type: 'Trojan', alive: true },
    },
  })
}

function createSwitchFixture(groupName = 'GLOBAL / ? # % 你好') {
  let selectedNode = 'Node A'
  const writes: Array<{ url: string, init: RequestInit | undefined }> = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') {
      writes.push({ url, init })
      const body = JSON.parse(String(init.body)) as { name: string }
      selectedNode = body.name
      return new Response(null, { status: 204 })
    }
    if (url.endsWith('/version'))
      return jsonResponse({ meta: true, version: '1.19.0' })
    if (url.endsWith('/configs'))
      return jsonResponse({ mode: 'rule' })
    return proxyResponse(selectedNode, groupName, ['Node A', 'Node B', 'Node C'])
  })
  return {
    fetcher,
    groupName,
    writes,
    selectedNode: () => selectedNode,
    setSelectedNode: (value: string) => selectedNode = value,
  }
}

function remoteRecord(origin: string): InstalledModuleRecord {
  const seed = createRepoLensSeed(origin)
  if (seed.manifest.runtime !== 'remote-frame')
    throw new Error('Expected remote-frame seed')
  return {
    manifest: {
      ...seed.manifest,
      id: 'dev.oneweb.fixture.shared-origin',
      name: 'Shared origin fixture',
    },
    enabled: true,
    source: 'user',
    sourceUrl: `${origin}/.well-known/oneweb-module.json`,
    grantedContexts: seed.grantedContexts,
    grantedContextFields: seed.grantedContextFields,
    grantedCapabilities: seed.grantedCapabilities,
    update: null,
    installedAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  }
}

function createHarness(
  fetcher?: typeof globalThis.fetch,
  originInUse?: (_originPattern: string) => boolean | Promise<boolean>,
  profileStore?: ClashControllerProfileStore,
) {
  let record = clashRecord()
  let extraRecords: InstalledModuleRecord[] = []
  let currentTime = '2026-08-28T00:00:00.000Z'
  let tokenSequence = 0
  const grantedOrigins = new Set<string>()
  const registry = {
    get: vi.fn(async () => structuredClone(record)),
    list: vi.fn(async () => structuredClone([record, ...extraRecords])),
    setCapabilityGrant: vi.fn(async (
      moduleId: string,
      capability: ModuleCapabilityId,
      granted: boolean,
    ) => {
      if (moduleId !== CLASH_CONTROL_MODULE_ID || capability !== CLASH_CONTROL_CAPABILITY) {
        return { ok: false as const, changed: false as const, reason: 'not-found' as const }
      }
      const nextCapabilities = granted
        ? [...new Set([...record.grantedCapabilities, capability])]
        : record.grantedCapabilities.filter(value => value !== capability)
      const changed = nextCapabilities.length !== record.grantedCapabilities.length
      record = { ...record, grantedCapabilities: nextCapabilities }
      return { ok: true as const, changed, record: structuredClone(record) }
    }),
  }
  const permissions = {
    contains: vi.fn(async ({ origins }: { origins: string[] }) => (
      origins.every(origin => grantedOrigins.has(origin))
    )),
    remove: vi.fn(async ({ origins }: { origins: string[] }) => {
      const changed = origins.some(origin => grantedOrigins.has(origin))
      origins.forEach(origin => grantedOrigins.delete(origin))
      return changed
    }),
  }
  const defaultFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT')
      return new Response(null, { status: 204 })
    if (url.endsWith('/version'))
      return jsonResponse({ meta: true, version: '1.19.0' })
    if (url.endsWith('/configs'))
      return jsonResponse({ mode: 'rule' })
    if (url.endsWith('/proxies')) {
      return jsonResponse({
        proxies: {
          GLOBAL: { type: 'Selector', now: 'DIRECT', all: ['DIRECT'] },
          DIRECT: { type: 'Direct', alive: true },
        },
      })
    }
    return new Response(null, { status: 404 })
  })
  const controller = new ClashControlController({
    registry,
    permissions,
    fetch: fetcher || defaultFetch,
    createToken: () => `controller-token-${++tokenSequence}`,
    now: () => currentTime,
    timeoutMs: 250,
    originInUse,
    profileStore,
  })

  return {
    controller,
    defaultFetch,
    grantedOrigins,
    permissions,
    registry,
    getRecord: () => structuredClone(record),
    setExtraRecords: (records: InstalledModuleRecord[]) => extraRecords = structuredClone(records),
    setRecord: (value: InstalledModuleRecord) => record = structuredClone(value),
    setTime: (value: string) => currentTime = value,
  }
}

async function prepareAndPermit(
  harness: ReturnType<typeof createHarness>,
  controllerUrl = 'http://127.0.0.1:9090',
) {
  const result = await harness.controller.prepare(controllerUrl)
  if (!result.ok)
    throw new Error(`Expected preparation, received ${result.reason}`)
  harness.grantedOrigins.add(result.preparation.originPattern)
  return result.preparation
}

async function connectAndRefresh(
  harness: ReturnType<typeof createHarness>,
  secret = 'switch-session-secret',
) {
  const preparation = await prepareAndPermit(harness)
  const connected = await harness.controller.connect(preparation, secret)
  if (!connected.ok)
    throw new Error(`Expected connection, received ${connected.reason}`)
  const refreshed = await harness.controller.refresh()
  if (!refreshed.ok)
    throw new Error(`Expected refresh, received ${refreshed.reason}`)
  return { preparation, snapshot: refreshed.snapshot }
}

describe('clash Control trusted background connector', () => {
  it('uses only fixed read endpoints, an exact Bearer header and a sanitized result', async () => {
    const secret = 'phase4a-secret-never-returned'
    const fetcher = vi.fn(async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      expect(this).toBe(globalThis)
      const url = String(input)
      expect(init).toMatchObject({
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
      })
      expect(init?.headers).toEqual({
        accept: 'application/json',
        authorization: `Bearer ${secret}`,
      })
      if (url.endsWith('/version'))
        return jsonResponse({ meta: true, version: '1.19.0' })
      if (url.endsWith('/configs'))
        return jsonResponse({ mode: 'rule' })
      return new Response(null, { status: 404 })
    })
    const harness = createHarness(fetcher)
    const preparation = await prepareAndPermit(harness)
    const result = await harness.controller.connect(preparation, secret)

    expect(result).toMatchObject({
      ok: true,
      status: {
        controllerOrigin: 'http://127.0.0.1:9090',
        implementation: 'Clash.Meta',
        version: '1.19.0',
        mode: 'rule',
      },
      record: { grantedCapabilities: [CLASH_CONTROL_CAPABILITY] },
    })
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      'http://127.0.0.1:9090/version',
      'http://127.0.0.1:9090/configs',
    ])
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(await harness.controller.status())).not.toContain(secret)
    expect(JSON.stringify(harness.getRecord())).not.toContain(secret)
  })

  it.each([
    ['authentication-failed', async () => new Response(null, { status: 401 })],
    ['network-failure', async () => Promise.reject(new Error('connection refused'))],
    ['response-malformed', async () => new Response('not-json', { status: 200 })],
    ['protocol-incompatible', async () => new Response(null, { status: 302, headers: { location: '/login' } })],
    ['response-too-large', async () => new Response('x', {
      status: 200,
      headers: { 'content-length': String(CLASH_CONTROL_RESPONSE_LIMIT_BYTES + 1) },
    })],
  ] as const)('classifies a failed controller response as %s', async (reason, responseFactory) => {
    const harness = createHarness(vi.fn(responseFactory) as typeof globalThis.fetch)
    const preparation = await prepareAndPermit(harness)
    await expect(harness.controller.connect(preparation, 'phase4a-secret')).resolves.toEqual({
      ok: false,
      reason,
    })
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: 'error' })
    expect(harness.getRecord().grantedCapabilities).toEqual([])
    expect(harness.grantedOrigins).toEqual(new Set())
  })

  it('rejects secret reflection from an untrusted localhost process', async () => {
    const secret = 'phase4a-reflected-secret'
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/version')
        ? jsonResponse({ version: secret })
        : jsonResponse({ mode: 'rule' })
    ))
    const harness = createHarness(fetcher)
    const preparation = await prepareAndPermit(harness)
    const result = await harness.controller.connect(preparation, secret)
    expect(result).toEqual({ ok: false, reason: 'response-malformed' })
    expect(JSON.stringify(result)).not.toContain(secret)
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: 'error' })
  })

  it('manually refreshes exactly three allowlisted endpoints into a generation-bound memory snapshot', async () => {
    const secret = 'phase4c-session-secret'
    const harness = createHarness()
    const preparation = await prepareAndPermit(harness)
    await expect(harness.controller.connect(preparation, secret)).resolves.toMatchObject({ ok: true })
    harness.setTime('2026-08-28T00:01:00.000Z')

    await expect(harness.controller.refresh()).resolves.toEqual({
      ok: true,
      snapshot: {
        version: 1,
        controllerOrigin: preparation.controllerOrigin,
        generation: preparation.generation,
        refreshedAt: '2026-08-28T00:01:00.000Z',
        implementation: 'Clash.Meta',
        controllerVersion: '1.19.0',
        mode: 'rule',
        proxyGroups: [{
          name: 'GLOBAL',
          type: 'Selector',
          selectedNode: 'DIRECT',
          nodes: [{ name: 'DIRECT', type: 'Direct', alive: true }],
        }],
      },
    })
    expect(harness.defaultFetch.mock.calls.map(([input]) => String(input))).toEqual([
      'http://127.0.0.1:9090/version',
      'http://127.0.0.1:9090/configs',
      'http://127.0.0.1:9090/version',
      'http://127.0.0.1:9090/configs',
      'http://127.0.0.1:9090/proxies',
    ])
    const readState = await harness.controller.readStatus()
    expect(readState).toMatchObject({ status: 'ready', snapshot: { generation: preparation.generation } })
    expect(JSON.stringify(readState)).not.toContain(secret)
    expect(JSON.stringify(harness.getRecord())).not.toContain(secret)
  })

  it('switches one reviewed group through an encoded fixed path and exact body, then invalidates the snapshot', async () => {
    const secret = 'phase4d-switch-secret'
    const fixture = createSwitchFixture()
    const harness = createHarness(fixture.fetcher)
    await connectAndRefresh(harness, secret)
    const prepared = await harness.controller.prepareProxySwitch(fixture.groupName, 'Node B')
    expect(prepared).toMatchObject({
      ok: true,
      plan: {
        controllerOrigin: 'http://127.0.0.1:9090',
        groupName: fixture.groupName,
        originalNode: 'Node A',
        targetNode: 'Node B',
      },
    })
    if (!prepared.ok)
      throw new Error('Expected proxy-switch plan')
    expect(JSON.stringify(prepared)).not.toContain(secret)
    expect(prepared.plan).not.toHaveProperty('snapshotBinding')

    await expect(harness.controller.confirmProxySwitch(prepared.plan.token)).resolves.toEqual({
      ok: true,
      groupName: fixture.groupName,
      previousNode: 'Node A',
      selectedNode: 'Node B',
    })
    expect(fixture.selectedNode()).toBe('Node B')
    expect(fixture.writes).toHaveLength(1)
    expect(fixture.writes[0]!.url).toBe(
      'http://127.0.0.1:9090/proxies/GLOBAL%20%2F%20%3F%20%23%20%25%20%E4%BD%A0%E5%A5%BD',
    )
    expect(fixture.writes[0]!.init).toMatchObject({
      method: 'PUT',
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Node B' }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
    })
    expect(Object.keys(JSON.parse(String(fixture.writes[0]!.init?.body)))).toEqual(['name'])
    await expect(harness.controller.readStatus()).resolves.toEqual({
      status: 'empty',
      snapshot: null,
      diagnostic: null,
    })
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: 'connected' })
    await expect(harness.controller.confirmProxySwitch(prepared.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })
    expect(JSON.stringify(harness.getRecord())).not.toContain(secret)
  })

  it('rejects snapshot-external groups, nodes and no-op selections without a write', async () => {
    const fixture = createSwitchFixture()
    const harness = createHarness(fixture.fetcher)
    await connectAndRefresh(harness)
    await expect(harness.controller.prepareProxySwitch('Outside', 'Node B')).resolves.toEqual({
      ok: false,
      reason: 'switch-target-invalid',
    })
    await expect(harness.controller.prepareProxySwitch(fixture.groupName, 'Outside')).resolves.toEqual({
      ok: false,
      reason: 'switch-target-invalid',
    })
    await expect(harness.controller.prepareProxySwitch(fixture.groupName, 'Node A')).resolves.toEqual({
      ok: false,
      reason: 'switch-no-change',
    })
    expect(fixture.writes).toEqual([])
  })

  it('consumes expired, replaced and mismatched plans exactly once', async () => {
    const fixture = createSwitchFixture()
    const harness = createHarness(fixture.fetcher)
    await connectAndRefresh(harness)
    const expiring = await harness.controller.prepareProxySwitch(fixture.groupName, 'Node B')
    if (!expiring.ok)
      throw new Error('Expected expiring plan')
    harness.setTime(expiring.plan.expiresAt)
    await expect(harness.controller.confirmProxySwitch(expiring.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-expired',
    })
    await expect(harness.controller.confirmProxySwitch(expiring.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })

    const replacementHarness = createHarness(fixture.fetcher)
    await connectAndRefresh(replacementHarness)
    const first = await replacementHarness.controller.prepareProxySwitch(fixture.groupName, 'Node B')
    const second = await replacementHarness.controller.prepareProxySwitch(fixture.groupName, 'Node C')
    if (!first.ok || !second.ok)
      throw new Error('Expected replacement plans')
    expect(second.plan.token).not.toBe(first.plan.token)
    await expect(replacementHarness.controller.confirmProxySwitch(first.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })
    await expect(replacementHarness.controller.confirmProxySwitch(second.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })
    expect(fixture.writes).toEqual([])
  })

  it('rejects application-time proxy replacement before issuing the write', async () => {
    const fixture = createSwitchFixture()
    const harness = createHarness(fixture.fetcher)
    await connectAndRefresh(harness)
    const prepared = await harness.controller.prepareProxySwitch(fixture.groupName, 'Node B')
    if (!prepared.ok)
      throw new Error('Expected proxy-switch plan')
    fixture.setSelectedNode('Node C')
    await expect(harness.controller.confirmProxySwitch(prepared.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-stale',
    })
    expect(fixture.writes).toEqual([])
    await expect(harness.controller.readStatus()).resolves.toEqual({
      status: 'empty',
      snapshot: null,
      diagnostic: null,
    })
  })

  it('allows only one confirmation and refuses plan replacement while its preflight is active', async () => {
    let proxyReads = 0
    let releasePreflight: (() => void) | undefined
    const fixture = createSwitchFixture()
    fixture.fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        fixture.writes.push({ url, init })
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/version'))
        return jsonResponse({ meta: true, version: '1.19.0' })
      if (url.endsWith('/configs'))
        return jsonResponse({ mode: 'rule' })
      proxyReads += 1
      if (proxyReads === 2)
        await new Promise<void>(resolve => releasePreflight = resolve)
      return proxyResponse('Node A', fixture.groupName, ['Node A', 'Node B', 'Node C'])
    })
    const harness = createHarness(fixture.fetcher)
    await connectAndRefresh(harness)
    const prepared = await harness.controller.prepareProxySwitch(fixture.groupName, 'Node B')
    if (!prepared.ok)
      throw new Error('Expected proxy-switch plan')
    const first = harness.controller.confirmProxySwitch(prepared.plan.token)
    await vi.waitFor(() => expect(proxyReads).toBe(2))
    await expect(harness.controller.confirmProxySwitch(prepared.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })
    await expect(harness.controller.prepareProxySwitch(fixture.groupName, 'Node C')).resolves.toEqual({
      ok: false,
      reason: 'operation-active',
    })
    releasePreflight?.()
    await expect(first).resolves.toMatchObject({ ok: true, selectedNode: 'Node B' })
    expect(fixture.writes).toHaveLength(1)
  })

  it('clears pending switch authority on disconnect, disable and exact-origin removal', async () => {
    const disconnectedFixture = createSwitchFixture()
    const disconnected = createHarness(disconnectedFixture.fetcher)
    await connectAndRefresh(disconnected)
    const disconnectPlan = await disconnected.controller.prepareProxySwitch(disconnectedFixture.groupName, 'Node B')
    if (!disconnectPlan.ok)
      throw new Error('Expected disconnect plan')
    await disconnected.controller.disconnect()
    await expect(disconnected.controller.confirmProxySwitch(disconnectPlan.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })

    const disabledFixture = createSwitchFixture()
    const disabled = createHarness(disabledFixture.fetcher)
    await connectAndRefresh(disabled)
    const disablePlan = await disabled.controller.prepareProxySwitch(disabledFixture.groupName, 'Node B')
    if (!disablePlan.ok)
      throw new Error('Expected disable plan')
    disabled.setRecord(clashRecord(false))
    await disabled.controller.handleInstalledRecordChanged(clashRecord(false))
    await expect(disabled.controller.confirmProxySwitch(disablePlan.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })

    const removedFixture = createSwitchFixture()
    const removed = createHarness(removedFixture.fetcher)
    const { preparation } = await connectAndRefresh(removed)
    const removedPlan = await removed.controller.prepareProxySwitch(removedFixture.groupName, 'Node B')
    if (!removedPlan.ok)
      throw new Error('Expected permission-removal plan')
    removed.grantedOrigins.delete(preparation.originPattern)
    await removed.controller.handlePermissionsRemoved({ origins: [preparation.originPattern] })
    await expect(removed.controller.confirmProxySwitch(removedPlan.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })
    expect(disconnectedFixture.writes).toEqual([])
    expect(disabledFixture.writes).toEqual([])
    expect(removedFixture.writes).toEqual([])
  })

  it.each([
    ['authentication-failed', () => Promise.resolve(new Response(null, { status: 401 })), 'error'],
    ['response-malformed', () => Promise.resolve(jsonResponse({ proxies: { invalid: true } })), 'error'],
    ['response-too-large', () => Promise.resolve(new Response('x', {
      status: 200,
      headers: { 'content-length': String(CLASH_CONTROL_RESPONSE_LIMIT_BYTES + 1) },
    })), 'error'],
    ['network-failure', () => Promise.reject(new Error('preflight refused')), 'connected'],
  ] as const)('handles a %s proxy-switch preflight without retaining authority', async (
    reason,
    failedPreflight,
    expectedPhase,
  ) => {
    let proxyReads = 0
    const writes: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        writes.push(url)
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/version'))
        return jsonResponse({ meta: true, version: '1.19.0' })
      if (url.endsWith('/configs'))
        return jsonResponse({ mode: 'rule' })
      proxyReads += 1
      return proxyReads === 1
        ? proxyResponse('Node A', 'GLOBAL', ['Node A', 'Node B'])
        : failedPreflight()
    })
    const harness = createHarness(fetcher)
    await connectAndRefresh(harness)
    const prepared = await harness.controller.prepareProxySwitch('GLOBAL', 'Node B')
    if (!prepared.ok)
      throw new Error('Expected preflight-failure plan')
    await expect(harness.controller.confirmProxySwitch(prepared.plan.token)).resolves.toEqual({
      ok: false,
      reason,
    })
    await expect(harness.controller.confirmProxySwitch(prepared.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })
    await expect(harness.controller.readStatus()).resolves.toEqual({
      status: 'empty',
      snapshot: null,
      diagnostic: null,
    })
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: expectedPhase })
    expect(harness.getRecord().grantedCapabilities).toEqual(
      expectedPhase === 'connected' ? [CLASH_CONTROL_CAPABILITY] : [],
    )
    expect(writes).toEqual([])
  })

  it.each([
    ['protocol-incompatible', () => Promise.resolve(new Response(null, { status: 500 })), 'error'],
    ['unexpected-complete-200', () => Promise.resolve(new Response('{}', {
      status: 200,
      headers: { 'content-length': '2' },
    })), 'error'],
    ['response-too-large', () => Promise.resolve(new Response('x', {
      status: 200,
      headers: { 'content-length': String(CLASH_CONTROL_RESPONSE_LIMIT_BYTES + 1) },
    })), 'error'],
    ['missing-declared-length', () => Promise.resolve(new Response(null, { status: 200 })), 'connected'],
    ['truncated-response', () => Promise.resolve(new Response('{"partial":', {
      status: 200,
      headers: { 'content-length': '16' },
    })), 'connected'],
    ['network-failure', () => Promise.reject(new Error('write response lost')), 'connected'],
  ] as const)('handles a %s proxy-switch write as outcome-unknown without local partial state', async (
    _failure,
    failedWrite,
    expectedPhase,
  ) => {
    let writeCalls = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') {
        writeCalls += 1
        return failedWrite()
      }
      if (url.endsWith('/version'))
        return jsonResponse({ meta: true, version: '1.19.0' })
      if (url.endsWith('/configs'))
        return jsonResponse({ mode: 'rule' })
      return proxyResponse('Node A', 'GLOBAL', ['Node A', 'Node B'])
    })
    const harness = createHarness(fetcher)
    await connectAndRefresh(harness, 'write-failure-secret')
    const prepared = await harness.controller.prepareProxySwitch('GLOBAL', 'Node B')
    if (!prepared.ok)
      throw new Error('Expected write-failure plan')
    const result = await harness.controller.confirmProxySwitch(prepared.plan.token)
    expect(result).toEqual({ ok: false, reason: 'switch-outcome-unknown' })
    expect(JSON.stringify(result)).not.toContain('write-failure-secret')
    expect(writeCalls).toBe(1)
    await expect(harness.controller.readStatus()).resolves.toEqual({
      status: 'empty',
      snapshot: null,
      diagnostic: null,
    })
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: expectedPhase })
    expect(harness.getRecord().grantedCapabilities).toEqual(
      expectedPhase === 'connected' ? [CLASH_CONTROL_CAPABILITY] : [],
    )
  })

  it('aborts an active switch preflight on disconnect without a late write', async () => {
    let proxyReads = 0
    let writeCalls = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (init?.method === 'PUT') {
        writeCalls += 1
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.endsWith('/version'))
        return Promise.resolve(jsonResponse({ meta: true, version: '1.19.0' }))
      if (url.endsWith('/configs'))
        return Promise.resolve(jsonResponse({ mode: 'rule' }))
      proxyReads += 1
      if (proxyReads === 1)
        return Promise.resolve(proxyResponse('Node A', 'GLOBAL', ['Node A', 'Node B']))
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const harness = createHarness(fetcher)
    await connectAndRefresh(harness)
    const prepared = await harness.controller.prepareProxySwitch('GLOBAL', 'Node B')
    if (!prepared.ok)
      throw new Error('Expected cancellable plan')
    const pending = harness.controller.confirmProxySwitch(prepared.plan.token)
    await vi.waitFor(() => expect(proxyReads).toBe(2))
    await harness.controller.disconnect()
    await expect(pending).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    expect(writeCalls).toBe(0)
  })

  it('requires a live connection and keeps a prior snapshot explicitly stale after a network failure', async () => {
    let failRefresh = false
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (failRefresh)
        throw new Error('connection refused')
      if (url.endsWith('/version'))
        return jsonResponse({ meta: true, version: '1.19.0' })
      if (url.endsWith('/configs'))
        return jsonResponse({ mode: 'rule' })
      return jsonResponse({
        proxies: {
          GLOBAL: { type: 'Selector', now: 'DIRECT', all: ['DIRECT'] },
          DIRECT: { type: 'Direct', alive: true },
        },
      })
    })
    const harness = createHarness(fetcher)
    await expect(harness.controller.refresh()).resolves.toEqual({ ok: false, reason: 'connection-required' })
    const preparation = await prepareAndPermit(harness)
    await harness.controller.connect(preparation, 'secret')
    await expect(harness.controller.refresh()).resolves.toMatchObject({ ok: true })
    failRefresh = true
    harness.setTime('2026-08-28T00:02:00.000Z')
    await expect(harness.controller.refresh()).resolves.toEqual({ ok: false, reason: 'network-failure' })
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: 'connected' })
    await expect(harness.controller.readStatus()).resolves.toMatchObject({
      status: 'stale',
      snapshot: { mode: 'rule' },
      diagnostic: { code: 'network-failure', occurredAt: '2026-08-28T00:02:00.000Z' },
    })
  })

  it.each([
    ['authentication-failed', () => new Response(null, { status: 401 })],
    ['protocol-incompatible', () => new Response(null, { status: 302, headers: { location: '/login' } })],
    ['response-malformed', () => jsonResponse({ proxies: { GLOBAL: { type: 'Selector', now: 'MISSING', all: [] } } })],
    ['response-too-large', () => new Response('x', {
      status: 200,
      headers: { 'content-length': String(CLASH_CONTROL_RESPONSE_LIMIT_BYTES + 1) },
    })],
  ] as const)('invalidates the connection and snapshot after a %s refresh', async (reason, failureResponse) => {
    let failProxyRead = false
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/version'))
        return jsonResponse({ meta: true, version: '1.19.0' })
      if (url.endsWith('/configs'))
        return jsonResponse({ mode: 'rule' })
      if (failProxyRead)
        return failureResponse()
      return jsonResponse({
        proxies: {
          GLOBAL: { type: 'Selector', now: 'DIRECT', all: ['DIRECT'] },
          DIRECT: { type: 'Direct', alive: true },
        },
      })
    })
    const harness = createHarness(fetcher)
    const preparation = await prepareAndPermit(harness)
    await harness.controller.connect(preparation, 'secret')
    await harness.controller.refresh()
    failProxyRead = true

    await expect(harness.controller.refresh()).resolves.toEqual({ ok: false, reason })
    await expect(harness.controller.status()).resolves.toMatchObject({
      phase: 'error',
      diagnostic: { code: reason },
    })
    await expect(harness.controller.readStatus()).resolves.toEqual({
      status: 'empty',
      snapshot: null,
      diagnostic: null,
    })
    expect(harness.getRecord().grantedCapabilities).toEqual([])
  })

  it('lets only the newest concurrent manual refresh publish', async () => {
    let versionReads = 0
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (url.endsWith('/version')) {
        versionReads += 1
        if (versionReads === 2) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
          })
        }
        return Promise.resolve(jsonResponse({ meta: true, version: versionReads === 3 ? '1.20.0' : '1.19.0' }))
      }
      if (url.endsWith('/configs'))
        return Promise.resolve(jsonResponse({ mode: 'rule' }))
      return Promise.resolve(jsonResponse({
        proxies: {
          GLOBAL: { type: 'Selector', now: 'DIRECT', all: ['DIRECT'] },
          DIRECT: { type: 'Direct', alive: true },
        },
      }))
    })
    const harness = createHarness(fetcher)
    const preparation = await prepareAndPermit(harness)
    await harness.controller.connect(preparation, 'secret')
    const first = harness.controller.refresh()
    await vi.waitFor(() => expect(versionReads).toBe(2))
    const second = harness.controller.refresh()

    await expect(first).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    await expect(second).resolves.toMatchObject({
      ok: true,
      snapshot: { controllerVersion: '1.20.0' },
    })
    await expect(harness.controller.readStatus()).resolves.toMatchObject({
      status: 'ready',
      snapshot: { controllerVersion: '1.20.0' },
    })
  })

  it('cancels an in-flight refresh and clears its snapshot on disconnect and permission removal', async () => {
    let blockRefresh = false
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (blockRefresh && url.endsWith('/version')) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }
      if (url.endsWith('/version'))
        return Promise.resolve(jsonResponse({ meta: true, version: '1.19.0' }))
      if (url.endsWith('/configs'))
        return Promise.resolve(jsonResponse({ mode: 'rule' }))
      return Promise.resolve(jsonResponse({
        proxies: {
          GLOBAL: { type: 'Selector', now: 'DIRECT', all: ['DIRECT'] },
          DIRECT: { type: 'Direct', alive: true },
        },
      }))
    })
    const harness = createHarness(fetcher)
    const preparation = await prepareAndPermit(harness)
    await harness.controller.connect(preparation, 'secret')
    await harness.controller.refresh()
    blockRefresh = true
    const pending = harness.controller.refresh()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6))
    await harness.controller.disconnect()
    await expect(pending).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    await expect(harness.controller.readStatus()).resolves.toEqual({
      status: 'empty',
      snapshot: null,
      diagnostic: null,
    })

    const reconnect = await prepareAndPermit(harness)
    await harness.controller.connect(reconnect, 'secret')
    blockRefresh = false
    await harness.controller.refresh()
    harness.grantedOrigins.delete(reconnect.originPattern)
    await harness.controller.handlePermissionsRemoved({ origins: [reconnect.originPattern] })
    await expect(harness.controller.readStatus()).resolves.toEqual({
      status: 'empty',
      snapshot: null,
      diagnostic: null,
    })
  })

  it('requires the matching unexpired preparation and exact-origin permission', async () => {
    const harness = createHarness()
    const preparation = await harness.controller.prepare('http://localhost:9090')
    if (!preparation.ok)
      throw new Error('Expected preparation')
    await expect(harness.controller.connect({ ...preparation.preparation, token: 'wrong-token' }, 'secret')).resolves.toEqual({
      ok: false,
      reason: 'invalid-preparation',
    })
    expect(harness.defaultFetch).not.toHaveBeenCalled()

    const missing = await harness.controller.prepare('http://localhost:9090')
    if (!missing.ok)
      throw new Error('Expected preparation')
    await expect(harness.controller.connect(missing.preparation, 'secret')).resolves.toEqual({
      ok: false,
      reason: 'permission-missing',
    })

    const expired = await harness.controller.prepare('http://localhost:9090')
    if (!expired.ok)
      throw new Error('Expected preparation')
    harness.setTime(expired.preparation.expiresAt)
    await expect(harness.controller.connect(expired.preparation, 'secret')).resolves.toEqual({
      ok: false,
      reason: 'invalid-preparation',
    })
    expect(harness.defaultFetch).not.toHaveBeenCalled()
  })

  it('removes only an origin acquired for the connection', async () => {
    const harness = createHarness()
    const preparation = await prepareAndPermit(harness)
    await expect(harness.controller.connect(preparation, 'secret')).resolves.toMatchObject({ ok: true })
    await expect(harness.controller.disconnect()).resolves.toMatchObject({
      ok: true,
      changed: true,
      releasedOrigin: true,
      record: { grantedCapabilities: [] },
    })
    expect(harness.permissions.remove).toHaveBeenCalledWith({
      origins: ['http://127.0.0.1:9090/*'],
    })
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: 'disconnected' })
  })

  it('retains pre-existing and remote-module-shared origin permissions', async () => {
    const preExisting = createHarness()
    preExisting.grantedOrigins.add('http://127.0.0.1:9090/*')
    const first = await preExisting.controller.prepare('http://127.0.0.1:9090')
    if (!first.ok)
      throw new Error('Expected preparation')
    await preExisting.controller.connect(first.preparation, 'secret')
    await expect(preExisting.controller.disconnect()).resolves.toMatchObject({
      ok: true,
      releasedOrigin: false,
    })
    expect(preExisting.permissions.remove).not.toHaveBeenCalled()

    const shared = createHarness()
    const second = await prepareAndPermit(shared)
    await shared.controller.connect(second, 'secret')
    shared.setExtraRecords([remoteRecord('http://127.0.0.1:9090')])
    await expect(shared.controller.disconnect()).resolves.toMatchObject({
      ok: true,
      releasedOrigin: false,
    })
    expect(shared.permissions.remove).not.toHaveBeenCalled()
    expect(shared.grantedOrigins).toContain('http://127.0.0.1:9090/*')
  })

  it('retains an acquired origin while another builtin lifecycle is using it', async () => {
    const originInUse = vi.fn(async () => true)
    const harness = createHarness(undefined, originInUse)
    const preparation = await prepareAndPermit(harness)
    await harness.controller.connect(preparation, 'secret')
    await expect(harness.controller.disconnect()).resolves.toMatchObject({
      ok: true,
      releasedOrigin: false,
    })
    expect(originInUse).toHaveBeenCalledWith(preparation.originPattern)
    expect(harness.permissions.remove).not.toHaveBeenCalled()
    expect(harness.grantedOrigins).toContain(preparation.originPattern)
  })

  it('cancels an in-flight request immediately when disabled', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        })
      })
    ))
    const harness = createHarness(fetcher as typeof globalThis.fetch)
    const preparation = await prepareAndPermit(harness)
    const connecting = harness.controller.connect(preparation, 'secret')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    harness.setRecord(clashRecord(false))
    await harness.controller.handleInstalledRecordChanged(clashRecord(false))

    await expect(connecting).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: 'disconnected' })
    expect(harness.getRecord().grantedCapabilities).toEqual([])
  })

  it('cancels state and revokes the dedicated grant when its exact permission is removed', async () => {
    const harness = createHarness()
    const preparation = await prepareAndPermit(harness)
    await harness.controller.connect(preparation, 'secret')
    harness.grantedOrigins.delete(preparation.originPattern)
    await harness.controller.handlePermissionsRemoved({ origins: [preparation.originPattern] })

    await expect(harness.controller.status()).resolves.toMatchObject({ phase: 'disconnected' })
    expect(harness.getRecord().grantedCapabilities).toEqual([])
    expect(harness.registry.setCapabilityGrant).toHaveBeenLastCalledWith(
      CLASH_CONTROL_MODULE_ID,
      CLASH_CONTROL_CAPABILITY,
      false,
    )
  })

  it('surfaces a dedicated-grant cleanup failure after permission removal', async () => {
    const harness = createHarness()
    const preparation = await prepareAndPermit(harness)
    await harness.controller.connect(preparation, 'secret')
    harness.registry.setCapabilityGrant.mockResolvedValueOnce({
      ok: false,
      changed: false,
      reason: 'not-found',
    })
    harness.grantedOrigins.delete(preparation.originPattern)
    await harness.controller.handlePermissionsRemoved({ origins: [preparation.originPattern] })

    await expect(harness.controller.status()).resolves.toMatchObject({
      phase: 'error',
      diagnostic: { code: 'capability-sync-failed' },
    })
  })

  it('binds replacement preparations to a new generation and rejects the stale origin binding', async () => {
    const harness = createHarness()
    const first = await harness.controller.prepare('http://127.0.0.1:9090')
    const second = await harness.controller.prepare('http://127.0.0.1:9091')
    if (!first.ok || !second.ok)
      throw new Error('Expected replacement preparations')
    expect(second.preparation.generation).toBeGreaterThan(first.preparation.generation)
    harness.grantedOrigins.add(first.preparation.originPattern)
    harness.grantedOrigins.add(second.preparation.originPattern)
    await expect(harness.controller.connect(first.preparation, 'secret')).resolves.toEqual({
      ok: false,
      reason: 'invalid-preparation',
    })
    expect(harness.defaultFetch).not.toHaveBeenCalled()
  })

  it('prevents a slower concurrent preparation from replacing the newer profile and token', async () => {
    const harness = createHarness()
    let releaseFirst: ((_value: boolean) => void) | undefined
    harness.permissions.contains.mockImplementation(async ({ origins }) => {
      if (origins[0] === 'http://127.0.0.1:9090/*')
        return new Promise<boolean>(resolve => releaseFirst = resolve)
      return false
    })
    const first = harness.controller.prepare('http://127.0.0.1:9090')
    await vi.waitFor(() => expect(harness.permissions.contains).toHaveBeenCalledOnce())
    const second = await harness.controller.prepare('http://127.0.0.1:9091')
    releaseFirst?.(false)

    await expect(first).resolves.toEqual({ ok: false, reason: 'invalid-preparation' })
    expect(second).toMatchObject({
      ok: true,
      preparation: { controllerOrigin: 'http://127.0.0.1:9091' },
    })
    await expect(harness.controller.status()).resolves.toMatchObject({
      phase: 'preparing',
      profile: { controllerOrigin: 'http://127.0.0.1:9091' },
    })
  })

  it('cancels an in-flight generation through explicit disconnect without a late grant', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        })
      })
    ))
    const harness = createHarness(fetcher as typeof globalThis.fetch)
    const preparation = await prepareAndPermit(harness)
    const connecting = harness.controller.connect(preparation, 'secret')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await expect(harness.controller.disconnect()).resolves.toMatchObject({ ok: true })
    await expect(connecting).resolves.toEqual({ ok: false, reason: 'lifecycle-cancelled' })
    expect(harness.getRecord().grantedCapabilities).toEqual([])
    await expect(harness.controller.status()).resolves.toMatchObject({ phase: 'disconnected' })
  })

  it('restores only the origin after a worker restart and clears a stale connection grant', async () => {
    let storedProfile: { version: 1, controllerOrigin: string } | null = null
    const profileStore: ClashControllerProfileStore = {
      load: vi.fn(async () => storedProfile ? structuredClone(storedProfile) : null),
      save: vi.fn(async (controllerOrigin: string) => {
        storedProfile = { version: 1, controllerOrigin }
        return structuredClone(storedProfile)
      }),
    }
    const fixture = createSwitchFixture()
    const firstWorker = createHarness(fixture.fetcher, undefined, profileStore)
    const { preparation } = await connectAndRefresh(firstWorker, 'worker-only-secret')
    const pendingSwitch = await firstWorker.controller.prepareProxySwitch(fixture.groupName, 'Node B')
    if (!pendingSwitch.ok)
      throw new Error('Expected worker-memory switch plan')
    expect(firstWorker.getRecord().grantedCapabilities).toEqual([CLASH_CONTROL_CAPABILITY])

    const restartedWorker = createHarness(undefined, undefined, profileStore)
    restartedWorker.setRecord(firstWorker.getRecord())
    await expect(restartedWorker.controller.status()).resolves.toEqual({
      phase: 'disconnected',
      generation: 0,
      profile: {
        version: 1,
        controllerOrigin: 'http://127.0.0.1:9090',
      },
    })
    await expect(restartedWorker.controller.readStatus()).resolves.toEqual({
      status: 'empty',
      snapshot: null,
      diagnostic: null,
    })
    expect(restartedWorker.getRecord().grantedCapabilities).toEqual([])
    await expect(restartedWorker.controller.connect(preparation, 'worker-only-secret')).resolves.toEqual({
      ok: false,
      reason: 'invalid-preparation',
    })
    await expect(restartedWorker.controller.confirmProxySwitch(pendingSwitch.plan.token)).resolves.toEqual({
      ok: false,
      reason: 'switch-plan-not-found',
    })
    expect(JSON.stringify(storedProfile)).not.toContain('worker-only-secret')
    expect(JSON.stringify(storedProfile)).not.toContain(pendingSwitch.plan.token)
    expect(JSON.stringify(restartedWorker.getRecord())).not.toContain(pendingSwitch.plan.token)
    expect(fixture.writes).toEqual([])
    expect(restartedWorker.defaultFetch).not.toHaveBeenCalled()
  })
})
