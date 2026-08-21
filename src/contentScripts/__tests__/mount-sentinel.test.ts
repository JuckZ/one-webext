import { describe, expect, it } from 'vitest'
import { claimContentScriptMount } from '../mount-sentinel'

describe('content-script mount sentinel', () => {
  it('ignores page element ID collisions and blocks repeated injection', () => {
    const pageElement = document.createElement('div')
    pageElement.id = __NAME__
    document.body.appendChild(pageElement)

    const isolatedWorld = Object.create(null) as object

    expect(claimContentScriptMount(isolatedWorld)).toBe(true)
    expect(document.getElementById(__NAME__)).toBe(pageElement)
    expect(claimContentScriptMount(isolatedWorld)).toBe(false)
  })
})
