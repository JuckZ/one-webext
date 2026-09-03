import type { BrowserJournalObservation } from './contracts'

export interface BrowserJournalTab {
  id?: number
  windowId?: number
  active?: boolean
  incognito?: boolean
  title?: string
  url?: string
}

export interface BrowserJournalTabsBoundary {
  get: (_tabId: number) => Promise<BrowserJournalTab>
  onActivated: {
    addListener: (_listener: (_activeInfo: { tabId: number, windowId: number }) => void) => void
    removeListener: (_listener: (_activeInfo: { tabId: number, windowId: number }) => void) => void
  }
  onUpdated: {
    addListener: (_listener: (
      _tabId: number,
      _changeInfo: { status?: string, title?: string, url?: string },
      _tab: BrowserJournalTab,
    ) => void) => void
    removeListener: (_listener: (
      _tabId: number,
      _changeInfo: { status?: string, title?: string, url?: string },
      _tab: BrowserJournalTab,
    ) => void) => void
  }
}

export interface BrowserJournalEventSource {
  start: (_sink: (_observation: BrowserJournalObservation) => void) => void
  stop: () => void
}

export function createBrowserJournalTabEventSource(
  tabs: BrowserJournalTabsBoundary,
  now: () => string = () => new Date().toISOString(),
): BrowserJournalEventSource {
  let sink: ((_observation: BrowserJournalObservation) => void) | null = null

  const emitTab = (kind: BrowserJournalObservation['kind'], tabId: number, tab: BrowserJournalTab) => {
    sink?.({
      kind,
      tabId,
      windowId: tab.windowId,
      occurredAt: now(),
      active: tab.active,
      incognito: tab.incognito,
      title: tab.title,
      url: tab.url,
    })
  }

  const activated = (activeInfo: { tabId: number, windowId: number }) => {
    void tabs.get(activeInfo.tabId)
      .then(tab => emitTab('activation', activeInfo.tabId, tab))
      .catch(() => undefined)
  }
  const updated = (
    tabId: number,
    changeInfo: { status?: string, title?: string, url?: string },
    tab: BrowserJournalTab,
  ) => {
    if (!tab.active)
      return
    if (changeInfo.url === undefined && changeInfo.status !== 'complete')
      return
    emitTab('navigation', tabId, tab)
  }

  return {
    start(nextSink) {
      if (sink)
        return
      sink = nextSink
      tabs.onActivated.addListener(activated)
      tabs.onUpdated.addListener(updated)
    },
    stop() {
      if (!sink)
        return
      sink = null
      tabs.onActivated.removeListener(activated)
      tabs.onUpdated.removeListener(updated)
    },
  }
}
