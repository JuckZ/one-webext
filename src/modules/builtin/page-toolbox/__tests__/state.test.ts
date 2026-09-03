import type { PageToolboxSettingsV1 } from '..'
import {
  addPageToolboxStateSite,
  normalizeStoredPageToolboxState,
  PAGE_TOOL_CATALOG,
  replacePageToolboxStateSite,
} from '..'

function legacySettings(...origins: string[]): PageToolboxSettingsV1 {
  return {
    schemaVersion: 1,
    sites: Object.fromEntries(origins.map(origin => [origin, {
      enabledToolIds: [],
      toolSettings: {},
    }])),
  }
}

describe('page Toolbox revisioned state document', () => {
  it('migrates legacy schema-1 settings in memory with independent revision zero', () => {
    const legacy = legacySettings('https://alpha.example', 'https://beta.example')
    const state = normalizeStoredPageToolboxState(legacy, PAGE_TOOL_CATALOG)

    expect(state).toEqual({
      schemaVersion: 2,
      settings: legacy,
      siteRevisions: {
        'https://alpha.example': 0,
        'https://beta.example': 0,
      },
    })
    expect(state).not.toBe(legacy)
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state?.siteRevisions)).toBe(true)
  })

  it('requires wrapper keys, plain data properties and a one-to-one revision map', () => {
    const settings = legacySettings('https://alpha.example')
    const valid = { schemaVersion: 2, settings, siteRevisions: { 'https://alpha.example': 3 } }
    expect(normalizeStoredPageToolboxState(valid, PAGE_TOOL_CATALOG)?.siteRevisions).toEqual({
      'https://alpha.example': 3,
    })
    expect(normalizeStoredPageToolboxState({ ...valid, extra: true }, PAGE_TOOL_CATALOG)).toBeNull()
    expect(normalizeStoredPageToolboxState({ ...valid, siteRevisions: {} }, PAGE_TOOL_CATALOG)).toBeNull()
    expect(normalizeStoredPageToolboxState({
      ...valid,
      siteRevisions: { 'https://alpha.example': 3, 'https://beta.example': 0 },
    }, PAGE_TOOL_CATALOG)).toBeNull()
    const accessor = { schemaVersion: 2, settings, siteRevisions: {} }
    Object.defineProperty(accessor, 'siteRevisions', { enumerable: true, get: () => ({ 'https://alpha.example': 3 }) })
    expect(normalizeStoredPageToolboxState(accessor, PAGE_TOOL_CATALOG)).toBeNull()
    expect(normalizeStoredPageToolboxState(Object.assign(Object.create({}), valid), PAGE_TOOL_CATALOG)).toBeNull()
  })

  it('creates approval revision zero and preserves peer revisions', () => {
    const initial = normalizeStoredPageToolboxState(legacySettings('https://alpha.example'), PAGE_TOOL_CATALOG)!
    const revised = replacePageToolboxStateSite(initial, 'https://alpha.example', 0, {
      enabledToolIds: ['password-visibility'],
      toolSettings: { 'password-visibility': { gesture: 'double-click' } },
    }, PAGE_TOOL_CATALOG)
    expect(revised).toMatchObject({ ok: true, revision: 1 })
    if (!revised.ok)
      throw new Error('expected revision')

    const withBeta = addPageToolboxStateSite(revised.state, 'https://beta.example', PAGE_TOOL_CATALOG)!
    expect(withBeta.siteRevisions).toEqual({
      'https://alpha.example': 1,
      'https://beta.example': 0,
    })
  })

  it('increments every accepted whole-document replacement, including semantic no-op', () => {
    const initial = normalizeStoredPageToolboxState(legacySettings('https://alpha.example'), PAGE_TOOL_CATALOG)!
    const site = initial.settings.sites['https://alpha.example']!
    const first = replacePageToolboxStateSite(initial, 'https://alpha.example', 0, site, PAGE_TOOL_CATALOG)
    expect(first).toMatchObject({ ok: true, changed: false, revision: 1 })
    if (!first.ok)
      throw new Error('expected replacement')
    expect(first.state).not.toBe(initial)
    expect(first.state.siteRevisions['https://alpha.example']).toBe(1)
  })

  it('rejects stale, malformed and exhausted mutations without changing the input', () => {
    const initial = normalizeStoredPageToolboxState(legacySettings('https://alpha.example'), PAGE_TOOL_CATALOG)!
    const before = structuredClone(initial)
    expect(replacePageToolboxStateSite(initial, 'https://alpha.example', 4, {
      enabledToolIds: [],
      toolSettings: {},
    }, PAGE_TOOL_CATALOG)).toEqual({ ok: false, reason: 'revision-conflict', revision: 0 })
    expect(replacePageToolboxStateSite(initial, 'https://alpha.example', 0, {
      enabledToolIds: ['not-a-tool'],
      toolSettings: {},
    }, PAGE_TOOL_CATALOG)).toEqual({ ok: false, reason: 'invalid-state', revision: 0 })

    const exhausted = normalizeStoredPageToolboxState({
      schemaVersion: 2,
      settings: initial.settings,
      siteRevisions: { 'https://alpha.example': Number.MAX_SAFE_INTEGER },
    }, PAGE_TOOL_CATALOG)!
    expect(replacePageToolboxStateSite(exhausted, 'https://alpha.example', Number.MAX_SAFE_INTEGER, {
      enabledToolIds: [],
      toolSettings: {},
    }, PAGE_TOOL_CATALOG)).toEqual({
      ok: false,
      reason: 'revision-exhausted',
      revision: Number.MAX_SAFE_INTEGER,
    })
    expect(initial).toEqual(before)
  })
})
