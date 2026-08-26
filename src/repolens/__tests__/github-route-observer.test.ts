import { createGitHubRouteObserver } from '../github-route-observer'

describe('gitHub route observer', () => {
  it('debounces SPA events, removes exact duplicates and emits repository changes', async () => {
    vi.useFakeTimers()
    let href = 'https://github.com/vuejs/core'
    const contexts: string[] = []
    const observer = createGitHubRouteObserver({
      window,
      readHref: () => href,
      debounceMs: 100,
      emit(context) {
        contexts.push(`${context.repo}|${context.pageType}`)
      },
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(contexts).toEqual(['vuejs/core|repository'])

    window.history.replaceState({}, '', '/')
    window.dispatchEvent(new Event('turbo:load'))
    await vi.advanceTimersByTimeAsync(100)
    expect(contexts).toHaveLength(1)

    href = 'https://github.com/vuejs/core/issues'
    window.history.pushState({}, '', '/issues')
    window.history.replaceState({}, '', '/issues')
    await vi.advanceTimersByTimeAsync(100)
    expect(contexts).toEqual(['vuejs/core|repository', 'vuejs/core|issues'])

    href = 'https://github.com/facebook/react/pulls'
    observer.schedule()
    observer.schedule()
    await vi.advanceTimersByTimeAsync(100)
    expect(contexts.at(-1)).toBe('facebook/react|pulls')

    observer.destroy()
    vi.useRealTimers()
  })
})
