import { ContextBroker, createDefaultContextBroker } from '../context-broker'
import { githubRepositoryProvider } from '../providers/github-repository'

describe('context broker', () => {
  it('accepts only provider-approved sources and deduplicates per-tab updates', () => {
    const broker = createDefaultContextBroker()
    const context = { repo: 'vuejs/core', url: 'https://github.com/vuejs/core', pageType: 'repository' }

    expect(broker.updateFromSource(12, 'github.repository', context, 'https://evil.example')).toBeNull()
    expect(broker.updateFromSource(12, 'github.repository', context, 'https://github.com/vuejs/core')?.contexts).toEqual({
      'github.repository': context,
    })
    expect(broker.updateFromSource(12, 'github.repository', { ...context }, 'https://github.com/vuejs/core')).toBeNull()
    expect(broker.updateFromSource(12, 'github.repository', {
      ...context,
      url: 'https://github.com/vuejs/core/issues',
      pageType: 'issues',
    }, 'https://github.com/vuejs/core/issues')?.revision).toBe('2')
    expect(broker.updateFromSource(12, 'github.repository', null, 'https://github.com/settings/profile')?.contexts).toEqual({})
  })

  it('uses URL providers as a navigation fallback and clears stale site context', () => {
    const broker = createDefaultContextBroker()
    expect(broker.updateFromUrl(7, 'https://github.com/facebook/react/pulls')?.contexts['github.repository']).toMatchObject({
      repo: 'facebook/react',
      pageType: 'pulls',
    })
    expect(broker.updateFromUrl(7, 'https://example.com/')?.contexts).toEqual({})
    expect(broker.updateFromUrl(7, 'https://example.com/')).toBeNull()
  })

  it('normalizes snapshots through registered providers and drops unknown or malformed values', () => {
    const broker = new ContextBroker([githubRepositoryProvider])
    const snapshot = broker.normalizeSnapshot(3, {
      'github.repository': {
        repo: 'vuejs/core',
        url: 'https://github.com/vuejs/core',
        pageType: 'repository',
        privateBody: 'must-not-pass',
      },
      'page.metadata': { title: 'forged' },
    })
    expect(snapshot?.contexts).toEqual({
      'github.repository': {
        repo: 'vuejs/core',
        url: 'https://github.com/vuejs/core',
        pageType: 'repository',
      },
    })
  })
})
