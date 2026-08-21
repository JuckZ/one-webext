import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountContentScriptOnce } from '../mount-sentinel'

describe('content-script mount sentinel', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('ignores page element ID collisions and blocks repeated injection', () => {
    const pageElement = document.createElement('div')
    pageElement.id = __NAME__
    document.body.appendChild(pageElement)

    const isolatedWorld = Object.create(null) as object
    const mount = vi.fn()

    expect(mountContentScriptOnce(mount, isolatedWorld)).toBe(true)
    expect(document.getElementById(__NAME__)).toBe(pageElement)
    expect(mountContentScriptOnce(mount, isolatedWorld)).toBe(false)
    expect(mount).toHaveBeenCalledOnce()
  })

  it('cleans up and allows a retry after a mount failure', () => {
    const isolatedWorld = Object.create(null) as object
    const cleanup = vi.fn()
    const mountError = new Error('mount failed')

    expect(() => mountContentScriptOnce((registerCleanup) => {
      registerCleanup(cleanup)
      throw mountError
    }, isolatedWorld)).toThrow(mountError)
    expect(cleanup).toHaveBeenCalledOnce()

    const retry = vi.fn()
    expect(mountContentScriptOnce(retry, isolatedWorld)).toBe(true)
    expect(retry).toHaveBeenCalledOnce()
  })
})
