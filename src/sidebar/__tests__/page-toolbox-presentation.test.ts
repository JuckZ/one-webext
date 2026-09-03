import type {
  PageToolboxControlEvent,
  PageToolboxControlSnapshotV1,
  PageToolboxControlState,
} from '../page-toolbox-presentation'
import {
  createPageToolboxControlState,
  normalizePageToolboxDisplayText,
  PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION,
  PAGE_TOOLBOX_CONTROL_SURFACE_POLICY,
  presentPageToolboxControlState,
  reducePageToolboxControlState,
  validatePageToolboxControlSnapshot,
} from '../page-toolbox-presentation'

function snapshot(
  overrides: Partial<PageToolboxControlSnapshotV1> = {},
): PageToolboxControlSnapshotV1 {
  return {
    schemaVersion: PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION,
    revision: 7,
    pageTitle: 'Example <img data-title-xss src=x>',
    exactOrigin: 'https://example.com',
    access: 'ready',
    siteSettings: {
      enabledToolIds: ['password-visibility'],
      toolSettings: {
        'password-visibility': { gesture: 'double-click' },
      },
    },
    ...overrides,
  }
}

function loadReady(input: unknown = snapshot()): PageToolboxControlState {
  let state = createPageToolboxControlState()
  state = reducePageToolboxControlState(state, { type: 'load-started', requestId: 'load-1' })
  return reducePageToolboxControlState(state, {
    type: 'load-succeeded',
    requestId: 'load-1',
    snapshot: input,
  })
}

function editPassword(state: PageToolboxControlState, gesture: 'double-click' | 'triple-click') {
  return reducePageToolboxControlState(state, {
    type: 'edit-tool',
    toolId: 'password-visibility',
    enabled: true,
    settings: { gesture },
  })
}

describe('page Toolbox product control contract', () => {
  it.each([
    ['unsupported', null],
    ['module-disabled', 'https://example.com'],
    ['site-unapproved', 'https://example.com'],
  ] as const)('canonically validates the %s access state', (access, exactOrigin) => {
    const validated = validatePageToolboxControlSnapshot(snapshot({
      access,
      exactOrigin,
      siteSettings: null,
    }))

    expect(validated).toMatchObject({
      ok: true,
      value: { access, exactOrigin },
    })
  })

  it('requires a normalized exact origin and settings only for ready access', () => {
    expect(validatePageToolboxControlSnapshot(snapshot({
      exactOrigin: 'https://example.com/path',
    }))).toMatchObject({ ok: false, path: '$.exactOrigin' })
    expect(validatePageToolboxControlSnapshot(snapshot({
      access: 'site-unapproved',
    }))).toMatchObject({ ok: false, path: '$.siteSettings' })
    expect(validatePageToolboxControlSnapshot(snapshot({
      siteSettings: null,
    }))).toMatchObject({ ok: false, path: expect.stringContaining('siteSettings') })
  })

  it('rejects accessors, unknown fields, unsafe revisions and unknown tools', () => {
    const getter = { ...snapshot() } as Record<string, unknown>
    Object.defineProperty(getter, 'pageTitle', { enumerable: true, get: () => 'getter' })
    expect(validatePageToolboxControlSnapshot(getter)).toMatchObject({ ok: false, path: '$' })
    expect(validatePageToolboxControlSnapshot({ ...snapshot(), extra: true })).toMatchObject({ ok: false, path: '$' })
    expect(validatePageToolboxControlSnapshot({ ...snapshot(), revision: Number.MAX_SAFE_INTEGER + 1 }))
      .toMatchObject({ ok: false, path: '$.revision' })
    expect(validatePageToolboxControlSnapshot(snapshot({
      siteSettings: {
        enabledToolIds: ['remote-tool'],
        toolSettings: { 'remote-tool': {} },
      },
    }))).toMatchObject({ ok: false, path: expect.stringContaining('siteSettings') })
  })

  it('bounds hostile title text without interpreting markup', () => {
    const title = `<script>not html</script>\0\n${'界'.repeat(200)}`
    const normalized = normalizePageToolboxDisplayText(title)
    expect(normalized).toContain('<script>not html</script>')
    expect(normalized).not.toContain('\0')
    expect(Array.from(normalized!).length).toBe(160)

    const validated = validatePageToolboxControlSnapshot(snapshot({ pageTitle: title }))
    expect(validated.ok && validated.value.pageTitle).toBe(normalized)
  })

  it('canonically clones source settings and freezes accepted state', () => {
    const input = snapshot()
    const validated = validatePageToolboxControlSnapshot(input)
    expect(validated.ok).toBe(true)
    ;(input.siteSettings!.enabledToolIds as string[]).push('free-page-edit')
    ;(input.siteSettings!.toolSettings['password-visibility'] as { gesture: string }).gesture = 'triple-click'

    expect(validated.ok && validated.value.siteSettings).toEqual({
      enabledToolIds: ['password-visibility'],
      toolSettings: { 'password-visibility': { gesture: 'double-click' } },
    })
    expect(validated.ok && Object.isFrozen(validated.value)).toBe(true)
    expect(validated.ok && Object.isFrozen(validated.value.siteSettings)).toBe(true)
  })

  it('keeps sidebar and future Shadow surface authority distinct', () => {
    expect(PAGE_TOOLBOX_CONTROL_SURFACE_POLICY['trusted-sidebar']).toEqual({
      canRequestSiteApproval: true,
      canPersistSettings: true,
      authority: 'host-derived-current-site',
    })
    expect(PAGE_TOOLBOX_CONTROL_SURFACE_POLICY['page-shadow']).toEqual({
      canRequestSiteApproval: false,
      canPersistSettings: false,
      authority: 'authenticated-generation-convenience',
    })
  })
})

