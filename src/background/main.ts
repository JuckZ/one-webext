import type { Runtime } from 'webextension-polyfill'
import {
  BookmarkDoctorController,
  BookmarkDoctorReader,
  BookmarkScanCoordinator,
  BookmarkUrlProbe,
  createBookmarkDoctorResponse,
  createBookmarkDoctorStateStore,
  createBrowserBookmarkMutationBoundary,
  createBrowserBookmarkTreeReader,
  isBookmarkDoctorRequest,
} from '~/modules/builtin/bookmark-doctor'
import {
  BrowserJournalController,
  createBrowserJournalArchiveStore,
  createBrowserJournalResponse,
  createBrowserJournalTabEventSource,
  isBrowserJournalRequest,
} from '~/modules/builtin/browser-journal'
import {
  ClashControlController,
  createClashControllerProfileStore,
  createClashControlResponse,
  isClashControlRequest,
} from '~/modules/builtin/clash-control'
import { BuiltinExactOriginUsageCoordinator } from '~/modules/builtin/origin-usage'
import {
  createPageToolboxInjectionAdapter,
  createPageToolboxStateStore,
  isPageToolboxManagementRequest,
  PageToolboxController,
  type PageToolboxHostPort,
  type PageToolboxScriptingApi,
} from '~/modules/builtin/page-toolbox'
import {
  createSendToOpenListProfileStore,
  createSendToOpenListResponse,
  isSendToOpenListRequest,
  SendToOpenListController,
} from '~/modules/builtin/send-to-openlist'
import { type ContextSnapshot, createDefaultContextBroker } from '~/modules/context-broker'
import {
  createContextSnapshotMessage,
  isContextRuntimeMessage,
} from '~/modules/context-protocol'
import { defaultModuleRegistry, initializeDefaultModuleRegistry } from '~/modules/default-registry'
import { ModuleInstaller } from '~/modules/installer'
import {
  isModuleManagementRequest,
  isTrustedModuleManagementSender,
} from '~/modules/management-protocol'
import { ModuleManager } from '~/modules/manager'
import { StorageModuleAdapter } from '~/modules/storage-module-adapter'
import { StorageModuleController } from '~/modules/storage-module-controller'
import { validateStorageModuleProtocolRequest } from '~/modules/storage-module-protocol'

const contextBroker = createDefaultContextBroker()
const builtinOriginUsage = new BuiltinExactOriginUsageCoordinator()
const moduleInstaller = new ModuleInstaller({
  registry: defaultModuleRegistry,
  permissions: browser.permissions,
  hostVersion: browser.runtime.getManifest().version,
  originInUse: originPattern => builtinOriginUsage.usedByAnother('remote-modules', originPattern),
})
const storageModuleAdapter = new StorageModuleAdapter({
  registry: defaultModuleRegistry,
  storage: browser.storage.local,
})
const storageModuleController = new StorageModuleController(storageModuleAdapter)
const bookmarkDoctorScanner = new BookmarkScanCoordinator({
  probe: new BookmarkUrlProbe(),
})
const browserJournalController = new BrowserJournalController({
  registry: defaultModuleRegistry,
  events: createBrowserJournalTabEventSource(browser.tabs),
  archive: createBrowserJournalArchiveStore(browser.storage.local),
})
const bookmarkDoctorController = new BookmarkDoctorController({
  registry: defaultModuleRegistry,
  permissions: browser.permissions,
  reader: new BookmarkDoctorReader({
    registry: defaultModuleRegistry,
    permissions: browser.permissions,
    bookmarks: createBrowserBookmarkTreeReader(browser.bookmarks),
  }),
  scanner: bookmarkDoctorScanner,
  repair: {
    bookmarks: createBrowserBookmarkMutationBoundary(browser.bookmarks),
    state: createBookmarkDoctorStateStore(browser.storage.local),
  },
})
const clashControlController = new ClashControlController({
  registry: defaultModuleRegistry,
  permissions: browser.permissions,
  profileStore: createClashControllerProfileStore(browser.storage.local),
  originInUse: originPattern => builtinOriginUsage.usedByAnother('clash-control', originPattern),
})
const pageToolboxController = new PageToolboxController({
  registry: defaultModuleRegistry,
  permissions: browser.permissions,
  tabs: browser.tabs,
  injection: createPageToolboxInjectionAdapter(
    (browser as unknown as { scripting: PageToolboxScriptingApi }).scripting,
  ),
  state: createPageToolboxStateStore(browser.storage.local),
  extensionId: browser.runtime.id,
  originInUse: originPattern => builtinOriginUsage.usedByAnother('page-toolbox', originPattern),
})
const sendToOpenListController = new SendToOpenListController({
  registry: defaultModuleRegistry,
  permissions: browser.permissions,
  store: createSendToOpenListProfileStore(browser.storage.local),
  originInUse: originPattern => builtinOriginUsage.usedByAnother('send-to-openlist', originPattern),
})
builtinOriginUsage.register('bookmark-doctor', originPattern => bookmarkDoctorController.usesOriginPattern(originPattern))
builtinOriginUsage.register('clash-control', originPattern => clashControlController.usesOriginPattern(originPattern))
builtinOriginUsage.register('page-toolbox', originPattern => pageToolboxController.usesOriginPattern(originPattern))
builtinOriginUsage.register('send-to-openlist', originPattern => sendToOpenListController.usesOriginPattern(originPattern))
bookmarkDoctorController.setOriginInUse(
  originPattern => builtinOriginUsage.usedByAnother('bookmark-doctor', originPattern),
)
const moduleManager = new ModuleManager(defaultModuleRegistry, moduleInstaller, {
  onInstalledRecordChanged: async (record) => {
    await storageModuleAdapter.handleInstalledRecordChanged(record.manifest.id)
    browserJournalController.handleInstalledRecordChanged(record)
    bookmarkDoctorController.handleInstalledRecordChanged(record)
    await clashControlController.handleInstalledRecordChanged(record)
    pageToolboxController.handleInstalledRecordChanged(record)
    await sendToOpenListController.handleInstalledRecordChanged(record)
  },
  onInstalledRecordRemoved: record => storageModuleAdapter.removeInstalledRecord(record.manifest.id),
})
const extensionBaseUrl = browser.runtime.getURL('/')

