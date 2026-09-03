import type { PageToolboxRuntimeBindingV1, PageToolPlanV1, PageToolRuntimeBindingV1 } from './contracts'
import type { PageToolboxHostMessage } from './protocol'
import type { PageToolResourceAdapter, PageToolResourceEntry } from './resource-ledger'
import type { PageToolId } from './tool-catalog'
import {
  PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION,
  PAGE_TOOLBOX_MODULE_ID,
} from './contracts'
import { PageToolResourceLedger } from './resource-ledger'
import {
  createPageToolboxShadowControlState,
  type PageToolboxShadowControlState,
  reducePageToolboxShadowControl,
} from './shadow-control-model'
import { PAGE_TOOL_IDS } from './tool-catalog'
import { createPageToolAuthority } from './validation'

export const PAGE_TOOLBOX_SHADOW_HOST_ATTRIBUTE = 'data-oneweb-page-toolbox-control' as const

interface ShadowListenerHandle {
  readonly kind: 'listener'
  readonly target: EventTarget
  readonly type: string
  readonly listener: EventListener
}

interface ShadowHostHandle {
  readonly kind: 'host'
  readonly node: HTMLElement
  readonly parent: Node
  readonly ownershipToken: string
}

type ShadowResourceHandle = ShadowListenerHandle | ShadowHostHandle
type ShadowResourceEntry = PageToolResourceEntry<ShadowResourceHandle, null>
type WithoutResourceId<Entry> = Entry extends unknown ? Omit<Entry, 'id'> : never
type ShadowResourceRegistration = WithoutResourceId<ShadowResourceEntry>

const hostOwnership = new WeakMap<Node, string>()

class ShadowResourceAdapter implements PageToolResourceAdapter<ShadowResourceHandle, null> {
  isOwned(entry: Extract<ShadowResourceEntry, { kind: 'owned-node' | 'owned-style' | 'dom-prior-value' }>) {
    return entry.kind === 'owned-node'
      && entry.handle.kind === 'host'
      && entry.handle.ownershipToken === entry.ownershipToken
      && hostOwnership.get(entry.handle.node) === entry.ownershipToken
      && entry.handle.node.parentNode === entry.handle.parent
  }

  release(entry: Exclude<ShadowResourceEntry, { kind: 'dom-prior-value' }>) {
    if (entry.kind === 'listener' && entry.handle.kind === 'listener') {
      entry.handle.target.removeEventListener(entry.handle.type, entry.handle.listener)
      return
    }
    if (entry.kind === 'owned-node' && entry.handle.kind === 'host') {
      hostOwnership.delete(entry.handle.node)
      entry.handle.node.remove()
      return
    }
    throw new TypeError('Page Toolbox Shadow resource kind mismatch')
  }

  restore() {
    throw new TypeError('Page Toolbox Shadow control has no prior-value resource')
  }
}

interface ShadowToolCopy {
  readonly toolId: PageToolId
  readonly title: string
  readonly description: string
}

const shadowTools: readonly ShadowToolCopy[] = Object.freeze([
  Object.freeze({
    toolId: 'password-visibility',
    title: '密码可见性',
    description: '仅切换合格密码框显示，不读取密码',
  }),
  Object.freeze({
    toolId: 'free-page-edit',
    title: '网页自由编辑',
    description: '临时编辑当前页面，关闭后恢复',
  }),
  Object.freeze({
    toolId: 'selection-copy-release',
    title: '解除选择与复制限制',
    description: '仅处理固定的选择、复制和右键阻断',
  }),
])

const shadowStyle = `
:host{all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483646;color-scheme:light dark;font-family:Inter,system-ui,sans-serif}
button,input{font:inherit}
.launcher{display:grid;width:44px;height:44px;padding:0;place-items:center;border:1px solid #7c6df2;border-radius:14px;background:#6557dc;color:#fff;box-shadow:0 12px 30px #12122b3d;cursor:pointer;font-weight:800}
.panel{position:absolute;right:0;bottom:52px;display:grid;width:min(300px,calc(100vw - 36px));gap:12px;padding:14px;border:1px solid #d8d5f7;border-radius:16px;background:#fff;color:#172033;box-shadow:0 18px 50px #12122b42}
.panel[hidden]{display:none}
.heading{display:grid;gap:2px}.title{font-size:14px;font-weight:800}.scope{color:#667085;font-size:11px}
.tools{display:grid;gap:8px}.tool{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:start;padding:9px;border:1px solid #e6e8ef;border-radius:11px}.tool strong{display:block;font-size:12px}.tool small{display:block;margin-top:2px;color:#667085;font-size:10px;line-height:1.4}
.status{min-height:16px;margin:0;color:#667085;font-size:10px;line-height:1.4}.status[data-error=true]{color:#b42318}
@media(prefers-color-scheme:dark){.panel{border-color:#403b66;background:#171529;color:#f4f3ff}.tool{border-color:#3a3658}.scope,.tool small,.status{color:#b8b3d4}}
`

