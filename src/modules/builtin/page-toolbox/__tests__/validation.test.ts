import type { PageToolSettingsSchemaDefinitionV1 } from '../contracts'
import {
  PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
  PAGE_TOOLBOX_MAX_SETTINGS_NODES,
  PAGE_TOOLBOX_MAX_SITES,
  PAGE_TOOLBOX_MAX_TOOL_SETTINGS_BYTES,
  PAGE_TOOLBOX_MAX_TOOLS_PER_SITE,
  PAGE_TOOLBOX_MODULE_ID,
} from '../contracts'
import {
  canonicalizePageToolJson,
  createDefaultPageToolboxSettings,
  createPageToolAuthority,
  createPageToolCatalog,
  normalizePageToolExactOrigin,
  validatePageToolboxSettings,
  validatePageToolDescriptor,
  validatePageToolRuntimeBinding,
} from '../validation'
import {
  createPageToolFixtureBinding,
  createPageToolFixtureCatalog,
  createRawPageToolDescriptor,
  unwrap,
} from './fixtures'

function codeOf(result: { ok: boolean, code?: string }): string | null {
  return result.ok ? null : result.code || null
}

function createSite(enabledToolIds: string[] = [], toolSettings: Record<string, unknown> = {}) {
  return { enabledToolIds, toolSettings }
}

