import type { Runtime } from 'webextension-polyfill'
import { storageModuleCapabilityCatalog } from '@oneweb/module-sdk'
import browser from 'webextension-polyfill'
import { BookmarkDoctorClient } from '~/modules/builtin/bookmark-doctor'
import { BrowserJournalClient } from '~/modules/builtin/browser-journal'
import { ClashControlClient } from '~/modules/builtin/clash-control'
import { PageToolboxClient } from '~/modules/builtin/page-toolbox'
import { type ContextSnapshot, createDefaultContextBroker } from '~/modules/context-broker'
import {
  type ContextSnapshotMessage,
  type ContextSubscriberReadyMessage,
  isContextRuntimeMessage,
} from '~/modules/context-protocol'
import { ModuleFrameHost } from '~/modules/frame-host'
import { ModuleManagementClient } from '~/modules/management-client'
import { StorageModuleClient } from '~/modules/storage-module-client'
import type { InstalledModuleRecord } from '~/modules/types'
import { resolveRepoLensInitFields } from '~/repolens/authorization'
import { ModuleManagementView } from './module-management-view'
import './sidebar.css'

const REPOLENS_MODULE_ID = 'dev.juck.repolens'
const frame = document.querySelector<HTMLIFrameElement>('[data-testid="oneweb-module-frame"]')!
const bridgeState = document.querySelector<HTMLElement>('.bridge-state')!
const contextLabel = document.querySelector<HTMLElement>('[data-testid="current-context"]')!
const moduleName = document.querySelector<HTMLElement>('[data-testid="module-name"]')!
const moduleMark = document.querySelector<HTMLElement>('.brand-mark')!
const shell = document.querySelector<HTMLElement>('[data-testid="oneweb-side-panel"]')!
const moduleSurface = document.querySelector<HTMLElement>('[data-testid="module-surface"]')!
const managerSurface = document.querySelector<HTMLElement>('[data-testid="module-manager"]')!
const manageButton = document.querySelector<HTMLButtonElement>('[data-testid="manage-modules"]')!
const closeManagerButton = document.querySelector<HTMLButtonElement>('[data-testid="close-module-manager"]')!
const unavailable = document.querySelector<HTMLElement>('[data-testid="module-unavailable"]')!
const unavailableTitle = unavailable.querySelector<HTMLElement>('[data-unavailable-title]')!
const unavailableDescription = unavailable.querySelector<HTMLElement>('[data-unavailable-description]')!
const openManagerButton = unavailable.querySelector<HTMLButtonElement>('[data-open-module-manager]')!
const extensionOrigin = new URL(browser.runtime.getURL('/')).origin
const requestedModuleId = new URL(globalThis.location.href).searchParams.get('moduleId')
const contextBroker = createDefaultContextBroker()
const managementClient = new ModuleManagementClient({
  sendMessage: message => browser.runtime.sendMessage(message),
  permissions: browser.permissions,
})
const browserJournalClient = new BrowserJournalClient({
  sendMessage: message => browser.runtime.sendMessage(message),
})
const bookmarkDoctorClient = new BookmarkDoctorClient({
  sendMessage: message => browser.runtime.sendMessage(message),
  permissions: browser.permissions,
})
const clashControlClient = new ClashControlClient(
  { sendMessage: message => browser.runtime.sendMessage(message) },
  browser.permissions,
)
const pageToolboxClient = new PageToolboxClient(
  { sendMessage: message => browser.runtime.sendMessage(message) },
  browser.permissions,
)
const storageModuleClient = new StorageModuleClient({
  sendMessage: message => browser.runtime.sendMessage(message),
})
const contextRequest: ContextSubscriberReadyMessage = {
  channel: 'oneweb.context',
  version: 1,
  type: 'CONTEXT_SUBSCRIBER_READY',
}

let moduleHost: ModuleFrameHost | null = null
let currentSnapshot: ContextSnapshot | null = null
let activeRecord: InstalledModuleRecord | null = null
let managementView: ModuleManagementView

function setBridgeLabel(value: string, ready = false) {
  bridgeState.textContent = value
  bridgeState.dataset.ready = String(ready)
}

function updateModuleIdentity(record: InstalledModuleRecord) {
  moduleName.textContent = record.manifest.name
  moduleMark.textContent = record.manifest.name.slice(0, 1).toUpperCase()
  document.title = `OneWeb · ${record.manifest.name}`
}

function destroyModuleFrame() {
  moduleHost?.destroy()
  moduleHost = null
  frame.removeAttribute('src')
  frame.hidden = true
}

function showModuleUnavailable(record: InstalledModuleRecord | null, message: string) {
  destroyModuleFrame()
  activeRecord = record
  if (record) {
    updateModuleIdentity(record)
    contextLabel.textContent = record.enabled ? '模块当前不可用' : '模块已停用'
    unavailableTitle.textContent = `${record.manifest.name}${record.enabled ? ' 不可用' : ' 已停用'}`
  }
  else {
    moduleName.textContent = 'OneWeb'
    moduleMark.textContent = 'O'
    contextLabel.textContent = '尚无可用模块'
    unavailableTitle.textContent = '模块不可用'
  }
  unavailableDescription.textContent = message
  unavailable.hidden = false
  setBridgeLabel(record?.enabled ? '模块不可用' : '模块已停用')
}

