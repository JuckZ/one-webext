import { RepoContextRegistry } from '../context-registry'

describe('repoContextRegistry', () => {
  it('deduplicates repeated navigation per tab and accepts repository switches', () => {
    const registry = new RepoContextRegistry()
    const vue = { repo: 'vuejs/core', url: 'https://github.com/vuejs/core', pageType: 'repository' }
    expect(registry.update(12, vue)).toEqual(vue)
    expect(registry.update(12, { ...vue })).toBeNull()
    expect(registry.update(12, { ...vue, url: 'https://github.com/vuejs/core/issues', pageType: 'issues' })).toEqual({
      repo: 'vuejs/core',
      url: 'https://github.com/vuejs/core/issues',
      pageType: 'issues',
    })
    expect(registry.update(12, { repo: 'facebook/react', url: 'https://github.com/facebook/react', pageType: 'repository' })?.repo).toBe('facebook/react')
    registry.remove(12)
    expect(registry.get(12)).toBeNull()
  })
})
