import {
  createPageToolboxControlResult,
  createPageToolboxControlToggle,
  createPageToolboxDispose,
  createPageToolboxDisposed,
  createPageToolboxHello,
  createPageToolboxInit,
  createPageToolboxInjectionAdapter,
  createPageToolboxManagementResponse,
  createPageToolboxReady,
  createPageToolboxSeed,
  createPageToolboxSync,
  createPageToolboxSynced,
  isPageToolboxManagementRequest,
  isPageToolboxManagementResponse,
  PAGE_TOOLBOX_CONTENT_SCRIPT_FILE,
  validatePageToolboxContentMessage,
  validatePageToolboxHostMessage,
} from '..'
import { validateModuleManifest } from '../../../manifest'

const challenge = '11'.repeat(24)
const sessionNonce = '22'.repeat(24)
const binding = {
  moduleId: 'dev.oneweb.page-toolbox' as const,
  exactOrigin: 'https://example.com',
  tabId: 7,
  frameId: 0 as const,
  navigationId: 'document:alpha',
  generation: 3,
}

describe('page Toolbox protocol and injection boundary', () => {
  it('defines an ordinary disabled builtin with no page access or capability grant', () => {
    const seed = createPageToolboxSeed()
    expect(seed.enabled).toBe(false)
    expect(seed.manifest).toMatchObject({
      runtime: 'builtin',
      id: 'dev.oneweb.page-toolbox',
      entry_id: 'page-toolbox',
      matches: [],
      contexts: [],
      context_fields: {},
      capabilities: [],
    })
    expect(seed.grantedContexts).toEqual([])
    expect(seed.grantedCapabilities).toEqual([])
    expect(validateModuleManifest(seed.manifest, { allowBuiltin: true })).toMatchObject({ ok: true })
  })

  it('constructs and validates exact lifecycle envelopes', () => {
    const hello = createPageToolboxHello(challenge)
    const tools = [{ toolId: 'free-page-edit', settings: { mode: 'rich-text' } }] as const
    const init = createPageToolboxInit(challenge, sessionNonce, binding, 1, tools)
    const ready = createPageToolboxReady(sessionNonce, binding, 1)
    const sync = createPageToolboxSync(sessionNonce, binding, 2, tools)
    const synced = createPageToolboxSynced(sessionNonce, binding, 2)
    const dispose = createPageToolboxDispose(sessionNonce, binding, 'navigation')
    const disposed = createPageToolboxDisposed(sessionNonce, binding)
    const toggle = createPageToolboxControlToggle(
      sessionNonce,
      binding,
      'shadow:3:alpha',
      'password-visibility',
      true,
    )
    const accepted = createPageToolboxControlResult(
      sessionNonce,
      binding,
      'shadow:3:alpha',
      'password-visibility',
      true,
      { ok: true, changed: true },
    )
    const rejected = createPageToolboxControlResult(
      sessionNonce,
      binding,
      'shadow:3:beta',
      'free-page-edit',
      false,
      { ok: false, reason: 'permission-missing' },
    )

    expect(validatePageToolboxContentMessage(hello)).toEqual(hello)
    expect(validatePageToolboxHostMessage(init)).toEqual(init)
    expect(validatePageToolboxContentMessage(ready)).toEqual(ready)
    expect(validatePageToolboxHostMessage(sync)).toEqual(sync)
    expect(validatePageToolboxContentMessage(synced)).toEqual(synced)
    expect(validatePageToolboxHostMessage(dispose)).toEqual(dispose)
    expect(validatePageToolboxContentMessage(disposed)).toEqual(disposed)
    expect(validatePageToolboxContentMessage(toggle)).toEqual(toggle)
    expect(validatePageToolboxHostMessage(accepted)).toEqual(accepted)
    expect(validatePageToolboxHostMessage(rejected)).toEqual(rejected)
  })

  it('rejects Shadow commands with identity replacement or any settings and DOM escape fields', () => {
    const toggle = createPageToolboxControlToggle(
      sessionNonce,
      binding,
      'shadow:3:alpha',
      'selection-copy-release',
      true,
    )
    for (const forged of [
      { ...toggle, moduleId: 'dev.oneweb.other' },
      { ...toggle, binding: { ...binding, generation: 0 } },
      { ...toggle, toolId: 'unknown' },
      { ...toggle, actionId: 'bad action id' },
      { ...toggle, settings: { selector: '*' } },
      { ...toggle, origin: 'https://evil.example' },
      { ...toggle, method: 'eval' },
    ]) {
      expect(validatePageToolboxContentMessage(forged)).toBeNull()
    }
    expect(validatePageToolboxContentMessage({ ...toggle, version: 2 })).toBeNull()
    expect(() => createPageToolboxControlResult(
      sessionNonce,
      binding,
      'shadow:3:alpha',
      'password-visibility',
      true,
      { ok: false, reason: 'unknown' as 'permission-missing' },
    )).toThrow(TypeError)
  })

  it('accepts only catalog-bound current-site tool management requests', () => {
    expect(isPageToolboxManagementRequest({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'password-visibility',
      enabled: true,
      settings: { gesture: 'double-click' },
    })).toBe(true)
    expect(isPageToolboxManagementRequest({
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
      toolId: 'password-visibility',
      enabled: false,
    })).toBe(true)
    for (const request of [
      {
        channel: 'oneweb.page-toolbox.management',
        version: 1,
        type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
        toolId: 'unknown',
        enabled: false,
      },
      {
        channel: 'oneweb.page-toolbox.management',
        version: 1,
        type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
        toolId: 'free-page-edit',
        enabled: true,
        settings: { mode: 'rich-text', selector: '*' },
      },
      {
        channel: 'oneweb.page-toolbox.management',
        version: 1,
        type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL',
        toolId: 'free-page-edit',
        enabled: false,
        settings: { mode: 'rich-text' },
      },
    ]) {
      expect(isPageToolboxManagementRequest(request)).toBe(false)
    }
  })

  it('accepts only finite current-site status and revisioned whole-settings envelopes', () => {
    const statusRequest = {
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_CONTROL_STATUS',
    } as const
    const replaceRequest = {
      channel: 'oneweb.page-toolbox.management',
      version: 1,
      type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS',
      expectedRevision: 4,
      siteSettings: {
        enabledToolIds: ['free-page-edit'],
        toolSettings: { 'free-page-edit': { mode: 'plain-text' } },
      },
    } as const
    expect(isPageToolboxManagementRequest(statusRequest)).toBe(true)
    expect(isPageToolboxManagementRequest(replaceRequest)).toBe(true)
    expect(isPageToolboxManagementRequest({ ...replaceRequest, origin: 'https://evil.example' })).toBe(false)
    expect(isPageToolboxManagementRequest({ ...replaceRequest, expectedRevision: -1 })).toBe(false)
    expect(isPageToolboxManagementRequest({
      ...replaceRequest,
      siteSettings: { enabledToolIds: [], toolSettings: {}, selector: '*' },
    })).toBe(false)

    const snapshot = {
      schemaVersion: 1 as const,
      revision: 5,
      pageTitle: '<b>safe text</b>',
      exactOrigin: 'https://example.com',
      access: 'ready' as const,
      siteSettings: replaceRequest.siteSettings,
    }
    expect(isPageToolboxManagementResponse(createPageToolboxManagementResponse(
      replaceRequest.type,
      { ok: true, operation: 'replace-site-settings', changed: true, synchronized: 1, snapshot },
    ))).toBe(true)
    expect(isPageToolboxManagementResponse(createPageToolboxManagementResponse(
      replaceRequest.type,
      { ok: false, operation: 'replace-site-settings', reason: 'revision-conflict', snapshot },
    ))).toBe(true)
    expect(isPageToolboxManagementResponse(createPageToolboxManagementResponse(
      replaceRequest.type,
      { ok: false, operation: 'replace-site-settings', reason: 'revision-conflict', snapshot: undefined as never },
    ))).toBe(false)
  })

  it('rejects short entropy, identity replacement, unknown fields and accessors', () => {
    expect(() => createPageToolboxHello('short')).toThrow(TypeError)
    expect(validatePageToolboxHostMessage({
      ...createPageToolboxInit(challenge, sessionNonce, binding),
      binding: { ...binding, exactOrigin: 'https://evil.example' },
      unexpected: true,
    })).toBeNull()
    expect(validatePageToolboxContentMessage({
      ...createPageToolboxReady(sessionNonce, binding),
      moduleId: 'dev.oneweb.other',
    })).toBeNull()
    const accessor = { ...createPageToolboxHello(challenge) }
    Object.defineProperty(accessor, 'challenge', { enumerable: true, get: () => challenge })
    expect(validatePageToolboxContentMessage(accessor)).toBeNull()
  })

  it('injects only one fixed packaged file into frame zero', async () => {
    const executeScript = vi.fn(async () => [])
    const adapter = createPageToolboxInjectionAdapter({ executeScript })
    await adapter.inject(12)
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 12, frameIds: [0] },
      files: [PAGE_TOOLBOX_CONTENT_SCRIPT_FILE],
    })
    expect(JSON.stringify(executeScript.mock.calls)).not.toContain('MAIN')
    await expect(adapter.inject(-1)).rejects.toThrow(TypeError)
    expect(executeScript).toHaveBeenCalledTimes(1)
  })
})
