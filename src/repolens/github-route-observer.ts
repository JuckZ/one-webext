import { contextKey, parseGitHubContext, type RepoContext } from './protocol'

interface RouteObserverOptions {
  window: Window
  readHref?: () => string
  debounceMs?: number
  emit: (_context: RepoContext) => void | Promise<void>
}

export function createGitHubRouteObserver({ window, readHref = () => window.location.href, debounceMs = 180, emit }: RouteObserverOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastKey = ''

  const flush = async () => {
    timer = undefined
    const context = parseGitHubContext(readHref())
    if (!context)
      return
    const key = contextKey(context)
    if (key === lastKey)
      return
    lastKey = key
    await emit(context)
  }

  const schedule = () => {
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => void flush(), debounceMs)
  }

  const originalPushState = window.history.pushState.bind(window.history)
  const originalReplaceState = window.history.replaceState.bind(window.history)
  window.history.pushState = function (...args) {
    originalPushState(...args)
    schedule()
  }
  window.history.replaceState = function (...args) {
    originalReplaceState(...args)
    schedule()
  }

  window.addEventListener('popstate', schedule)
  window.addEventListener('turbo:load', schedule)
  window.addEventListener('pjax:end', schedule)
  schedule()

  return {
    flush,
    schedule,
    destroy() {
      if (timer)
        clearTimeout(timer)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
      window.removeEventListener('popstate', schedule)
      window.removeEventListener('turbo:load', schedule)
      window.removeEventListener('pjax:end', schedule)
    },
  }
}
