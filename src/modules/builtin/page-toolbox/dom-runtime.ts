import type {
  PageToolAuthorityV1,
  PageToolboxDisposeReason,
  PageToolboxRuntimeBindingV1,
  PageToolJsonValue,
  PageToolPlanV1,
  PageToolRuntimeBindingV1,
} from './contracts'
import type { PageToolDisposeReason, PageToolLifecycleState } from './lifecycle'
import type { PageToolResourceAdapter, PageToolResourceEntry } from './resource-ledger'
import type {
  FreePageEditSettingsV1,
  PageToolId,
  PasswordVisibilitySettingsV1,
  SelectionCopyReleaseSettingsV1,
} from './tool-catalog'
import {
  PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION,
  PAGE_TOOLBOX_MODULE_ID,
} from './contracts'
import {
  createPageToolLifecycleState,
  reducePageToolLifecycle,
} from './lifecycle'
import { PageToolResourceLedger } from './resource-ledger'
import { isPageToolId, PAGE_TOOL_CATALOG } from './tool-catalog'
import {
  createPageToolAuthority,
  validatePageToolPlans,
  validatePageToolRuntimeBinding,
} from './validation'

const PASSWORD_TRACKED_INPUT_LIMIT = 256
const RELEASE_STYLE_TEXT = ':root,body,*{user-select:text!important;-webkit-user-select:text!important}'

interface AttributeHandle {
  readonly kind: 'attribute'
  readonly element: Element
  readonly name: string
  readonly ownershipToken: string
  observer: MutationObserver
  expected: string | null
  owned: boolean
  priorPresent: boolean
  priorValue: string | null
  selfRestored: boolean
}

interface ListenerHandle {
  readonly kind: 'listener'
  readonly target: EventTarget
  readonly type: string
  readonly listener: EventListener
  readonly options: AddEventListenerOptions | boolean | undefined
}

interface ObserverHandle {
  readonly kind: 'observer'
  readonly observer: MutationObserver
}

interface StyleHandle {
  readonly kind: 'style'
  readonly node: HTMLStyleElement
  readonly parent: Node
  readonly ownershipToken: string
  expectedText: string
}

interface DomOwnershipState {
  readonly attributes: WeakMap<Element, Map<string, {
    readonly token: string
    readonly priorPresent: boolean
    readonly priorValue: string | null
  }>>
  readonly nodes: WeakMap<Node, string>
}

const ownershipByDocument = new WeakMap<Document, DomOwnershipState>()

function ownershipFor(document: Document): DomOwnershipState {
  let ownership = ownershipByDocument.get(document)
  if (!ownership) {
    ownership = {
      attributes: new WeakMap(),
      nodes: new WeakMap(),
    }
    ownershipByDocument.set(document, ownership)
  }
  return ownership
}

type PageToolDomHandle = AttributeHandle | ListenerHandle | ObserverHandle | StyleHandle
type DomResourceEntry = PageToolResourceEntry<PageToolDomHandle, string | null>

class PageToolDomResourceAdapter implements PageToolResourceAdapter<PageToolDomHandle, string | null> {
  private readonly ownership: DomOwnershipState

  constructor(ownership: DomOwnershipState) {
    this.ownership = ownership
  }

  isOwned(entry: Extract<DomResourceEntry, { kind: 'owned-node' | 'owned-style' | 'dom-prior-value' }>) {
    const handle = entry.handle
    if (entry.kind === 'dom-prior-value') {
      return handle.kind === 'attribute'
        && handle.ownershipToken === entry.ownershipToken
        && this.ownership.attributes.get(handle.element)?.get(handle.name)?.token === entry.ownershipToken
        && handle.owned
        && handle.element.getAttribute(handle.name) === handle.expected
    }
    return handle.kind === 'style'
      && handle.ownershipToken === entry.ownershipToken
      && this.ownership.nodes.get(handle.node) === entry.ownershipToken
      && handle.node.parentNode === handle.parent
      && handle.node.textContent === handle.expectedText
  }

  release(entry: Exclude<DomResourceEntry, { kind: 'dom-prior-value' }>) {
    const handle = entry.handle
    if (entry.kind === 'listener' && handle.kind === 'listener') {
      handle.target.removeEventListener(handle.type, handle.listener, handle.options)
      return
    }
    if (entry.kind === 'observer' && handle.kind === 'observer') {
      handle.observer.disconnect()
      return
    }
    if ((entry.kind === 'owned-node' || entry.kind === 'owned-style') && handle.kind === 'style') {
      this.ownership.nodes.delete(handle.node)
      handle.node.remove()
      return
    }
    throw new TypeError('Page Toolbox DOM resource kind mismatch')
  }