const errorMessages = Object.freeze({
  'action-active': '已有一个操作正在处理。',
  'action-limit': '本页操作次数已达上限，请刷新页面。',
  'action-replayed': '旧操作已失效。',
  'lifecycle-cancelled': '当前页面生命周期已变化。',
  'module-disabled': 'Page Toolbox 已停用。',
  'permission-check-failed': '无法核验站点权限。',
  'permission-missing': '当前站点权限已撤销。',
  'revision-exhausted': '当前站点设置版本已耗尽。',
  'settings-write-failed': '无法保存设置，页面状态未改变。',
  'tool-settings-invalid': '工具设置不再有效，请使用可信侧边栏修复。',
} as const)

export interface PageToolboxShadowControlOptions {
  readonly document: Document
  readonly binding: PageToolboxRuntimeBindingV1
  readonly plans: readonly PageToolPlanV1[]
  readonly onToggle: (_toolId: PageToolId, _enabled: boolean) => string | null
}

export class PageToolboxShadowControl {
  private readonly binding: PageToolboxRuntimeBindingV1
  private readonly host: HTMLElement
  private readonly inputs = new Map<PageToolId, HTMLInputElement>()
  private readonly launcher: HTMLButtonElement
  private readonly ledger: PageToolResourceLedger<ShadowResourceHandle, null>
  private readonly authority
  private readonly onToggle: PageToolboxShadowControlOptions['onToggle']
  private readonly panel: HTMLElement
  private readonly statusNode: HTMLElement
  private state: PageToolboxShadowControlState
  private expanded = false
  private resourceSequence = 0

  constructor({ document, binding, plans, onToggle }: PageToolboxShadowControlOptions) {
    const state = createPageToolboxShadowControlState(binding, plans)
    if (!state)
      throw new TypeError('Invalid initial Page Toolbox Shadow control state')
    this.state = state
    this.binding = state.binding
    this.onToggle = onToggle
    const resourceBinding: PageToolRuntimeBindingV1 = {
      schemaVersion: PAGE_TOOL_RUNTIME_BINDING_SCHEMA_VERSION,
      moduleId: PAGE_TOOLBOX_MODULE_ID,
      toolId: 'page-toolbox-shadow-control',
      exactOrigin: binding.exactOrigin,
      tabId: binding.tabId,
      frameId: 0,
      navigationId: binding.navigationId,
      generation: binding.generation,
    }
    this.authority = createPageToolAuthority(resourceBinding)
    this.ledger = new PageToolResourceLedger(resourceBinding, new ShadowResourceAdapter())

    this.host = document.createElement('div')
    this.host.setAttribute(PAGE_TOOLBOX_SHADOW_HOST_ATTRIBUTE, '')
    this.host.tabIndex = 0
    this.host.style.cssText = 'all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483646'
    const shadow = this.host.attachShadow({ mode: 'closed', delegatesFocus: true })
    const style = document.createElement('style')
    style.textContent = shadowStyle
    this.launcher = document.createElement('button')
    this.launcher.type = 'button'
    this.launcher.className = 'launcher'
    this.launcher.textContent = 'O'
    this.launcher.setAttribute('aria-label', '打开 Page Toolbox 当前站点工具')
    this.launcher.setAttribute('aria-expanded', 'false')
    this.panel = document.createElement('section')
    this.panel.className = 'panel'
    this.panel.hidden = true
    this.panel.setAttribute('aria-label', 'Page Toolbox 当前站点工具')
    const heading = document.createElement('div')
    heading.className = 'heading'
    const title = document.createElement('strong')
    title.className = 'title'
    title.textContent = 'Page Toolbox'
    const scope = document.createElement('span')
    scope.className = 'scope'
    scope.textContent = '仅控制当前已授权站点'
    heading.append(title, scope)
    const toolList = document.createElement('div')
    toolList.className = 'tools'
    for (const tool of shadowTools) {
      const label = document.createElement('label')
      label.className = 'tool'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.dataset.toolId = tool.toolId
      const copy = document.createElement('span')
      const toolTitle = document.createElement('strong')
      toolTitle.textContent = tool.title
      const description = document.createElement('small')
      description.textContent = tool.description
      copy.append(toolTitle, description)
      label.append(input, copy)
      toolList.append(label)
      this.inputs.set(tool.toolId, input)
    }
    this.statusNode = document.createElement('p')
    this.statusNode.className = 'status'
    this.statusNode.setAttribute('role', 'status')
    this.panel.append(heading, toolList, this.statusNode)
    shadow.append(style, this.launcher, this.panel)

    const parent = document.documentElement
    const ownershipToken = `shadow:${binding.generation}:${binding.navigationId}`
    try {
      parent.append(this.host)
      hostOwnership.set(this.host, ownershipToken)
      if (!this.register({
        kind: 'owned-node',
        handle: { kind: 'host', node: this.host, parent, ownershipToken },
        ownershipToken,
      })) {
        throw new Error('Unable to ledger Page Toolbox Shadow host')
      }
      this.listen(this.launcher, 'click', this.handleLauncherClick)
      for (const input of this.inputs.values())
        this.listen(input, 'change', this.handleToolChange)
      this.render()
    }
    catch (error) {
      this.ledger.dispose(this.authority)
      hostOwnership.delete(this.host)
      this.host.remove()
      throw error
    }
  }