function activateModule(record: InstalledModuleRecord) {
  if (!record.enabled) {
    showModuleUnavailable(record, '你可以在模块管理中重新启用它。')
    return
  }
  if (record.manifest.runtime !== 'remote-frame') {
    showModuleUnavailable(record, '该模块的运行入口尚未接入当前侧边栏。')
    return
  }

  destroyModuleFrame()
  activeRecord = record
  unavailable.hidden = true
  frame.hidden = false
  updateModuleIdentity(record)
  setBridgeLabel('正在建立安全桥接…')
  moduleHost = new ModuleFrameHost({
    frame,
    record,
    extensionOrigin,
    resolveInitFields: selected => resolveRepoLensInitFields(selected, extensionOrigin),
    onReady: () => setBridgeLabel('安全桥接已连接', true),
    onContextAccepted: message => setBridgeLabel(`已同步 ${message.contextLabel || '当前上下文'}`, true),
    onStatus: (message) => {
      setBridgeLabel(message.label || `${record.manifest.name} · ${message.state || '运行中'}`, true)
    },
    ...(record.manifest.capabilities.includes('storage.module')
      ? {
          capabilityRpc: {
            catalog: storageModuleCapabilityCatalog,
            openSession: binding => storageModuleClient.open(binding),
            createHandlers: binding => storageModuleClient.createHandlers(binding),
            closeSession: async (binding) => {
              await storageModuleClient.close(binding)
            },
          },
        }
      : {}),
  })
  moduleHost.start()
  sendCurrentContext()
  void requestCurrentContext()
}

function sendCurrentContext() {
  if (!moduleHost || !currentSnapshot)
    return
  moduleHost.updateContext(currentSnapshot)
}

function acceptContextSnapshot(message: ContextSnapshotMessage) {
  const snapshot = contextBroker.normalizeSnapshot(message.tabId, message.contexts)
  if (!snapshot)
    return
  snapshot.revision = message.revision
  currentSnapshot = snapshot
  const repository = snapshot.contexts['github.repository']
  if (moduleHost)
    contextLabel.textContent = typeof repository?.repo === 'string' ? repository.repo : '等待页面上下文'
  sendCurrentContext()
}

async function requestCurrentContext() {
  const response = await browser.runtime.sendMessage(contextRequest).catch(() => null)
  if (isContextRuntimeMessage(response) && response.type === 'CONTEXT_SNAPSHOT')
    acceptContextSnapshot(response)
}

function handleRuntimeMessage(message: unknown, sender: Runtime.MessageSender) {
  if (!sender.tab && isContextRuntimeMessage(message) && message.type === 'CONTEXT_SNAPSHOT')
    acceptContextSnapshot(message)
  return undefined
}

browser.runtime.onMessage.addListener(handleRuntimeMessage)

function openModuleManager() {
  shell.dataset.view = 'manager'
  moduleSurface.hidden = true
  managerSurface.hidden = false
  manageButton.setAttribute('aria-expanded', 'true')
  void managementView.refresh()
}

function closeModuleManager() {
  shell.dataset.view = 'module'
  managerSurface.hidden = true
  moduleSurface.hidden = false
  manageButton.setAttribute('aria-expanded', 'false')
}

managementView = new ModuleManagementView({
  root: managerSurface,
  client: managementClient,
  browserJournal: browserJournalClient,
  bookmarkDoctor: bookmarkDoctorClient,
  clashControl: clashControlClient,
  pageToolbox: pageToolboxClient,
  onRecordChanged: (record) => {
    if (record.manifest.id === activeRecord?.manifest.id)
      activateModule(record)
  },
  onRecordRemoved: (record) => {
    if (record.manifest.id === activeRecord?.manifest.id)
      showModuleUnavailable(null, '该模块已经从 OneWeb 中移除。')
  },
})

browser.permissions.onRemoved.addListener((permissions) => {
  if (permissions.permissions?.includes('bookmarks') || permissions.origins?.length)
    void managementView.refresh()
})

manageButton.addEventListener('click', () => managerSurface.hidden ? openModuleManager() : closeModuleManager())
closeManagerButton.addEventListener('click', closeModuleManager)
openManagerButton.addEventListener('click', openModuleManager)

async function initialize() {
  const records = await managementClient.list()
  const selectedModuleId = requestedModuleId && requestedModuleId.length <= 128
    ? requestedModuleId
    : REPOLENS_MODULE_ID
  const record = records.find(candidate => candidate.manifest.id === selectedModuleId) || null
  if (record)
    activateModule(record)
  else
    showModuleUnavailable(null, '所选模块记录不存在，请打开模块管理检查当前状态。')
}

void initialize().catch(() => showModuleUnavailable(null, '模块初始化失败，请稍后重试。'))
