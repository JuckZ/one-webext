import type { InstalledModuleRecord } from '../../types'
import type {
  PageToolboxDisposeReason,
  PageToolboxRuntimeBindingV1,
  PageToolboxSettingsV1,
  PageToolboxSitePreparationV1,
  PageToolCatalogV1,
} from './contracts'
import type { PageToolboxInjectionBoundary } from './injection'
import type { PageToolboxControlSnapshotV1 } from './product-control'
import type { PageToolboxShadowActionErrorCode } from './shadow-control-model'
import type {
  PageToolboxStateDocumentV2,
  PageToolboxStateStore,
} from './state'
import type { PageToolId } from './tool-catalog'
import {
  PAGE_TOOLBOX_ENTRY_ID,
  PAGE_TOOLBOX_MODULE_ID,
  PAGE_TOOLBOX_NONCE_BYTES,
  PAGE_TOOLBOX_PORT_NAME,
  PAGE_TOOLBOX_PREPARATION_TTL_MS,
} from './contracts'
import {
  PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION,
  validatePageToolboxControlSnapshot,
} from './product-control'
import {
  createPageToolboxControlResult,
  createPageToolboxDispose,
  createPageToolboxInit,
  createPageToolboxManagementResponse,
  createPageToolboxSync,
  type PageToolboxErrorCode,
  type PageToolboxLifecyclePhase,
  type PageToolboxManagementRequest,
  type PageToolboxManagementResponse,
  type PageToolboxManagementResult,
  samePageToolboxBinding,
  validatePageToolboxContentMessage,
} from './protocol'
import { PAGE_TOOLBOX_SHADOW_MAX_ACTIONS_PER_SESSION } from './shadow-control-model'
import {
  addPageToolboxStateSite,
  normalizeStoredPageToolboxState,
  removePageToolboxStateSite,
  replacePageToolboxStateSite,
  setPageToolboxStateSiteTool,
} from './state'
import { getDefaultPageToolSettings, PAGE_TOOL_CATALOG } from './tool-catalog'
import { createPageToolPlansForSite, normalizePageToolExactOrigin } from './validation'

export interface PageToolboxRegistryBoundary {
  get: (_moduleId: string) => Promise<InstalledModuleRecord | null | undefined>
  list?: () => Promise<InstalledModuleRecord[]>
}

export interface PageToolboxPermissionsBoundary {
  contains: (_request: { origins: string[] }) => Promise<boolean>
  remove?: (_request: { origins: string[] }) => Promise<boolean>
}

export interface PageToolboxTab {
  readonly id?: number
  readonly title?: string
  readonly url?: string
}

export interface PageToolboxTabsBoundary {
  query: (_query: { active?: boolean, currentWindow?: boolean }) => Promise<PageToolboxTab[]>
  get: (_tabId: number) => Promise<PageToolboxTab>
}

interface PageToolboxHostPortEvent<Message = unknown> {
  addListener: (_listener: (_message: Message) => void) => void
  removeListener: (_listener: (_message: Message) => void) => void
}

interface PageToolboxHostDisconnectEvent {
  addListener: (_listener: () => void) => void
  removeListener: (_listener: () => void) => void
}

export interface PageToolboxPortSender {
  readonly id?: string
  readonly frameId?: number
  readonly url?: string
  readonly documentId?: string
  readonly tab?: { readonly id?: number, readonly url?: string }
}

export interface PageToolboxHostPort {
  readonly name: string
  readonly sender?: PageToolboxPortSender
  readonly onMessage: PageToolboxHostPortEvent
  readonly onDisconnect: PageToolboxHostDisconnectEvent
  postMessage: (_message: unknown) => void
  disconnect: () => void
}

export interface PageToolboxControllerOptions {
  readonly registry: PageToolboxRegistryBoundary
  readonly permissions: PageToolboxPermissionsBoundary
  readonly tabs: PageToolboxTabsBoundary
  readonly injection: PageToolboxInjectionBoundary
  readonly state: PageToolboxStateStore
  readonly extensionId: string
  readonly catalog?: PageToolCatalogV1
  readonly now?: () => string
  readonly entropy?: () => Uint8Array
  readonly originInUse?: (_originPattern: string) => boolean | Promise<boolean>
}

interface PrivatePreparation extends PageToolboxSitePreparationV1 {
  readonly tabId: number
}

interface HostSession {
  readonly port: PageToolboxHostPort
  readonly sessionNonce: string
  readonly binding: PageToolboxRuntimeBindingV1
  phase: PageToolboxLifecyclePhase
  planRevision: number
  readonly controlActionIds: Set<string>
  pendingControlActionId: string | null
}

interface PageToolboxControlAction {
  readonly actionId: string
  readonly toolId: PageToolId
  readonly enabled: boolean
}

type PageToolboxControlActionResult =
  | { readonly ok: true, readonly changed: boolean }
  | { readonly ok: false, readonly reason: PageToolboxShadowActionErrorCode }

