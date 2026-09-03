import type {
  PageToolJsonValue,
  PageToolSiteSettingsV1,
} from '~/modules/builtin/page-toolbox/contracts'
import type {
  PageToolboxControlSnapshotV1,
} from '~/modules/builtin/page-toolbox/product-control'
import {
  isPageToolboxControlRevision,
  validatePageToolboxControlSiteSettings,
  validatePageToolboxControlSnapshot,
} from '~/modules/builtin/page-toolbox/product-control'
import type { PageToolId } from '~/modules/builtin/page-toolbox/tool-catalog'
import {
  getDefaultPageToolSettings,
  PAGE_TOOL_CATALOG,
  PAGE_TOOL_IDS,
} from '~/modules/builtin/page-toolbox/tool-catalog'
import {
  validatePageToolSettingsValue,
} from '~/modules/builtin/page-toolbox/validation'

export const PAGE_TOOLBOX_CONTROL_REQUEST_ID_MAX_LENGTH = 160 as const

export {
  normalizePageToolboxDisplayText,
  PAGE_TOOLBOX_CONTROL_SNAPSHOT_VERSION,
  PAGE_TOOLBOX_CONTROL_TITLE_MAX_LENGTH,
  validatePageToolboxControlSnapshot,
} from '~/modules/builtin/page-toolbox/product-control'
export type {
  PageToolboxControlSnapshotV1,
  PageToolboxControlValidationResult,
  PageToolboxSiteAccess,
} from '~/modules/builtin/page-toolbox/product-control'

export const PAGE_TOOLBOX_CONTROL_SURFACE_POLICY = Object.freeze({
  'trusted-sidebar': Object.freeze({
    canRequestSiteApproval: true,
    canPersistSettings: true,
    authority: 'host-derived-current-site',
  }),
  'page-shadow': Object.freeze({
    canRequestSiteApproval: false,
    canPersistSettings: false,
    authority: 'authenticated-generation-convenience',
  }),
} as const)

export type PageToolboxControlErrorCode =
  | 'invalid-snapshot'
  | 'load-failed'
  | 'save-failed'
  | 'settings-rejected'

export type PageToolboxControlPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'stale'
  | 'error'

export interface PageToolboxControlPendingRequest {
  readonly kind: 'load' | 'save'
  readonly requestId: string
  readonly baseRevision: number | null
}

export interface PageToolboxControlState {
  readonly phase: PageToolboxControlPhase
  readonly pending: PageToolboxControlPendingRequest | null
  readonly snapshot: PageToolboxControlSnapshotV1 | null
  readonly draft: PageToolSiteSettingsV1 | null
  readonly dirty: boolean
  readonly errorCode: PageToolboxControlErrorCode | null
  readonly staleRevision: number | null
}

export type PageToolboxControlEvent =
  | { readonly type: 'load-started', readonly requestId: string }
  | { readonly type: 'load-succeeded', readonly requestId: string, readonly snapshot: unknown }
  | {
    readonly type: 'load-failed'
    readonly requestId: string
    readonly errorCode: Extract<PageToolboxControlErrorCode, 'load-failed'>
  }
  | {
    readonly type: 'edit-tool'
    readonly toolId: PageToolId
    readonly enabled: boolean
    readonly settings: PageToolJsonValue
  }
  | { readonly type: 'discard-draft' }
  | { readonly type: 'save-started', readonly requestId: string }
  | { readonly type: 'save-succeeded', readonly requestId: string, readonly snapshot: unknown }
  | {
    readonly type: 'save-failed'
    readonly requestId: string
    readonly errorCode: Extract<PageToolboxControlErrorCode, 'save-failed'>
  }
  | { readonly type: 'save-conflicted', readonly requestId: string, readonly revision: number }
  | { readonly type: 'revision-observed', readonly revision: number }

export interface PageToolboxChoiceOptionPresentation {
  readonly value: string
  readonly label: string
}

export type PageToolboxSettingPresentation =
  | {
    readonly kind: 'choice'
    readonly key: 'gesture' | 'mode'
    readonly label: string
    readonly value: string
    readonly options: readonly PageToolboxChoiceOptionPresentation[]
  }
  | {
    readonly kind: 'boolean'
    readonly key: 'selection' | 'copy' | 'contextMenu'
    readonly label: string
    readonly value: boolean
  }

export interface PageToolboxToolControlPresentation {
  readonly toolId: PageToolId
  readonly title: string
  readonly safetyLabel: string
  readonly enabled: boolean
  readonly defaultEnabled: false
  readonly canEdit: boolean
  readonly settings: readonly PageToolboxSettingPresentation[]
}