  restore(entry: Extract<DomResourceEntry, { kind: 'dom-prior-value' }>) {
    const handle = entry.handle
    if (handle.kind !== 'attribute')
      throw new TypeError('Page Toolbox DOM prior-value handle is invalid')
    if (entry.prior.present)
      handle.element.setAttribute(handle.name, entry.prior.value || '')
    else
      handle.element.removeAttribute(handle.name)
    handle.observer.takeRecords()
    const owners = this.ownership.attributes.get(handle.element)
    if (owners?.get(handle.name)?.token === handle.ownershipToken)
      owners.delete(handle.name)
    handle.owned = false
    handle.selfRestored = true
  }
}

class PageToolDomContext {
  readonly authority: PageToolAuthorityV1
  private readonly binding: PageToolRuntimeBindingV1
  private readonly document: Document
  private readonly ownership: DomOwnershipState
  private readonly ledger: PageToolResourceLedger<PageToolDomHandle, string | null>
  private readonly attributes = new WeakMap<Element, Map<string, AttributeHandle>>()
  private resourceSequence = 0

  constructor(document: Document, binding: PageToolRuntimeBindingV1) {
    this.document = document
    this.ownership = ownershipFor(document)
    this.binding = binding
    this.authority = createPageToolAuthority(binding)
    this.ledger = new PageToolResourceLedger(binding, new PageToolDomResourceAdapter(this.ownership))
  }

  get resources() {
    return this.ledger.size
  }

  addListener(
    target: EventTarget,
    type: 'click' | 'copy' | 'contextmenu' | 'selectstart',
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ) {
    target.addEventListener(type, listener, options)
    const handle: ListenerHandle = { kind: 'listener', target, type, listener, options }
    if (!this.register({ kind: 'listener', handle })) {
      target.removeEventListener(type, listener, options)
      throw new Error('Unable to ledger Page Toolbox listener')
    }
  }

  addObserver(observer: MutationObserver, target: Node, options: MutationObserverInit) {
    observer.observe(target, options)
    if (!this.register({ kind: 'observer', handle: { kind: 'observer', observer } })) {
      observer.disconnect()
      throw new Error('Unable to ledger Page Toolbox observer')
    }
  }

  ownAttribute(element: Element, name: 'type' | 'contenteditable', value: string) {
    const existing = this.attributes.get(element)?.get(name)
    if (existing) {
      const currentOwner = this.ownership.attributes.get(element)?.get(name)
      if (existing.owned && currentOwner?.token !== existing.ownershipToken) {
        existing.owned = false
        existing.selfRestored = false
      }
      if (!existing.owned && !existing.selfRestored)
        return null
      element.setAttribute(name, value)
      existing.observer.takeRecords()
      const owners = this.ownership.attributes.get(element) || new Map()
      owners.set(name, {
        token: existing.ownershipToken,
        priorPresent: existing.priorPresent,
        priorValue: existing.priorValue,
      })
      this.ownership.attributes.set(element, owners)
      existing.expected = value
      existing.owned = true
      existing.selfRestored = false
      return existing
    }

    const priorOwner = this.ownership.attributes.get(element)?.get(name)
    const priorPresent = priorOwner?.priorPresent ?? element.hasAttribute(name)
    const priorValue = priorOwner ? priorOwner.priorValue : element.getAttribute(name)
    const ownershipToken = this.token(`attribute:${name}`)
    let handle!: AttributeHandle
    const observer = new this.document.defaultView!.MutationObserver(() => {
      handle.owned = false
      handle.selfRestored = false
      const owners = this.ownership.attributes.get(element)
      if (owners?.get(name)?.token === ownershipToken)
        owners.delete(name)
    })
    handle = {
      kind: 'attribute',
      element,
      name,
      ownershipToken,
      observer,
      expected: value,
      owned: true,
      priorPresent,
      priorValue,
      selfRestored: false,
    }
    observer.observe(element, { attributes: true, attributeFilter: [name] })
    element.setAttribute(name, value)
    observer.takeRecords()
    const owners = this.ownership.attributes.get(element) || new Map()
    owners.set(name, { token: ownershipToken, priorPresent, priorValue })
    this.ownership.attributes.set(element, owners)
    if (!this.register({ kind: 'observer', handle: { kind: 'observer', observer } })) {
      observer.disconnect()
      owners.delete(name)
      if (priorPresent)
        element.setAttribute(name, priorValue || '')
      else
        element.removeAttribute(name)
      throw new Error('Unable to ledger Page Toolbox attribute observer')
    }
    const entry: DomResourceEntry = {
      id: this.id(`prior:${name}`),
      kind: 'dom-prior-value',
      handle,
      ownershipToken,
      property: name,
      prior: { present: priorPresent, value: priorValue },
    }
    if (!this.ledger.register(this.authority, entry).ok) {
      observer.disconnect()
      owners.delete(name)
      if (priorPresent)
        element.setAttribute(name, priorValue || '')
      else
        element.removeAttribute(name)
      throw new Error('Unable to ledger Page Toolbox attribute')
    }
    const values = this.attributes.get(element) || new Map<string, AttributeHandle>()
    values.set(name, handle)
    this.attributes.set(element, values)
    return handle
  }