describe('page Toolbox pure presentation and reducer', () => {
  it('projects exactly three default-off finite controls before a site is ready', () => {
    let state = createPageToolboxControlState()
    let view = presentPageToolboxControlState(state)
    expect(view).toMatchObject({
      surface: 'trusted-sidebar',
      state: 'idle',
      canEdit: false,
      canSave: false,
    })
    expect(view.tools.map(tool => [tool.toolId, tool.enabled, tool.defaultEnabled])).toEqual([
      ['password-visibility', false, false],
      ['free-page-edit', false, false],
      ['selection-copy-release', false, false],
    ])

    state = loadReady(snapshot({ access: 'site-unapproved', siteSettings: null }))
    view = presentPageToolboxControlState(state)
    expect(view.state).toBe('site-unapproved')
    expect(view.tools.every(tool => !tool.canEdit && !tool.enabled)).toBe(true)
    expect(view.tools[0]!.settings[0]).toMatchObject({
      kind: 'choice',
      key: 'gesture',
      value: 'double-click',
      options: [
        { value: 'double-click', label: '双击' },
        { value: 'triple-click', label: '三击' },
      ],
    })
  })

  it('replaces load authority and ignores late or invalid request IDs', () => {
    const initial = createPageToolboxControlState()
    expect(reducePageToolboxControlState(initial, { type: 'load-started', requestId: 'bad id' })).toBe(initial)

    const first = reducePageToolboxControlState(initial, { type: 'load-started', requestId: 'load-1' })
    const second = reducePageToolboxControlState(first, { type: 'load-started', requestId: 'load-2' })
    const late = reducePageToolboxControlState(second, {
      type: 'load-succeeded',
      requestId: 'load-1',
      snapshot: snapshot(),
    })
    expect(late).toBe(second)
    expect(presentPageToolboxControlState(second).state).toBe('loading')
  })

  it('edits only packaged schemas and keeps source events immutable', () => {
    const loaded = loadReady()
    const settings = { gesture: 'triple-click' as 'double-click' | 'triple-click' }
    const edited = reducePageToolboxControlState(loaded, {
      type: 'edit-tool',
      toolId: 'password-visibility',
      enabled: true,
      settings,
    })
    settings.gesture = 'double-click'

    expect(edited).not.toBe(loaded)
    expect(edited.draft?.toolSettings['password-visibility']).toEqual({ gesture: 'triple-click' })
    expect(edited.dirty).toBe(true)
    expect(presentPageToolboxControlState(edited)).toMatchObject({
      state: 'ready',
      canSave: true,
      dirty: true,
    })

    const arbitraryTool = reducePageToolboxControlState(
      edited,
      { type: 'edit-tool', toolId: 'remote-script', enabled: true, settings: {} } as unknown as PageToolboxControlEvent,
    )
    expect(arbitraryTool).toBe(edited)
    const arbitrarySetting = reducePageToolboxControlState(edited, {
      type: 'edit-tool',
      toolId: 'password-visibility',
      enabled: true,
      settings: { gesture: 'hover' },
    } as unknown as PageToolboxControlEvent)
    expect(arbitrarySetting).toMatchObject({ phase: 'error', errorCode: 'settings-rejected' })
    expect(arbitrarySetting.draft).toBe(edited.draft)
  })

  it('discards a draft back to the accepted canonical snapshot', () => {
    const loaded = loadReady()
    const edited = editPassword(loaded, 'triple-click')
    const discarded = reducePageToolboxControlState(edited, { type: 'discard-draft' })

    expect(discarded).toMatchObject({ phase: 'ready', dirty: false, errorCode: null })
    expect(discarded.draft?.toolSettings['password-visibility']).toEqual({ gesture: 'double-click' })
  })

  it('binds a save to the loaded revision and accepts only its exact draft', () => {
    const edited = editPassword(loadReady(), 'triple-click')
    const saving = reducePageToolboxControlState(edited, { type: 'save-started', requestId: 'save-1' })
    expect(saving).toMatchObject({
      phase: 'saving',
      pending: { kind: 'save', requestId: 'save-1', baseRevision: 7 },
    })

    const saved = reducePageToolboxControlState(saving, {
      type: 'save-succeeded',
      requestId: 'save-1',
      snapshot: snapshot({ revision: 8, siteSettings: saving.draft }),
    })
    expect(saved).toMatchObject({ phase: 'ready', dirty: false, pending: null })
    expect(saved.snapshot?.revision).toBe(8)

    const late = reducePageToolboxControlState(saved, {
      type: 'save-failed',
      requestId: 'save-1',
      errorCode: 'save-failed',
    })
    expect(late).toBe(saved)
  })

  it.each([
    ['wrong revision', snapshot({ revision: 9 })],
    ['wrong origin', snapshot({ revision: 8, exactOrigin: 'https://other.example' })],
    ['replaced settings', snapshot({ revision: 8 })],
  ])('marks a %s save result stale instead of replacing authority', (_label, response) => {
    const edited = editPassword(loadReady(), 'triple-click')
    const saving = reducePageToolboxControlState(edited, { type: 'save-started', requestId: 'save-stale' })
    const stale = reducePageToolboxControlState(saving, {
      type: 'save-succeeded',
      requestId: 'save-stale',
      snapshot: response,
    })

    expect(stale).toMatchObject({ phase: 'stale', pending: null })
    expect(stale.snapshot?.revision).toBe(7)
    expect(presentPageToolboxControlState(stale)).toMatchObject({
      state: 'stale',
      canEdit: false,
      canSave: false,
    })
  })

  it('makes conflict or a newer observed revision first-terminal-wins', () => {
    const edited = editPassword(loadReady(), 'triple-click')
    const saving = reducePageToolboxControlState(edited, { type: 'save-started', requestId: 'save-conflict' })
    const stale = reducePageToolboxControlState(saving, {
      type: 'revision-observed',
      revision: 12,
    })
    expect(stale).toMatchObject({ phase: 'stale', staleRevision: 12, pending: null })

    const lateSuccess = reducePageToolboxControlState(stale, {
      type: 'save-succeeded',
      requestId: 'save-conflict',
      snapshot: snapshot({ revision: 8, siteSettings: saving.draft }),
    })
    expect(lateSuccess).toBe(stale)

    const savingAgain = reducePageToolboxControlState(edited, { type: 'save-started', requestId: 'save-conflict-2' })
    expect(reducePageToolboxControlState(savingAgain, {
      type: 'save-conflicted',
      requestId: 'save-conflict-2',
      revision: 13,
    })).toMatchObject({ phase: 'stale', staleRevision: 13 })
  })

  it('uses fixed failure presentation and can recover only through a new load or discard', () => {
    let state = createPageToolboxControlState()
    state = reducePageToolboxControlState(state, { type: 'load-started', requestId: 'load-fail' })
    state = reducePageToolboxControlState(state, {
      type: 'load-failed',
      requestId: 'load-fail',
      errorCode: 'load-failed',
    })
    expect(state).toMatchObject({ phase: 'error', errorCode: 'load-failed' })
    expect(presentPageToolboxControlState(state)).toMatchObject({
      state: 'error',
      message: '操作失败；当前草稿未获得新的保存权威。',
    })

    const recovered = loadReady()
    const edited = editPassword(recovered, 'triple-click')
    const saving = reducePageToolboxControlState(edited, { type: 'save-started', requestId: 'save-fail' })
    const failed = reducePageToolboxControlState(saving, {
      type: 'save-failed',
      requestId: 'save-fail',
      errorCode: 'save-failed',
    })
    expect(failed).toMatchObject({ phase: 'error', dirty: true, errorCode: 'save-failed' })
    expect(reducePageToolboxControlState(failed, { type: 'discard-draft' }))
      .toMatchObject({ phase: 'ready', dirty: false, errorCode: null })
  })

  it('keeps reducer instances and their drafts isolated', () => {
    const alpha = editPassword(loadReady(snapshot({ exactOrigin: 'https://alpha.example' })), 'triple-click')
    const beta = loadReady(snapshot({
      exactOrigin: 'https://beta.example',
      pageTitle: 'Beta',
      revision: 2,
    }))

    expect(alpha.draft?.toolSettings['password-visibility']).toEqual({ gesture: 'triple-click' })
    expect(beta.draft?.toolSettings['password-visibility']).toEqual({ gesture: 'double-click' })
    expect(alpha.snapshot?.exactOrigin).toBe('https://alpha.example')
    expect(beta.snapshot?.exactOrigin).toBe('https://beta.example')
    expect(beta).toMatchObject({ phase: 'ready', dirty: false })
  })
})
