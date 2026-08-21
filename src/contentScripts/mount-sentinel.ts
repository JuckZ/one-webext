const mountSentinel = Symbol.for(`${__NAME__}:content-script-mounted`)

type Cleanup = () => void
type RegisterCleanup = (_cleanup: Cleanup) => void

function claimContentScriptMount(scope: object) {
  const state = scope as Record<symbol, unknown>

  if (state[mountSentinel])
    return false

  Object.defineProperty(state, mountSentinel, { configurable: true, value: true })
  return true
}

function releaseContentScriptMount(scope: object) {
  Reflect.deleteProperty(scope, mountSentinel)
}

export function mountContentScriptOnce(
  mount: (_registerCleanup: RegisterCleanup) => void,
  scope: object = globalThis,
) {
  if (!claimContentScriptMount(scope))
    return false

  const cleanups: Cleanup[] = []

  try {
    mount(cleanup => cleanups.push(cleanup))
    return true
  }
  catch (error) {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup()
      }
      catch {
        // Preserve the original mount error while attempting every cleanup.
      }
    }

    releaseContentScriptMount(scope)
    throw error
  }
}