  restoreAttribute(handle: AttributeHandle) {
    if (!handle.owned || handle.element.getAttribute(handle.name) !== handle.expected)
      return false
    const map = this.attributes.get(handle.element)
    const entry = map?.get(handle.name)
    if (entry !== handle)
      return false
    // The original prior value is captured by the handle's first mutation. Password inputs are
    // always qualified from type=password, so a manual hide restores that exact safe value.
    handle.element.setAttribute(handle.name, 'password')
    handle.observer.takeRecords()
    const owners = this.ownership.attributes.get(handle.element)
    if (owners?.get(handle.name)?.token === handle.ownershipToken)
      owners.delete(handle.name)
    handle.owned = false
    handle.selfRestored = true
    return true
  }

  addOwnedStyle(text: string) {
    const node = this.document.createElement('style')
    const parent = this.document.head || this.document.documentElement
    const ownershipToken = this.token('style')
    node.textContent = text
    parent.append(node)
    this.ownership.nodes.set(node, ownershipToken)
    const handle: StyleHandle = { kind: 'style', node, parent, ownershipToken, expectedText: text }
    if (!this.ledger.register(this.authority, {
      id: this.id('owned-style'),
      kind: 'owned-style',
      handle,
      ownershipToken,
    }).ok) {
      node.remove()
      throw new Error('Unable to ledger Page Toolbox style')
    }
    return handle
  }

  updateOwnedStyle(handle: StyleHandle, text: string) {
    if (this.ownership.nodes.get(handle.node) !== handle.ownershipToken
      || handle.node.parentNode !== handle.parent
      || handle.node.textContent !== handle.expectedText) {
      return false
    }
    handle.node.textContent = text
    handle.expectedText = text
    return true
  }

  dispose() {
    return this.ledger.dispose(this.authority)
  }

  private register(entry: Omit<DomResourceEntry, 'id'>) {
    return this.ledger.register(this.authority, { ...entry, id: this.id(entry.kind) } as DomResourceEntry).ok
  }

  private id(prefix: string) {
    return `${prefix}:${++this.resourceSequence}`
  }

  private token(prefix: string) {
    return `${this.binding.toolId}:${this.binding.generation}:${prefix}:${this.resourceSequence + 1}`
  }
}

interface PageToolImplementation {
  update: (_settings: PageToolJsonValue) => void
  dispose: () => void
  readonly resourceCount: number
}

class PasswordVisibilityTool implements PageToolImplementation {
  private settings: PasswordVisibilitySettingsV1
  private readonly tracked = new Map<HTMLInputElement, AttributeHandle>()

  constructor(private readonly context: PageToolDomContext, private readonly document: Document, settings: PageToolJsonValue) {
    this.settings = settings as unknown as PasswordVisibilitySettingsV1
    context.addListener(document, 'click', this.onClick, true)
  }

  get resourceCount() { return this.context.resources }

  update(settings: PageToolJsonValue) {
    this.settings = settings as unknown as PasswordVisibilitySettingsV1
  }

  dispose() {}

  private readonly onClick: EventListener = (event) => {
    const required = this.settings.gesture === 'double-click' ? 2 : 3
    if ((event as MouseEvent).detail !== required)
      return
    const target = event.target
    const Input = this.document.defaultView?.HTMLInputElement
    if (!Input || !(target instanceof Input) || target.disabled || !target.isConnected)
      return
    const tracked = this.tracked.get(target)
    if (tracked?.owned) {
      this.context.restoreAttribute(tracked)
      return
    }
    if (tracked && !tracked.selfRestored)
      return
    if (target.type !== 'password' || (!tracked && this.tracked.size >= PASSWORD_TRACKED_INPUT_LIMIT))
      return
    const handle = this.context.ownAttribute(target, 'type', 'text')
    if (handle)
      this.tracked.set(target, handle)
  }
}

