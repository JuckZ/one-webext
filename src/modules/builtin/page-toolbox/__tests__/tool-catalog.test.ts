import {
  PAGE_TOOL_CATALOG,
  PAGE_TOOL_IDS,
  validatePageToolPlans,
  validatePageToolSettingsValue,
} from '..'

describe('page Toolbox packaged tool catalog', () => {
  it('contains only the three reviewed default-off exact-origin descriptors', () => {
    expect(Object.keys(PAGE_TOOL_CATALOG)).toEqual([...PAGE_TOOL_IDS])
    for (const entry of Object.values(PAGE_TOOL_CATALOG)) {
      expect(entry.descriptor).toMatchObject({
        siteScope: 'user-approved-exact-http-origin',
        requiredSiteGrant: 'exact-origin',
        frames: 'top',
        defaultEnabled: false,
        requiresMainWorld: false,
      })
      expect(Object.keys(entry.descriptor)).not.toEqual(expect.arrayContaining([
        'selector',
        'script',
        'expression',
        'url',
        'method',
      ]))
    }
  })

  it('accepts only exact finite tool-specific settings', () => {
    expect(validatePageToolSettingsValue('password-visibility', { gesture: 'double-click' }, PAGE_TOOL_CATALOG).ok)
      .toBe(true)
    expect(validatePageToolSettingsValue('free-page-edit', { mode: 'plain-text' }, PAGE_TOOL_CATALOG).ok)
      .toBe(true)
    expect(validatePageToolSettingsValue('selection-copy-release', {
      selection: true,
      copy: false,
      contextMenu: true,
    }, PAGE_TOOL_CATALOG).ok).toBe(true)

    for (const [toolId, settings] of [
      ['password-visibility', { gesture: 'hover' }],
      ['free-page-edit', { mode: 'rich-text', html: '<b>unsafe</b>' }],
      ['selection-copy-release', { selection: true, copy: true, contextMenu: true, event: 'keydown' }],
      ['unknown-tool', {}],
    ] as const) {
      expect(validatePageToolSettingsValue(toolId, settings, PAGE_TOOL_CATALOG).ok).toBe(false)
    }
  })

  it('canonically clones, sorts and isolates plans while rejecting duplicates and accessors', () => {
    const input = [
      { toolId: 'selection-copy-release', settings: { selection: true, copy: true, contextMenu: false } },
      { toolId: 'password-visibility', settings: { gesture: 'triple-click' } },
    ]
    const validated = validatePageToolPlans(input, PAGE_TOOL_CATALOG)
    expect(validated).toMatchObject({
      ok: true,
      value: [{ toolId: 'password-visibility' }, { toolId: 'selection-copy-release' }],
    })
    input[0].toolId = 'forged'
    expect(validated.ok && validated.value[1].toolId).toBe('selection-copy-release')

    expect(validatePageToolPlans([
      { toolId: 'password-visibility', settings: { gesture: 'double-click' } },
      { toolId: 'password-visibility', settings: { gesture: 'triple-click' } },
    ], PAGE_TOOL_CATALOG).ok).toBe(false)
    const accessor = { toolId: 'password-visibility', settings: { gesture: 'double-click' } }
    Object.defineProperty(accessor, 'settings', { enumerable: true, get: () => ({ gesture: 'double-click' }) })
    expect(validatePageToolPlans([accessor], PAGE_TOOL_CATALOG).ok).toBe(false)
  })
})
