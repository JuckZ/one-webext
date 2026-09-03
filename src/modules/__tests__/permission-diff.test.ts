import type { RemoteFrameModuleManifest } from '../types'
import { diffModulePermissions } from '../permission-diff'
import { createRepoLensSeed } from '../seeds/repolens'

function baseManifest() {
  const manifest = createRepoLensSeed('https://repolens.example').manifest
  if (manifest.runtime !== 'remote-frame')
    throw new Error('RepoLens must remain a remote-frame test fixture')
  return manifest
}

function expandedManifest(base: RemoteFrameModuleManifest): RemoteFrameModuleManifest {
  return {
    ...base,
    entry_url: 'https://modules.example/repolens/embed',
    icon_url: 'https://modules.example/repolens/icon.png',
    matches: [...base.matches, 'https://example.com/*'],
    contexts: [...base.contexts, 'page.metadata'],
    context_fields: {
      ...base.context_fields,
      'page.metadata': ['title'],
    },
    capabilities: ['tabs.open'],
  }
}

describe('module permission diff', () => {
  it('requires reapproval for every expanded access dimension', () => {
    const base = baseManifest()
    const diff = diffModulePermissions(base, expandedManifest(base))

    expect(diff.entryOrigin).toEqual({
      previous: 'https://repolens.example',
      next: 'https://modules.example',
      changed: true,
    })
    expect(diff.matches.added).toEqual(['https://example.com/*'])
    expect(diff.contexts.added).toEqual(['page.metadata'])
    expect(diff.contextFields).toContainEqual({ contextId: 'page.metadata', added: ['title'], removed: [] })
    expect(diff.capabilities.added).toEqual(['tabs.open'])
    expect(diff.requiresReapproval).toBe(true)
    expect(diff.expansionReasons).toEqual([
      'entry-origin',
      'match-pattern',
      'context',
      'context-field',
      'capability',
    ])
  })

  it('does not require reapproval when an update only reduces access', () => {
    const base = baseManifest()
    const wide = {
      ...expandedManifest(base),
      entry_url: base.entry_url,
      icon_url: base.icon_url,
    }
    const diff = diffModulePermissions(wide, base)

    expect(diff.matches.removed).toEqual(['https://example.com/*'])
    expect(diff.contexts.removed).toEqual(['page.metadata'])
    expect(diff.contextFields).toContainEqual({ contextId: 'page.metadata', added: [], removed: ['title'] })
    expect(diff.capabilities.removed).toEqual(['tabs.open'])
    expect(diff.requiresReapproval).toBe(false)
    expect(diff.expansionReasons).toEqual([])
  })

  it('ignores copy and version changes when access is unchanged', () => {
    const base = baseManifest()
    const diff = diffModulePermissions(base, {
      ...base,
      name: 'RepoLens Next',
      version: '0.2.0',
      description: 'Updated product copy',
    })

    expect(diff.requiresReapproval).toBe(false)
    expect(diff.expansionReasons).toEqual([])
    expect(diff.contextFields).toEqual([])
  })
})