class FreePageEditTool implements PageToolImplementation {
  private settings: FreePageEditSettingsV1
  private readonly bodies = new Set<HTMLElement>()

  constructor(private readonly context: PageToolDomContext, private readonly document: Document, settings: PageToolJsonValue) {
    this.settings = settings as unknown as FreePageEditSettingsV1
    this.ensureBody()
    const observer = new document.defaultView!.MutationObserver(() => this.ensureBody())
    context.addObserver(observer, document.documentElement, { childList: true, subtree: true })
  }

  get resourceCount() { return this.context.resources }

  update(settings: PageToolJsonValue) {
    this.settings = settings as unknown as FreePageEditSettingsV1
    for (const body of this.bodies)
      this.context.ownAttribute(body, 'contenteditable', this.value)
    this.ensureBody()
  }

  dispose() {}

  private get value() {
    return this.settings.mode === 'plain-text' ? 'plaintext-only' : 'true'
  }

  private ensureBody() {
    const body = this.document.body
    if (!body || this.bodies.has(body))
      return
    this.context.ownAttribute(body, 'contenteditable', this.value)
    this.bodies.add(body)
  }
}

class SelectionCopyReleaseTool implements PageToolImplementation {
  private settings: SelectionCopyReleaseSettingsV1
  private readonly style: StyleHandle

  constructor(private readonly context: PageToolDomContext, document: Document, settings: PageToolJsonValue) {
    this.settings = settings as unknown as SelectionCopyReleaseSettingsV1
    this.style = context.addOwnedStyle(this.settings.selection ? RELEASE_STYLE_TEXT : '')
    context.addListener(document, 'copy', this.onCopy, true)
    context.addListener(document, 'contextmenu', this.onContextMenu, true)
    context.addListener(document, 'selectstart', this.onSelectStart, true)
  }

  get resourceCount() { return this.context.resources }

  update(settings: PageToolJsonValue) {
    const next = settings as unknown as SelectionCopyReleaseSettingsV1
    if (!this.context.updateOwnedStyle(this.style, next.selection ? RELEASE_STYLE_TEXT : ''))
      throw new Error('Selection release style ownership was replaced')
    this.settings = next
  }

  dispose() {}

  private readonly onCopy: EventListener = event => this.settings.copy && event.stopImmediatePropagation()
  private readonly onContextMenu: EventListener = event => this.settings.contextMenu && event.stopImmediatePropagation()
  private readonly onSelectStart: EventListener = event => this.settings.selection && event.stopImmediatePropagation()
}

function implementationFor(
  toolId: PageToolId,
  context: PageToolDomContext,
  document: Document,
  settings: PageToolJsonValue,
): PageToolImplementation {
  if (toolId === 'password-visibility')
    return new PasswordVisibilityTool(context, document, settings)
  if (toolId === 'free-page-edit')
    return new FreePageEditTool(context, document, settings)
  return new SelectionCopyReleaseTool(context, document, settings)
}

class ManagedPageTool {
  private readonly document: Document
  private state: PageToolLifecycleState
  private implementation: PageToolImplementation | null = null
  private sequence = 0

  constructor(
    document: Document,
    readonly binding: PageToolRuntimeBindingV1,
    settings: PageToolJsonValue,
  ) {
    this.document = document
    this.state = createPageToolLifecycleState(binding)
    this.apply(settings)
  }

  get resourceCount() { return this.implementation?.resourceCount || 0 }

  update(settings: PageToolJsonValue) {
    const operationId = this.operationId('update')
    const start = reducePageToolLifecycle(this.state, {
      type: 'UPDATE',
      authority: this.state.authority,
      operationId,
      settings,
    }, PAGE_TOOL_CATALOG)
    if (start.effect === 'idempotent')
      return true
    if (start.effect !== 'transitioned')
      return false
    this.state = start.state
    try {
      this.implementation!.update(settings)
      this.state = reducePageToolLifecycle(this.state, {
        type: 'UPDATE_SUCCEEDED',
        authority: this.state.authority,
        operationId,
      }, PAGE_TOOL_CATALOG).state
      return true
    }
    catch {
      this.implementation?.dispose()
      this.implementation = null
      this.state = reducePageToolLifecycle(this.state, {
        type: 'UPDATE_FAILED',
        authority: this.state.authority,
        operationId,
      }, PAGE_TOOL_CATALOG).state
      return false
    }
  }

