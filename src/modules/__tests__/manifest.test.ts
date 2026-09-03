import { validateModuleManifest } from '../manifest'

function remoteManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifest_version: 1,
    runtime: 'remote-frame',
    id: 'dev.juck.example',
    name: 'Example',
    version: '1.2.3',
    description: 'Example OneWeb module',
    icon_url: 'https://module.example/icon.png',
    entry_url: 'https://module.example/embed',
    matches: ['https://example.com/*'],
    contexts: ['tab.basic'],
    context_fields: { 'tab.basic': ['url'] },
    capabilities: ['tabs.open'],
    activation: 'manual',
    min_host_version: '0.0.1',
    bridge: { protocol: 'oneweb.module', version: 1 },
    ...overrides,
  }
}

describe('module manifest validation', () => {
  it('normalizes a valid remote-frame manifest', () => {
    const result = validateModuleManifest(remoteManifest())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.manifest.id).toBe('dev.juck.example')
      expect(result.manifest.contexts).toEqual(['tab.basic'])
      expect(result.manifest.context_fields).toEqual({ 'tab.basic': ['url'] })
      expect(result.manifest.capabilities).toEqual(['tabs.open'])
    }
    const missingFields = validateModuleManifest(remoteManifest({ context_fields: {} }))
    expect(missingFields.ok).toBe(false)
    if (!missingFields.ok)
      expect(missingFields.issues).toContain('context_fields.tab.basic is required')
  })

  it('allows explicit localhost modules but rejects insecure remote origins', () => {
    expect(validateModuleManifest(remoteManifest({
      icon_url: 'http://127.0.0.1:4747/icon.png',
      entry_url: 'http://127.0.0.1:4747/embed',
    })).ok).toBe(true)
    const insecure = validateModuleManifest(remoteManifest({
      icon_url: 'http://module.example/icon.png',
      entry_url: 'http://module.example/embed',
    }))
    expect(insecure.ok).toBe(false)
    if (!insecure.ok)
      expect(insecure.issues).toContain('entry_url must use HTTPS or an explicit localhost HTTP origin')
  })

  it('rejects origin changes, unsupported access and a forged protocol', () => {
    const result = validateModuleManifest(remoteManifest({
      icon_url: 'https://cdn.example/icon.png',
      contexts: ['tab.basic', 'page.body'],
      context_fields: { 'tab.basic': ['url', 'cookies'] },
      capabilities: ['tabs.open', 'browser.call'],
      bridge: { protocol: 'evil.module', version: 1 },
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContain('icon_url and entry_url must use the same origin')
      expect(result.issues).toContain('contexts contains unsupported value: page.body')
      expect(result.issues).toContain('context_fields.tab.basic contains unsupported field: cookies')
      expect(result.issues).toContain('capabilities contains unsupported value: browser.call')
      expect(result.issues).toContain('bridge.protocol must be oneweb.module')
    }
  })

  it('rejects builtin capabilities from remote modules', () => {
    const remote = validateModuleManifest(remoteManifest({
      capabilities: ['bookmarks.read', 'bookmarks.write', 'clash.status.read'],
    }))
    expect(remote).toMatchObject({ ok: false })
    if (!remote.ok) {
      expect(remote.issues).toContain('capabilities contains unsupported value: bookmarks.read')
      expect(remote.issues).toContain('capabilities contains unsupported value: bookmarks.write')
      expect(remote.issues).toContain('capabilities contains unsupported value: clash.status.read')
    }
  })

  it('reserves builtin manifests for packaged OneWeb code', () => {
    const builtin = {
      manifest_version: 1,
      runtime: 'builtin',
      id: 'dev.juck.bookmark-doctor',
      name: 'Bookmark Doctor',
      version: '0.1.0',
      description: 'Local bookmark maintenance',
      icon_path: '/assets/bookmark-doctor.png',
      entry_id: 'bookmark-doctor',
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: ['bookmarks.read'],
      activation: 'manual',
      min_host_version: '0.0.1',
    }
    expect(validateModuleManifest(builtin).ok).toBe(false)
    const allowed = validateModuleManifest(builtin, { allowBuiltin: true })
    expect(allowed).toMatchObject({
      ok: true,
      manifest: {
        runtime: 'builtin',
        matches: [],
        contexts: [],
        capabilities: ['bookmarks.read'],
      },
    })

    const remoteWithoutMatches = validateModuleManifest(remoteManifest({ matches: [] }))
    expect(remoteWithoutMatches).toMatchObject({ ok: false })
    if (!remoteWithoutMatches.ok)
      expect(remoteWithoutMatches.issues).toContain('remote-frame matches must contain at least one match pattern')
  })
})
