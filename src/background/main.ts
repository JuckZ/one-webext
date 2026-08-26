import type { Runtime } from 'webextension-polyfill'
import { RepoContextRegistry } from '~/repolens/context-registry'
import { isExtensionMessage, normalizeRepoContext, parseGitHubContext } from '~/repolens/protocol'
import type {
  PanelContextMessage,
  RepoContext,
} from '~/repolens/protocol'

const registry = new RepoContextRegistry()

async function activeTabContext() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id)
    return null
  const stored = registry.get(tab.id)
  if (stored)
    return { tabId: tab.id, context: stored }
  const parsed = tab.url ? parseGitHubContext(tab.url) : null
  if (!parsed)
    return null
  registry.update(tab.id, parsed)
  return { tabId: tab.id, context: parsed }
}

async function broadcastContext(tabId: number, context: RepoContext | null) {
  if (!context)
    return
  const message: PanelContextMessage = {
    channel: 'repolens.extension',
    version: 1,
    type: 'PANEL_CONTEXT',
    tabId,
    context,
  }
  await browser.runtime.sendMessage(message).catch(() => undefined)
}

async function updateTabContext(tabId: number, href: string | undefined) {
  if (!href)
    return
  const parsed = parseGitHubContext(href)
  if (!parsed)
    return
  const context = registry.update(tabId, parsed)
  if (context)
    await broadcastContext(tabId, context)
}

browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
  if (!isExtensionMessage(message))
    return undefined

  if (message.type === 'GITHUB_CONTEXT') {
    const tabId = sender.tab?.id
    let senderIsGitHub = false
    try {
      senderIsGitHub = new URL(sender.url || '').origin === 'https://github.com'
    }
    catch {}
    if (tabId === undefined || !senderIsGitHub)
      return undefined
    const incoming = normalizeRepoContext(message.context)
    if (!incoming)
      return undefined
    const context = registry.update(tabId, incoming)
    if (!context)
      return undefined
    void broadcastContext(tabId, context)
    return undefined
  }

  if (message.type === 'PANEL_READY') {
    return activeTabContext().then((active) => {
      if (!active)
        return null
      return {
        channel: 'repolens.extension',
        version: 1,
        type: 'PANEL_CONTEXT',
        ...active,
      } satisfies PanelContextMessage
    })
  }

  return undefined
})

browser.tabs.onActivated.addListener(async () => {
  const active = await activeTabContext()
  if (active)
    await broadcastContext(active.tabId, active.context)
})

// Firefox MV3 event pages may be suspended between messages. URL updates provide a
// navigation-level fallback; the content script remains responsible for SPA signals.
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const href = changeInfo.url || (changeInfo.status === 'complete' ? tab.url : undefined)
  if (href)
    void updateTabContext(tabId, href)
})

browser.tabs.onRemoved.addListener(tabId => registry.remove(tabId))

if (!__FIREFOX__ && typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined)
}