  dispose(reason: PageToolDisposeReason) {
    const operationId = this.operationId('dispose')
    const start = reducePageToolLifecycle(this.state, {
      type: 'DISPOSE',
      authority: this.state.authority,
      operationId,
      reason,
    }, PAGE_TOOL_CATALOG)
    if (start.effect === 'idempotent')
      return true
    if (start.effect !== 'transitioned')
      return false
    this.state = start.state
    let successful = true
    try {
      this.implementation?.dispose()
      this.implementation = null
    }
    catch {
      successful = false
    }
    this.state = reducePageToolLifecycle(this.state, {
      type: successful ? 'DISPOSE_SUCCEEDED' : 'DISPOSE_FAILED',
      authority: this.state.authority,
      operationId,
    }, PAGE_TOOL_CATALOG).state
    return successful
  }

  private apply(settings: PageToolJsonValue) {
    const operationId = this.operationId('apply')
    const start = reducePageToolLifecycle(this.state, {
      type: 'APPLY',
      authority: this.state.authority,
      operationId,
      settings,
    }, PAGE_TOOL_CATALOG)
    if (start.effect !== 'transitioned')
      throw new Error('Page Toolbox tool apply was rejected')
    this.state = start.state
    const context = new PageToolDomContext(this.document, this.binding)
    try {
      this.implementation = implementationFor(this.binding.toolId as PageToolId, context, this.document, settings)
      const success = reducePageToolLifecycle(this.state, {
        type: 'APPLY_SUCCEEDED',
        authority: this.state.authority,
        operationId,
      }, PAGE_TOOL_CATALOG)
      this.state = success.state
    }
    catch (error) {
      context.dispose()
      this.state = reducePageToolLifecycle(this.state, {
        type: 'APPLY_FAILED',
        authority: this.state.authority,
        operationId,
      }, PAGE_TOOL_CATALOG).state
      throw error
    }
    const implementation = this.implementation
    const originalDispose = implementation.dispose.bind(implementation)
    implementation.dispose = () => {
      originalDispose()
      const disposed = context.dispose()
      if (!disposed.ok || disposed.report.results.some(result => result.outcome === 'failed'))
        throw new Error('Page Toolbox resource cleanup failed')
    }
  }

  private operationId(kind: string) {
    return `${kind}:${this.binding.toolId}:${++this.sequence}`
  }
}

function lifecycleReason(reason: PageToolboxDisposeReason): PageToolDisposeReason {
  if (reason === 'tab-removed')
    return 'frame-teardown'
  return reason
}

export class PageToolboxDomRuntime {
  private readonly binding: PageToolboxRuntimeBindingV1
  private readonly document: Document
  private readonly tools = new Map<PageToolId, ManagedPageTool>()
  private disposed = false

  constructor(
    document: Document,
    binding: PageToolboxRuntimeBindingV1,
    plans: readonly PageToolPlanV1[],
  ) {
    this.document = document
    this.binding = binding
    this.reconcile(plans)
  }

  get activeToolIds() {
    return Object.freeze([...this.tools.keys()].sort())
  }

  get resourceCount() {
    return [...this.tools.values()].reduce((total, tool) => total + tool.resourceCount, 0)
  }

  reconcile(input: unknown) {
    if (this.disposed)
      return false
    const plans = validatePageToolPlans(input, PAGE_TOOL_CATALOG)
    if (!plans.ok)
      return false
    const nextIds = new Set(plans.value.map(plan => plan.toolId as PageToolId))
    for (const [toolId, tool] of [...this.tools.entries()].reverse()) {
      if (!nextIds.has(toolId)) {
        tool.dispose('manual')
        this.tools.delete(toolId)
      }
    }
    for (const plan of plans.value) {
      if (!isPageToolId(plan.toolId))
        continue
      const existing = this.tools.get(plan.toolId)
      if (existing) {
        if (!existing.update(plan.settings))
          this.tools.delete(plan.toolId)
        continue
      }
      const binding = validatePageToolRuntimeBinding({
        schemaVersion: PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION,
        moduleId: PAGE_TOOLBOX_MODULE_ID,
        toolId: plan.toolId,
        exactOrigin: this.binding.exactOrigin,
        tabId: this.binding.tabId,
        frameId: 0,
        navigationId: this.binding.navigationId,
        generation: this.binding.generation,
      }, PAGE_TOOL_CATALOG)
      if (!binding.ok)
        continue
      try {
        this.tools.set(plan.toolId, new ManagedPageTool(this.document, binding.value, plan.settings))
      }
      catch {}
    }
    return true
  }

  dispose(reason: PageToolboxDisposeReason) {
    if (this.disposed)
      return false
    this.disposed = true
    for (const tool of [...this.tools.values()].reverse())
      tool.dispose(lifecycleReason(reason))
    this.tools.clear()
    return true
  }
}
