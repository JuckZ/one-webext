import type { InstalledModuleRecord } from '../../../types'
import {
  SEND_TO_OPENLIST_CONTEXT_MENU_IDS,
  SendToOpenListContextMenuController,
} from '../context-menu'
import { createSendToOpenListSeed } from '../manifest'

function record(enabled: boolean): InstalledModuleRecord {
  return {
    manifest: createSendToOpenListSeed().manifest,
    enabled,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
    update: null,
    installedAt: 'installed',
    updatedAt: 'updated',
  }
}

describe('send to OpenList fixed context menus', () => {
  it('registers exactly three fixed gesture entries and follows module enablement', async () => {
    let created = false
    const menus = {
      create: vi.fn((properties) => {
        created = true
        return properties.id
      }),
      update: vi.fn(async (_id: string, _properties: { enabled: boolean }) => {
        if (!created)
          throw new Error('missing')
      }),
    }
    const discovery = { ingestContextCandidate: vi.fn() }
    const controller = new SendToOpenListContextMenuController(menus, discovery as never)
    await controller.initialize(false)
    expect(menus.create.mock.calls.map(([properties]) => properties)).toEqual([
      { id: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.page, title: '发送当前页面到 OpenList', contexts: ['page'], enabled: false },
      { id: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.link, title: '发送链接到 OpenList', contexts: ['link'], enabled: false },
      { id: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.media, title: '发送媒体地址到 OpenList', contexts: ['image', 'audio', 'video'], enabled: false },
    ])
    await controller.syncRecord(record(true))
    expect(menus.update).toHaveBeenCalledTimes(6)
    expect(menus.update.mock.calls.slice(-3).every(([, value]) => value.enabled)).toBe(true)
  })

  it('maps only fixed link/media/page fields and rejects foreign or incognito clicks', async () => {
    const ingestContextCandidate = vi.fn(async input => ({ ok: true, value: input }))
    const controller = new SendToOpenListContextMenuController(
      { create: properties => properties.id, update: async () => undefined },
      { ingestContextCandidate } as never,
    )
    await controller.handleClick(
      { menuItemId: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.link, linkUrl: 'https://cdn.example/a' },
      { title: '<script>text</script>' },
    )
    await controller.handleClick(
      { menuItemId: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.media, srcUrl: 'https://cdn.example/a.mp4' },
    )
    await controller.handleClick(
      { menuItemId: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.page, pageUrl: 'https://page.example/' },
    )
    expect(ingestContextCandidate.mock.calls.map(([input]) => input.source)).toEqual([
      'context-link',
      'context-media',
      'current-page',
    ])
    await expect(controller.handleClick({ menuItemId: 'foreign', linkUrl: 'https://evil.example' }))
      .resolves
      .toEqual({ ok: false, reason: 'discovery-empty' })
    await expect(controller.handleClick(
      { menuItemId: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.page, pageUrl: 'https://private.example' },
      { incognito: true },
    )).resolves.toEqual({ ok: false, reason: 'active-tab-unavailable' })
    expect(ingestContextCandidate).toHaveBeenCalledTimes(3)
  })
})