describe('page Toolbox pure validation contract', () => {
  it('canonically clones immutable descriptors through a static schema allowlist', () => {
    const raw = createRawPageToolDescriptor('password-view')
    const schema: PageToolSettingsSchemaDefinitionV1 = {
      toolId: raw.id,
      schemaId: raw.settingsSchemaId,
      schemaVersion: PAGE_TOOL_SETTINGS_SCHEMA_VERSION,
      validate: () => true,
    }
    const result = validatePageToolDescriptor(raw, [schema])
    expect(result).toMatchObject({ ok: true })
    const descriptor = unwrap(result)
    const catalog = unwrap(createPageToolCatalog([raw], [schema]))
    expect(descriptor).not.toBe(raw)
    expect(descriptor).toEqual(raw)
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(Object.isFrozen(descriptor.domAccess)).toBe(true)

    ;(raw as unknown as { title: string }).title = 'mutated caller title'
    ;(schema as unknown as { validate: () => boolean }).validate = () => false
    expect(descriptor.title).toBe('Tool password-view')
    expect(catalog['password-view'].descriptor.title).toBe('Tool password-view')
    expect(catalog['password-view'].settingsSchema.validate(null)).toBe(true)
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog['password-view'].settingsSchema)).toBe(true)
  })

  it('rejects descriptor privilege widening, unknown fields, duplicate access and accessors', () => {
    const descriptor = createRawPageToolDescriptor('tool-safe')
    const schema: PageToolSettingsSchemaDefinitionV1 = {
      toolId: descriptor.id,
      schemaId: descriptor.settingsSchemaId,
      schemaVersion: 1,
      validate: () => true,
    }
    const invalid = [
      { ...descriptor, defaultEnabled: true },
      { ...descriptor, frames: 'all' },
      { ...descriptor, requiresMainWorld: true },
      { ...descriptor, siteScope: '*://*/*' },
      { ...descriptor, requiredSiteGrant: 'wildcard' },
      { ...descriptor, domAccess: ['read', 'read'] },
      { ...descriptor, source: 'alert(1)' },
    ]
    for (const candidate of invalid)
      expect(codeOf(validatePageToolDescriptor(candidate, [schema]))).toBe('invalid-descriptor')

    let getterCalled = false
    const withGetter = { ...descriptor }
    Object.defineProperty(withGetter, 'title', {
      enumerable: true,
      get() {
        getterCalled = true
        return 'hostile'
      },
    })
    expect(codeOf(validatePageToolDescriptor(withGetter, [schema]))).toBe('invalid-descriptor')
    expect(getterCalled).toBe(false)
    expect(codeOf(validatePageToolDescriptor(descriptor, []))).toBe('unknown-settings-schema')
  })

  it('rejects duplicate tool descriptors and schema identity substitution', () => {
    const descriptor = createRawPageToolDescriptor('tool-safe')
    const schema: PageToolSettingsSchemaDefinitionV1 = {
      toolId: descriptor.id,
      schemaId: descriptor.settingsSchemaId,
      schemaVersion: 1,
      validate: () => true,
    }
    expect(codeOf(createPageToolCatalog([descriptor, descriptor], [schema]))).toBe('duplicate-tool')
    expect(codeOf(validatePageToolDescriptor(descriptor, [{
      ...schema,
      toolId: 'tool-other',
    }]))).toBe('unknown-settings-schema')
  })

  it('normalizes exact HTTP(S) origins and rejects paths, credentials and non-web schemes', () => {
    expect(normalizePageToolExactOrigin('HTTPS://Example.COM:443/')).toBe('https://example.com')
    expect(normalizePageToolExactOrigin('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
    expect(normalizePageToolExactOrigin('https://example.com/path')).toBeNull()
    expect(normalizePageToolExactOrigin('https://user:secret@example.com')).toBeNull()
    expect(normalizePageToolExactOrigin('file:///tmp/tool')).toBeNull()
    expect(normalizePageToolExactOrigin('data:text/plain,test')).toBeNull()
  })

  it('canonically clones settings without mutating caller data', () => {
    const catalog = createPageToolFixtureCatalog()
    const callerSettings = { mode: 'temporary' }
    const input = {
      schemaVersion: 1,
      sites: {
        'HTTPS://Example.COM:443/': createSite(['tool-1', 'tool-0'], {
          'tool-1': { mode: 'second' },
          'tool-0': callerSettings,
        }),
      },
    }
    const output = unwrap(validatePageToolboxSettings(input, catalog))
    expect(Object.keys(output.sites)).toEqual(['https://example.com'])
    expect(output.sites['https://example.com'].enabledToolIds).toEqual(['tool-0', 'tool-1'])
    expect(Object.keys(output.sites['https://example.com'].toolSettings)).toEqual(['tool-0', 'tool-1'])
    expect(Object.isFrozen(output)).toBe(true)
    expect(Object.isFrozen(output.sites['https://example.com'].toolSettings['tool-0'])).toBe(true)
    callerSettings.mode = 'caller-mutated'
    expect(output.sites['https://example.com'].toolSettings['tool-0']).toEqual({ mode: 'temporary' })
  })

  it('creates an empty immutable default-off settings document', () => {
    const settings = createDefaultPageToolboxSettings()
    expect(settings).toEqual({ schemaVersion: 1, sites: {} })
    expect(Object.keys(settings.sites)).toEqual([])
    expect(Object.isFrozen(settings)).toBe(true)
    expect(Object.isFrozen(settings.sites)).toBe(true)
  })

  it('rejects hostile JSON shapes and never invokes accessors', () => {
    const catalog = createPageToolFixtureCatalog()
    const cyclic: Record<string, unknown> = { mode: 'cyclic' }
    cyclic.self = cyclic
    const invalidValues = [
      { mode: Number.NaN },
      { mode: () => 'code' },
      { mode: Symbol('code') },
      cyclic,
    ]
    for (const value of invalidValues) {
      expect(codeOf(validatePageToolboxSettings({
        schemaVersion: 1,
        sites: { 'https://example.test': createSite([], { 'tool-0': value }) },
      }, catalog))).toBe('invalid-json-value')
    }

    let getterCalled = false
    const hostile = Object.create(null)
    Object.defineProperty(hostile, 'mode', {
      enumerable: true,
      get() {
        getterCalled = true
        return 'code'
      },
    })
    expect(codeOf(canonicalizePageToolJson(hostile))).toBe('invalid-json-value')
    expect(getterCalled).toBe(false)
  })

  it('enforces site and tool cardinality boundaries', () => {
    const catalog = createPageToolFixtureCatalog(PAGE_TOOLBOX_MAX_TOOLS_PER_SITE + 1)
    const boundarySites = Object.fromEntries(Array.from(
      { length: PAGE_TOOLBOX_MAX_SITES },
      (_, index) => [`https://site-${index}.example`, createSite()],
    ))
    expect(validatePageToolboxSettings({ schemaVersion: 1, sites: boundarySites }, catalog).ok).toBe(true)
    boundarySites['https://site-overflow.example'] = createSite()
    expect(codeOf(validatePageToolboxSettings({ schemaVersion: 1, sites: boundarySites }, catalog))).toBe('site-limit')

    const boundaryToolIds = Array.from({ length: PAGE_TOOLBOX_MAX_TOOLS_PER_SITE }, (_, index) => `tool-${index}`)
    expect(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: { 'https://example.test': createSite(boundaryToolIds) },
    }, catalog).ok).toBe(true)
    expect(codeOf(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: { 'https://example.test': createSite([...boundaryToolIds, 'tool-16']) },
    }, catalog))).toBe('tool-limit')
  })

  it('enforces tool, site and total canonical UTF-8 byte quotas', () => {
    const catalog = createPageToolFixtureCatalog(6)
    const exactToolPayloadLength = PAGE_TOOLBOX_MAX_TOOL_SETTINGS_BYTES - JSON.stringify({ mode: '' }).length
    expect(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: {
        'https://boundary.example': createSite([], {
          'tool-0': { mode: 'x'.repeat(exactToolPayloadLength) },
        }),
      },
    }, catalog).ok).toBe(true)
    expect(codeOf(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: {
        'https://example.test': createSite([], { 'tool-0': { mode: 'x'.repeat(2 * 1024) } }),
      },
    }, catalog))).toBe('tool-settings-bytes-limit')

    const largeSiteSettings = Object.fromEntries(Array.from(
      { length: 5 },
      (_, index) => [`tool-${index}`, { mode: 'x'.repeat(1700) }],
    ))
    expect(codeOf(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: { 'https://example.test': createSite([], largeSiteSettings) },
    }, catalog))).toBe('site-settings-bytes-limit')

    const largeTotalSites = Object.fromEntries(Array.from(
      { length: 40 },
      (_, index) => [
        `https://site-${index}.example`,
        createSite([], { 'tool-0': { mode: 'x'.repeat(1700) } }),
      ],
    ))
    expect(codeOf(validatePageToolboxSettings({ schemaVersion: 1, sites: largeTotalSites }, catalog)))
      .toBe('total-settings-bytes-limit')
  })

  it('enforces depth and complete-document node quotas', () => {
    const nested: Record<string, unknown> = { mode: 'safe' }
    let cursor = nested
    for (let index = 0; index < 8; index += 1) {
      cursor.child = { mode: 'safe' }
      cursor = cursor.child as Record<string, unknown>
    }
    expect(codeOf(canonicalizePageToolJson(nested))).toBe('settings-depth-limit')
    expect(codeOf(canonicalizePageToolJson(Array.from(
      { length: PAGE_TOOLBOX_MAX_SETTINGS_NODES },
      () => null,
    )))).toBe('settings-node-limit')

    const descriptor = createRawPageToolDescriptor('quota-tool')
    const quotaCatalog = unwrap(createPageToolCatalog([descriptor], [{
      toolId: descriptor.id,
      schemaId: descriptor.settingsSchemaId,
      schemaVersion: 1,
      validate: () => true,
    }]))
    expect(codeOf(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: { 'https://example.test': createSite([], { 'quota-tool': nested }) },
    }, quotaCatalog))).toBe('settings-depth-limit')
    expect(codeOf(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: {
        'https://example.test': createSite([], {
          'quota-tool': Array.from({ length: PAGE_TOOLBOX_MAX_SETTINGS_NODES }, () => null),
        }),
      },
    }, quotaCatalog))).toBe('settings-node-limit')
  })

  it('rejects schema failures, unknown tools and normalized duplicate origins atomically', () => {
    const catalog = createPageToolFixtureCatalog()
    expect(codeOf(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: { 'https://example.test': createSite([], { 'tool-0': { mode: 1 } }) },
    }, catalog))).toBe('settings-schema-rejected')
    expect(codeOf(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: { 'https://example.test': createSite(['tool-unknown']) },
    }, catalog))).toBe('invalid-settings')
    expect(codeOf(validatePageToolboxSettings({
      schemaVersion: 1,
      sites: {
        'https://example.test': createSite(),
        'https://EXAMPLE.test:443/': createSite(),
      },
    }, catalog))).toBe('invalid-settings')
  })

  it('binds module, tool, exact origin, top frame, navigation and generation canonically', () => {
    const catalog = createPageToolFixtureCatalog()
    const binding = createPageToolFixtureBinding(catalog, { exactOrigin: 'HTTPS://Example.TEST:443/' })
    expect(binding).toMatchObject({
      moduleId: PAGE_TOOLBOX_MODULE_ID,
      toolId: 'tool-0',
      exactOrigin: 'https://example.test',
      frameId: 0,
      generation: 1,
    })
    expect(Object.isFrozen(binding)).toBe(true)
    expect(createPageToolAuthority(binding)).toEqual({
      bindingKey: JSON.stringify([1, PAGE_TOOLBOX_MODULE_ID, 'tool-0', 'https://example.test', 7, 0, 'navigation-1', 1]),
      generation: 1,
    })

    const base = { ...binding }
    const invalidBindings: unknown[] = [
      { ...base, moduleId: 'dev.remote.attacker' },
      { ...base, toolId: 'tool-unknown' },
      { ...base, exactOrigin: 'https://example.test/path' },
      { ...base, frameId: 1 },
      { ...base, navigationId: '' },
      { ...base, generation: 0 },
      { ...base, script: 'alert(1)' },
    ]
    for (const candidate of invalidBindings)
      expect(codeOf(validatePageToolRuntimeBinding(candidate, catalog))).toBe('invalid-binding')
  })

  it('leaves descriptor inputs unchanged when validation fails', () => {
    const descriptor = createRawPageToolDescriptor('tool-safe')
    const snapshot = structuredClone(descriptor)
    expect(validatePageToolDescriptor({
      ...descriptor,
      domAccess: ['read', 'read'],
    }, []).ok).toBe(false)
    expect(descriptor).toEqual(snapshot)
  })
})
