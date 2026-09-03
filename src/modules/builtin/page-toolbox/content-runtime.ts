import type {
  PageToolboxDisposeReason,
  PageToolboxRuntimeBindingV1,
  PageToolPlanV1,
} from './contracts'
import type { PageToolboxHostMessage } from './protocol'
import type { PageToolId } from './tool-catalog'
import { PAGE_TOOLBOX_NONCE_BYTES, PAGE_TOOLBOX_PORT_NAME } from './contracts'
import {
  createPageToolboxControlToggle,
  createPageToolboxDisposed,
  createPageToolboxHello,
  createPageToolboxReady,
  createPageToolboxSynced,
  samePageToolboxBinding,
  validatePageToolboxHostMessage,
} from './protocol'
import { isPageToolId } from './tool-catalog'

export type PageToolboxContentRuntimeStatus = 'idle' | 'hello-sent' | 'connected' | 'destroyed'

export interface PageToolboxPortEvent<Message = unknown> {
  addListener: (_listener: (_message: Message) => void) => void
  removeListener: (_listener: (_message: Message) => void) => void
}

export interface PageToolboxDisconnectEvent {
  addListener: (_listener: () => void) => void
  removeListener: (_listener: () => void) => void
}

export interface PageToolboxContentPort {
  readonly onMessage: PageToolboxPortEvent
  readonly onDisconnect: PageToolboxDisconnectEvent
  postMessage: (_message: unknown) => void
  disconnect: () => void
}

export interface PageToolboxContentRuntimeOptions {
  readonly connect: (_name: typeof PAGE_TOOLBOX_PORT_NAME) => PageToolboxContentPort
  readonly entropy?: () => Uint8Array
  readonly onConnected?: (
    _binding: PageToolboxRuntimeBindingV1,
    _tools: readonly PageToolPlanV1[],
  ) => void
  readonly onTools?: (
    _tools: readonly PageToolPlanV1[],
    _binding: PageToolboxRuntimeBindingV1,
  ) => void
  readonly onDispose?: (_reason: PageToolboxDisposeReason | 'port-loss') => void
  readonly onControlResult?: (
    _result: Extract<PageToolboxHostMessage, { type: 'PAGE_TOOLBOX_CONTROL_RESULT' }>,
  ) => void
}

