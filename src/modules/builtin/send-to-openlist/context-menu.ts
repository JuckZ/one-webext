import type { InstalledModuleRecord } from '../../types'
import type {
  SendToOpenListDiscoveryController,
  SendToOpenListDiscoveryTab,
} from './discovery'
import { SEND_TO_OPENLIST_MODULE_ID } from './contracts'

export const SEND_TO_OPENLIST_CONTEXT_MENU_IDS = {
  page: 'oneweb.send-to-openlist.page',
  link: 'oneweb.send-to-openlist.link',
  media: 'oneweb.send-to-openlist.media',
} as const

export interface SendToOpenListContextMenuInfo {
  readonly menuItemId: string | number
  readonly pageUrl?: string
  readonly linkUrl?: string
  readonly srcUrl?: string
}

export interface SendToOpenListContextMenusBoundary {
  create: (_properties: {
    id: string
    title: string
    contexts: string[]
    enabled: boolean
  }) => string | number
  update: (_id: string, _properties: { enabled: boolean }) => Promise<void>
}

export class SendToOpenListContextMenuController {
  private initialized = false

  constructor(
    private readonly _menus: SendToOpenListContextMenusBoundary,
    private readonly _discovery: SendToOpenListDiscoveryController,
  ) {}

  async initialize(enabled: boolean): Promise<void> {
    if (this.initialized)
      return this.sync(enabled)
    const definitions = [
      { id: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.page, title: '发送当前页面到 OpenList', contexts: ['page'] },
      { id: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.link, title: '发送链接到 OpenList', contexts: ['link'] },
      { id: SEND_TO_OPENLIST_CONTEXT_MENU_IDS.media, title: '发送媒体地址到 OpenList', contexts: ['image', 'audio', 'video'] },
    ]
    await Promise.all(definitions.map(async (definition) => {
      try {
        await this._menus.update(definition.id, { enabled })
      }
      catch {
        try {
          this._menus.create({ ...definition, enabled })
        }
        catch {
          await this._menus.update(definition.id, { enabled })
        }
      }
    }))
    this.initialized = true
  }

  async sync(enabled: boolean): Promise<void> {
    if (!this.initialized)
      return this.initialize(enabled)
    await Promise.all(Object.values(SEND_TO_OPENLIST_CONTEXT_MENU_IDS).map(id => (
      this._menus.update(id, { enabled }).catch(() => undefined)
    )))
  }

  syncRecord(record: InstalledModuleRecord) {
    if (record.manifest.id === SEND_TO_OPENLIST_MODULE_ID)
      return this.sync(record.enabled)
    return Promise.resolve()
  }

  async handleClick(info: SendToOpenListContextMenuInfo, tab?: SendToOpenListDiscoveryTab) {
    if (tab?.incognito)
      return { ok: false as const, reason: 'active-tab-unavailable' as const }
    const id = String(info.menuItemId)
    if (id === SEND_TO_OPENLIST_CONTEXT_MENU_IDS.link && info.linkUrl) {
      return this._discovery.ingestContextCandidate({
        url: info.linkUrl,
        source: 'context-link',
        ...(tab?.title ? { title: tab.title } : {}),
      })
    }
    if (id === SEND_TO_OPENLIST_CONTEXT_MENU_IDS.media && info.srcUrl) {
      return this._discovery.ingestContextCandidate({
        url: info.srcUrl,
        source: 'context-media',
        ...(tab?.title ? { title: tab.title } : {}),
      })
    }
    if (id === SEND_TO_OPENLIST_CONTEXT_MENU_IDS.page && (info.pageUrl || tab?.url)) {
      return this._discovery.ingestContextCandidate({
        url: info.pageUrl || tab!.url!,
        source: 'current-page',
        ...(tab?.title ? { title: tab.title } : {}),
      })
    }
    return { ok: false as const, reason: 'discovery-empty' as const }
  }
}
