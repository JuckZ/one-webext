import type { InstalledModuleRecord } from '../../../types'
import type { ClashControlClientError } from '../client'
import { ClashControlClient } from '../client'
import { createClashControlSeed } from '../manifest'
import {
  CLASH_CONTROL_CHANNEL,
  CLASH_CONTROL_PROTOCOL_VERSION,
  createClashControlResponse,
  isClashControlRequest,
  isClashControlResponse,
} from '../protocol'

const requestBase = {
  channel: CLASH_CONTROL_CHANNEL,
  version: CLASH_CONTROL_PROTOCOL_VERSION,
} as const

function clashRecord(): InstalledModuleRecord {
  const seed = createClashControlSeed()
  return {
    manifest: seed.manifest,
    enabled: true,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: ['clash.status.read'],
    update: null,
    installedAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  }
}

describe('clash Control protocol', () => {
  it('accepts only the seven narrow versioned operations with bounded switch selectors', () => {
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_PREPARE',
      controllerUrl: 'http://127.0.0.1:9090',
    })).toBe(true)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_CONNECT',
      token: 'preparation-1',
      generation: 1,
      controllerOrigin: 'http://127.0.0.1:9090',
      originPattern: 'http://127.0.0.1:9090/*',
      expiresAt: '2026-08-28T00:02:00.000Z',
      secret: 'secret',
    })).toBe(true)
    expect(isClashControlRequest({ ...requestBase, type: 'CLASH_CONTROL_STATUS' })).toBe(true)
    expect(isClashControlRequest({ ...requestBase, type: 'CLASH_CONTROL_REFRESH' })).toBe(true)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_PREPARE_PROXY_SWITCH',
      groupName: 'GLOBAL',
      targetNode: 'Node B',
    })).toBe(true)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH',
      token: 'switch-plan-1',
    })).toBe(true)
    expect(isClashControlRequest({ ...requestBase, type: 'CLASH_CONTROL_DISCONNECT' })).toBe(true)
    expect(isClashControlRequest({ ...requestBase, type: 'CLASH_CONTROL_SWITCH_PROXY' })).toBe(false)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_PREPARE_PROXY_SWITCH',
      groupName: 'x'.repeat(257),
      targetNode: 'Node B',
    })).toBe(false)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_PREPARE_PROXY_SWITCH',
      groupName: 'GLOBAL',
      targetNode: '',
    })).toBe(false)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_PREPARE_PROXY_SWITCH',
      groupName: 'GLOBAL',
      targetNode: 'Node B',
      path: '/arbitrary',
    })).toBe(false)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH',
      token: 'x'.repeat(129),
    })).toBe(false)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH',
      token: 'switch-plan-1',
      body: { name: 'forged' },
    })).toBe(false)
    expect(isClashControlRequest({
      ...requestBase,
      type: 'CLASH_CONTROL_CONNECT',
      token: 'preparation-1',
      generation: 1,
      controllerOrigin: 'http://127.0.0.1:9090',
      originPattern: 'http://127.0.0.1:9090/*',
      expiresAt: '2026-08-28T00:02:00.000Z',
      secret: 'line\nbreak',
    })).toBe(false)
    expect(isClashControlRequest({
      ...requestBase,
      version: 1,
      type: 'CLASH_CONTROL_STATUS',
    })).toBe(false)
  })

  it('validates operation-specific responses', () => {
    const connected = createClashControlResponse('CLASH_CONTROL_CONNECT', {
      ok: true,
      operation: 'connect',
      status: {
        controllerOrigin: 'http://127.0.0.1:9090',
        implementation: 'Clash.Meta',
        version: '1.19.0',
        mode: 'rule',
        connectedAt: '2026-08-28T00:00:00.000Z',
      },
      record: clashRecord(),
    })
    expect(isClashControlResponse(connected)).toBe(true)
    expect(isClashControlResponse({
      ...connected,
      requestType: 'CLASH_CONTROL_STATUS',
    })).toBe(false)
    expect(isClashControlResponse({
      ...connected,
      result: { ok: false, operation: 'connect', reason: 'arbitrary-error' },
    })).toBe(false)

    const disconnected = createClashControlResponse('CLASH_CONTROL_STATUS', {
      ok: true,
      operation: 'status',
      connection: {
        phase: 'disconnected',
        generation: 0,
        profile: { version: 1, controllerOrigin: 'http://127.0.0.1:9090' },
      },
      status: null,
      readState: { status: 'empty', snapshot: null, diagnostic: null },
    })
    expect(isClashControlResponse(disconnected)).toBe(true)
    expect(JSON.stringify(disconnected)).not.toContain('token')

    const refreshed = createClashControlResponse('CLASH_CONTROL_REFRESH', {
      ok: true,
      operation: 'refresh',
      snapshot: {
        version: 1,
        controllerOrigin: 'http://127.0.0.1:9090',
        generation: 2,
        refreshedAt: '2026-08-28T00:01:00.000Z',
        implementation: 'Clash.Meta',
        controllerVersion: '1.19.0',
        mode: 'rule',
        proxyGroups: [],
      },
    })
    expect(isClashControlResponse(refreshed)).toBe(true)
    expect(isClashControlResponse({
      ...refreshed,
      result: { ...refreshed.result, snapshot: { raw: true } },
    })).toBe(false)

    const validSwitchPlan = {
      version: 1 as const,
      token: 'switch-plan-1',
      controllerOrigin: 'http://127.0.0.1:9090',
      generation: 2,
      snapshotVersion: 1 as const,
      snapshotRefreshedAt: '2026-08-28T00:01:00.000Z',
      groupName: 'GLOBAL',
      groupType: 'Selector',
      originalNode: 'Node A',
      targetNode: 'Node B',
      createdAt: '2026-08-28T00:01:10.000Z',
      expiresAt: '2026-08-28T00:02:10.000Z',
    }
    const switchPlan = createClashControlResponse('CLASH_CONTROL_PREPARE_PROXY_SWITCH', {
      ok: true,
      operation: 'prepare-proxy-switch',
      plan: validSwitchPlan,
    })
    expect(isClashControlResponse(switchPlan)).toBe(true)
    expect(isClashControlResponse({
      ...switchPlan,
      result: {
        ...switchPlan.result,
        plan: { ...validSwitchPlan, snapshotBinding: 'private' },
      },
    })).toBe(false)

    const switched = createClashControlResponse('CLASH_CONTROL_CONFIRM_PROXY_SWITCH', {
      ok: true,
      operation: 'confirm-proxy-switch',
      groupName: 'GLOBAL',
      previousNode: 'Node A',
      selectedNode: 'Node B',
    })
    expect(isClashControlResponse(switched)).toBe(true)
    expect(isClashControlResponse(createClashControlResponse('CLASH_CONTROL_CONFIRM_PROXY_SWITCH', {
      ok: false,
      operation: 'confirm-proxy-switch',
      reason: 'switch-outcome-unknown',
    }))).toBe(true)
    expect(isClashControlResponse({
      ...switched,
      result: { ok: false, operation: 'confirm-proxy-switch', reason: 'arbitrary-error' },
    })).toBe(false)
  })

  it('sends a payload-free manual refresh request through the dedicated channel', async () => {
    const response = createClashControlResponse('CLASH_CONTROL_REFRESH', {
      ok: false,
      operation: 'refresh',
      reason: 'connection-required',
    })
    const sendMessage = vi.fn(async () => response)
    const client = new ClashControlClient(
      { sendMessage },
      { request: vi.fn() },
    )
    await expect(client.refresh()).resolves.toEqual(response.result)
    expect(sendMessage).toHaveBeenCalledWith({
      channel: CLASH_CONTROL_CHANNEL,
      version: CLASH_CONTROL_PROTOCOL_VERSION,
      type: 'CLASH_CONTROL_REFRESH',
    })
  })

  it('sends only reviewed selectors for preparation and only the token for confirmation', async () => {
    const plan = {
      version: 1 as const,
      token: 'switch-plan-1',
      controllerOrigin: 'http://127.0.0.1:9090',
      generation: 2,
      snapshotVersion: 1 as const,
      snapshotRefreshedAt: '2026-08-28T00:01:00.000Z',
      groupName: 'GLOBAL',
      groupType: 'Selector',
      originalNode: 'Node A',
      targetNode: 'Node B',
      createdAt: '2026-08-28T00:01:10.000Z',
      expiresAt: '2026-08-28T00:02:10.000Z',
    }
    const responses = [
      createClashControlResponse('CLASH_CONTROL_PREPARE_PROXY_SWITCH', {
        ok: true,
        operation: 'prepare-proxy-switch',
        plan,
      }),
      createClashControlResponse('CLASH_CONTROL_CONFIRM_PROXY_SWITCH', {
        ok: true,
        operation: 'confirm-proxy-switch',
        groupName: 'GLOBAL',
        previousNode: 'Node A',
        selectedNode: 'Node B',
      }),
    ]
    const sendMessage = vi.fn(async () => responses.shift())
    const client = new ClashControlClient(
      { sendMessage },
      { request: vi.fn() },
    )

    await expect(client.prepareProxySwitch('GLOBAL', 'Node B')).resolves.toMatchObject({ ok: true, plan })
    await expect(client.confirmProxySwitch(plan.token)).resolves.toMatchObject({
      ok: true,
      selectedNode: 'Node B',
    })
    expect(sendMessage.mock.calls).toEqual([
      [{
        channel: CLASH_CONTROL_CHANNEL,
        version: CLASH_CONTROL_PROTOCOL_VERSION,
        type: 'CLASH_CONTROL_PREPARE_PROXY_SWITCH',
        groupName: 'GLOBAL',
        targetNode: 'Node B',
      }],
      [{
        channel: CLASH_CONTROL_CHANNEL,
        version: CLASH_CONTROL_PROTOCOL_VERSION,
        type: 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH',
        token: 'switch-plan-1',
      }],
    ])
  })

  it('requests only the reviewed exact origin before sending a secret to the trusted transport', async () => {
    const sequence: string[] = []
    const permissionRequest = vi.fn(async ({ origins }: { origins: string[] }) => {
      sequence.push(`permission:${origins.join(',')}`)
      return true
    })
    const sendMessage = vi.fn(async (request) => {
      sequence.push(`message:${request.type}`)
      return createClashControlResponse('CLASH_CONTROL_CONNECT', {
        ok: false,
        operation: 'connect',
        reason: 'authentication-failed',
      })
    })
    const client = new ClashControlClient(
      { sendMessage },
      { request: permissionRequest },
    )
    const preparation = {
      controllerOrigin: 'http://127.0.0.1:9090',
      originPattern: 'http://127.0.0.1:9090/*',
      token: 'preparation-1',
      generation: 1,
      expiresAt: '2026-08-28T00:02:00.000Z',
    }

    await expect(client.connect(preparation, 'phase4a-secret')).resolves.toMatchObject({
      ok: false,
      reason: 'authentication-failed',
    })
    expect(sequence).toEqual([
      'permission:http://127.0.0.1:9090/*',
      'message:CLASH_CONTROL_CONNECT',
    ])
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CLASH_CONTROL_CONNECT',
      token: 'preparation-1',
      generation: 1,
      controllerOrigin: 'http://127.0.0.1:9090',
      originPattern: 'http://127.0.0.1:9090/*',
      expiresAt: '2026-08-28T00:02:00.000Z',
      secret: 'phase4a-secret',
    }))
  })

  it('never sends the connect request after permission denial', async () => {
    const sendMessage = vi.fn()
    const client = new ClashControlClient(
      { sendMessage },
      { request: vi.fn(async () => false) },
    )
    await expect(client.connect({
      controllerOrigin: 'http://127.0.0.1:9090',
      originPattern: 'http://127.0.0.1:9090/*',
      token: 'preparation-1',
      generation: 1,
      expiresAt: '2026-08-28T00:02:00.000Z',
    }, 'phase4a-secret')).rejects.toEqual(expect.objectContaining<Partial<ClashControlClientError>>({
      code: 'permission-denied',
    }))
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