function hexadecimalEntropy(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== PAGE_TOOLBOX_NONCE_BYTES)
    throw new TypeError(`Page Toolbox lifecycle entropy must contain ${PAGE_TOOLBOX_NONCE_BYTES} bytes`)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export class PageToolboxContentRuntime {
  private readonly connect: PageToolboxContentRuntimeOptions['connect']
  private readonly entropy: () => Uint8Array
  private readonly onConnected?: PageToolboxContentRuntimeOptions['onConnected']
  private readonly onTools?: PageToolboxContentRuntimeOptions['onTools']
  private readonly onDispose?: PageToolboxContentRuntimeOptions['onDispose']
  private readonly onControlResult?: PageToolboxContentRuntimeOptions['onControlResult']
  private port: PageToolboxContentPort | null = null
  private challenge: string | null = null
  private sessionNonce: string | null = null
  private binding: PageToolboxRuntimeBindingV1 | null = null
  private planRevision = 0
  private actionSequence = 0
  private pendingAction: Readonly<{ actionId: string, toolId: PageToolId, enabled: boolean }> | null = null
  private state: PageToolboxContentRuntimeStatus = 'idle'

  constructor({
    connect,
    entropy = () => crypto.getRandomValues(new Uint8Array(PAGE_TOOLBOX_NONCE_BYTES)),
    onConnected,
    onTools,
    onDispose,
    onControlResult,
  }: PageToolboxContentRuntimeOptions) {
    this.connect = connect
    this.entropy = entropy
    this.onConnected = onConnected
    this.onTools = onTools
    this.onDispose = onDispose
    this.onControlResult = onControlResult
  }

  get status() {
    return this.state
  }

  get currentBinding() {
    return this.binding ? structuredClone(this.binding) : null
  }

  start() {
    if (this.state !== 'idle')
      return false
    let port: PageToolboxContentPort
    let challenge: string
    try {
      challenge = hexadecimalEntropy(this.entropy())
      port = this.connect(PAGE_TOOLBOX_PORT_NAME)
    }
    catch {
      this.state = 'destroyed'
      return false
    }
    this.challenge = challenge
    this.port = port
    this.state = 'hello-sent'
    port.onMessage.addListener(this.handleMessage)
    port.onDisconnect.addListener(this.handleDisconnect)
    try {
      port.postMessage(createPageToolboxHello(challenge))
      return true
    }
    catch {
      this.finish('port-loss', true)
      return false
    }
  }

  destroy(reason: PageToolboxDisposeReason | 'port-loss' = 'port-loss') {
    if (this.state === 'destroyed')
      return false
    this.finish(reason, true)
    return true
  }

  requestToolToggle(toolId: PageToolId, enabled: boolean) {
    if (this.state !== 'connected'
      || !this.port
      || !this.binding
      || !this.sessionNonce
      || !this.challenge
      || this.pendingAction
      || !isPageToolId(toolId)
      || typeof enabled !== 'boolean') {
      return null
    }
    const actionId = `shadow:${this.binding.generation}:${++this.actionSequence}:${this.challenge.slice(0, 24)}`
    const message = createPageToolboxControlToggle(
      this.sessionNonce,
      this.binding,
      actionId,
      toolId,
      enabled,
    )
    this.pendingAction = Object.freeze({ actionId, toolId, enabled })
    try {
      this.port.postMessage(message)
      return actionId
    }
    catch {
      this.pendingAction = null
      this.finish('port-loss', true)
      return null
    }
  }

  private readonly handleMessage = (raw: unknown) => {
    if (this.state === 'destroyed')
      return
    const message = validatePageToolboxHostMessage(raw)
    if (!message)
      return
    if (message.type === 'PAGE_TOOLBOX_INIT') {
      if (this.state !== 'hello-sent'
        || message.challenge !== this.challenge
        || this.sessionNonce !== null
        || this.binding !== null) {
        this.finish('port-loss', true)
        return
      }
      this.sessionNonce = message.sessionNonce
      this.binding = message.binding
      try {
        this.onConnected?.(structuredClone(message.binding), structuredClone(message.tools))
        this.port!.postMessage(createPageToolboxReady(
          message.sessionNonce,
          message.binding,
          message.planRevision,
        ))
      }
      catch {
        this.finish('port-loss', true)
        return
      }
      this.planRevision = message.planRevision
      this.state = 'connected'
      return
    }
    if (this.state !== 'connected'
      || message.sessionNonce !== this.sessionNonce
      || !this.binding
      || !samePageToolboxBinding(message.binding, this.binding)) {
      return
    }
    if (message.type === 'PAGE_TOOLBOX_SYNC') {
      if (message.planRevision <= this.planRevision)
        return
      try {
        this.onTools?.(structuredClone(message.tools), structuredClone(message.binding))
        this.port!.postMessage(createPageToolboxSynced(
          message.sessionNonce,
          message.binding,
          message.planRevision,
        ))
        this.planRevision = message.planRevision
      }
      catch {
        this.finish('port-loss', true)
      }
      return
    }
    if (message.type === 'PAGE_TOOLBOX_CONTROL_RESULT') {
      if (!this.pendingAction
        || message.actionId !== this.pendingAction.actionId
        || message.toolId !== this.pendingAction.toolId
        || message.enabled !== this.pendingAction.enabled) {
        return
      }
      this.pendingAction = null
      try {
        this.onControlResult?.(structuredClone(message))
      }
      catch {
        this.finish('port-loss', true)
      }
      return
    }
    try {
      this.port!.postMessage(createPageToolboxDisposed(message.sessionNonce, message.binding))
    }
    catch {}
    this.finish(message.reason, true)
  }

  private readonly handleDisconnect = () => {
    if (this.state !== 'destroyed')
      this.finish('port-loss', false)
  }

  private finish(reason: PageToolboxDisposeReason | 'port-loss', disconnect: boolean) {
    const port = this.port
    this.state = 'destroyed'
    this.port = null
    this.challenge = null
    this.sessionNonce = null
    this.binding = null
    this.planRevision = 0
    this.actionSequence = 0
    this.pendingAction = null
    if (port) {
      port.onMessage.removeListener(this.handleMessage)
      port.onDisconnect.removeListener(this.handleDisconnect)
      if (disconnect) {
        try {
          port.disconnect()
        }
        catch {}
      }
    }
    this.onDispose?.(reason)
  }
}