export type PageToolboxControlViewState =
  | 'idle'
  | 'loading'
  | 'unsupported'
  | 'module-disabled'
  | 'site-unapproved'
  | 'ready'
  | 'saving'
  | 'stale'
  | 'error'

export interface PageToolboxControlPresentation {
  readonly surface: 'trusted-sidebar'
  readonly state: PageToolboxControlViewState
  readonly title: string
  readonly origin: string
  readonly message: string
  readonly canEdit: boolean
  readonly canSave: boolean
  readonly dirty: boolean
  readonly tools: readonly PageToolboxToolControlPresentation[]
}

interface ProductToolDefinition {
  readonly toolId: PageToolId
  readonly title: string
  readonly safetyLabel: string
  readonly defaultSettings: PageToolJsonValue
}

const productTools: readonly ProductToolDefinition[] = Object.freeze([
  Object.freeze({
    toolId: 'password-visibility',
    title: '密码可见性切换',
    safetyLabel: '仅改变合格密码框的显示类型，不读取密码内容',
    defaultSettings: getDefaultPageToolSettings('password-visibility'),
  }),
  Object.freeze({
    toolId: 'free-page-edit',
    title: '网页自由编辑',
    safetyLabel: '仅临时启用当前页面编辑，关闭后恢复且不保存页面内容',
    defaultSettings: getDefaultPageToolSettings('free-page-edit'),
  }),
  Object.freeze({
    toolId: 'selection-copy-release',
    title: '解除选择与复制限制',
    safetyLabel: '仅处理选择、复制和右键菜单三类固定阻断',
    defaultSettings: getDefaultPageToolSettings('selection-copy-release'),
  }),
])

const requestIdPattern = /^\w[\w.:-]*$/

function isRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= PAGE_TOOLBOX_CONTROL_REQUEST_ID_MAX_LENGTH
    && requestIdPattern.test(value)
}

function defaultSettings(toolId: PageToolId): PageToolJsonValue {
  return productTools.find(tool => tool.toolId === toolId)!.defaultSettings
}

function createCompleteSiteDraft(
  exactOrigin: string,
  source: PageToolSiteSettingsV1,
): PageToolSiteSettingsV1 {
  const toolSettings = Object.fromEntries(PAGE_TOOL_IDS.map((toolId) => {
    const input = source.toolSettings[toolId] ?? defaultSettings(toolId)
    const validated = validatePageToolSettingsValue(toolId, input, PAGE_TOOL_CATALOG)
    if (!validated.ok)
      throw new TypeError(`Invalid canonical Page Toolbox settings: ${toolId}`)
    return [toolId, validated.value]
  }))
  const validated = validatePageToolboxControlSiteSettings(exactOrigin, {
    enabledToolIds: source.enabledToolIds,
    toolSettings,
  })
  if (!validated.ok)
    throw new TypeError('Invalid canonical Page Toolbox site draft')
  return validated.value
}

function draftForSnapshot(snapshot: PageToolboxControlSnapshotV1): PageToolSiteSettingsV1 | null {
  if (snapshot.access !== 'ready' || !snapshot.exactOrigin || !snapshot.siteSettings)
    return null
  return createCompleteSiteDraft(snapshot.exactOrigin, snapshot.siteSettings)
}

function freezePending(
  kind: PageToolboxControlPendingRequest['kind'],
  requestId: string,
  baseRevision: number | null,
): PageToolboxControlPendingRequest {
  return Object.freeze({ kind, requestId, baseRevision })
}

function freezeState(state: PageToolboxControlState): PageToolboxControlState {
  return Object.freeze(state)
}

export function createPageToolboxControlState(): PageToolboxControlState {
  return freezeState({
    phase: 'idle',
    pending: null,
    snapshot: null,
    draft: null,
    dirty: false,
    errorCode: null,
    staleRevision: null,
  })
}

