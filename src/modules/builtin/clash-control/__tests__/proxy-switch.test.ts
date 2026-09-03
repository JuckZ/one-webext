import type { ClashReadOnlySnapshot } from '../contracts'
import {
  compareClashProxySwitchPreflight,
  createClashProxySwitchPlan,
  createClashProxySwitchWrite,
  isClashProxySwitchPlan,
  toPublicClashProxySwitchPlan,
  validateClashProxySwitchPlan,
} from '../proxy-switch'

function snapshot(): ClashReadOnlySnapshot {
  return {
    version: 1,
    controllerOrigin: 'http://127.0.0.1:9090',
    generation: 7,
    refreshedAt: '2026-08-28T01:00:00.000Z',
    implementation: 'Clash.Meta',
    controllerVersion: '1.19.0',
    mode: 'rule',
    proxyGroups: [{
      name: 'Group / ? # % 你好',
      type: 'Selector',
      selectedNode: 'Node A',
      nodes: [
        { name: 'Node A', type: 'Vmess', alive: true },
        { name: 'Node B', type: 'Shadowsocks', alive: false },
      ],
    }],
  }
}

function plan() {
  const result = createClashProxySwitchPlan(
    snapshot(),
    'Group / ? # % 你好',
    'Node B',
    'switch-token-1',
    '2026-08-28T01:00:01.000Z',
  )
  if (!result.ok)
    throw new Error(`Expected switch plan, received ${result.reason}`)
  return result.plan
}

describe('clash proxy-switch contract', () => {
  it('binds a short-lived plan to the complete normalized snapshot and reviewed values', () => {
    const value = plan()
    expect(value).toMatchObject({
      version: 1,
      token: 'switch-token-1',
      controllerOrigin: 'http://127.0.0.1:9090',
      generation: 7,
      snapshotVersion: 1,
      snapshotRefreshedAt: '2026-08-28T01:00:00.000Z',
      groupName: 'Group / ? # % 你好',
      groupType: 'Selector',
      originalNode: 'Node A',
      targetNode: 'Node B',
      createdAt: '2026-08-28T01:00:01.000Z',
      expiresAt: '2026-08-28T01:01:01.000Z',
    })
    expect(value.snapshotBinding).toBe(JSON.stringify(snapshot()))
    expect(value.snapshotBinding).not.toContain('switch-token-1')
  })

  it.each([
    ['unknown group', 'Outside', 'Node B', 'switch-target-invalid'],
    ['unknown node', 'Group / ? # % 你好', 'Outside', 'switch-target-invalid'],
    ['current node', 'Group / ? # % 你好', 'Node A', 'switch-no-change'],
    ['oversized group', 'x'.repeat(257), 'Node B', 'switch-target-invalid'],
  ])('rejects %s before creating authority', (_label, groupName, targetNode, reason) => {
    expect(createClashProxySwitchPlan(
      snapshot(),
      groupName,
      targetNode,
      'switch-token-1',
      '2026-08-28T01:00:01.000Z',
    )).toEqual({ ok: false, reason })
  })

  it('expires exactly at the boundary and rejects a different token', () => {
    const value = plan()
    expect(validateClashProxySwitchPlan(
      value,
      snapshot(),
      value.token,
      '2026-08-28T01:01:00.999Z',
    )).toEqual({ ok: true })
    expect(validateClashProxySwitchPlan(
      value,
      snapshot(),
      value.token,
      value.expiresAt,
    )).toEqual({ ok: false, reason: 'switch-plan-expired' })
    expect(validateClashProxySwitchPlan(
      value,
      snapshot(),
      'different-token',
      '2026-08-28T01:00:02.000Z',
    )).toEqual({ ok: false, reason: 'switch-plan-not-found' })
  })

  it('rejects any replacement of the bound normalized snapshot', () => {
    const value = plan()
    const changedMode = { ...snapshot(), mode: 'global' }
    expect(validateClashProxySwitchPlan(
      value,
      changedMode,
      value.token,
      '2026-08-28T01:00:02.000Z',
    )).toEqual({ ok: false, reason: 'switch-plan-stale' })

    const changedNodeState = snapshot()
    changedNodeState.proxyGroups[0]!.nodes[1]!.alive = true
    expect(validateClashProxySwitchPlan(
      value,
      changedNodeState,
      value.token,
      '2026-08-28T01:00:02.000Z',
    )).toEqual({ ok: false, reason: 'switch-plan-stale' })
  })

  it('compares the preflight group, original selection and target membership only', () => {
    const value = plan()
    expect(compareClashProxySwitchPreflight(value, snapshot().proxyGroups)).toEqual({ ok: true })
    const replaced = snapshot().proxyGroups
    replaced[0]!.selectedNode = 'Node B'
    expect(compareClashProxySwitchPreflight(value, replaced)).toEqual({
      ok: false,
      reason: 'switch-plan-stale',
    })
    const targetRemoved = snapshot().proxyGroups
    targetRemoved[0]!.nodes = targetRemoved[0]!.nodes.filter(node => node.name !== 'Node B')
    expect(compareClashProxySwitchPreflight(value, targetRemoved)).toEqual({
      ok: false,
      reason: 'switch-plan-stale',
    })
  })

  it('constructs the encoded path and exact body without accepting request options', () => {
    const write = createClashProxySwitchWrite(plan())
    expect(write).toEqual({
      path: '/proxies/Group%20%2F%20%3F%20%23%20%25%20%E4%BD%A0%E5%A5%BD',
      body: { name: 'Node B' },
    })
    expect(Object.keys(write)).toEqual(['path', 'body'])
    expect(Object.keys(write.body)).toEqual(['name'])
  })

  it('returns a public review plan without its server-side snapshot binding', () => {
    const publicPlan = toPublicClashProxySwitchPlan(plan())
    expect(isClashProxySwitchPlan(publicPlan)).toBe(true)
    expect(publicPlan).not.toHaveProperty('snapshotBinding')
    expect(JSON.stringify(publicPlan)).not.toContain('secret')
    expect(isClashProxySwitchPlan({ ...publicPlan, snapshotBinding: 'forged' })).toBe(false)
    expect(isClashProxySwitchPlan({ ...publicPlan, secret: 'forged' })).toBe(false)
  })
})
