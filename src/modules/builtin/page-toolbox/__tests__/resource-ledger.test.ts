import type { PageToolResourceEntry } from '../resource-ledger'
import {
  createPageToolAuthority,
  PageToolResourceLedger,
} from '../index'
import {
  createPageToolFixtureBinding,
  createPageToolFixtureCatalog,
} from './fixtures'
import { PurePageToolResourceTestAdapter } from './resource-adapter'

type TestEntry = PageToolResourceEntry<string, string | null>

function registerAll(
  ledger: PageToolResourceLedger<string, string | null>,
  authority: ReturnType<typeof createPageToolAuthority>,
  entries: TestEntry[],
) {
  entries.forEach((entry, index) => {
    expect(ledger.register(authority, entry)).toEqual({ ok: true, index })
  })
}

describe('page Toolbox abstract resource ledger', () => {
  it('drains every resource kind exactly once in reverse registration order', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog)
    const authority = createPageToolAuthority(binding)
    const adapter = new PurePageToolResourceTestAdapter()
    adapter.seed('node', { owner: 'owner-node' })
    adapter.seed('style', { owner: 'owner-style' })
    adapter.seed('attribute', { owner: 'owner-attribute', value: 'current' })
    const ledger = new PageToolResourceLedger(binding, adapter)
    registerAll(ledger, authority, [
      { id: 'listener-1', kind: 'listener', handle: 'listener' },
      { id: 'timer-1', kind: 'timer', handle: 'timer' },
      { id: 'observer-1', kind: 'observer', handle: 'observer' },
      { id: 'abort-1', kind: 'abort', handle: 'abort' },
      { id: 'node-1', kind: 'owned-node', handle: 'node', ownershipToken: 'owner-node' },
      { id: 'style-1', kind: 'owned-style', handle: 'style', ownershipToken: 'owner-style' },
      {
        id: 'prior-1',
        kind: 'dom-prior-value',
        handle: 'attribute',
        ownershipToken: 'owner-attribute',
        property: 'contenteditable',
        prior: { present: false, value: null },
      },
    ])
    expect(ledger.size).toBe(7)
    const first = ledger.dispose(authority)
    expect(first).toMatchObject({
      ok: true,
      report: {
        repeated: false,
        results: [
          { id: 'prior-1', outcome: 'restored' },
          { id: 'style-1', outcome: 'released' },
          { id: 'node-1', outcome: 'released' },
          { id: 'abort-1', outcome: 'released' },
          { id: 'observer-1', outcome: 'released' },
          { id: 'timer-1', outcome: 'released' },
          { id: 'listener-1', outcome: 'released' },
        ],
      },
    })
    expect(adapter.cleanupEvents).toEqual([
      'restore:prior-1',
      'release:style-1',
      'release:node-1',
      'release:abort-1',
      'release:observer-1',
      'release:timer-1',
      'release:listener-1',
    ])
    expect(adapter.resources.get('attribute')).toMatchObject({ present: false, value: null, owner: null })
    expect(ledger.size).toBe(0)

    const repeated = ledger.dispose(authority)
    expect(repeated).toMatchObject({ ok: true, report: { repeated: true } })
    expect(adapter.cleanupEvents).toHaveLength(7)
  })

  it('skips owned nodes, styles and prior values after newer ownership replaces them', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog)
    const authority = createPageToolAuthority(binding)
    const adapter = new PurePageToolResourceTestAdapter()
    adapter.seed('node', { owner: 'new-owner' })
    adapter.seed('style', { owner: 'new-owner' })
    adapter.seed('attribute', { owner: 'new-owner', value: 'newer-page-value' })
    const ledger = new PageToolResourceLedger(binding, adapter)
    registerAll(ledger, authority, [
      { id: 'node', kind: 'owned-node', handle: 'node', ownershipToken: 'old-owner' },
      { id: 'style', kind: 'owned-style', handle: 'style', ownershipToken: 'old-owner' },
      {
        id: 'prior',
        kind: 'dom-prior-value',
        handle: 'attribute',
        ownershipToken: 'old-owner',
        property: 'type',
        prior: { present: true, value: 'password' },
      },
    ])
    expect(ledger.dispose(authority)).toMatchObject({
      ok: true,
      report: {
        results: [
          { id: 'prior', outcome: 'skipped-unowned' },
          { id: 'style', outcome: 'skipped-unowned' },
          { id: 'node', outcome: 'skipped-unowned' },
        ],
      },
    })
    expect(adapter.cleanupEvents).toEqual([])
    expect(adapter.resources.get('attribute')?.value).toBe('newer-page-value')
  })

  it('continues reverse cleanup after adapter failure without retrying failed entries', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog)
    const authority = createPageToolAuthority(binding)
    const adapter = new PurePageToolResourceTestAdapter()
    adapter.seed('failure', { failCleanup: true })
    const ledger = new PageToolResourceLedger(binding, adapter)
    registerAll(ledger, authority, [
      { id: 'listener', kind: 'listener', handle: 'listener' },
      { id: 'failure', kind: 'timer', handle: 'failure' },
      { id: 'observer', kind: 'observer', handle: 'observer' },
    ])
    expect(ledger.dispose(authority)).toMatchObject({
      ok: true,
      report: {
        results: [
          { id: 'observer', outcome: 'released' },
          { id: 'failure', outcome: 'failed' },
          { id: 'listener', outcome: 'released' },
        ],
      },
    })
    expect(adapter.cleanupEvents).toEqual([
      'release:observer',
      'release:failure',
      'release:listener',
    ])
    ledger.dispose(authority)
    expect(adapter.cleanupEvents).toHaveLength(3)
  })

  it('rejects duplicate IDs, malformed entries and registration after disposal', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog)
    const authority = createPageToolAuthority(binding)
    const adapter = new PurePageToolResourceTestAdapter()
    const ledger = new PageToolResourceLedger(binding, adapter)
    expect(ledger.register(authority, { id: 'same', kind: 'listener', handle: 'first' })).toEqual({ ok: true, index: 0 })
    expect(ledger.register(authority, { id: 'same', kind: 'timer', handle: 'second' }))
      .toEqual({ ok: false, reason: 'duplicate-id' })
    expect(ledger.register(authority, {
      id: '',
      kind: 'observer',
      handle: 'invalid',
    })).toEqual({ ok: false, reason: 'invalid-entry' })
    expect(ledger.register(authority, {
      id: 'unexpected',
      kind: 'listener',
      handle: 'invalid',
      extra: 'not-allowed',
    } as TestEntry)).toEqual({ ok: false, reason: 'invalid-entry' })
    ledger.dispose(authority)
    expect(ledger.register(authority, { id: 'late', kind: 'abort', handle: 'late' }))
      .toEqual({ ok: false, reason: 'disposed' })
  })

  it('does not invoke accessors while rejecting hostile resource entries', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog)
    const authority = createPageToolAuthority(binding)
    const ledger = new PageToolResourceLedger(binding, new PurePageToolResourceTestAdapter())
    let getterCalled = false
    const hostile = {
      kind: 'listener',
      handle: 'hostile',
      get id() {
        getterCalled = true
        return 'hostile'
      },
    }
    expect(ledger.register(authority, hostile as TestEntry)).toEqual({ ok: false, reason: 'invalid-entry' })
    expect(getterCalled).toBe(false)
  })

  it('rejects cross-origin, cross-tool and stale-generation resource authority', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog)
    const authority = createPageToolAuthority(binding)
    const ledger = new PageToolResourceLedger(binding, new PurePageToolResourceTestAdapter())
    const foreignAuthorities = [
      createPageToolAuthority(createPageToolFixtureBinding(catalog, { exactOrigin: 'https://other.test' })),
      createPageToolAuthority(createPageToolFixtureBinding(catalog, { toolId: 'tool-1' })),
      createPageToolAuthority(createPageToolFixtureBinding(catalog, { generation: 9 })),
    ]
    for (const foreign of foreignAuthorities) {
      expect(ledger.register(foreign, { id: 'foreign', kind: 'timer', handle: 'foreign' }))
        .toEqual({ ok: false, reason: 'authority-mismatch' })
      expect(ledger.dispose(foreign)).toEqual({ ok: false, reason: 'authority-mismatch' })
    }
    expect(ledger.register(authority, { id: 'local', kind: 'timer', handle: 'local' }))
      .toEqual({ ok: true, index: 0 })
  })

  it('keeps two ledger instances isolated when resource IDs and handles collide', () => {
    const catalog = createPageToolFixtureCatalog()
    const firstBinding = createPageToolFixtureBinding(catalog)
    const secondBinding = createPageToolFixtureBinding(catalog, {
      exactOrigin: 'https://second.test',
      toolId: 'tool-1',
      generation: 2,
    })
    const firstAuthority = createPageToolAuthority(firstBinding)
    const secondAuthority = createPageToolAuthority(secondBinding)
    const firstAdapter = new PurePageToolResourceTestAdapter()
    const secondAdapter = new PurePageToolResourceTestAdapter()
    const firstLedger = new PageToolResourceLedger(firstBinding, firstAdapter)
    const secondLedger = new PageToolResourceLedger(secondBinding, secondAdapter)
    expect(firstLedger.register(firstAuthority, { id: 'shared', kind: 'listener', handle: 'shared' }).ok).toBe(true)
    expect(secondLedger.register(secondAuthority, { id: 'shared', kind: 'listener', handle: 'shared' }).ok).toBe(true)

    firstLedger.dispose(firstAuthority)
    expect(firstAdapter.cleanupEvents).toEqual(['release:shared'])
    expect(secondAdapter.cleanupEvents).toEqual([])
    expect(secondLedger.size).toBe(1)
    secondLedger.dispose(secondAuthority)
    expect(secondAdapter.cleanupEvents).toEqual(['release:shared'])
  })

  it('stores an immutable ledger entry snapshot rather than caller identity fields', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog)
    const authority = createPageToolAuthority(binding)
    const adapter = new PurePageToolResourceTestAdapter()
    const ledger = new PageToolResourceLedger(binding, adapter)
    const callerEntry: { id: string, kind: 'listener', handle: string } = {
      id: 'original-id',
      kind: 'listener',
      handle: 'listener',
    }
    expect(ledger.register(authority, callerEntry)).toEqual({ ok: true, index: 0 })
    callerEntry.id = 'mutated-id'
    expect(ledger.dispose(authority)).toMatchObject({
      ok: true,
      report: { results: [{ id: 'original-id', outcome: 'released' }] },
    })
  })
})