  get activeToolIds() { return this.state.enabledToolIds }
  get phase() { return this.state.phase }
  get resourceCount() { return this.ledger.size }
  get hostNode() { return this.host }

  update(plans: unknown, binding: PageToolboxRuntimeBindingV1 = this.binding) {
    const reduced = reducePageToolboxShadowControl(this.state, {
      type: 'plans-updated',
      binding,
      plans,
    })
    if (reduced.effect === 'rejected')
      return false
    this.state = reduced.state
    this.render()
    return true
  }

  acceptResult(
    result: Extract<PageToolboxHostMessage, { type: 'PAGE_TOOLBOX_CONTROL_RESULT' }>,
  ) {
    const pendingToolId = this.state.pending?.toolId
    const reduced = reducePageToolboxShadowControl(this.state, result.ok
      ? {
          type: 'action-accepted',
          binding: result.binding,
          actionId: result.actionId,
          toolId: result.toolId,
          enabled: result.enabled,
        }
      : {
          type: 'action-rejected',
          binding: result.binding,
          actionId: result.actionId,
          toolId: result.toolId,
          enabled: result.enabled,
          reason: result.reason,
        })
    if (reduced.effect !== 'transitioned')
      return false
    this.state = reduced.state
    this.render()
    if (pendingToolId)
      this.inputs.get(pendingToolId)?.focus()
    return true
  }

  requestToggle(toolId: PageToolId, enabled: boolean) {
    if (this.state.phase === 'error') {
      const cleared = reducePageToolboxShadowControl(this.state, {
        type: 'clear-error',
        binding: this.binding,
      })
      if (cleared.effect !== 'transitioned')
        return false
      this.state = cleared.state
    }
    if (!PAGE_TOOL_IDS.includes(toolId)
      || this.state.phase !== 'active'
      || this.state.pending
      || this.state.enabledToolIds.includes(toolId) === enabled) {
      return false
    }
    const actionId = this.onToggle(toolId, enabled)
    if (!actionId)
      return false
    const reduced = reducePageToolboxShadowControl(this.state, {
      type: 'request-toggle',
      binding: this.binding,
      actionId,
      toolId,
      enabled,
    })
    if (reduced.effect !== 'transitioned')
      return false
    this.state = reduced.state
    this.render()
    return true
  }

  dispose() {
    const reduced = reducePageToolboxShadowControl(this.state, { type: 'dispose', binding: this.binding })
    if (reduced.effect !== 'transitioned')
      return false
    this.state = reduced.state
    const disposed = this.ledger.dispose(this.authority)
    return disposed.ok && disposed.report.results.every(result => result.outcome !== 'failed')
  }

  private readonly handleLauncherClick: EventListener = () => {
    if (this.state.phase === 'disposed')
      return
    this.expanded = !this.expanded
    this.panel.hidden = !this.expanded
    this.launcher.setAttribute('aria-expanded', String(this.expanded))
  }

  private readonly handleToolChange: EventListener = (event) => {
    const input = event.currentTarget
    if (!(input instanceof this.host.ownerDocument.defaultView!.HTMLInputElement))
      return
    const toolId = input.dataset.toolId
    if (!PAGE_TOOL_IDS.includes(toolId as PageToolId)
      || !this.requestToggle(toolId as PageToolId, input.checked)) {
      this.render()
    }
  }

  private render() {
    const enabled = new Set(this.state.enabledToolIds)
    for (const [toolId, input] of this.inputs) {
      input.checked = enabled.has(toolId)
      input.disabled = this.state.phase === 'pending' || this.state.phase === 'disposed'
    }
    this.statusNode.dataset.error = String(this.state.phase === 'error')
    this.statusNode.textContent = this.state.phase === 'pending'
      ? '正在安全保存…'
      : this.state.phase === 'error' && this.state.error
        ? errorMessages[this.state.error]
        : '详细设置与站点授权请使用可信侧边栏。'
  }

  private listen(target: EventTarget, type: string, listener: EventListener) {
    target.addEventListener(type, listener)
    if (!this.register({ kind: 'listener', handle: { kind: 'listener', target, type, listener } })) {
      target.removeEventListener(type, listener)
      throw new Error('Unable to ledger Page Toolbox Shadow listener')
    }
  }

  private register(entry: ShadowResourceRegistration) {
    this.resourceSequence += 1
    return this.ledger.register(this.authority, {
      ...entry,
      id: `shadow:${this.binding.generation}:${this.resourceSequence}`,
    } as ShadowResourceEntry).ok
  }
}
