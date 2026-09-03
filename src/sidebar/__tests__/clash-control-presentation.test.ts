import type {
  ClashProxySwitchPlan,
  ClashReadOnlySnapshot,
} from '~/modules/builtin/clash-control'
import {
  presentClashProxyGroupChoices,
  presentClashProxySwitchReview,
} from '../clash-control-presentation'

function snapshot(): ClashReadOnlySnapshot {
  return {
    version: 1,
    controllerOrigin: 'http://127.0.0.1:9090',
    generation: 4,
    refreshedAt: '2026-08-29T01:00:00.000Z',
    implementation: 'Clash.Meta',
    controllerVersion: '1.19.0',
    mode: 'rule',
    proxyGroups: [{
      name: 'GLOBAL <img data-clash-xss src=x>',
      type: 'Selector',
      selectedNode: 'Node A',
      nodes: [
        { name: 'Node A', type: 'Vmess', alive: true },
        { name: 'Node B <script>ignored</script>', type: 'Shadowsocks', alive: false },
      ],
    }],
  }
}

function plan(): ClashProxySwitchPlan {
  return {
    version: 1,
    token: 'switch-plan-ui-1',
    controllerOrigin: 'http://127.0.0.1:9090',
    generation: 4,
    snapshotVersion: 1,
    snapshotRefreshedAt: '2026-08-29T01:00:00.000Z',
    groupName: 'GLOBAL <img data-clash-xss src=x>',
    groupType: 'Selector',
    originalNode: 'Node A',
    targetNode: 'Node B <script>ignored</script>',
    createdAt: '2026-08-29T01:00:10.000Z',
    expiresAt: '2026-08-29T01:01:10.000Z',
  }
}

const staleCases: Array<[string, ClashReadOnlySnapshot | null]> = [
  ['missing snapshot', null],
  ['changed origin', { ...snapshot(), controllerOrigin: 'http://127.0.0.1:9091' }],
  ['changed generation', { ...snapshot(), generation: 5 }],
  ['changed refresh', { ...snapshot(), refreshedAt: '2026-08-29T01:00:01.000Z' }],
  ['changed selection', {
    ...snapshot(),
    proxyGroups: [{ ...snapshot().proxyGroups[0]!, selectedNode: 'Node B <script>ignored</script>' }],
  }],
  ['removed target', {
    ...snapshot(),
    proxyGroups: [{ ...snapshot().proxyGroups[0]!, nodes: [snapshot().proxyGroups[0]!.nodes[0]!] }],
  }],
]

describe('clash Control presentation', () => {
  it('offers only alternate normalized nodes without interpreting untrusted text', () => {
    expect(presentClashProxyGroupChoices(snapshot())).toEqual([{
      groupName: 'GLOBAL <img data-clash-xss src=x>',
      groupType: 'Selector',
      selectedNode: 'Node A',
      targets: [{
        name: 'Node B <script>ignored</script>',
        type: 'Shadowsocks',
        alive: false,
      }],
    }])
  })

  it('presents a matching unexpired plan as separately confirmable', () => {
    expect(presentClashProxySwitchReview(
      snapshot(),
      plan(),
      '2026-08-29T01:00:30.000Z',
    )).toMatchObject({
      state: 'ready',
      canConfirm: true,
      originalNode: 'Node A',
      targetNode: 'Node B <script>ignored</script>',
    })
  })

  it('expires exactly at the plan boundary', () => {
    expect(presentClashProxySwitchReview(
      snapshot(),
      plan(),
      plan().expiresAt,
    )).toMatchObject({
      state: 'expired',
      canConfirm: false,
    })
  })

  it.each(staleCases)('marks %s as stale', (_label, changedSnapshot) => {
    expect(presentClashProxySwitchReview(
      changedSnapshot,
      plan(),
      '2026-08-29T01:00:30.000Z',
    )).toMatchObject({
      state: 'stale',
      canConfirm: false,
    })
  })
})