function isPageToolboxRecord(record: InstalledModuleRecord | null | undefined): record is InstalledModuleRecord {
  return Boolean(record
    && record.source === 'seeded'
    && record.manifest.runtime === 'builtin'
    && record.manifest.id === PAGE_TOOLBOX_MODULE_ID
    && record.manifest.entry_id === PAGE_TOOLBOX_ENTRY_ID)
}

function exactOriginFromUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 8192)
    return null
  try {
    return normalizePageToolExactOrigin(new URL(value).origin)
  }
  catch {
    return null
  }
}

function exactOriginPattern(origin: string) {
  return `${origin}/*`
}

function sameState(left: PageToolboxStateDocumentV2, right: PageToolboxStateDocumentV2) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class PageToolboxController {
  private readonly registry: PageToolboxRegistryBoundary
  private readonly permissions: PageToolboxPermissionsBoundary
  private readonly tabs: PageToolboxTabsBoundary
  private readonly injection: PageToolboxInjectionBoundary
  private readonly stateStore: PageToolboxStateStore
  private readonly extensionId: string
  private readonly catalog: PageToolCatalogV1
  private readonly now: () => string
  private readonly entropy: () => Uint8Array
  private originInUse: (_originPattern: string) => boolean | Promise<boolean>
  private initialization: Promise<boolean> | null = null
  private stateDocument: PageToolboxStateDocumentV2 | null = null
  private settings: PageToolboxSettingsV1 | null = null
  private preparation: PrivatePreparation | null = null
  private preparationSequence = 0
  private generation = 0
  private readonly approvedOrigins = new Set<string>()
  private readonly sessions = new Map<number, HostSession>()
  private queue: Promise<void> = Promise.resolve()

  constructor({
    registry,
    permissions,
    tabs,
    injection,
    state,
    extensionId,
    catalog = PAGE_TOOL_CATALOG,
    now = () => new Date().toISOString(),
    entropy = () => crypto.getRandomValues(new Uint8Array(PAGE_TOOLBOX_NONCE_BYTES)),
    originInUse = () => false,
  }: PageToolboxControllerOptions) {
    this.registry = registry
    this.permissions = permissions
    this.tabs = tabs
    this.injection = injection
    this.stateStore = state
    this.extensionId = extensionId
    this.catalog = catalog
    this.now = now
    this.entropy = entropy
    this.originInUse = originInUse
  }

  setOriginInUse(probe: (_originPattern: string) => boolean | Promise<boolean>) {
    this.originInUse = probe
  }

  usesOriginPattern(pattern: string) {
    return [...this.approvedOrigins].some(origin => exactOriginPattern(origin) === pattern)
  }

  async startup() {
    if (!await this.ensureInitialized())
      return false
    await this.reconcileMissingPermissions()
    const available = await this.availableRecord()
    if (!available.ok)
      return false
    await this.reconcileAllTabs()
    return true
  }

  async prepareCurrentSite(): Promise<PageToolboxManagementResult> {
    if (!await this.ensureInitialized())
      return { ok: false, operation: 'prepare', reason: 'settings-read-failed' }
    const available = await this.availableRecord()
    if (!available.ok)
      return { ok: false, operation: 'prepare', reason: available.reason }
    const current = await this.currentTab()
    if (!current.ok)
      return { ok: false, operation: 'prepare', reason: current.reason }
    try {
      await this.permissions.contains({ origins: [current.originPattern] })
    }
    catch {
      return { ok: false, operation: 'prepare', reason: 'permission-check-failed' }
    }
    const createdAt = Date.parse(this.now())
    if (!Number.isFinite(createdAt))
      return { ok: false, operation: 'prepare', reason: 'invalid-preparation' }
    const sequence = ++this.preparationSequence
    let token: string
    try {
      token = this.randomNonce()
    }
    catch {
      return { ok: false, operation: 'prepare', reason: 'invalid-preparation' }
    }
    if (sequence !== this.preparationSequence)
      return { ok: false, operation: 'prepare', reason: 'invalid-preparation' }
    this.preparation = Object.freeze({
      token,
      tabId: current.tabId,
      exactOrigin: current.exactOrigin,
      originPattern: current.originPattern,
      expiresAt: new Date(createdAt + PAGE_TOOLBOX_PREPARATION_TTL_MS).toISOString(),
    })
    return {
      ok: true,
      operation: 'prepare',
      preparation: this.publicPreparation(this.preparation),
    }
  }

  confirmCurrentSite(token: string): Promise<PageToolboxManagementResult> {
    return this.runExclusive(async () => {
      if (!await this.ensureInitialized())
        return { ok: false, operation: 'confirm', reason: 'settings-read-failed' }
      const preparation = this.preparation
      this.preparation = null
      this.preparationSequence += 1
      if (!preparation
        || token !== preparation.token
        || Date.parse(this.now()) >= Date.parse(preparation.expiresAt)) {
        return { ok: false, operation: 'confirm', reason: 'invalid-preparation' }
      }
      const available = await this.availableRecord()
      if (!available.ok)
        return { ok: false, operation: 'confirm', reason: available.reason }
      const current = await this.tabOrigin(preparation.tabId)
      if (!current || current !== preparation.exactOrigin)
        return { ok: false, operation: 'confirm', reason: 'invalid-preparation' }
      try {
        if (!await this.permissions.contains({ origins: [preparation.originPattern] }))
          return { ok: false, operation: 'confirm', reason: 'permission-missing' }
      }
      catch {
        return { ok: false, operation: 'confirm', reason: 'permission-check-failed' }
      }
      if (!this.stateDocument)
        return { ok: false, operation: 'confirm', reason: 'settings-invalid' }
      const next = addPageToolboxStateSite(this.stateDocument, preparation.exactOrigin, this.catalog)
      if (!next)
        return { ok: false, operation: 'confirm', reason: 'settings-invalid' }
      const changed = !sameState(this.stateDocument, next)
      if (changed) {
        try {
          await this.stateStore.write(next)
        }
        catch {
          return { ok: false, operation: 'confirm', reason: 'settings-write-failed' }
        }
      }
      this.publishState(next)
      const injected = await this.injectTab(preparation.tabId, preparation.exactOrigin)
      return {
        ok: true,
        operation: 'confirm',
        changed,
        injected,
        preparation: this.publicPreparation(preparation),
      }
    })
  }

  revokeCurrentSite(): Promise<PageToolboxManagementResult> {
    return this.runExclusive(async () => {
      if (!await this.ensureInitialized())
        return { ok: false, operation: 'revoke', reason: 'settings-read-failed' }
      const current = await this.currentTab()
      if (!current.ok)
        return { ok: false, operation: 'revoke', reason: current.reason }
      if (!this.stateDocument)
        return { ok: false, operation: 'revoke', reason: 'settings-invalid' }
      const existed = this.approvedOrigins.has(current.exactOrigin)
      const next = removePageToolboxStateSite(this.stateDocument, current.exactOrigin, this.catalog)
      if (!next)
        return { ok: false, operation: 'revoke', reason: 'settings-invalid' }
      if (existed) {
        try {
          await this.stateStore.write(next)
        }
        catch {
          return { ok: false, operation: 'revoke', reason: 'settings-write-failed' }
        }
      }
      this.publishState(next)
      this.invalidateOrigin(current.exactOrigin, 'origin-revoked')
      if (!existed)
        return { ok: true, operation: 'revoke', changed: false, releasedOrigin: false }
      const released = await this.releaseOrigin(current.originPattern)
      return released.ok
        ? { ok: true, operation: 'revoke', changed: true, releasedOrigin: released.released }
        : { ok: false, operation: 'revoke', reason: released.reason }
    })
  }

  setCurrentSiteTool(
    request: Extract<PageToolboxManagementRequest, { type: 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL' }>,
  ): Promise<PageToolboxManagementResult> {
    return this.runExclusive(async () => {
      if (!await this.ensureInitialized())
        return { ok: false, operation: 'set-tool', reason: 'settings-read-failed' }
      const available = await this.availableRecord()
      if (!available.ok)
        return { ok: false, operation: 'set-tool', reason: available.reason }
      const current = await this.currentTab()
      if (!current.ok)
        return { ok: false, operation: 'set-tool', reason: current.reason }
      if (!this.stateDocument || !this.approvedOrigins.has(current.exactOrigin))
        return { ok: false, operation: 'set-tool', reason: 'permission-missing' }
      try {
        if (!await this.permissions.contains({ origins: [current.originPattern] }))
          return { ok: false, operation: 'set-tool', reason: 'permission-missing' }
      }
      catch {
        return { ok: false, operation: 'set-tool', reason: 'permission-check-failed' }
      }
      const mutation = setPageToolboxStateSiteTool(
        this.stateDocument,
        current.exactOrigin,
        request.toolId,
        request.enabled,
        request.enabled ? request.settings : null,
        this.catalog,
      )
      if (!mutation.ok) {
        return {
          ok: false,
          operation: 'set-tool',
          reason: mutation.reason === 'revision-exhausted' ? 'revision-exhausted' : 'tool-settings-invalid',
        }
      }
      if (mutation.changed) {
        try {
          await this.stateStore.write(mutation.state)
        }
        catch {
          return { ok: false, operation: 'set-tool', reason: 'settings-write-failed' }
        }
      }
      this.publishState(mutation.state)
      const synchronized = mutation.changed ? this.synchronizeOrigin(current.exactOrigin) : 0
      if (mutation.changed && synchronized === 0)
        await this.injectTab(current.tabId, current.exactOrigin)
      return {
        ok: true,
        operation: 'set-tool',
        toolId: request.toolId,
        enabled: request.enabled,
        changed: mutation.changed,
        synchronized,
      }
    })
  }

  async controlStatus(): Promise<PageToolboxManagementResult> {
    if (!await this.ensureInitialized() || !this.stateDocument)
      return { ok: false, operation: 'control-status', reason: 'settings-read-failed' }
    const record = await this.registry.get(PAGE_TOOLBOX_MODULE_ID)
    if (!isPageToolboxRecord(record))
      return { ok: false, operation: 'control-status', reason: 'module-unavailable' }
    const current = await this.currentControlTab()
    if (!current.ok)
      return { ok: false, operation: 'control-status', reason: current.reason }
    if (!current.exactOrigin) {
      const snapshot = this.controlSnapshot(current, record, false)
      return snapshot
        ? { ok: true, operation: 'control-status', snapshot }
        : { ok: false, operation: 'control-status', reason: 'settings-invalid' }
    }
    if (!record.enabled) {
      const snapshot = this.controlSnapshot(current, record, false)
      return snapshot
        ? { ok: true, operation: 'control-status', snapshot }
        : { ok: false, operation: 'control-status', reason: 'settings-invalid' }
    }
    let permitted = false
    try {
      permitted = await this.permissions.contains({ origins: [exactOriginPattern(current.exactOrigin)] })
    }
    catch {
      return { ok: false, operation: 'control-status', reason: 'permission-check-failed' }
    }
    const snapshot = this.controlSnapshot(current, record, permitted)
    return snapshot
      ? { ok: true, operation: 'control-status', snapshot }
      : { ok: false, operation: 'control-status', reason: 'settings-invalid' }
  }

  replaceCurrentSiteSettings(
    request: Extract<PageToolboxManagementRequest, { type: 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS' }>,
  ): Promise<PageToolboxManagementResult> {
    return this.runExclusive(async () => {
      if (!await this.ensureInitialized() || !this.stateDocument)
        return { ok: false, operation: 'replace-site-settings', reason: 'settings-read-failed' }
      const available = await this.availableRecord()
      if (!available.ok)
        return { ok: false, operation: 'replace-site-settings', reason: available.reason }
      const current = await this.currentTab()
      if (!current.ok)
        return { ok: false, operation: 'replace-site-settings', reason: current.reason }
      if (!this.approvedOrigins.has(current.exactOrigin))
        return { ok: false, operation: 'replace-site-settings', reason: 'permission-missing' }
      try {
        if (!await this.permissions.contains({ origins: [current.originPattern] }))
          return { ok: false, operation: 'replace-site-settings', reason: 'permission-missing' }
      }
      catch {
        return { ok: false, operation: 'replace-site-settings', reason: 'permission-check-failed' }
      }
      const mutation = replacePageToolboxStateSite(
        this.stateDocument,
        current.exactOrigin,
        request.expectedRevision,
        request.siteSettings,
        this.catalog,
      )
      if (!mutation.ok) {
        if (mutation.reason === 'revision-conflict') {
          const snapshot = this.controlSnapshot(current, available.record, true)
          return snapshot
            ? {
                ok: false,
                operation: 'replace-site-settings',
                reason: 'revision-conflict',
                snapshot,
              }
            : { ok: false, operation: 'replace-site-settings', reason: 'settings-invalid' }
        }
        return {
          ok: false,
          operation: 'replace-site-settings',
          reason: mutation.reason === 'revision-exhausted' ? 'revision-exhausted' : 'tool-settings-invalid',
        }
      }
      try {
        await this.stateStore.write(mutation.state)
      }
      catch {
        return { ok: false, operation: 'replace-site-settings', reason: 'settings-write-failed' }
      }
      this.publishState(mutation.state)
      const synchronized = this.synchronizeOrigin(current.exactOrigin)
      if (synchronized === 0)
        await this.injectTab(current.tabId, current.exactOrigin)
      const snapshot = this.controlSnapshot(current, available.record, true)
      return snapshot
        ? {
            ok: true,
            operation: 'replace-site-settings',
            changed: mutation.changed,
            synchronized,
            snapshot,
          }
        : { ok: false, operation: 'replace-site-settings', reason: 'settings-invalid' }
    })
  }

  async status(): Promise<PageToolboxManagementResult> {
    if (!await this.ensureInitialized())
      return { ok: false, operation: 'status', reason: 'settings-read-failed' }
    if (!this.settings)
      return { ok: false, operation: 'status', reason: 'settings-invalid' }
    return {
      ok: true,
      operation: 'status',
      snapshot: this.snapshot(),
    }
  }

  async handle(request: PageToolboxManagementRequest): Promise<PageToolboxManagementResponse> {
    const result = request.type === 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE'
      ? await this.prepareCurrentSite()
      : request.type === 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE'
        ? await this.confirmCurrentSite(request.token)
        : request.type === 'PAGE_TOOLBOX_SET_CURRENT_SITE_TOOL'
          ? await this.setCurrentSiteTool(request)
          : request.type === 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS'
            ? await this.replaceCurrentSiteSettings(request)
            : request.type === 'PAGE_TOOLBOX_CONTROL_STATUS'
              ? await this.controlStatus()
              : request.type === 'PAGE_TOOLBOX_REVOKE_CURRENT_SITE'
                ? await this.revokeCurrentSite()
                : await this.status()
    return createPageToolboxManagementResponse(request.type, result)
  }

  acceptPort(port: PageToolboxHostPort) {
    const sender = port.sender
    const tabId = sender?.tab?.id
    const exactOrigin = exactOriginFromUrl(sender?.url)
    if (port.name !== PAGE_TOOLBOX_PORT_NAME
      || sender?.id !== this.extensionId
      || sender.frameId !== 0
      || tabId === undefined
      || !Number.isSafeInteger(tabId)
      || !exactOrigin) {
      this.disconnectPort(port)
      return false
    }
    let authenticating = false
    let closed = false
    const onMessage = (raw: unknown) => {
      const message = validatePageToolboxContentMessage(raw)
      if (!message) {
        this.disconnectPort(port)
        return
      }
      const session = this.sessions.get(tabId)
      if (message.type === 'PAGE_TOOLBOX_HELLO') {
        if (authenticating || session?.port === port) {
          this.disconnectPort(port)
          return
        }
        authenticating = true
        void this.authenticatePort(port, tabId, exactOrigin, sender.documentId, message.challenge)
          .finally(() => authenticating = false)
        return
      }
      if (!session
        || session.port !== port
        || message.sessionNonce !== session.sessionNonce
        || !samePageToolboxBinding(message.binding, session.binding)) {
        this.disconnectPort(port)
        return
      }
      if (message.type === 'PAGE_TOOLBOX_READY') {
        if (session.phase !== 'initializing' || message.planRevision !== session.planRevision) {
          this.invalidateSession(session, 'port-loss')
          return
        }
        session.phase = 'ready'
        return
      }
      if (message.type === 'PAGE_TOOLBOX_SYNCED') {
        if (session.phase !== 'ready' || message.planRevision !== session.planRevision)
          this.invalidateSession(session, 'port-loss')
        return
      }
      if (message.type === 'PAGE_TOOLBOX_CONTROL_TOGGLE') {
        this.handleControlToggle(session, message)
        return
      }
      this.removeSession(session, true)
    }
    const onDisconnect = () => {
      if (closed)
        return
      closed = true
      port.onMessage.removeListener(onMessage)
      port.onDisconnect.removeListener(onDisconnect)
      const session = this.sessions.get(tabId)
      if (session?.port === port)
        this.sessions.delete(tabId)
    }
    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
    return true
  }

  handleInstalledRecordChanged(record: InstalledModuleRecord) {
    if (!isPageToolboxRecord(record))
      return false
    this.preparation = null
    this.preparationSequence += 1
    if (!record.enabled) {
      this.invalidateAll('disabled')
      return true
    }
    void this.reconcileAllTabs()
    return true
  }

  handleTabUpdated(tabId: number, changeInfo: { status?: string, url?: string }) {
    if (changeInfo.url || changeInfo.status === 'loading') {
      if (this.preparation?.tabId === tabId) {
        this.preparation = null
        this.preparationSequence += 1
      }
      this.invalidateTab(tabId, 'navigation')
    }
    if (changeInfo.status === 'complete')
      void this.reconcileTab(tabId)
  }

  handleTabRemoved(tabId: number) {
    if (this.preparation?.tabId === tabId) {
      this.preparation = null
      this.preparationSequence += 1
    }
    this.invalidateTab(tabId, 'tab-removed')
  }

  handlePermissionsRemoved(removed: { origins?: string[] }) {
    return this.runExclusive(async () => {
      if (!removed.origins?.length || !await this.ensureInitialized() || !this.stateDocument)
        return false
      const revoked = new Set(removed.origins.flatMap((pattern) => {
        const origin = exactOriginFromUrl(pattern)
        return origin ? [origin] : []
      }).filter(origin => this.approvedOrigins.has(origin)))
      if (!revoked.size)
        return false
      let next = this.stateDocument
      for (const origin of revoked)
        next = removePageToolboxStateSite(next, origin, this.catalog) || next
      this.publishState(next)
      for (const origin of revoked)
        this.invalidateOrigin(origin, 'origin-revoked')
      try {
        await this.stateStore.write(next)
      }
      catch {
        // Permission absence is authoritative even if stale settings cannot be repaired yet.
      }
      return true
    })
  }

  shutdown(reason: PageToolboxDisposeReason = 'worker-restart') {
    this.preparation = null
    this.preparationSequence += 1
    this.invalidateAll(reason)
  }

  private ensureInitialized() {
    if (!this.initialization) {
      this.initialization = this.stateStore.read()
        .then((stored) => {
          const state = normalizeStoredPageToolboxState(stored, this.catalog)
          if (!state)
            return false
          this.publishState(state)
          return true
        })
        .catch(() => false)
    }
    return this.initialization
  }

  private async availableRecord() {
    const record = await this.registry.get(PAGE_TOOLBOX_MODULE_ID)
    if (!isPageToolboxRecord(record))
      return { ok: false, reason: 'module-unavailable' } as const
    return record.enabled
      ? { ok: true, record } as const
      : { ok: false, reason: 'module-disabled' } as const
  }

  private async currentTab() {
    const current = await this.currentControlTab()
    if (!current.ok)
      return current
    if (!current.exactOrigin)
      return { ok: false, reason: 'invalid-origin' } as const
    return {
      ok: true,
      tabId: current.tabId,
      pageTitle: current.pageTitle,
      exactOrigin: current.exactOrigin,
      originPattern: exactOriginPattern(current.exactOrigin),
    } as const
  }

  private async currentControlTab() {
    let tabs: PageToolboxTab[]
    try {
      tabs = await this.tabs.query({ active: true, currentWindow: true })
    }
    catch {
      return { ok: false, reason: 'active-tab-unavailable' } as const
    }
    const tab = tabs[0]
    if (tab?.id === undefined || !Number.isSafeInteger(tab.id))
      return { ok: false, reason: 'active-tab-unavailable' } as const
    return {
      ok: true,
      tabId: tab.id,
      pageTitle: tab.title || tab.url || '',
      exactOrigin: exactOriginFromUrl(tab.url),
    } as const
  }

  private async tabOrigin(tabId: number) {
    try {
      const tab = await this.tabs.get(tabId)
      return exactOriginFromUrl(tab.url)
    }
    catch {
      return null
    }
  }

  private async authenticatePort(
    port: PageToolboxHostPort,
    tabId: number,
    senderOrigin: string,
    documentId: string | undefined,
    challenge: string,
  ) {
    if (!await this.ensureInitialized() || !this.approvedOrigins.has(senderOrigin)) {
      this.disconnectPort(port)
      return
    }
    const available = await this.availableRecord()
    if (!available.ok) {
      this.disconnectPort(port)
      return
    }
    const currentOrigin = await this.tabOrigin(tabId)
    if (currentOrigin !== senderOrigin) {
      this.disconnectPort(port)
      return
    }
    try {
      if (!await this.permissions.contains({ origins: [exactOriginPattern(senderOrigin)] })) {
        this.disconnectPort(port)
        return
      }
    }
    catch {
      this.disconnectPort(port)
      return
    }
    const existing = this.sessions.get(tabId)
    if (existing)
      this.invalidateSession(existing, 'navigation')
    const generation = ++this.generation
    let sessionNonce: string
    try {
      sessionNonce = this.randomNonce()
    }
    catch {
      this.disconnectPort(port)
      return
    }
    const navigationId = typeof documentId === 'string' && documentId.length > 0 && documentId.length <= 160
      ? `document:${documentId}`
      : `navigation:${generation}:${sessionNonce.slice(0, 16)}`
    const binding: PageToolboxRuntimeBindingV1 = Object.freeze({
      moduleId: PAGE_TOOLBOX_MODULE_ID,
      exactOrigin: senderOrigin,
      tabId,
      frameId: 0,
      navigationId,
      generation,
    })
    const site = this.settings?.sites[senderOrigin]
    const tools = site ? createPageToolPlansForSite(site, this.catalog) : null
    if (!tools?.ok) {
      this.disconnectPort(port)
      return
    }
    const session: HostSession = {
      port,
      sessionNonce,
      binding,
      phase: 'initializing',
      planRevision: 1,
      controlActionIds: new Set(),
      pendingControlActionId: null,
    }
    this.sessions.set(tabId, session)
    try {
      port.postMessage(createPageToolboxInit(challenge, sessionNonce, binding, session.planRevision, tools.value))
    }
    catch {
      this.removeSession(session, true)
    }
  }

  private async reconcileMissingPermissions() {
    if (!this.stateDocument)
      return
    let next = this.stateDocument
    let changed = false
    for (const origin of this.approvedOrigins) {
      let permitted = false
      try {
        permitted = await this.permissions.contains({ origins: [exactOriginPattern(origin)] })
      }
      catch {
        continue
      }
      if (!permitted) {
        next = removePageToolboxStateSite(next, origin, this.catalog) || next
        changed = true
      }
    }
    if (!changed)
      return
    this.publishState(next)
    try {
      await this.stateStore.write(next)
    }
    catch {}
  }

  private async reconcileAllTabs() {
    let tabs: PageToolboxTab[]
    try {
      tabs = await this.tabs.query({})
    }
    catch {
      return
    }
    await Promise.all(tabs.flatMap(tab => tab.id === undefined ? [] : [this.reconcileTab(tab.id)]))
  }

  private async reconcileTab(tabId: number) {
    const origin = await this.tabOrigin(tabId)
    if (!origin || !this.approvedOrigins.has(origin))
      return false
    return this.injectTab(tabId, origin)
  }

  private async injectTab(tabId: number, expectedOrigin: string) {
    if (this.sessions.has(tabId))
      return true
    const available = await this.availableRecord()
    if (!available.ok || !this.approvedOrigins.has(expectedOrigin))
      return false
    if (await this.tabOrigin(tabId) !== expectedOrigin)
      return false
    try {
      if (!await this.permissions.contains({ origins: [exactOriginPattern(expectedOrigin)] }))
        return false
      await this.injection.inject(tabId)
      return true
    }
    catch {
      return false
    }
  }

  private async releaseOrigin(originPattern: string): Promise<
    { ok: true, released: boolean } | { ok: false, reason: PageToolboxErrorCode }
  > {
    if (!this.permissions.remove)
      return { ok: true, released: false }
    try {
      if (await this.remoteModuleUsesOrigin(originPattern) || await this.originInUse(originPattern))
        return { ok: true, released: false }
    }
    catch {
      return { ok: true, released: false }
    }
    try {
      return { ok: true, released: await this.permissions.remove({ origins: [originPattern] }) }
    }
    catch {
      return { ok: false, reason: 'permission-remove-failed' }
    }
  }

  private async remoteModuleUsesOrigin(pattern: string) {
    if (!this.registry.list)
      return true
    const records = await this.registry.list()
    return records.some((record) => {
      if (record.source !== 'user' || record.manifest.runtime !== 'remote-frame')
        return false
      return [record.sourceUrl, record.manifest.entry_url, record.manifest.icon_url].some((url) => {
        const origin = exactOriginFromUrl(url)
        return origin ? exactOriginPattern(origin) === pattern : false
      })
    })
  }

  private controlSnapshot(
    current: { readonly pageTitle: string, readonly exactOrigin: string | null },
    record: InstalledModuleRecord,
    permitted: boolean,
  ): PageToolboxControlSnapshotV1 | null {
    if (!this.stateDocument)
      return null
    const exactOrigin = current.exactOrigin
    const ready = Boolean(record.enabled
      && exactOrigin
      && permitted
      && this.approvedOrigins.has(exactOrigin))
    const access = !exactOrigin
      ? 'unsupported'
      : !record.enabled
          ? 'module-disabled'
          : ready
            ? 'ready'
            : 'site-unapproved'
    const raw = {
      schemaVersion: PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION,
      revision: exactOrigin ? this.stateDocument.siteRevisions[exactOrigin] ?? 0 : 0,
      pageTitle: current.pageTitle,
      exactOrigin,
      access,
      siteSettings: ready && exactOrigin ? this.stateDocument.settings.sites[exactOrigin] : null,
    }
    const snapshot = validatePageToolboxControlSnapshot(raw)
    return snapshot.ok ? snapshot.value : null
  }

  private snapshot() {
    return Object.freeze({
      approvedOrigins: Object.freeze([...this.approvedOrigins].sort()),
      sessions: Object.freeze([...this.sessions.values()]
        .map(session => Object.freeze({
          exactOrigin: session.binding.exactOrigin,
          tabId: session.binding.tabId,
          navigationId: session.binding.navigationId,
          generation: session.binding.generation,
          phase: session.phase,
          planRevision: session.planRevision,
        }))
        .sort((left, right) => left.tabId - right.tabId)),
    })
  }

  private publishState(state: PageToolboxStateDocumentV2) {
    this.stateDocument = state
    this.settings = state.settings
    this.approvedOrigins.clear()
    for (const origin of Object.keys(state.settings.sites))
      this.approvedOrigins.add(origin)
  }

  private publicPreparation(preparation: PrivatePreparation): PageToolboxSitePreparationV1 {
    return Object.freeze({
      token: preparation.token,
      exactOrigin: preparation.exactOrigin,
      originPattern: preparation.originPattern,
      expiresAt: preparation.expiresAt,
    })
  }

  private invalidateOrigin(origin: string, reason: PageToolboxDisposeReason) {
    for (const session of [...this.sessions.values()]) {
      if (session.binding.exactOrigin === origin)
        this.invalidateSession(session, reason)
    }
  }

  private synchronizeOrigin(origin: string) {
    const site = this.settings?.sites[origin]
    const tools = site ? createPageToolPlansForSite(site, this.catalog) : null
    if (!tools?.ok)
      return 0
    let synchronized = 0
    for (const session of [...this.sessions.values()]) {
      if (session.binding.exactOrigin !== origin)
        continue
      if (session.phase !== 'ready') {
        this.invalidateSession(session, 'tool-update')
        continue
      }
      const planRevision = session.planRevision + 1
      try {
        session.port.postMessage(createPageToolboxSync(
          session.sessionNonce,
          session.binding,
          planRevision,
          tools.value,
        ))
        session.planRevision = planRevision
        synchronized += 1
      }
      catch {
        this.invalidateSession(session, 'port-loss')
      }
    }
    return synchronized
  }

  private handleControlToggle(session: HostSession, action: PageToolboxControlAction) {
    if (session.phase !== 'ready') {
      this.postControlResult(session, action, { ok: false, reason: 'lifecycle-cancelled' })
      return
    }
    if (session.controlActionIds.has(action.actionId)) {
      if (session.pendingControlActionId === action.actionId)
        return
      this.postControlResult(session, action, { ok: false, reason: 'action-replayed' })
      return
    }
    if (session.controlActionIds.size >= PAGE_TOOLBOX_SHADOW_MAX_ACTIONS_PER_SESSION) {
      this.postControlResult(session, action, { ok: false, reason: 'action-limit' })
      return
    }
    session.controlActionIds.add(action.actionId)
    if (session.pendingControlActionId) {
      this.postControlResult(session, action, { ok: false, reason: 'action-active' })
      return
    }
    session.pendingControlActionId = action.actionId
    void this.runExclusive(() => this.applyControlToggle(session, action))
      .then(result => this.completeControlToggle(session, action, result))
      .catch(() => this.completeControlToggle(
        session,
        action,
        { ok: false, reason: 'settings-write-failed' },
      ))
  }

  private async applyControlToggle(
    session: HostSession,
    action: PageToolboxControlAction,
  ): Promise<PageToolboxControlActionResult> {
    if (!this.isCurrentControlAction(session, action.actionId))
      return { ok: false, reason: 'lifecycle-cancelled' }
    const available = await this.availableRecord()
    if (!this.isCurrentControlAction(session, action.actionId))
      return { ok: false, reason: 'lifecycle-cancelled' }
    if (!available.ok)
      return { ok: false, reason: 'module-disabled' }
    if (await this.tabOrigin(session.binding.tabId) !== session.binding.exactOrigin
      || !this.isCurrentControlAction(session, action.actionId)) {
      return { ok: false, reason: 'lifecycle-cancelled' }
    }
    const originPattern = exactOriginPattern(session.binding.exactOrigin)
    try {
      if (!await this.permissions.contains({ origins: [originPattern] }))
        return { ok: false, reason: 'permission-missing' }
    }
    catch {
      return { ok: false, reason: 'permission-check-failed' }
    }
    if (!this.isCurrentControlAction(session, action.actionId))
      return { ok: false, reason: 'lifecycle-cancelled' }
    const state = this.stateDocument
    const site = state?.settings.sites[session.binding.exactOrigin]
    if (!state || !site || !this.approvedOrigins.has(session.binding.exactOrigin))
      return { ok: false, reason: 'permission-missing' }
    const settings = action.enabled
      ? Object.hasOwn(site.toolSettings, action.toolId)
        ? structuredClone(site.toolSettings[action.toolId])
        : getDefaultPageToolSettings(action.toolId)
      : null
    const mutation = setPageToolboxStateSiteTool(
      state,
      session.binding.exactOrigin,
      action.toolId,
      action.enabled,
      settings,
      this.catalog,
    )
    if (!mutation.ok) {
      return {
        ok: false,
        reason: mutation.reason === 'revision-exhausted' ? 'revision-exhausted' : 'tool-settings-invalid',
      }
    }
    if (mutation.changed) {
      if (!this.isCurrentControlAction(session, action.actionId))
        return { ok: false, reason: 'lifecycle-cancelled' }
      try {
        await this.stateStore.write(mutation.state)
      }
      catch {
        return { ok: false, reason: 'settings-write-failed' }
      }
      if (!this.isCurrentControlAction(session, action.actionId))
        return { ok: false, reason: 'lifecycle-cancelled' }
    }
    this.publishState(mutation.state)
    if (mutation.changed)
      this.synchronizeOrigin(session.binding.exactOrigin)
    return { ok: true, changed: mutation.changed }
  }

  private completeControlToggle(
    session: HostSession,
    action: PageToolboxControlAction,
    result: PageToolboxControlActionResult,
  ) {
    if (!this.isCurrentControlAction(session, action.actionId))
      return
    session.pendingControlActionId = null
    this.postControlResult(session, action, result)
  }

  private isCurrentControlAction(session: HostSession, actionId: string) {
    return this.sessions.get(session.binding.tabId) === session
      && session.phase === 'ready'
      && session.pendingControlActionId === actionId
  }

  private postControlResult(
    session: HostSession,
    action: PageToolboxControlAction,
    result: PageToolboxControlActionResult,
  ) {
    if (this.sessions.get(session.binding.tabId) !== session)
      return false
    try {
      session.port.postMessage(createPageToolboxControlResult(
        session.sessionNonce,
        session.binding,
        action.actionId,
        action.toolId,
        action.enabled,
        result,
      ))
      return true
    }
    catch {
      this.invalidateSession(session, 'port-loss')
      return false
    }
  }

  private invalidateTab(tabId: number, reason: PageToolboxDisposeReason) {
    const session = this.sessions.get(tabId)
    if (session)
      this.invalidateSession(session, reason)
  }

  private invalidateAll(reason: PageToolboxDisposeReason) {
    for (const session of [...this.sessions.values()])
      this.invalidateSession(session, reason)
  }

  private invalidateSession(session: HostSession, reason: PageToolboxDisposeReason) {
    if (this.sessions.get(session.binding.tabId) !== session)
      return
    this.sessions.delete(session.binding.tabId)
    try {
      session.port.postMessage(createPageToolboxDispose(session.sessionNonce, session.binding, reason))
    }
    catch {}
    this.disconnectPort(session.port)
  }

  private removeSession(session: HostSession, disconnect: boolean) {
    if (this.sessions.get(session.binding.tabId) === session)
      this.sessions.delete(session.binding.tabId)
    if (disconnect)
      this.disconnectPort(session.port)
  }

  private disconnectPort(port: PageToolboxHostPort) {
    try {
      port.disconnect()
    }
    catch {}
  }

  private randomNonce() {
    const bytes = this.entropy()
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== PAGE_TOOLBOX_NONCE_BYTES)
      throw new TypeError('Page Toolbox entropy source returned an invalid nonce')
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  }

  private runExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}