void initializeDefaultModuleRegistry()
  .then(async () => {
    await Promise.all([
      browserJournalController.startup(),
      clashControlController.startup(),
      pageToolboxController.startup(),
      sendToOpenListController.startup(),
    ])
  })
  .catch((error) => {
    console.error('Failed to initialize the OneWeb module registry', error)
  })

async function activeTabContext() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined)
    return null
  if (tab.url)
    contextBroker.updateFromUrl(tab.id, tab.url)
  return contextBroker.getSnapshot(tab.id)
}

async function broadcastContext(snapshot: ContextSnapshot) {
  await browser.runtime.sendMessage(createContextSnapshotMessage(snapshot)).catch(() => undefined)
}

async function updateTabContext(tabId: number, href: string | undefined) {
  if (!href)
    return
  const snapshot = contextBroker.updateFromUrl(tabId, href)
  if (snapshot)
    await broadcastContext(snapshot)
}

browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
  if (isSendToOpenListRequest(message)) {
    if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
      return undefined
    if (message.type === 'SEND_TO_OPENLIST_PREPARE') {
      return sendToOpenListController.prepare(message.profile).then(result => createSendToOpenListResponse(
        message.type,
        result,
      ))
    }
    if (message.type === 'SEND_TO_OPENLIST_CONNECT') {
      return sendToOpenListController.connect(message.preparation, message.token).then(result => createSendToOpenListResponse(
        message.type,
        result,
      ))
    }
    if (message.type === 'SEND_TO_OPENLIST_STATUS') {
      return sendToOpenListController.status().then(result => createSendToOpenListResponse(
        message.type,
        { ok: true, value: result },
      ))
    }
    if (message.type === 'SEND_TO_OPENLIST_DISCOVER_TOOLS') {
      return sendToOpenListController.discoverTools(message.destinationPath).then(result => createSendToOpenListResponse(
        message.type,
        result,
      ))
    }
    if (message.type === 'SEND_TO_OPENLIST_SUBMIT') {
      return sendToOpenListController.submit(
        message.candidates,
        message.destinationPath,
        message.tool,
      ).then(result => createSendToOpenListResponse(message.type, result))
    }
    if (message.type === 'SEND_TO_OPENLIST_LIST_TASKS') {
      return sendToOpenListController.listTasks(message.list).then(result => createSendToOpenListResponse(
        message.type,
        result,
      ))
    }
    if (message.type === 'SEND_TO_OPENLIST_PREPARE_CANCEL') {
      return sendToOpenListController.prepareCancel(message.taskId).then(result => createSendToOpenListResponse(
        message.type,
        result,
      ))
    }
    if (message.type === 'SEND_TO_OPENLIST_CONFIRM_CANCEL') {
      return sendToOpenListController.confirmCancel(message.token).then(result => createSendToOpenListResponse(
        message.type,
        result,
      ))
    }
    if (message.type === 'SEND_TO_OPENLIST_DELETE_PROFILE') {
      return sendToOpenListController.deleteProfile().then(result => createSendToOpenListResponse(
        message.type,
        { ok: true, value: result },
      ))
    }
    return sendToOpenListController.disconnect().then(result => createSendToOpenListResponse(
      message.type,
      { ok: true, value: result },
    ))
  }

  if (isPageToolboxManagementRequest(message)) {
    if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
      return undefined
    return pageToolboxController.handle(message)
  }

  const storageModuleRequest = validateStorageModuleProtocolRequest(message)
  if (storageModuleRequest) {
    if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
      return undefined
    return storageModuleController.handle(storageModuleRequest)
  }

  if (isBrowserJournalRequest(message)) {
    if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
      return undefined
    if (message.type === 'BROWSER_JOURNAL_START') {
      return browserJournalController.start().then(result => createBrowserJournalResponse(
        message.type,
        { operation: 'start', ...result },
      ))
    }
    if (message.type === 'BROWSER_JOURNAL_STATUS') {
      return Promise.resolve(createBrowserJournalResponse(message.type, {
        ok: true,
        operation: 'status',
        snapshot: browserJournalController.status(),
      }))
    }
    if (message.type === 'BROWSER_JOURNAL_ARCHIVE') {
      return browserJournalController.archiveState().then(result => createBrowserJournalResponse(
        message.type,
        { operation: 'archive', ...result },
      ))
    }
    if (message.type === 'BROWSER_JOURNAL_SAVE') {
      return browserJournalController.save().then(result => createBrowserJournalResponse(
        message.type,
        { operation: 'save', ...result },
      ))
    }
    if (message.type === 'BROWSER_JOURNAL_DELETE_SAVED') {
      return browserJournalController.deleteSavedSession(message.savedSessionId).then(result => createBrowserJournalResponse(
        message.type,
        { operation: 'delete-saved', ...result },
      ))
    }
    if (message.type === 'BROWSER_JOURNAL_CLEAR_SAVED') {
      return browserJournalController.clearArchive(message.confirmation).then(result => createBrowserJournalResponse(
        message.type,
        { operation: 'clear-saved', ...result },
      ))
    }
    return Promise.resolve(createBrowserJournalResponse(message.type, {
      operation: 'stop',
      ...browserJournalController.stop(),
    }))
  }

  if (isClashControlRequest(message)) {
    if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
      return undefined
    if (message.type === 'CLASH_CONTROL_PREPARE') {
      return clashControlController.prepare(message.controllerUrl).then(result => createClashControlResponse(
        message.type,
        { operation: 'prepare', ...result },
      ))
    }
    if (message.type === 'CLASH_CONTROL_CONNECT') {
      return clashControlController.connect({
        token: message.token,
        generation: message.generation,
        controllerOrigin: message.controllerOrigin,
        originPattern: message.originPattern,
        expiresAt: message.expiresAt,
      }, message.secret).then(result => createClashControlResponse(
        message.type,
        { operation: 'connect', ...result },
      ))
    }
    if (message.type === 'CLASH_CONTROL_STATUS') {
      return Promise.all([
        clashControlController.status(),
        clashControlController.readStatus(),
      ]).then(([connection, readState]) => createClashControlResponse(message.type, {
        ok: true,
        operation: 'status',
        connection,
        status: connection.phase === 'connected' ? connection.status : null,
        readState,
      }))
    }
    if (message.type === 'CLASH_CONTROL_REFRESH') {
      return clashControlController.refresh().then(result => createClashControlResponse(
        message.type,
        { operation: 'refresh', ...result },
      ))
    }
    if (message.type === 'CLASH_CONTROL_PREPARE_PROXY_SWITCH') {
      return clashControlController.prepareProxySwitch(
        message.groupName,
        message.targetNode,
      ).then(result => createClashControlResponse(
        message.type,
        { operation: 'prepare-proxy-switch', ...result },
      ))
    }
    if (message.type === 'CLASH_CONTROL_CONFIRM_PROXY_SWITCH') {
      return clashControlController.confirmProxySwitch(message.token).then(result => createClashControlResponse(
        message.type,
        { operation: 'confirm-proxy-switch', ...result },
      ))
    }
    return clashControlController.disconnect().then(result => createClashControlResponse(
      message.type,
      { operation: 'disconnect', ...result },
    ))
  }

  if (isBookmarkDoctorRequest(message)) {
    if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
      return undefined
    if (message.type === 'BOOKMARK_DOCTOR_AUTHORIZE') {
      return bookmarkDoctorController.authorize().then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'authorize', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_PREPARE') {
      return bookmarkDoctorController.prepare().then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'prepare', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_START') {
      return bookmarkDoctorController.start(message.token).then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'start', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_STATUS') {
      return Promise.resolve(createBookmarkDoctorResponse(message.type, {
        ok: true,
        operation: 'status',
        snapshot: bookmarkDoctorController.status(),
      }))
    }
    if (message.type === 'BOOKMARK_DOCTOR_AUTHORIZE_REPAIRS') {
      return bookmarkDoctorController.authorizeRepairs().then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'authorize-repairs', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_PREPARE_REPAIR') {
      return bookmarkDoctorController.prepareRepair(message.request).then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'prepare-repair', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_CONFIRM_REPAIRS') {
      return bookmarkDoctorController.confirmRepairs(message.confirmations).then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'confirm-repairs', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_WORKSPACE_STATE') {
      return bookmarkDoctorController.workspaceState().then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'workspace-state', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_UNIGNORE') {
      return bookmarkDoctorController.unignore(message.bookmarkId).then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'unignore', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_CLEAR_LOCAL_DATA') {
      return bookmarkDoctorController.clearLocalData(message.confirmation).then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'clear-local-data', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_PREPARE_RESTORE') {
      return bookmarkDoctorController.prepareRestore(message.backupToken).then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'prepare-restore', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_CONFIRM_RESTORE') {
      return bookmarkDoctorController.confirmRestore(message.confirmation).then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'confirm-restore', ...result },
      ))
    }
    if (message.type === 'BOOKMARK_DOCTOR_REVOKE') {
      return bookmarkDoctorController.revoke().then(result => createBookmarkDoctorResponse(
        message.type,
        { operation: 'revoke', ...result },
      ))
    }
    return bookmarkDoctorController.stop().then(result => createBookmarkDoctorResponse(message.type, {
      ok: true,
      operation: 'stop',
      ...result,
    }))
  }

  if (isModuleManagementRequest(message)) {
    if (!isTrustedModuleManagementSender(sender, browser.runtime.id, extensionBaseUrl))
      return undefined
    return moduleManager.handle(message)
  }

  if (!isContextRuntimeMessage(message))
    return undefined

  if (message.type === 'CONTEXT_PROVIDER_UPDATE') {
    const tabId = sender.tab?.id
    if (tabId === undefined)
      return undefined
    const snapshot = contextBroker.updateFromSource(tabId, message.contextId, message.value, sender.url)
    if (!snapshot)
      return undefined
    void broadcastContext(snapshot)
    return undefined
  }

  if (message.type === 'CONTEXT_SUBSCRIBER_READY') {
    if (sender.tab)
      return undefined
    return activeTabContext().then((active) => {
      if (!active)
        return null
      return createContextSnapshotMessage(active)
    })
  }

  return undefined
})

browser.runtime.onConnect.addListener((port) => {
  pageToolboxController.acceptPort(port as unknown as PageToolboxHostPort)
})

browser.tabs.onActivated.addListener(async () => {
  const active = await activeTabContext()
  if (active)
    await broadcastContext(active)
})

// Firefox MV3 event pages may be suspended between messages. URL updates provide a
// navigation-level fallback; the content script remains responsible for SPA signals.
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  pageToolboxController.handleTabUpdated(tabId, changeInfo)
  const href = changeInfo.url || (changeInfo.status === 'complete' ? tab.url : undefined)
  if (href)
    void updateTabContext(tabId, href)
})

browser.tabs.onRemoved.addListener((tabId) => {
  contextBroker.remove(tabId)
  pageToolboxController.handleTabRemoved(tabId)
})

browser.permissions.onRemoved.addListener((permissions) => {
  browserJournalController.handlePermissionsRemoved(permissions)
  void bookmarkDoctorController.handlePermissionsRemoved(permissions)
  void clashControlController.handlePermissionsRemoved(permissions)
  void pageToolboxController.handlePermissionsRemoved(permissions)
  void sendToOpenListController.handlePermissionsRemoved(permissions)
})

if (!__FIREFOX__ && typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined)
}
