import {
  CLASH_CONTROL_READ_ENDPOINTS,
} from '../contracts'
import {
  isClashControlReadEndpoint,
  isClashReadOnlySnapshot,
  isClashReadState,
  parseClashConnectionStatus,
  parseClashReadOnlySnapshot,
} from '../snapshot'

const context = {
  controllerOrigin: 'http://127.0.0.1:9090',
  generation: 7,
  refreshedAt: '2026-08-28T01:02:03.000Z',
  forbiddenText: 'do-not-reflect',
}

function payloads() {
  return {
    version: { meta: true, version: '1.19.0', unknown: '<b>ignored</b>' },
    configs: { mode: 'rule', mixedPort: 7890 },
    proxies: {
      extra: '<img src=x onerror=alert(1)>',
      proxies: {
        'Node B': { type: 'Shadowsocks', alive: false, history: [{ delay: 9 }] },
        'GLOBAL': {
          type: 'Selector',
          alive: true,
          now: 'Node A',
          all: ['Node A', 'Node B', 'Node A'],
        },
        'Node A': { type: 'Vmess', alive: true, udp: true },
        'Fallback': {
          type: 'Fallback',
          now: 'Node B',
          all: ['Node B'],
        },
      },
    },
  }
}

describe('clash read-only snapshot contract', () => {
  it('fixes the endpoint allowlist and rejects every caller-controlled path', () => {
    expect(CLASH_CONTROL_READ_ENDPOINTS).toEqual(['/version', '/configs', '/proxies'])
    expect(CLASH_CONTROL_READ_ENDPOINTS.every(isClashControlReadEndpoint)).toBe(true)
    expect(['/rules', '/configs?mode=global', 'http://127.0.0.1:9090/proxies', '/proxies/Node A']
      .every(value => !isClashControlReadEndpoint(value))).toBe(true)
  })

  it('projects sorted groups, selected nodes and minimal node status while dropping unknown fields', () => {
    const result = parseClashReadOnlySnapshot(payloads(), context)
    expect(result).toEqual({
      ok: true,
      snapshot: {
        version: 1,
        controllerOrigin: context.controllerOrigin,
        generation: 7,
        refreshedAt: context.refreshedAt,
        implementation: 'Clash.Meta',
        controllerVersion: '1.19.0',
        mode: 'rule',
        proxyGroups: [
          {
            name: 'Fallback',
            type: 'Fallback',
            selectedNode: 'Node B',
            nodes: [{ name: 'Node B', type: 'Shadowsocks', alive: false }],
          },
          {
            name: 'GLOBAL',
            type: 'Selector',
            selectedNode: 'Node A',
            nodes: [
              { name: 'Node A', type: 'Vmess', alive: true },
              { name: 'Node B', type: 'Shadowsocks', alive: false },
            ],
          },
        ],
      },
    })
    if (!result.ok)
      throw new Error('Expected normalized snapshot')
    expect(JSON.stringify(result.snapshot)).not.toContain('unknown')
    expect(JSON.stringify(result.snapshot)).not.toContain('mixedPort')
    expect(JSON.stringify(result.snapshot)).not.toContain('history')
    expect(JSON.stringify(result.snapshot)).not.toContain('<img')
    expect(isClashReadOnlySnapshot(result.snapshot)).toBe(true)
    expect(isClashReadState({ status: 'ready', snapshot: result.snapshot, diagnostic: null })).toBe(true)
  })

  it('accepts an empty proxy collection as a deliberate empty product state', () => {
    expect(parseClashReadOnlySnapshot({
      version: { version: '1.18.0' },
      configs: { mode: 'global' },
      proxies: { proxies: {} },
    }, context)).toMatchObject({ ok: true, snapshot: { proxyGroups: [] } })
  })

  it.each([
    ['missing proxies map', { ...payloads(), proxies: {} }],
    ['mistyped mode', { ...payloads(), configs: { mode: 7 } }],
    ['mistyped group members', {
      ...payloads(),
      proxies: { proxies: { GLOBAL: { type: 'Selector', now: 'A', all: 'A' } } },
    }],
    ['missing selected node', {
      ...payloads(),
      proxies: { proxies: { GLOBAL: { type: 'Selector', all: [] } } },
    }],
    ['unknown selected node', {
      ...payloads(),
      proxies: { proxies: { GLOBAL: { type: 'Selector', now: 'A', all: ['A'] } } },
    }],
    ['mistyped alive state', {
      ...payloads(),
      proxies: { proxies: { A: { type: 'Direct', alive: 'yes' } } },
    }],
  ])('returns a stable diagnostic for %s', (_label, value) => {
    expect(parseClashReadOnlySnapshot(value, context)).toEqual({
      ok: false,
      reason: 'response-malformed',
    })
  })

  it('rejects secret reflection in every projected text field', () => {
    const reflected = payloads()
    reflected.proxies.proxies['Node A'].type = `Vmess-do-not-reflect`
    expect(parseClashReadOnlySnapshot(reflected, context)).toEqual({
      ok: false,
      reason: 'response-malformed',
    })
    expect(parseClashConnectionStatus(
      { version: 'do-not-reflect' },
      { mode: 'rule' },
      context,
    )).toBeNull()
  })

  it('validates ready, empty and stale read-state shapes strictly', () => {
    const result = parseClashReadOnlySnapshot(payloads(), context)
    if (!result.ok)
      throw new Error('Expected normalized snapshot')
    const diagnostic = { code: 'network-failure' as const, occurredAt: context.refreshedAt }
    expect(isClashReadState({ status: 'empty', snapshot: null, diagnostic })).toBe(true)
    expect(isClashReadState({ status: 'stale', snapshot: result.snapshot, diagnostic })).toBe(true)
    expect(isClashReadState({ status: 'stale', snapshot: null, diagnostic })).toBe(false)
    expect(isClashReadState({ status: 'ready', snapshot: result.snapshot, diagnostic })).toBe(false)
  })
})