function siteSettingsEqual(left: PageToolSiteSettingsV1, right: PageToolSiteSettingsV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function failWithSettings(state: PageToolboxControlState): PageToolboxControlState {
  return freezeState({
    ...state,
    phase: 'error',
    pending: null,
    errorCode: 'settings-rejected',
  })
}

function editTool(
  state: PageToolboxControlState,
  event: Extract<PageToolboxControlEvent, { type: 'edit-tool' }>,
): PageToolboxControlState {
  if (state.phase !== 'ready'
    || state.snapshot?.access !== 'ready'
    || !state.snapshot.exactOrigin
    || !state.draft
    || !PAGE_TOOL_IDS.includes(event.toolId)
    || typeof event.enabled !== 'boolean') {
    return state
  }
  const setting = validatePageToolSettingsValue(event.toolId, event.settings, PAGE_TOOL_CATALOG)
  if (!setting.ok)
    return failWithSettings(state)
  const enabledToolIds = new Set(state.draft.enabledToolIds)
  if (event.enabled)
    enabledToolIds.add(event.toolId)
  else
    enabledToolIds.delete(event.toolId)
  const validated = validatePageToolboxControlSiteSettings(state.snapshot.exactOrigin, {
    enabledToolIds: [...enabledToolIds],
    toolSettings: {
      ...state.draft.toolSettings,
      [event.toolId]: setting.value,
    },
  })
  if (!validated.ok)
    return failWithSettings(state)
  const original = draftForSnapshot(state.snapshot)!
  return freezeState({
    ...state,
    draft: validated.value,
    dirty: !siteSettingsEqual(original, validated.value),
    errorCode: null,
  })
}

function matchingPending(
  state: PageToolboxControlState,
  kind: PageToolboxControlPendingRequest['kind'],
  requestId: unknown,
): boolean {
  return isRequestId(requestId)
    && state.pending?.kind === kind
    && state.pending.requestId === requestId
}

function staleState(state: PageToolboxControlState, revision: number | null): PageToolboxControlState {
  return freezeState({
    ...state,
    phase: 'stale',
    pending: null,
    errorCode: null,
    staleRevision: revision,
  })
}

export function reducePageToolboxControlState(
  state: PageToolboxControlState,
  event: PageToolboxControlEvent,
): PageToolboxControlState {
  if (event.type === 'load-started') {
    if (!isRequestId(event.requestId))
      return state
    return freezeState({
      phase: 'loading',
      pending: freezePending('load', event.requestId, null),
      snapshot: null,
      draft: null,
      dirty: false,
      errorCode: null,
      staleRevision: null,
    })
  }
  if (event.type === 'load-succeeded') {
    if (!matchingPending(state, 'load', event.requestId))
      return state
    const snapshot = validatePageToolboxControlSnapshot(event.snapshot)
    if (!snapshot.ok) {
      return freezeState({
        ...state,
        phase: 'error',
        pending: null,
        errorCode: 'invalid-snapshot',
      })
    }
    return freezeState({
      phase: 'ready',
      pending: null,
      snapshot: snapshot.value,
      draft: draftForSnapshot(snapshot.value),
      dirty: false,
      errorCode: null,
      staleRevision: null,
    })
  }
  if (event.type === 'load-failed') {
    if (!matchingPending(state, 'load', event.requestId))
      return state
    return freezeState({
      ...state,
      phase: 'error',
      pending: null,
      errorCode: 'load-failed',
    })
  }
  if (event.type === 'edit-tool')
    return editTool(state, event)
  if (event.type === 'discard-draft') {
    if (!state.snapshot)
      return state
    return freezeState({
      ...state,
      phase: 'ready',
      pending: null,
      draft: draftForSnapshot(state.snapshot),
      dirty: false,
      errorCode: null,
      staleRevision: null,
    })
  }
  if (event.type === 'save-started') {
    if (state.phase !== 'ready'
      || state.snapshot?.access !== 'ready'
      || !state.draft
      || !state.dirty
      || !isRequestId(event.requestId)) {
      return state
    }
    return freezeState({
      ...state,
      phase: 'saving',
      pending: freezePending('save', event.requestId, state.snapshot.revision),
      errorCode: null,
    })
  }
  if (event.type === 'save-succeeded') {
    const baseRevision = state.pending?.baseRevision
    if (!matchingPending(state, 'save', event.requestId)
      || baseRevision === null
      || baseRevision === undefined
      || !state.snapshot
      || !state.draft) {
      return state
    }
    const snapshot = validatePageToolboxControlSnapshot(event.snapshot)
    if (!snapshot.ok) {
      return freezeState({
        ...state,
        phase: 'error',
        pending: null,
        errorCode: 'invalid-snapshot',
      })
    }
    const candidateDraft = draftForSnapshot(snapshot.value)
    if (snapshot.value.access !== 'ready'
      || snapshot.value.exactOrigin !== state.snapshot.exactOrigin
      || snapshot.value.revision !== baseRevision + 1
      || !candidateDraft
      || !siteSettingsEqual(candidateDraft, state.draft)) {
      return staleState(state, snapshot.value.revision)
    }
    return freezeState({
      phase: 'ready',
      pending: null,
      snapshot: snapshot.value,
      draft: candidateDraft,
      dirty: false,
      errorCode: null,
      staleRevision: null,
    })
  }
  if (event.type === 'save-failed') {
    if (!matchingPending(state, 'save', event.requestId))
      return state
    return freezeState({
      ...state,
      phase: 'error',
      pending: null,
      errorCode: 'save-failed',
    })
  }
  if (event.type === 'save-conflicted') {
    if (!matchingPending(state, 'save', event.requestId) || !isPageToolboxControlRevision(event.revision))
      return state
    return staleState(state, event.revision)
  }
  if (event.type === 'revision-observed') {
    if (!state.snapshot
      || !isPageToolboxControlRevision(event.revision)
      || event.revision <= state.snapshot.revision) {
      return state
    }
    return staleState(state, event.revision)
  }
  return state
}

function settingRecord(settings: PageToolJsonValue): Readonly<Record<string, PageToolJsonValue>> {
  return settings as Readonly<Record<string, PageToolJsonValue>>
}

function presentSettings(toolId: PageToolId, settings: PageToolJsonValue): readonly PageToolboxSettingPresentation[] {
  const record = settingRecord(settings)
  if (toolId === 'password-visibility') {
    return Object.freeze([Object.freeze({
      kind: 'choice',
      key: 'gesture',
      label: '触发手势',
      value: record.gesture as string,
      options: Object.freeze([
        Object.freeze({ value: 'double-click', label: '双击' }),
        Object.freeze({ value: 'triple-click', label: '三击' }),
      ]),
    })])
  }
  if (toolId === 'free-page-edit') {
    return Object.freeze([Object.freeze({
      kind: 'choice',
      key: 'mode',
      label: '编辑模式',
      value: record.mode as string,
      options: Object.freeze([
        Object.freeze({ value: 'rich-text', label: '富文本' }),
        Object.freeze({ value: 'plain-text', label: '纯文本' }),
      ]),
    })])
  }
  return Object.freeze([
    Object.freeze({ kind: 'boolean', key: 'selection', label: '允许选择文本', value: record.selection as boolean }),
    Object.freeze({ kind: 'boolean', key: 'copy', label: '允许复制', value: record.copy as boolean }),
    Object.freeze({ kind: 'boolean', key: 'contextMenu', label: '允许右键菜单', value: record.contextMenu as boolean }),
  ])
}

function viewState(state: PageToolboxControlState): PageToolboxControlViewState {
  if (state.phase !== 'ready')
    return state.phase
  return state.snapshot?.access ?? 'idle'
}

const messages: Record<PageToolboxControlViewState, string> = {
  'idle': '尚未读取当前站点。',
  'loading': '正在读取当前站点状态…',
  'unsupported': '当前页面不是可授权的 HTTP(S) 顶层站点。',
  'module-disabled': 'Page Toolbox 已停用；启用模块后才能配置站点工具。',
  'site-unapproved': '当前站点尚未获得明确的 exact-origin 授权。',
  'ready': '仅修改当前已授权站点；所有工具默认关闭。',
  'saving': '正在按已读取的修订保存设置…',
  'stale': '设置已在其他位置变化，请重新读取后再编辑。',
  'error': '操作失败；当前草稿未获得新的保存权威。',
}

export function presentPageToolboxControlState(
  state: PageToolboxControlState,
): PageToolboxControlPresentation {
  const currentView = viewState(state)
  const canEdit = currentView === 'ready'
  const source = state.draft
  const enabledToolIds = new Set(source?.enabledToolIds ?? [])
  const tools = productTools.map((definition) => {
    const settings = source?.toolSettings[definition.toolId] ?? definition.defaultSettings
    return Object.freeze({
      toolId: definition.toolId,
      title: definition.title,
      safetyLabel: definition.safetyLabel,
      enabled: enabledToolIds.has(definition.toolId),
      defaultEnabled: false as const,
      canEdit,
      settings: presentSettings(definition.toolId, settings),
    })
  })
  return Object.freeze({
    surface: 'trusted-sidebar',
    state: currentView,
    title: state.snapshot?.pageTitle ?? 'Page Toolbox',
    origin: state.snapshot?.exactOrigin ?? '',
    message: messages[currentView],
    canEdit,
    canSave: canEdit && state.dirty,
    dirty: state.dirty,
    tools: Object.freeze(tools),
  })
}
