const mountSentinel = Symbol.for(`${__NAME__}:content-script-mounted`)

export function claimContentScriptMount(scope: object = globalThis) {
  const state = scope as Record<symbol, unknown>

  if (state[mountSentinel])
    return false

  Object.defineProperty(state, mountSentinel, { value: true })
  return true
}
