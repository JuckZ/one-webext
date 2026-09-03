import type { CapabilityRpcCatalog, CapabilityRpcSessionBinding } from '@oneweb/module-sdk'
import type {
  ModuleCapabilityDispatcher,
  ModuleCapabilityHandlers,
} from './capability-dispatcher'
import type { InstalledModuleRecord, ModuleContextId } from './types'
import { createModuleCapabilityDispatcher } from './capability-dispatcher'
import {
  createModuleEnvelope,
  isTrustedModuleHello,
  type ModuleBridgeEnvelope,
  validateModulePortMessage,
} from './protocol'

export interface ModuleContextUpdate {
  revision: string
  contexts: Partial<Record<ModuleContextId, unknown>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function selectGrantedModuleContexts(
  record: InstalledModuleRecord,
  source: Partial<Record<ModuleContextId, unknown>>,
) {
  const contexts: Partial<Record<ModuleContextId, unknown>> = {}
  for (const contextId of record.grantedContexts) {
    const value = source[contextId]
    if (!isRecord(value))
      continue
    const declaredFields = record.manifest.context_fields[contextId] || []
    const grantedFields = record.grantedContextFields[contextId] || []
    const selected: Record<string, unknown> = {}
    for (const field of grantedFields) {
      if (declaredFields.includes(field) && Object.hasOwn(value, field))
        selected[field] = value[field]
    }
    if (Object.keys(selected).length)
      contexts[contextId] = selected
  }
  return contexts
}

interface ModuleFrameHostOptions {
  frame: HTMLIFrameElement
  record: InstalledModuleRecord
  extensionOrigin: string
  window?: Window
  resolveInitFields?: (_record: InstalledModuleRecord) => Promise<Record<string, unknown>>
  onReady?: () => void
  onContextAccepted?: (_message: ModuleBridgeEnvelope) => void
  onStatus?: (_message: ModuleBridgeEnvelope) => void
  capabilityRpc?: {
    catalog: CapabilityRpcCatalog
    openSession?: (_binding: CapabilityRpcSessionBinding) => Promise<void>
    createHandlers?: (_binding: CapabilityRpcSessionBinding) => ModuleCapabilityHandlers<CapabilityRpcCatalog>
    closeSession?: (_binding: CapabilityRpcSessionBinding) => void | Promise<void>
    handlers?: ModuleCapabilityHandlers<CapabilityRpcCatalog>
  }
}

function createSessionNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export class ModuleFrameHost {
  private readonly frame: HTMLIFrameElement
  private readonly record: InstalledModuleRecord
  private readonly extensionOrigin: string
  private readonly entryUrl: string
  private readonly hostWindow: Window
  private readonly resolveInitFields?: ModuleFrameHostOptions['resolveInitFields']
  private readonly onReady?: ModuleFrameHostOptions['onReady']
  private readonly onContextAccepted?: ModuleFrameHostOptions['onContextAccepted']
  private readonly onStatus?: ModuleFrameHostOptions['onStatus']
  private readonly capabilityRpc?: ModuleFrameHostOptions['capabilityRpc']
  private activeChallenge = ''
  private sessionNonce = ''
  private port: MessagePort | null = null
  private capabilityDispatcher: ModuleCapabilityDispatcher | null = null
  private capabilityBinding: CapabilityRpcSessionBinding | null = null
  private sessionGeneration = 0
  private ready = false
  private skipNextLoadReset = false
  private loadAwaitingHello = false
  private pendingHello: ModuleBridgeEnvelope | null = null
  private currentContext: ModuleContextUpdate | null = null
  private currentContextSignature = ''
  private contextRevision = 0

  constructor({
    frame,
    record,
    extensionOrigin,
    window = globalThis.window,
    resolveInitFields,
    onReady,
    onContextAccepted,
    onStatus,
    capabilityRpc,
  }: ModuleFrameHostOptions) {
    if (record.manifest.runtime !== 'remote-frame')
      throw new Error('ModuleFrameHost requires a remote-frame module')
    this.frame = frame
    this.record = record
    this.extensionOrigin = extensionOrigin
    this.entryUrl = record.manifest.entry_url
    this.hostWindow = window
    this.resolveInitFields = resolveInitFields
    this.onReady = onReady
    this.onContextAccepted = onContextAccepted
    this.onStatus = onStatus
    this.capabilityRpc = capabilityRpc
  }

  start() {
    const entry = new URL(this.entryUrl)
    entry.searchParams.set('parentOrigin', this.extensionOrigin)
    entry.searchParams.set('moduleId', this.record.manifest.id)
    this.hostWindow.addEventListener('message', this.handleWindowMessage)
    this.frame.addEventListener('load', this.handleFrameLoad)
    this.frame.src = entry.href
    this.frame.title = `${this.record.manifest.name} · OneWeb module`
  }

  destroy() {
    this.hostWindow.removeEventListener('message', this.handleWindowMessage)
    this.frame.removeEventListener('load', this.handleFrameLoad)
    this.pendingHello = null
    this.skipNextLoadReset = false
    this.loadAwaitingHello = false
    this.resetSession()
  }

  updateContext(update: ModuleContextUpdate) {
    const contexts = selectGrantedModuleContexts(this.record, update.contexts)
    const signature = JSON.stringify(contexts)
    if (signature === this.currentContextSignature)
      return
    this.currentContextSignature = signature
    this.contextRevision++
    this.currentContext = { revision: String(this.contextRevision), contexts }
    this.sendCurrentContext()
  }

  private readonly handleFrameLoad = () => {
    if (this.pendingHello) {
      const message = this.pendingHello
      this.pendingHello = null
      this.skipNextLoadReset = false
      this.loadAwaitingHello = false
      this.resetSession()
      void this.acceptHello(message)
      return
    }
    if (this.skipNextLoadReset) {
      this.skipNextLoadReset = false
      return
    }
    this.resetSession()
    this.loadAwaitingHello = true
  }

  private readonly handleWindowMessage = (event: MessageEvent) => {
    if (!isTrustedModuleHello(event, this.record, this.frame.contentWindow))
      return
    if (event.data.challenge === this.activeChallenge || event.data.challenge === this.pendingHello?.challenge)
      return
    if (this.port) {
      this.pendingHello = event.data
      return
    }
    if (this.loadAwaitingHello)
      this.loadAwaitingHello = false
    else
      this.skipNextLoadReset = true
    void this.acceptHello(event.data)
  }

  private async acceptHello(message: ModuleBridgeEnvelope) {
    if (!message.challenge || message.challenge === this.activeChallenge || this.port)
      return
    const challenge = message.challenge
    this.activeChallenge = challenge
    const sessionNonce = createSessionNonce()
    const initFields = await this.resolveInitFields?.(this.record).catch(() => ({})) || {}
    if (this.activeChallenge !== challenge || this.port)
      return

    const capabilityBinding = {
      moduleId: this.record.manifest.id,
      sessionId: sessionNonce,
      generation: this.sessionGeneration + 1,
    }
    let capabilityHandlers = this.capabilityRpc?.handlers
    if (this.capabilityRpc) {
      await this.capabilityRpc.openSession?.(capabilityBinding).catch(() => undefined)
      if (this.activeChallenge !== challenge || this.port) {
        void this.capabilityRpc.closeSession?.(capabilityBinding)
        return
      }
      capabilityHandlers = this.capabilityRpc.createHandlers?.(capabilityBinding) || capabilityHandlers
      this.sessionGeneration = capabilityBinding.generation
      this.capabilityBinding = capabilityBinding
    }
    const channel = new MessageChannel()
    this.port = channel.port1
    this.sessionNonce = sessionNonce
    if (this.capabilityRpc) {
      this.capabilityDispatcher = createModuleCapabilityDispatcher({
        binding: capabilityBinding,
        catalog: this.capabilityRpc.catalog,
        manifestCapabilities: this.record.manifest.capabilities,
        grantedCapabilities: this.record.grantedCapabilities,
        handlers: capabilityHandlers,
        port: this.port,
      })
    }
    this.port.addEventListener('message', this.handlePortMessage)
    this.port.addEventListener('messageerror', this.handlePortFailure)
    this.port.start()
    this.frame.contentWindow?.postMessage(
      createModuleEnvelope(this.record, 'MODULE_INIT', {
        ...initFields,
        challenge,
        sessionNonce,
        ...(this.capabilityRpc ? { capabilityGeneration: this.sessionGeneration } : {}),
        grantedContexts: this.record.grantedContexts,
        grantedContextFields: this.record.grantedContextFields,
        grantedCapabilities: this.record.grantedCapabilities,
      }),
      new URL(this.entryUrl).origin,
      [channel.port2],
    )
  }

  private readonly handlePortMessage = (event: MessageEvent) => {
    const message = validateModulePortMessage(event.data, this.record, this.sessionNonce)
    if (!message) {
      if (this.ready)
        this.capabilityDispatcher?.dispatch(event.data)
      return
    }
    if (message.type === 'MODULE_READY') {
      if (this.ready)
        return
      this.ready = true
      this.onReady?.()
      this.sendCurrentContext()
    }
    else if (message.type === 'CONTEXT_ACCEPTED') {
      this.onContextAccepted?.(message)
    }
    else if (message.type === 'MODULE_STATUS') {
      this.onStatus?.(message)
    }
  }

  private readonly handlePortFailure = () => {
    this.resetSession()
  }

  private sendCurrentContext() {
    if (!this.ready || !this.port || !this.currentContext)
      return
    this.port.postMessage(createModuleEnvelope(this.record, 'CONTEXT_UPDATE', {
      sessionNonce: this.sessionNonce,
      ...this.currentContext,
    }))
  }

  private resetSession() {
    this.capabilityDispatcher?.destroy()
    this.capabilityDispatcher = null
    if (this.capabilityBinding)
      void this.capabilityRpc?.closeSession?.(this.capabilityBinding)
    this.capabilityBinding = null
    this.port?.removeEventListener('message', this.handlePortMessage)
    this.port?.removeEventListener('messageerror', this.handlePortFailure)
    this.port?.close()
    this.port = null
    this.activeChallenge = ''
    this.sessionNonce = ''
    this.ready = false
  }
}
