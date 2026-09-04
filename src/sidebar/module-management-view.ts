import type {
  BookmarkDoctorWorkspaceState,
  BookmarkRepairConfirmation,
  BookmarkRepairPlan,
  BookmarkRepairRequest,
  BookmarkRestoreConfirmation,
  BookmarkRestorePlan,
  BookmarkScanPreparation,
  BookmarkScanSnapshot,
} from '~/modules/builtin/bookmark-doctor'
import {
  BOOKMARK_DOCTOR_ENTRY_ID,
  BOOKMARK_DOCTOR_MODULE_ID,
} from '~/modules/builtin/bookmark-doctor'
import { BookmarkDoctorClientError } from '~/modules/builtin/bookmark-doctor/client'
import type {
  BookmarkDoctorResult,
} from '~/modules/builtin/bookmark-doctor/protocol'
import type {
  BrowserJournalArchiveState,
  BrowserJournalSnapshot,
} from '~/modules/builtin/browser-journal'
import {
  BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT,
  BROWSER_JOURNAL_ENTRY_ID,
  BROWSER_JOURNAL_MODULE_ID,
  BrowserJournalClientError,
} from '~/modules/builtin/browser-journal'
import type { BrowserJournalResult } from '~/modules/builtin/browser-journal/protocol'
import type {
  ClashConnectionPreparation,
  ClashConnectionStatus,
  ClashProxySwitchPlan,
  ClashReadState,
} from '~/modules/builtin/clash-control'
import {
  CLASH_CONTROL_ENTRY_ID,
  CLASH_CONTROL_MODULE_ID,
  ClashControlClientError,
} from '~/modules/builtin/clash-control'
import type { ClashControlResult } from '~/modules/builtin/clash-control/protocol'
import type {
  PageToolboxManagementResult,
  PageToolboxSitePreparationV1,
  PageToolSiteSettingsV1,
} from '~/modules/builtin/page-toolbox'
import {
  PAGE_TOOLBOX_ENTRY_ID,
  PAGE_TOOLBOX_MODULE_ID,
  PageToolboxClientError,
} from '~/modules/builtin/page-toolbox'
import type {
  ResourceCandidateV1,
  SendToOpenListCancelReviewPlanV1,
  SendToOpenListConnectionPreparationV1,
  SendToOpenListConnectionSnapshotV1,
  SendToOpenListSubmissionStateV1,
  SendToOpenListTaskSnapshotV1,
} from '~/modules/builtin/send-to-openlist'
import {
  SEND_TO_OPENLIST_ENTRY_ID,
  SEND_TO_OPENLIST_MODULE_ID,
  SendToOpenListClientError,
} from '~/modules/builtin/send-to-openlist'
import type { ModuleInstallReview, ModuleInstallSelection } from '~/modules/installer'
import {
  type ModuleInstallCancelManagementResult,
  type ModuleInstallConfirmManagementResult,
  type ModuleInstallPrepareManagementResult,
  ModuleManagementClientError,
  type ModuleRemoveManagementResult,
  type ModuleSetEnabledManagementResult,
  type ModuleUpdateApplyManagementResult,
  type ModuleUpdateApproveManagementResult,
  type ModuleUpdateCheckManagementResult,
} from '~/modules/management-client'
import type {
  InstalledModuleRecord,
  ModuleCapabilityId,
  ModuleContextFieldGrants,
  ModuleContextId,
  ModuleUpdateApprovalSelection,
} from '~/modules/types'
import {
  type BookmarkDoctorResultFilter,
  bookmarkProbeOutcomeLabel,
  type BookmarkRepairDraft,
  bookmarkRepairRequestFromDraft,
  createBookmarkRepairDraft,
  presentBookmarkDoctorScan,
  presentBookmarkDoctorWorkspace,
  presentBookmarkRepairPlan,
  presentBookmarkRestorePlan,
} from './bookmark-doctor-presentation'
import { presentBrowserJournalArchive } from './browser-journal-presentation'
import {
  presentClashProxyGroupChoices,
  presentClashProxySwitchReview,
} from './clash-control-presentation'
import {
  presentModuleAccess,
  presentRequestedModuleAccess,
} from './module-presentation'
import {
  formatModuleUpdateCheckedAt,
  isRemotelyUpdateable,
  presentModuleUpdate,
} from './module-update-presentation'
import {
  createPageToolboxControlState,
  type PageToolboxControlState,
  presentPageToolboxControlState,
  reducePageToolboxControlState,
} from './page-toolbox-presentation'
import {
  mergePresentedResourceCandidates,
  parseManualResourceCandidates,
  presentResourceCandidate,
  presentSubmissionStatus,
  presentTaskSnapshot,
} from './send-to-openlist-presentation'

export interface BookmarkDoctorActions {
  authorize: () => Promise<BookmarkDoctorResult>
  prepare: () => Promise<BookmarkDoctorResult>
  start: (_preparation: BookmarkScanPreparation) => Promise<BookmarkDoctorResult>
  status: () => Promise<BookmarkScanSnapshot | null>
  stop: () => Promise<BookmarkDoctorResult>
  authorizeRepairs: () => Promise<BookmarkDoctorResult>
  prepareRepair: (_request: BookmarkRepairRequest) => Promise<BookmarkDoctorResult>
  confirmRepairs: (_confirmations: BookmarkRepairConfirmation[]) => Promise<BookmarkDoctorResult>
  workspaceState: () => Promise<BookmarkDoctorResult>
  unignore: (_bookmarkId: string) => Promise<BookmarkDoctorResult>
  clearLocalData: () => Promise<BookmarkDoctorResult>
  prepareRestore: (_backupToken: string) => Promise<BookmarkDoctorResult>
  confirmRestore: (_confirmation: BookmarkRestoreConfirmation) => Promise<BookmarkDoctorResult>
  revoke: () => Promise<BookmarkDoctorResult>
}

export interface BrowserJournalActions {
  start: () => Promise<BrowserJournalResult>
  stop: () => Promise<BrowserJournalResult>
  status: () => Promise<BrowserJournalResult>
  archive: () => Promise<BrowserJournalResult>
  save: () => Promise<BrowserJournalResult>
  deleteSaved: (_savedSessionId: string) => Promise<BrowserJournalResult>
  clearSaved: () => Promise<BrowserJournalResult>
}

export interface ClashControlActions {
  prepare: (_controllerUrl: string) => Promise<ClashControlResult>
  connect: (_preparation: ClashConnectionPreparation, _secret: string) => Promise<ClashControlResult>
  status: () => Promise<ClashControlResult>
  refresh: () => Promise<ClashControlResult>
  prepareProxySwitch: (_groupName: string, _targetNode: string) => Promise<ClashControlResult>
  confirmProxySwitch: (_token: string) => Promise<ClashControlResult>
  disconnect: () => Promise<ClashControlResult>
}

export interface PageToolboxActions {
  status: () => Promise<PageToolboxManagementResult>
  prepare: () => Promise<PageToolboxManagementResult>
  confirm: (_preparation: PageToolboxSitePreparationV1) => Promise<PageToolboxManagementResult>
  replace: (_expectedRevision: number, _settings: PageToolSiteSettingsV1) => Promise<PageToolboxManagementResult>
  revoke: () => Promise<PageToolboxManagementResult>
}

export interface SendToOpenListActions {
  prepare: (_profile: {
    schemaVersion: 1
    id: string
    label: string
    controllerOrigin: string
  }) => Promise<unknown>
  connect: (_preparation: SendToOpenListConnectionPreparationV1, _token?: string) => Promise<unknown>
  status: () => Promise<unknown>
  discoverTools: (_destinationPath: string) => Promise<unknown>
  submit: (
    _candidates: readonly ResourceCandidateV1[],
    _destinationPath: string,
    _tool: string,
  ) => Promise<unknown>
  listTasks: (_list: 'undone' | 'done') => Promise<unknown>
  prepareCancel: (_taskId: string) => Promise<unknown>
  confirmCancel: (_token: string) => Promise<unknown>
  disconnect: () => Promise<unknown>
  deleteProfile: () => Promise<unknown>
}

export interface ModuleManagementActions {
  list: () => Promise<InstalledModuleRecord[]>
  setEnabled: (_moduleId: string, _enabled: boolean) => Promise<ModuleSetEnabledManagementResult>
  remove: (_moduleId: string) => Promise<ModuleRemoveManagementResult>
  prepareInstall: (_manifestUrl: string) => Promise<ModuleInstallPrepareManagementResult>
  confirmInstall: (
    _manifestUrl: string,
    _expectedDigest: string,
    _selection: ModuleInstallSelection,
  ) => Promise<ModuleInstallConfirmManagementResult>
  cancelInstall: (_manifestUrl: string) => Promise<ModuleInstallCancelManagementResult>
  checkUpdate: (_moduleId: string) => Promise<ModuleUpdateCheckManagementResult>
  approveUpdate: (
    _moduleId: string,
    _expectedDigest: string,
    _selection: ModuleUpdateApprovalSelection,
  ) => Promise<ModuleUpdateApproveManagementResult>
  applyUpdate: (_moduleId: string) => Promise<ModuleUpdateApplyManagementResult>
}

export interface ModuleManagementViewOptions {
  root: HTMLElement
  client: ModuleManagementActions
  browserJournal?: BrowserJournalActions
  bookmarkDoctor?: BookmarkDoctorActions
  clashControl?: ClashControlActions
  pageToolbox?: PageToolboxActions
  sendToOpenList?: SendToOpenListActions
  now?: () => string
  onRecordChanged?: (_record: InstalledModuleRecord) => void
  onRecordRemoved?: (_record: InstalledModuleRecord) => void
  onRecordInstalled?: (_record: InstalledModuleRecord) => void
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined)
    node.textContent = text
  return node
}

function appendAccessRow(list: HTMLDListElement, label: string, values: string[]) {
  list.append(element('dt', 'access-label', label))
  const value = element('dd', 'access-value')
  for (const entry of values.length ? values : ['无'])
    value.append(element('span', 'access-entry', entry))
  list.append(value)
}

function installErrorMessage(reason: string) {
  const messages: Record<string, string> = {
    'invalid-manifest-url': '请输入 HTTPS 或明确的 localhost manifest 地址',
    'permission-denied': '未获得该模块 origin 的访问权限',
    'missing-origin-permission': 'origin 权限未生效，请重新发起审查',
    'installation-unavailable': '后台安装服务当前不可用',
    'fetch-failed': '无法读取远程 manifest',
    'manifest-too-large': 'Manifest 超过 128 KiB 限制',
    'manifest-invalid': 'Manifest 格式或协议不受支持',
    'manifest-origin-mismatch': 'Manifest、入口页面和跳转地址必须属于同一 origin',
    'host-incompatible': '该模块要求更高版本的 OneWeb',
    'already-installed': '该模块已经安装',
    'manifest-changed': 'Manifest 在审查后发生变化，请重新检查',
    'transport-error': '无法连接后台安装服务',
    'invalid-response': '后台返回了无效安装结果',
  }
  return messages[reason] || '安装模块失败'
}

function updateErrorMessage(reason: string) {
  const messages: Record<string, string> = {
    'update-check-unavailable': '后台更新检查当前不可用',
    'update-apply-unavailable': '后台更新应用当前不可用',
    'not-found': '模块已不存在，列表已刷新',
    'not-updateable': '该模块没有可检查的固定远程来源',
    'missing-origin-permission': '缺少模块来源的 origin 权限',
    'fetch-failed': '无法读取远程 manifest，请稍后重试',
    'manifest-too-large': '远程 manifest 超过 128 KiB 限制',
    'manifest-invalid': '远程 manifest 格式或协议不受支持',
    'manifest-origin-mismatch': '远程 manifest、跳转或入口 origin 不一致',
    'host-incompatible': '候选版本要求更高版本的 OneWeb',
    'installed-record-changed': '模块状态已并发变化，列表已刷新',
    'no-update-candidate': '更新候选已不存在，请重新检查',
    'update-candidate-changed': '候选已过期，请重新检查并审查',
    'update-approval-not-required': '该安全更新不需要审批',
    'update-approval-required': '审批已失效，请重新检查并审批',
    'update-rejected': '该候选触及不可变安全边界，不能应用',
    'invalid-update-approval': '所选授权不属于当前候选的新增权限',
    'invalid-candidate': '候选内容与已检查记录不一致',
    'transport-error': '无法连接后台更新服务',
    'invalid-response': '后台返回了无效更新结果',
  }
  return messages[reason] || '更新操作失败'
}

function updateErrorReason(error: unknown) {
  return error instanceof ModuleManagementClientError ? error.code : 'transport-error'
}

function appendUpdateChangeList(parent: HTMLElement, label: string, values: string[]) {
  if (!values.length)
    return
  const group = element('div', 'module-update-change-group')
  group.append(element('h4', 'module-update-change-label', label))
  const list = element('ul', 'module-update-change-list')
  for (const value of values)
    list.append(element('li', '', value))
  group.append(list)
  parent.append(group)
}

type SendActionResult<Value> =
  | { ok: true, value: Value }
  | { ok: false, reason: string }

function readSendActionResult<Value>(input: unknown): SendActionResult<Value> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return null
  const record = input as Record<string, unknown>
  if (record.ok === true && Object.hasOwn(record, 'value'))
    return { ok: true, value: record.value as Value }
  if (record.ok === false && typeof record.reason === 'string')
    return { ok: false, reason: record.reason }
  return null
}

export class ModuleManagementView {
  private readonly client: ModuleManagementActions
  private readonly browserJournal?: BrowserJournalActions
  private readonly bookmarkDoctor?: BookmarkDoctorActions
  private readonly clashControl?: ClashControlActions
  private readonly pageToolbox?: PageToolboxActions
  private readonly sendToOpenList?: SendToOpenListActions
  private readonly now: () => string
  private readonly onRecordChanged?: ModuleManagementViewOptions['onRecordChanged']
  private readonly onRecordRemoved?: ModuleManagementViewOptions['onRecordRemoved']
  private readonly onRecordInstalled?: ModuleManagementViewOptions['onRecordInstalled']
  private readonly listElement: HTMLElement
  private readonly feedback: HTMLElement
  private readonly confirmOverlay: HTMLElement
  private readonly confirmName: HTMLElement
  private readonly confirmButton: HTMLButtonElement
  private readonly cancelButton: HTMLButtonElement
  private readonly addButton: HTMLButtonElement
  private readonly installOverlay: HTMLElement
  private readonly installEntry: HTMLElement
  private readonly installReview: HTMLElement
  private readonly installInput: HTMLInputElement
  private readonly installStatus: HTMLElement
  private readonly installPrepareButton: HTMLButtonElement
  private readonly installCloseButton: HTMLButtonElement
  private readonly installCancelButton: HTMLButtonElement
  private readonly installConfirmButton: HTMLButtonElement
  private readonly installMark: HTMLElement
  private readonly installName: HTMLElement
  private readonly installDescription: HTMLElement
  private readonly installAccess: HTMLDListElement
  private readonly installGrants: HTMLElement
  private readonly busyModuleIds = new Set<string>()
  private readonly staleUpdateDigests = new Map<string, string>()
  private readonly updateMessages = new Map<string, { message: string, error: boolean }>()
  private records: InstalledModuleRecord[] = []
  private pendingRemovalId: string | null = null
  private pendingInstallReview: ModuleInstallReview | null = null
  private bookmarkPreparation: BookmarkScanPreparation | null = null
  private bookmarkSnapshot: BookmarkScanSnapshot | null = null
  private bookmarkRepairPlan: BookmarkRepairPlan | null = null
  private bookmarkRepairDraft: BookmarkRepairDraft | null = null
  private bookmarkRestorePlan: BookmarkRestorePlan | null = null
  private bookmarkWorkspaceState: BookmarkDoctorWorkspaceState = { ignoredBookmarks: [], deletionBackups: [] }
  private bookmarkResultFilter: BookmarkDoctorResultFilter = 'problems'
  private bookmarkMessage: { message: string, error: boolean } | null = null
  private bookmarkBusy = false
  private bookmarkStarting = false
  private bookmarkPollTimer: number | null = null
  private browserJournalSnapshot: BrowserJournalSnapshot | null = null
  private browserJournalArchive: BrowserJournalArchiveState = { schemaVersion: 1, sessions: [] }
  private browserJournalSelectedSavedSessionId: string | null = null
  private browserJournalMessage: { message: string, error: boolean } | null = null
  private browserJournalBusy = false
  private clashPreparation: ClashConnectionPreparation | null = null
  private clashStatus: ClashConnectionStatus | null = null
  private clashReadState: ClashReadState = { status: 'empty', snapshot: null, diagnostic: null }
  private clashSwitchPlan: ClashProxySwitchPlan | null = null
  private clashControllerUrl = 'http://127.0.0.1:9090'
  private clashMessage: { message: string, error: boolean } | null = null
  private clashBusy = false
  private clashOperationGeneration = 0
  private pageToolboxControlState: PageToolboxControlState = createPageToolboxControlState()
  private pageToolboxPreparation: PageToolboxSitePreparationV1 | null = null
  private pageToolboxMessage: { message: string, error: boolean } | null = null
  private pageToolboxRequestSequence = 0
  private sendConnection: SendToOpenListConnectionSnapshotV1 | null = null
  private sendPreparation: SendToOpenListConnectionPreparationV1 | null = null
  private sendCandidates: readonly ResourceCandidateV1[] = []
  private readonly sendSelected = new Set<string>()
  private sendTools: readonly string[] = []
  private sendTaskSnapshots: Partial<Record<'undone' | 'done', SendToOpenListTaskSnapshotV1>> = {}
  private sendCancelPlan: SendToOpenListCancelReviewPlanV1 | null = null
  private sendSubmission: SendToOpenListSubmissionStateV1 | null = null
  private sendProfileOrigin = ''
  private sendProfileLabel = 'OpenList/AList'
  private sendDestinationPath = '/'
  private sendManualText = ''
  private sendSelectedTool = ''
  private sendMessage: { message: string, error: boolean } | null = null
  private sendBusy = false

  constructor({ root, client, browserJournal, bookmarkDoctor, clashControl, pageToolbox, sendToOpenList, now = () => new Date().toISOString(), onRecordChanged, onRecordRemoved, onRecordInstalled }: ModuleManagementViewOptions) {
    this.client = client
    this.browserJournal = browserJournal
    this.bookmarkDoctor = bookmarkDoctor
    this.clashControl = clashControl
    this.pageToolbox = pageToolbox
    this.sendToOpenList = sendToOpenList
    this.now = now
    this.onRecordChanged = onRecordChanged
    this.onRecordRemoved = onRecordRemoved
    this.onRecordInstalled = onRecordInstalled
    this.listElement = root.querySelector<HTMLElement>('[data-module-list]')!
    this.feedback = root.querySelector<HTMLElement>('[data-testid="module-manager-status"]')!
    this.confirmOverlay = root.querySelector<HTMLElement>('[data-testid="remove-module-dialog"]')!
    this.confirmName = root.querySelector<HTMLElement>('[data-remove-module-name]')!
    this.confirmButton = root.querySelector<HTMLButtonElement>('[data-confirm-remove]')!
    this.cancelButton = root.querySelector<HTMLButtonElement>('[data-cancel-remove]')!
    this.addButton = root.querySelector<HTMLButtonElement>('[data-testid="add-module"]')!
    this.installOverlay = root.querySelector<HTMLElement>('[data-testid="install-module-dialog"]')!
    this.installEntry = root.querySelector<HTMLElement>('[data-install-entry]')!
    this.installReview = root.querySelector<HTMLElement>('[data-install-review]')!
    this.installInput = root.querySelector<HTMLInputElement>('[data-manifest-url]')!
    this.installStatus = root.querySelector<HTMLElement>('[data-testid="install-module-status"]')!
    this.installPrepareButton = root.querySelector<HTMLButtonElement>('[data-prepare-install]')!
    this.installCloseButton = root.querySelector<HTMLButtonElement>('[data-close-install]')!
    this.installCancelButton = root.querySelector<HTMLButtonElement>('[data-cancel-install]')!
    this.installConfirmButton = root.querySelector<HTMLButtonElement>('[data-confirm-install]')!
    this.installMark = root.querySelector<HTMLElement>('[data-install-mark]')!
    this.installName = root.querySelector<HTMLElement>('[data-install-name]')!
    this.installDescription = root.querySelector<HTMLElement>('[data-install-description]')!
    this.installAccess = root.querySelector<HTMLDListElement>('[data-install-access]')!
    this.installGrants = root.querySelector<HTMLElement>('[data-install-grants]')!

    this.listElement.addEventListener('click', this.handleListClick)
    this.listElement.addEventListener('change', this.handleListChange)
    this.confirmButton.addEventListener('click', this.handleConfirmRemoval)
    this.cancelButton.addEventListener('click', this.closeRemovalConfirmation)
    this.confirmOverlay.addEventListener('keydown', this.handleConfirmationKeydown)
    this.addButton.addEventListener('click', this.openInstaller)
    this.installPrepareButton.addEventListener('click', this.handlePrepareInstall)
    this.installCloseButton.addEventListener('click', this.handleCancelInstall)
    this.installCancelButton.addEventListener('click', this.handleCancelInstall)
    this.installConfirmButton.addEventListener('click', this.handleConfirmInstall)
    this.installInput.addEventListener('keydown', this.handleManifestUrlKeydown)
    this.installOverlay.addEventListener('keydown', this.handleInstallerKeydown)
  }

  async refresh() {
    this.setFeedback('正在读取已安装模块…')
    try {
      await this.reloadRecords()
      await Promise.all([
        this.refreshBrowserJournalStatus(),
        this.refreshBrowserJournalArchive(),
        this.refreshBookmarkScanStatus(),
        this.refreshBookmarkWorkspaceState(),
        this.refreshClashStatus(),
        this.refreshPageToolboxControl(),
        this.refreshSendToOpenListStatus(),
      ])
      this.render()
      this.setFeedback(`已安装 ${this.records.length} 个模块`)
    }
    catch {
      this.records = []
      this.render()
      this.setFeedback('无法读取模块，请稍后重试', true)
    }
  }

  private async reloadRecords() {
    this.records = await this.client.list()
    this.render()
  }

  private async tryReloadRecords() {
    try {
      await this.reloadRecords()
      return true
    }
    catch {
      return false
    }
  }

  private readonly openInstaller = () => {
    this.pendingInstallReview = null
    this.installInput.value = ''
    this.installEntry.hidden = false
    this.installReview.hidden = true
    this.setInstallStatus('')
    this.installOverlay.hidden = false
    this.installInput.focus()
  }

  private readonly handleManifestUrlKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void this.prepareInstall()
    }
  }

  private readonly handleInstallerKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !this.installCloseButton.disabled)
      void this.cancelInstall()
  }

  private readonly handlePrepareInstall = () => {
    void this.prepareInstall()
  }

  private readonly handleConfirmInstall = () => {
    void this.confirmInstall()
  }

  private readonly handleCancelInstall = () => {
    void this.cancelInstall()
  }

  private setInstallerBusy(busy: boolean) {
    this.installInput.disabled = busy
    this.installPrepareButton.disabled = busy
    this.installCloseButton.disabled = busy
    this.installCancelButton.disabled = busy
    this.installConfirmButton.disabled = busy
  }

  private setInstallStatus(message: string, error = false) {
    this.installStatus.textContent = message
    this.installStatus.dataset.state = error ? 'error' : 'ready'
  }

  private async prepareInstall() {
    const manifestUrl = this.installInput.value.trim()
    this.setInstallerBusy(true)
    this.setInstallStatus('正在请求 origin 权限并读取 manifest…')
    try {
      const result = await this.client.prepareInstall(manifestUrl)
      if (!result.ok) {
        this.setInstallStatus(installErrorMessage(result.reason), true)
        return
      }
      this.pendingInstallReview = result.review
      this.installInput.value = result.review.manifestUrl
      this.renderInstallReview(result.review)
      this.installEntry.hidden = true
      this.installReview.hidden = false
      this.setInstallStatus('请确认来源、适用页面和授权范围')
    }
    catch (error) {
      const reason = error instanceof ModuleManagementClientError ? error.code : 'transport-error'
      this.setInstallStatus(installErrorMessage(reason), true)
    }
    finally {
      this.setInstallerBusy(false)
    }
  }

  private renderInstallReview(review: ModuleInstallReview) {
    const requested = presentRequestedModuleAccess(review.manifest)
    this.installMark.textContent = review.manifest.name.slice(0, 1).toUpperCase() || 'M'
    this.installName.textContent = review.manifest.name
    this.installDescription.textContent = review.manifest.description
    this.installAccess.replaceChildren()
    appendAccessRow(this.installAccess, '版本', [review.manifest.version])
    appendAccessRow(this.installAccess, '精确 origin', [requested.origin])
    appendAccessRow(this.installAccess, '适用页面', review.manifest.matches)
    appendAccessRow(this.installAccess, '申请的上下文', requested.contexts)
    appendAccessRow(this.installAccess, '浏览器能力', requested.capabilities)

    const grants = document.createDocumentFragment()
    for (const contextId of review.manifest.contexts) {
      const group = element('fieldset', 'grant-group')
      group.append(element('legend', '', `共享上下文：${contextId}`))
      for (const field of review.manifest.context_fields[contextId] || []) {
        const label = element('label', 'grant-option')
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = true
        checkbox.dataset.contextId = contextId
        checkbox.dataset.contextField = field
        label.append(checkbox, document.createTextNode(field))
        group.append(label)
      }
      grants.append(group)
    }
    if (review.manifest.capabilities.length) {
      const group = element('fieldset', 'grant-group')
      group.append(element('legend', '', '浏览器能力'))
      for (const capability of review.manifest.capabilities) {
        const label = element('label', 'grant-option')
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = true
        checkbox.dataset.capability = capability
        label.append(checkbox, document.createTextNode(capability))
        group.append(label)
      }
      grants.append(group)
    }
    this.installGrants.replaceChildren(grants)
  }

  private collectInstallSelection(): ModuleInstallSelection {
    const grantedContextFields: ModuleContextFieldGrants = {}
    for (const checkbox of this.installGrants.querySelectorAll<HTMLInputElement>('input[data-context-id][data-context-field]:checked')) {
      const contextId = checkbox.dataset.contextId as ModuleContextId
      const field = checkbox.dataset.contextField!
      grantedContextFields[contextId] ||= []
      grantedContextFields[contextId]!.push(field)
    }
    const grantedCapabilities = [...this.installGrants.querySelectorAll<HTMLInputElement>('input[data-capability]:checked')]
      .map(checkbox => checkbox.dataset.capability as ModuleCapabilityId)
    return { grantedContextFields, grantedCapabilities }
  }

  private async confirmInstall() {
    const review = this.pendingInstallReview
    if (!review)
      return
    this.setInstallerBusy(true)
    this.setInstallStatus('正在重新验证并安装…')
    try {
      const result = await this.client.confirmInstall(
        review.manifestUrl,
        review.manifestDigest,
        this.collectInstallSelection(),
      )
      if (!result.ok) {
        this.setInstallStatus(installErrorMessage(result.reason), true)
        this.pendingInstallReview = null
        this.installReview.hidden = true
        this.installEntry.hidden = false
        return
      }
      this.pendingInstallReview = null
      this.records.push(result.record)
      this.render()
      this.setFeedback(`${result.record.manifest.name} 已安装`)
      this.onRecordInstalled?.(result.record)
      this.installOverlay.hidden = true
    }
    catch (error) {
      const reason = error instanceof ModuleManagementClientError ? error.code : 'transport-error'
      this.setInstallStatus(installErrorMessage(reason), true)
    }
    finally {
      this.setInstallerBusy(false)
    }
  }

  private async cancelInstall() {
    const review = this.pendingInstallReview
    this.pendingInstallReview = null
    this.installOverlay.hidden = true
    this.installReview.hidden = true
    this.installEntry.hidden = false
    if (review)
      await this.client.cancelInstall(review.manifestUrl).catch(() => undefined)
  }

  private setFeedback(message: string, error = false) {
    this.feedback.textContent = message
    this.feedback.dataset.state = error ? 'error' : 'ready'
  }

  private render() {
    const fragment = document.createDocumentFragment()
    if (!this.records.length) {
      fragment.append(element('p', 'module-list-empty', '尚未安装模块'))
    }
    else {
      for (const record of this.records)
        fragment.append(this.renderCard(record))
    }
    this.listElement.replaceChildren(fragment)
  }

  private renderCard(record: InstalledModuleRecord) {
    const access = presentModuleAccess(record)
    const card = element('article', 'module-card')
    card.dataset.testid = 'module-card'
    card.dataset.moduleId = record.manifest.id

    const heading = element('div', 'module-card-heading')
    const mark = element('span', 'module-card-mark', record.manifest.name.slice(0, 1).toUpperCase() || 'M')
    mark.setAttribute('aria-hidden', 'true')
    const identity = element('div', 'module-card-identity')
    identity.append(
      element('h2', 'module-card-name', record.manifest.name),
      element('p', 'module-card-description', record.manifest.description),
    )
    heading.append(mark, identity, this.renderToggle(record))

    const badges = element('div', 'module-badges')
    badges.append(
      element('span', 'module-badge', access.source),
      element('span', 'module-badge', access.runtime),
      element('span', `module-badge ${record.enabled ? 'is-enabled' : 'is-disabled'}`, record.enabled ? '已启用' : '已停用'),
    )

    const details = element('details', 'module-details')
    details.dataset.testid = 'module-details'
    details.append(element('summary', 'module-details-summary', '权限与来源'))
    const accessList = element('dl', 'module-access-list')
    appendAccessRow(accessList, '版本', [record.manifest.version])
    appendAccessRow(accessList, '入口来源', [access.origin])
    appendAccessRow(accessList, '适用页面', record.manifest.matches)
    appendAccessRow(accessList, '申请的上下文', access.requestedContexts)
    appendAccessRow(accessList, '已授权上下文', access.grantedContexts)
    appendAccessRow(accessList, '申请的浏览器能力', access.requestedCapabilities)
    appendAccessRow(accessList, '已授权浏览器能力', access.grantedCapabilities)
    details.append(accessList)

    const footer = element('div', 'module-card-footer')
    footer.append(element('code', 'module-id', record.manifest.id))
    const removeButton = element(
      'button',
      'module-remove-button',
      record.source === 'seeded' ? '预置模块不可移除' : '移除模块',
    )
    removeButton.type = 'button'
    removeButton.dataset.testid = 'module-remove'
    removeButton.dataset.action = 'remove'
    removeButton.dataset.moduleId = record.manifest.id
    removeButton.disabled = record.source === 'seeded' || this.busyModuleIds.has(record.manifest.id)
    footer.append(removeButton)

    card.append(heading, badges, details)
    if (record.manifest.runtime === 'builtin' && record.manifest.entry_id === BROWSER_JOURNAL_ENTRY_ID)
      card.append(this.renderBrowserJournalSection(record))
    if (record.manifest.runtime === 'builtin' && record.manifest.entry_id === BOOKMARK_DOCTOR_ENTRY_ID)
      card.append(this.renderBookmarkDoctorSection(record))
    if (record.manifest.runtime === 'builtin' && record.manifest.entry_id === CLASH_CONTROL_ENTRY_ID)
      card.append(this.renderClashControlSection(record))
    if (record.manifest.runtime === 'builtin' && record.manifest.entry_id === PAGE_TOOLBOX_ENTRY_ID)
      card.append(this.renderPageToolboxSection())
    if (record.manifest.runtime === 'builtin' && record.manifest.entry_id === SEND_TO_OPENLIST_ENTRY_ID)
      card.append(this.renderSendToOpenListSection(record))
    if (isRemotelyUpdateable(record))
      card.append(this.renderUpdateSection(record))
    card.append(footer)
    return card
  }

  private sendActionButton(action: string, label: string, disabled = this.sendBusy) {
    const button = element('button', 'secondary-button send-openlist-action', label)
    button.type = 'button'
    button.dataset.action = action
    button.dataset.moduleId = SEND_TO_OPENLIST_MODULE_ID
    button.dataset.testid = action
    button.disabled = disabled
    return button
  }

  private renderSendToOpenListSection(record: InstalledModuleRecord) {
    const section = element('section', 'send-openlist-panel')
    section.dataset.testid = 'send-to-openlist'
    section.append(
      element('h3', 'send-openlist-title', 'Send to OpenList · 资源收件箱'),
      element('p', 'send-openlist-note', '浏览器只提交你审查过的 URL；不会转交 Cookie、Referer、自定义请求头或文件字节。'),
    )
    if (this.sendMessage) {
      const message = element('p', 'send-openlist-message', this.sendMessage.message)
      message.dataset.state = this.sendMessage.error ? 'error' : 'ready'
      message.dataset.testid = 'send-openlist-message'
      section.append(message)
    }
    if (!record.enabled) {
      section.append(element('p', 'send-openlist-note', '模块已停用；不会连接服务或提交资源。'))
      return section
    }

    const connection = this.sendConnection
    if (!connection || connection.phase === 'disconnected' || connection.phase === 'error') {
      const label = document.createElement('input')
      label.type = 'text'
      label.value = this.sendProfileLabel
      label.dataset.testid = 'send-openlist-profile-label'
      const origin = document.createElement('input')
      origin.type = 'url'
      origin.value = this.sendProfileOrigin || connection?.profile?.controllerOrigin || ''
      origin.placeholder = 'https://openlist.example'
      origin.dataset.testid = 'send-openlist-origin'
      const form = element('div', 'send-openlist-form')
      form.append(
        this.sendField('服务名称', label),
        this.sendField('OpenList/AList exact origin', origin),
        element('p', 'send-openlist-note', 'Token 将保存在浏览器本地专用记录中，并非 OS 级密钥保险箱；建议使用最小权限账号。'),
        this.sendActionButton('send-openlist-prepare', '审查精确服务地址'),
      )
      section.append(form)
      if (connection?.phase === 'error')
        section.append(element('p', 'send-openlist-note', `最近诊断：${connection.errorCode}`))
      return section
    }

    if (connection.phase === 'preparing' && this.sendPreparation) {
      const review = element('div', 'send-openlist-review')
      review.dataset.testid = 'send-openlist-connection-review'
      review.append(
        element('strong', '', '确认连接边界'),
        element('code', '', this.sendPreparation.profile.controllerOrigin),
        element('p', 'send-openlist-note', `仅申请 ${this.sendPreparation.originPattern}；Token 只交给受信后台。`),
        this.sendActionButton('send-openlist-connect', '授权并验证 Token'),
        this.sendActionButton('send-openlist-disconnect', '取消'),
      )
      section.append(review)
      return section
    }

    if (connection.phase !== 'connected')
      return section

    section.append(element(
      'p',
      'send-openlist-note',
      `已连接 ${connection.profile.label} · ${connection.profile.controllerOrigin}。仅手动操作，不轮询。`,
    ))
    const connectionActions = element('div', 'send-openlist-actions')
    connectionActions.append(
      this.sendActionButton('send-openlist-disconnect', '断开并清除 Token'),
      this.sendActionButton('send-openlist-delete-profile', '删除 Profile'),
    )
    section.append(connectionActions)

    const manual = document.createElement('textarea')
    manual.value = this.sendManualText
    manual.rows = 4
    manual.placeholder = '每行一个 http、https、magnet 或 ed2k 地址'
    manual.dataset.testid = 'send-openlist-manual-input'
    const candidateActions = element('div', 'send-openlist-actions')
    candidateActions.append(this.sendActionButton('send-openlist-parse', '检查候选'))
    section.append(this.sendField('手动粘贴', manual), candidateActions)

    if (this.sendCandidates.length) {
      const list = element('ul', 'send-openlist-candidates')
      list.dataset.testid = 'send-openlist-candidates'
      for (const candidate of this.sendCandidates) {
        const presented = presentResourceCandidate(candidate)
        const item = element('li', 'send-openlist-candidate')
        const choice = document.createElement('input')
        choice.type = 'checkbox'
        choice.checked = !presented.blocked && this.sendSelected.has(candidate.id)
        choice.disabled = presented.blocked
        choice.dataset.sendCandidateId = candidate.id
        item.append(
          choice,
          element('span', 'send-openlist-kind', candidate.kind),
          element('span', 'send-openlist-url', candidate.url),
          ...(candidate.title ? [element('span', 'send-openlist-title-text', candidate.title)] : []),
          element('span', 'send-openlist-risk', presented.riskLabel),
        )
        list.append(item)
      }
      section.append(list)
    }

    const path = document.createElement('input')
    path.type = 'text'
    path.value = this.sendDestinationPath
    path.dataset.testid = 'send-openlist-path'
    section.append(
      this.sendField('服务端目标目录', path),
      this.sendActionButton('send-openlist-tools', '读取可用离线工具'),
    )
    if (this.sendTools.length) {
      const select = document.createElement('select')
      select.dataset.testid = 'send-openlist-tool'
      select.dataset.sendTool = 'true'
      for (const tool of this.sendTools) {
        const option = document.createElement('option')
        option.value = tool
        option.textContent = tool
        option.selected = tool === this.sendSelectedTool
        select.append(option)
      }
      section.append(
        this.sendField('服务端返回工具', select),
        this.sendActionButton(
          'send-openlist-submit',
          `提交已选 ${this.sendSelected.size} 项`,
          this.sendBusy || this.sendSelected.size === 0 || !this.sendSelectedTool,
        ),
      )
    }
    if (this.sendSubmission) {
      const results = element('ul', 'send-openlist-results')
      results.dataset.testid = 'send-openlist-results'
      for (const item of presentSubmissionStatus(this.sendSubmission)) {
        const row = element('li', 'send-openlist-result')
        row.append(element('span', '', item.label), element('span', 'send-openlist-url', item.url))
        results.append(row)
      }
      section.append(results)
    }

    const taskActions = element('div', 'send-openlist-actions')
    taskActions.append(
      this.sendActionButton('send-openlist-list-undone', '刷新未完成任务'),
      this.sendActionButton('send-openlist-list-done', '刷新已完成任务'),
    )
    section.append(taskActions)
    for (const listKind of ['undone', 'done'] as const) {
      const presented = presentTaskSnapshot(this.sendTaskSnapshots[listKind] || null)
      const tasks = element('section', 'send-openlist-tasks')
      tasks.dataset.testid = `send-openlist-${listKind}`
      tasks.append(element('strong', '', presented.label))
      const list = element('ul', 'send-openlist-task-list')
      for (const task of presented.tasks) {
        const item = element('li', 'send-openlist-task')
        item.append(element('span', '', task.label), element('code', '', task.id))
        if (listKind === 'undone') {
          const button = this.sendActionButton('send-openlist-prepare-cancel', '审查取消')
          button.dataset.taskId = task.id
          item.append(button)
        }
        list.append(item)
      }
      tasks.append(list)
      section.append(tasks)
    }
    if (this.sendCancelPlan) {
      const review = element('div', 'send-openlist-review')
      review.dataset.testid = 'send-openlist-cancel-review'
      review.append(
        element('strong', '', '确认取消一个服务端任务'),
        element('code', '', this.sendCancelPlan.taskId),
        element('p', 'send-openlist-note', `一次性计划有效至 ${this.sendCancelPlan.expiresAt}`),
        this.sendActionButton('send-openlist-confirm-cancel', '确认取消'),
        this.sendActionButton('send-openlist-abandon-cancel', '放弃'),
      )
      section.append(review)
    }
    return section
  }

  private sendField(label: string, control: HTMLElement) {
    const wrapper = element('label', 'send-openlist-field')
    wrapper.append(element('span', '', label), control)
    return wrapper
  }

  private pageToolboxActionButton(action: string, label: string, disabled = false) {
    const button = element('button', 'secondary-button page-toolbox-control-action', label)
    button.type = 'button'
    button.dataset.action = action
    button.dataset.moduleId = PAGE_TOOLBOX_MODULE_ID
    button.dataset.testid = action
    button.disabled = disabled
    return button
  }

  private renderPageToolboxSection() {
    const presented = presentPageToolboxControlState(this.pageToolboxControlState)
    const section = element('section', 'page-toolbox-control-panel')
    section.dataset.testid = 'page-toolbox-control'
    section.dataset.state = presented.state

    const heading = element('div', 'page-toolbox-control-heading')
    heading.append(
      element('h3', 'page-toolbox-control-title', 'Page Toolbox · 当前站点'),
      element('span', 'page-toolbox-control-badge', '可信侧边栏 · exact-origin'),
    )
    section.append(heading)

    const identity = element('div', 'page-toolbox-current-site')
    identity.append(
      element('strong', 'page-toolbox-current-title', presented.title),
      element('code', 'page-toolbox-current-origin', presented.origin || '非 HTTP(S) 页面'),
    )
    section.append(identity)

    const message = element(
      'p',
      'page-toolbox-control-message',
      this.pageToolboxMessage?.message || presented.message,
    )
    message.dataset.testid = 'page-toolbox-control-message'
    message.dataset.state = this.pageToolboxMessage?.error || presented.state === 'error' || presented.state === 'stale'
      ? 'error'
      : 'ready'
    section.append(message)

    if (presented.state === 'site-unapproved') {
      if (this.pageToolboxPreparation) {
        const review = element('div', 'page-toolbox-site-review')
        review.dataset.testid = 'page-toolbox-site-review'
        review.append(
          element('strong', '', '确认当前精确站点授权'),
          element('code', '', this.pageToolboxPreparation.exactOrigin),
          element('p', 'page-toolbox-control-note', '只请求上方 exact origin；站点、标签页与模块身份均由后台重新派生。'),
          this.pageToolboxActionButton('page-toolbox-confirm-site', '授权并启用站点'),
          this.pageToolboxActionButton('page-toolbox-cancel-site', '取消'),
        )
        section.append(review)
      }
      else {
        section.append(this.pageToolboxActionButton('page-toolbox-prepare-site', '审查当前站点授权'))
      }
      section.append(this.pageToolboxActionButton('page-toolbox-refresh', '重新读取'))
      return section
    }

    if (presented.state === 'ready' || presented.state === 'saving') {
      const tools = element('div', 'page-toolbox-tool-list')
      for (const tool of presented.tools) {
        const card = element('fieldset', 'page-toolbox-tool-control')
        card.disabled = !tool.canEdit || presented.state === 'saving'
        card.dataset.toolId = tool.toolId
        const legend = element('legend', 'page-toolbox-tool-heading')
        const enabled = document.createElement('input')
        enabled.type = 'checkbox'
        enabled.checked = tool.enabled
        enabled.dataset.pageToolboxEnabled = 'true'
        enabled.dataset.toolId = tool.toolId
        legend.append(enabled, document.createTextNode(tool.title))
        card.append(legend, element('p', 'page-toolbox-control-note', tool.safetyLabel))
        for (const setting of tool.settings) {
          const label = element('label', 'page-toolbox-setting')
          label.append(element('span', '', setting.label))
          if (setting.kind === 'choice') {
            const select = document.createElement('select')
            select.dataset.pageToolboxSetting = setting.key
            select.dataset.toolId = tool.toolId
            for (const option of setting.options) {
              const node = document.createElement('option')
              node.value = option.value
              node.textContent = option.label
              select.append(node)
            }
            select.value = setting.value
            label.append(select)
          }
          else {
            const checkbox = document.createElement('input')
            checkbox.type = 'checkbox'
            checkbox.checked = setting.value
            checkbox.dataset.pageToolboxSetting = setting.key
            checkbox.dataset.toolId = tool.toolId
            label.prepend(checkbox)
          }
          card.append(label)
        }
        tools.append(card)
      }
      section.append(tools)
      const actions = element('div', 'page-toolbox-control-actions')
      actions.append(
        this.pageToolboxActionButton('page-toolbox-save', '保存当前站点设置', !presented.canSave),
        this.pageToolboxActionButton('page-toolbox-discard', '放弃草稿', !presented.dirty),
        this.pageToolboxActionButton('page-toolbox-refresh', '重新读取'),
        this.pageToolboxActionButton('page-toolbox-revoke-site', '撤销站点授权'),
      )
      section.append(actions)
      return section
    }

    section.append(this.pageToolboxActionButton('page-toolbox-refresh', '重新读取'))
    return section
  }

  private renderBrowserJournalSection(record: InstalledModuleRecord) {
    const section = element('section', 'browser-journal-panel bookmark-doctor-panel')
    section.dataset.testid = 'browser-journal'
    const heading = element('div', 'bookmark-doctor-heading')
    heading.append(
      element('h3', 'bookmark-doctor-title', 'Browser Journal · 手动浏览会话'),
      element('span', 'bookmark-doctor-limits', '手动保存 · 7 天 · 最多 10 份'),
    )
    section.append(heading)
    if (this.browserJournalMessage) {
      const message = element('p', 'bookmark-doctor-message', this.browserJournalMessage.message)
      message.dataset.testid = 'browser-journal-message'
      message.dataset.state = this.browserJournalMessage.error ? 'error' : 'ready'
      section.append(message)
    }
    if (!record.enabled) {
      section.append(element(
        'p',
        'bookmark-doctor-note',
        '模块已停用；不会监听标签页，临时会话已清空。此前明确保存的记录仍保留，可在下方删除。',
      ))
      section.append(this.renderBrowserJournalArchive())
      return section
    }

    const snapshot = this.browserJournalSnapshot
    const recording = snapshot?.status === 'recording'
    section.append(element(
      'p',
      'bookmark-doctor-note',
      recording
        ? '正在记录明确开始后的活动标签页激活与导航；无痕窗口不会进入会话。'
        : '只记录手动开始后的活动标签页；不会读取已有历史，也不会持久保存。',
    ))
    section.append(this.browserJournalActionButton(
      recording ? 'browser-journal-stop' : 'browser-journal-start',
      recording ? '停止本次记录' : '开始一次记录',
      this.browserJournalBusy,
    ))
    if (!recording && snapshot?.entries.length) {
      section.append(this.browserJournalActionButton(
        'browser-journal-save',
        '保存本次会话到本机（7 天）',
        this.browserJournalBusy,
      ))
    }

    const results = element('div', 'bookmark-doctor-results')
    results.dataset.testid = 'browser-journal-results'
    results.dataset.state = snapshot?.status || 'stopped'
    results.append(element(
      'p',
      'bookmark-doctor-counts',
      `${recording ? '记录中' : '已停止'} · ${snapshot?.entries.length || 0} 条`,
    ))
    const list = element('ol', 'bookmark-doctor-result-list')
    for (const entry of snapshot?.entries.slice(-50) || []) {
      const item = element('li', 'bookmark-doctor-result')
      item.append(
        element('strong', 'bookmark-doctor-result-title', entry.title || '未命名页面'),
        element('span', 'bookmark-doctor-result-url', entry.url),
        element('span', 'bookmark-doctor-result-folder', `${entry.kind === 'activation' ? '激活' : '导航'} · ${entry.occurredAt}`),
      )
      list.append(item)
    }
    if (!snapshot?.entries.length)
      list.append(element('li', 'bookmark-doctor-result-more', '当前后台会话中没有记录。'))
    results.append(list)
    section.append(results)
    section.append(this.renderBrowserJournalArchive())
    return section
  }

  private renderBrowserJournalArchive() {
    const presentation = presentBrowserJournalArchive(
      this.browserJournalArchive,
      this.browserJournalSelectedSavedSessionId,
    )
    const archive = element('section', 'bookmark-doctor-local-state browser-journal-archive')
    archive.dataset.testid = 'browser-journal-archive'
    archive.append(element(
      'h3',
      'bookmark-doctor-title',
      `明确保存 · ${this.browserJournalArchive.sessions.length}/${BROWSER_JOURNAL_ARCHIVE_SESSION_LIMIT}`,
    ))
    archive.append(element(
      'p',
      'bookmark-doctor-note',
      '只保存在本机扩展存储；不会自动保存，超过 7 天会在后台启动或访问时清理。',
    ))
    if (!this.browserJournalArchive.sessions.length) {
      archive.append(element('p', 'bookmark-doctor-empty', '尚无明确保存的会话。'))
      return archive
    }
    const index = element('div', 'browser-journal-saved-index')
    index.dataset.testid = 'browser-journal-saved-index'
    for (const session of presentation.sessions) {
      const choice = this.browserJournalActionButton(
        'browser-journal-select-saved',
        `${session.entryCount} 条 · 保存于 ${session.savedAt}`,
        this.browserJournalBusy,
      )
      choice.classList.add('browser-journal-session-choice')
      choice.dataset.testid = 'browser-journal-saved-session-choice'
      choice.dataset.savedSessionId = session.id
      choice.setAttribute('aria-pressed', String(session.id === presentation.selectedSessionId))
      choice.append(element('span', 'browser-journal-session-expiry', `到期 ${session.expiresAt}`))
      index.append(choice)
    }
    archive.append(index)

    const session = presentation.selectedSession
    if (session) {
      const detail = element('article', 'bookmark-doctor-result browser-journal-saved-session')
      detail.dataset.testid = 'browser-journal-saved-session'
      detail.dataset.savedSessionId = session.id
      detail.append(
        element('strong', 'bookmark-doctor-result-title', `${session.entryCount} 条 · 保存于 ${session.savedAt}`),
        element('span', 'bookmark-doctor-result-folder', `${session.startedAt} → ${session.stoppedAt}`),
        element('span', 'bookmark-doctor-result-folder', `保留至 ${session.expiresAt}`),
      )
      const entries = element('ol', 'bookmark-doctor-result-list')
      entries.dataset.testid = 'browser-journal-saved-entries'
      for (const entry of session.entries) {
        const item = element('li', 'bookmark-doctor-result')
        item.append(
          element('strong', 'bookmark-doctor-result-title', entry.title || '未命名页面'),
          element('span', 'bookmark-doctor-result-url', entry.url),
          element('span', 'bookmark-doctor-result-folder', `${entry.kind === 'activation' ? '激活' : '导航'} · ${entry.occurredAt}`),
        )
        entries.append(item)
      }
      const remove = this.browserJournalActionButton('browser-journal-delete-saved', '删除当前会话', this.browserJournalBusy)
      remove.dataset.savedSessionId = session.id
      detail.append(entries, remove)
      archive.append(detail)
    }
    const confirmation = element('label', 'bookmark-local-clear-confirmation')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.dataset.testid = 'browser-journal-clear-confirmation'
    confirmation.append(checkbox, document.createTextNode('我确认清除全部已保存会话'))
    archive.append(
      confirmation,
      this.browserJournalActionButton('browser-journal-clear-saved', '清除全部保存记录', this.browserJournalBusy),
    )
    return archive
  }

  private browserJournalActionButton(action: string, label: string, disabled: boolean) {
    const button = element('button', 'secondary-button bookmark-doctor-action', label)
    button.type = 'button'
    button.dataset.action = action
    button.dataset.moduleId = BROWSER_JOURNAL_MODULE_ID
    button.dataset.testid = action
    button.disabled = disabled
    return button
  }

  private renderClashControlSection(record: InstalledModuleRecord) {
    const section = element('section', 'clash-control-panel')
    section.dataset.testid = 'clash-control'
    const heading = element('div', 'clash-control-heading')
    heading.append(
      element('h3', 'clash-control-title', 'Clash Control · 状态与节点切换'),
      element('span', 'clash-control-badge', '手动 · 审查后执行'),
    )
    section.append(heading)
    if (this.clashMessage) {
      const message = element('p', 'clash-control-message', this.clashMessage.message)
      message.dataset.testid = 'clash-control-message'
      message.dataset.state = this.clashMessage.error ? 'error' : 'ready'
      section.append(message)
    }
    if (!record.enabled) {
      section.append(element('p', 'clash-control-note', '模块已停用；不会连接 controller，也不会保留连接 secret。'))
      return section
    }
    if (this.clashStatus) {
      const status = element('dl', 'clash-control-status')
      status.dataset.testid = 'clash-control-status'
      appendAccessRow(status, 'Controller', [this.clashStatus.controllerOrigin])
      appendAccessRow(status, '实现', [this.clashStatus.implementation])
      appendAccessRow(status, '版本', [this.clashStatus.version])
      appendAccessRow(status, '模式', [this.clashStatus.mode])
      section.append(status, this.renderClashReadState())
      const actions = element('div', 'clash-control-actions')
      actions.append(
        this.clashActionButton('clash-refresh', '手动刷新只读状态', this.clashBusy),
        this.clashActionButton('clash-disconnect', '断开并回收权限', this.clashBusy),
      )
      section.append(actions)
      return section
    }
    if (this.clashPreparation) {
      const review = element('div', 'clash-control-review')
      review.dataset.testid = 'clash-control-review'
      review.append(
        element('strong', '', '确认精确 localhost origin'),
        element('code', '', this.clashPreparation.controllerOrigin),
        element('p', 'clash-control-note', 'Secret 通过浏览器模态输入，不写入页面 DOM、URL、日志或模块状态。'),
        this.clashActionButton('clash-connect', '授权 origin 并连接', this.clashBusy),
        this.clashActionButton('clash-disconnect', '取消', this.clashBusy),
      )
      section.append(review)
      return section
    }
    const label = element('label', 'clash-control-field')
    label.append(element('span', '', 'Controller URL'))
    const input = document.createElement('input')
    input.type = 'url'
    input.value = this.clashControllerUrl
    input.placeholder = 'http://127.0.0.1:9090'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.dataset.testid = 'clash-controller-url'
    label.append(input)
    section.append(
      element('p', 'clash-control-note', '仅接受 localhost、127.0.0.0/8 或 [::1] 的纯 origin；后台只访问固定只读端点。'),
      label,
      this.clashActionButton('clash-prepare', '检查地址', this.clashBusy),
    )
    return section
  }

  private renderClashReadState() {
    const container = element('div', 'clash-read-state')
    container.dataset.testid = 'clash-read-state'
    container.dataset.state = this.clashReadState.status
    const snapshot = this.clashReadState.snapshot
    if (!snapshot) {
      container.append(element(
        'p',
        'clash-control-note',
        this.clashReadState.diagnostic
          ? '上次手动读取失败，当前没有可展示的快照。'
          : '尚未读取代理组。点击“手动刷新只读状态”后才会访问 controller。',
      ))
      return container
    }
    const summary = element('dl', 'clash-control-status clash-read-summary')
    appendAccessRow(summary, '快照模式', [snapshot.mode])
    appendAccessRow(summary, '刷新时间', [snapshot.refreshedAt])
    appendAccessRow(summary, '代理组', [String(snapshot.proxyGroups.length)])
    container.append(summary)
    if (this.clashReadState.status === 'stale')
      container.append(element('p', 'clash-control-note clash-read-stale', '最近一次刷新失败；以下为本次 worker 会话中的过期快照。'))
    if (!snapshot.proxyGroups.length) {
      container.append(element('p', 'clash-control-note', 'Controller 返回了空的代理组集合。'))
      return container
    }
    const groups = element('div', 'clash-proxy-groups')
    groups.dataset.testid = 'clash-proxy-groups'
    const choices = presentClashProxyGroupChoices(snapshot)
    if (this.clashSwitchPlan)
      container.append(this.renderClashProxySwitchReview(snapshot, this.clashSwitchPlan))
    for (const [index, group] of snapshot.proxyGroups.entries()) {
      const card = element('article', 'clash-proxy-group')
      card.dataset.testid = 'clash-proxy-group'
      card.dataset.groupName = group.name
      card.append(
        element('h4', 'clash-proxy-group-name', `${group.name} · ${group.type}`),
        element('p', 'clash-proxy-selection', `当前选择：${group.selectedNode}`),
      )
      const nodes = element('ul', 'clash-proxy-nodes')
      for (const node of group.nodes) {
        const alive = node.alive === true ? '可用' : node.alive === false ? '不可用' : '状态未知'
        nodes.append(element('li', '', `${node.name} · ${node.type} · ${alive}`))
      }
      card.append(nodes)
      const choice = choices[index]!
      if (this.clashReadState.status === 'ready' && !this.clashSwitchPlan) {
        if (choice.targets.length) {
          const control = element('div', 'clash-switch-control')
          const label = element('label', 'clash-switch-field')
          label.append(element('span', '', '切换到已读取节点'))
          const select = document.createElement('select')
          select.dataset.testid = 'clash-switch-target'
          select.dataset.groupName = choice.groupName
          for (const target of choice.targets) {
            const option = document.createElement('option')
            option.value = target.name
            option.textContent = `${target.name} · ${target.type}`
            select.append(option)
          }
          label.append(select)
          control.append(
            label,
            this.clashActionButton('clash-switch-prepare', '审查节点切换', this.clashBusy),
          )
          card.append(control)
        }
        else {
          card.append(element('p', 'clash-control-note', '当前快照中没有其他可选节点。'))
        }
      }
      groups.append(card)
    }
    container.append(groups)
    return container
  }

  private renderClashProxySwitchReview(
    snapshot: NonNullable<ClashReadState['snapshot']>,
    plan: ClashProxySwitchPlan,
  ) {
    const presented = presentClashProxySwitchReview(snapshot, plan, this.now())
    const review = element('section', 'clash-switch-review')
    review.dataset.testid = 'clash-switch-review'
    review.dataset.state = presented.state
    review.append(element('h4', 'clash-switch-review-title', '确认节点切换'))
    const values = element('dl', 'clash-control-status clash-switch-review-values')
    appendAccessRow(values, 'Controller', [presented.controllerOrigin])
    appendAccessRow(values, '代理组', [presented.groupName])
    appendAccessRow(values, '当前节点', [presented.originalNode])
    appendAccessRow(values, '目标节点', [presented.targetNode])
    appendAccessRow(values, '有效至', [presented.expiresAt])
    const message = element('p', 'clash-control-note', presented.message)
    const actions = element('div', 'clash-control-actions')
    actions.append(
      this.clashActionButton(
        'clash-switch-confirm',
        '确认执行一次切换',
        this.clashBusy || !presented.canConfirm,
      ),
      this.clashActionButton('clash-switch-cancel', '放弃本次审查', this.clashBusy),
    )
    review.append(values, message, actions)
    return review
  }

  private clashActionButton(action: string, label: string, disabled: boolean) {
    const button = element('button', 'secondary-button clash-control-action', label)
    button.type = 'button'
    button.dataset.action = action
    button.dataset.moduleId = CLASH_CONTROL_MODULE_ID
    button.dataset.testid = action
    button.disabled = disabled
    return button
  }

  private renderBookmarkDoctorSection(record: InstalledModuleRecord) {
    const section = element('section', 'bookmark-doctor-panel')
    section.dataset.testid = 'bookmark-doctor-scan'
    const heading = element('div', 'bookmark-doctor-heading')
    heading.append(
      element('h3', 'bookmark-doctor-title', 'Bookmark Doctor · 本地书签健康检查'),
      element('span', 'bookmark-doctor-limits', '手动 · 4 并发 · 8 秒'),
    )
    section.append(heading)

    if (this.bookmarkMessage) {
      const message = element('p', 'bookmark-doctor-message', this.bookmarkMessage.message)
      message.dataset.state = this.bookmarkMessage.error ? 'error' : 'ready'
      message.dataset.testid = 'bookmark-doctor-message'
      section.append(message)
    }

    if (!record.enabled) {
      section.append(
        element('p', 'bookmark-doctor-note', '模块已停用；不会读取书签或发起网络请求。本地忽略和恢复记录仍可单独清理。'),
        this.renderBookmarkLocalDiagnostics(record),
      )
      return section
    }

    if (!record.grantedCapabilities.includes('bookmarks.read')) {
      section.append(element('p', 'bookmark-doctor-note', '书签只在本机读取，标题、URL 与结果不会共享给网页模块。'))
      section.append(this.bookmarkActionButton('bookmark-authorize', '授权读取书签', this.bookmarkBusy))
      section.append(this.renderBookmarkLocalDiagnostics(record))
      return section
    }

    if (this.bookmarkPreparation && !this.bookmarkStarting) {
      const plan = element(
        'p',
        'bookmark-doctor-note',
        `准备检查 ${this.bookmarkPreparation.total} 条链接，跳过 ${this.bookmarkPreparation.skipped} 条；需要 ${this.bookmarkPreparation.originPatterns.length} 个精确来源权限。`,
      )
      plan.dataset.testid = 'bookmark-doctor-plan'
      section.append(plan)
      section.append(this.bookmarkActionButton('bookmark-start', '授权来源并开始', this.bookmarkBusy))
    }
    else if (!this.bookmarkSnapshot || this.bookmarkSnapshot.status !== 'scanning') {
      section.append(this.bookmarkActionButton(
        'bookmark-prepare',
        this.bookmarkSnapshot ? '准备再次扫描' : '准备扫描',
        this.bookmarkBusy || this.bookmarkStarting,
      ))
    }

    if (this.bookmarkStarting && this.bookmarkSnapshot?.status !== 'scanning')
      section.append(element('p', 'bookmark-doctor-note', '正在核验精确来源权限并启动…'))

    if (this.bookmarkSnapshot)
      section.append(this.renderBookmarkScanSnapshot(this.bookmarkSnapshot, record))
    else
      section.append(element('p', 'bookmark-doctor-empty', '尚未运行扫描。结果只保留在本次后台会话中。'))
    section.append(this.renderBookmarkRepairSection(record))
    section.append(this.renderBookmarkLocalDiagnostics(record))
    return section
  }

  private renderBookmarkRepairSection(record: InstalledModuleRecord) {
    const section = element('section', 'bookmark-repair-panel')
    section.dataset.testid = 'bookmark-repair'
    section.append(element('h3', 'bookmark-doctor-title', '安全修复 · 审查后执行'))
    if (!record.grantedCapabilities.includes('bookmarks.write')) {
      section.append(element('p', 'bookmark-doctor-note', '读取与修改分权；启用后每次操作仍需先生成计划并再次确认。'))
      section.append(this.bookmarkActionButton('bookmark-authorize-repairs', '启用修复权限', this.bookmarkBusy))
      return section
    }
    if (this.bookmarkRepairPlan) {
      section.append(this.renderBookmarkRepairReview(this.bookmarkRepairPlan))
      return section
    }
    if (!this.bookmarkRepairDraft) {
      section.append(element(
        'p',
        'bookmark-doctor-note',
        this.bookmarkSnapshot?.results.length ? '请从扫描结果选择更新、移动、忽略或删除。' : '完成一次扫描后可从结果直接发起修复。',
      ))
      return section
    }

    const draft = this.bookmarkRepairDraft
    const form = element('div', 'bookmark-repair-form')
    form.dataset.testid = 'bookmark-repair-draft'
    const labels: Record<BookmarkRepairDraft['operation'], string> = {
      update: '更新书签',
      move: '移动书签',
      ignore: '忽略书签',
      delete: '删除书签',
    }
    form.append(
      element('strong', 'bookmark-repair-operation', labels[draft.operation]),
      element('p', 'bookmark-doctor-note', `目标书签：${draft.bookmarkId}`),
    )
    const fields = draft.operation === 'update'
      ? [
          ['bookmark-repair-title', '新标题', 'title', draft.title],
          ['bookmark-repair-url', '新 URL', 'url', draft.url],
        ]
      : draft.operation === 'move'
        ? [
            ['bookmark-repair-parent', '目标文件夹 ID', 'parentId', draft.parentId],
            ['bookmark-repair-index', '目标顺序（可选）', 'index', draft.index],
          ]
        : []
    for (const [testId, placeholder, name, value] of fields) {
      const input = document.createElement('input')
      input.type = name === 'index' ? 'number' : 'text'
      input.min = name === 'index' ? '0' : ''
      input.placeholder = placeholder
      input.value = value
      input.dataset.testid = testId
      input.dataset.repairField = name
      form.append(this.bookmarkRepairField(placeholder, input))
    }
    const actions = element('div', 'bookmark-repair-actions')
    actions.append(
      this.bookmarkActionButton('bookmark-repair-cancel', '取消', this.bookmarkBusy),
      this.bookmarkActionButton('bookmark-repair-prepare', '生成审查计划', this.bookmarkBusy),
    )
    form.append(actions)
    section.append(form)
    return section
  }

  private bookmarkRepairField(label: string, control: HTMLElement) {
    const wrapper = element('label', 'bookmark-repair-field')
    wrapper.append(element('span', '', label), control)
    return wrapper
  }

  private renderBookmarkRepairReview(plan: BookmarkRepairPlan) {
    const presentation = presentBookmarkRepairPlan(plan)
    const review = element('div', 'bookmark-repair-review')
    review.dataset.testid = 'bookmark-repair-review'
    review.append(
      element('strong', 'bookmark-repair-operation', presentation.operationLabel),
      element('p', 'bookmark-doctor-note', presentation.targetLabel),
    )
    const values = element('ul', 'bookmark-repair-values')
    for (const value of [...presentation.beforeValues, ...presentation.proposedValues])
      values.append(element('li', '', value))
    review.append(values, element('p', 'bookmark-doctor-note', `计划有效至 ${presentation.expiresAt}`))
    if (presentation.destructive) {
      const label = element('label', 'bookmark-repair-delete-confirmation')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.dataset.testid = 'bookmark-repair-delete-confirmation'
      label.append(checkbox, document.createTextNode('我确认永久删除该书签'))
      review.append(label)
    }
    review.append(this.bookmarkActionButton(
      'bookmark-repair-confirm',
      presentation.destructive ? '确认永久删除' : '确认执行',
      this.bookmarkBusy,
    ))
    return review
  }

  private bookmarkActionButton(action: string, label: string, disabled: boolean) {
    const button = element('button', 'secondary-button bookmark-doctor-action', label)
    button.type = 'button'
    button.dataset.action = action
    button.dataset.moduleId = BOOKMARK_DOCTOR_MODULE_ID
    button.dataset.testid = action
    button.disabled = disabled
    return button
  }

  private renderBookmarkScanSnapshot(snapshot: BookmarkScanSnapshot, record: InstalledModuleRecord) {
    const presentation = presentBookmarkDoctorScan(snapshot)
    const workspace = presentBookmarkDoctorWorkspace(
      snapshot,
      this.bookmarkWorkspaceState,
      this.bookmarkResultFilter,
    )
    const container = element('div', 'bookmark-doctor-results')
    container.dataset.testid = 'bookmark-doctor-results'
    const summary = element('div', 'bookmark-doctor-summary')
    summary.append(
      element('strong', '', presentation.statusLabel),
      element('span', '', presentation.progressLabel),
    )
    container.append(summary)
    const counts = element('p', 'bookmark-doctor-counts')
    counts.textContent = `可访问 ${presentation.counts.reachable} · HTTP 错误 ${presentation.counts['http-error']} · 超时 ${presentation.counts.timeout} · 网络失败 ${presentation.counts['network-failure']}`
    container.append(counts)

    if (snapshot.status === 'scanning')
      container.append(this.bookmarkActionButton('bookmark-stop', '停止扫描', false))

    const filters = element('div', 'bookmark-doctor-filters')
    for (const [filter, label, count] of [
      ['problems', '问题', workspace.problemCount],
      ['all', '全部', snapshot.results.length],
      ['reachable', '可访问', workspace.reachableCount],
    ] as const) {
      const button = this.bookmarkActionButton('bookmark-result-filter', `${label} ${count}`, false)
      button.dataset.filter = filter
      button.dataset.active = String(this.bookmarkResultFilter === filter)
      filters.append(button)
    }
    container.append(filters)

    const list = element('ul', 'bookmark-doctor-result-list')
    for (const result of workspace.visibleResults.slice(0, 50)) {
      const item = element('li', 'bookmark-doctor-result')
      item.append(
        element('span', `bookmark-doctor-result-state is-${result.outcome}`, bookmarkProbeOutcomeLabel(result.outcome)),
        element('strong', 'bookmark-doctor-result-title', result.title || '未命名书签'),
        element('span', 'bookmark-doctor-result-url', result.url),
        element('span', 'bookmark-doctor-result-folder', result.folderPath.length ? result.folderPath.join(' / ') : '书签根目录'),
      )
      if (result.bookmarkId && record.grantedCapabilities.includes('bookmarks.write')) {
        const actions = element('div', 'bookmark-doctor-result-actions')
        for (const [operation, label] of [
          ['update', '更新'],
          ['move', '移动'],
          ['ignore', '忽略'],
          ['delete', '删除'],
        ] as const) {
          const button = this.bookmarkActionButton('bookmark-result-repair', label, this.bookmarkBusy)
          button.dataset.entryId = result.entryId
          button.dataset.operation = operation
          button.dataset.testid = `bookmark-result-${operation}`
          actions.append(button)
        }
        item.append(actions)
      }
      list.append(item)
    }
    if (!workspace.visibleResults.length)
      list.append(element('li', 'bookmark-doctor-result-more', workspace.emptyLabel))
    else if (workspace.visibleResults.length > 50)
      list.append(element('li', 'bookmark-doctor-result-more', `仅展示前 50 条，共 ${workspace.visibleResults.length} 条结果`))
    container.append(list)
    return container
  }

  private renderBookmarkLocalDiagnostics(record: InstalledModuleRecord) {
    const section = element('section', 'bookmark-doctor-local-state')
    section.dataset.testid = 'bookmark-local-diagnostics'
    section.append(element(
      'h3',
      'bookmark-doctor-title',
      `本地记录 · 忽略 ${this.bookmarkWorkspaceState.ignoredBookmarks.length} · 恢复 ${this.bookmarkWorkspaceState.deletionBackups.length}`,
    ))

    if (this.bookmarkRestorePlan) {
      const plan = presentBookmarkRestorePlan(this.bookmarkRestorePlan)
      const review = element('div', 'bookmark-restore-review')
      review.dataset.testid = 'bookmark-restore-review'
      review.append(
        element('strong', 'bookmark-repair-operation', '恢复已删除书签'),
        element('p', 'bookmark-doctor-note', `标题：${plan.title}`),
        element('p', 'bookmark-doctor-note', `URL：${plan.url}`),
        element('p', 'bookmark-doctor-note', `原位置：${plan.destination}`),
        element('p', 'bookmark-doctor-note', `计划有效至 ${plan.expiresAt}`),
        this.bookmarkActionButton('bookmark-restore-confirm', '确认恢复', this.bookmarkBusy),
      )
      section.append(review)
    }

    if (this.bookmarkWorkspaceState.ignoredBookmarks.length) {
      const list = element('ul', 'bookmark-local-list')
      for (const ignored of this.bookmarkWorkspaceState.ignoredBookmarks) {
        const item = element('li', 'bookmark-local-item')
        item.append(
          element('strong', '', ignored.title || '未命名书签'),
          element('span', '', ignored.url),
        )
        const button = this.bookmarkActionButton('bookmark-unignore', '取消忽略', this.bookmarkBusy || !record.enabled)
        button.dataset.bookmarkId = ignored.bookmarkId
        item.append(button)
        list.append(item)
      }
      section.append(list)
    }

    if (this.bookmarkWorkspaceState.deletionBackups.length) {
      const list = element('ul', 'bookmark-local-list')
      for (const backup of this.bookmarkWorkspaceState.deletionBackups) {
        const item = element('li', 'bookmark-local-item')
        item.append(
          element('strong', '', backup.title || '未命名书签'),
          element('span', '', backup.url),
        )
        const button = this.bookmarkActionButton('bookmark-restore-prepare', '审查恢复', this.bookmarkBusy || !record.enabled)
        button.dataset.backupToken = backup.repairToken
        item.append(button)
        list.append(item)
      }
      section.append(list)
    }

    if (this.bookmarkWorkspaceState.ignoredBookmarks.length || this.bookmarkWorkspaceState.deletionBackups.length) {
      const confirmation = element('label', 'bookmark-local-clear-confirmation')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.dataset.testid = 'bookmark-local-clear-confirmation'
      confirmation.append(checkbox, document.createTextNode('确认清除以上 Bookmark Doctor 本地记录'))
      section.append(
        confirmation,
        this.bookmarkActionButton('bookmark-local-clear', '清除本地记录', this.bookmarkBusy),
      )
    }

    if (record.grantedCapabilities.includes('bookmarks.read'))
      section.append(this.bookmarkActionButton('bookmark-revoke', '撤销书签权限', this.bookmarkBusy))
    return section
  }

  private renderUpdateSection(record: InstalledModuleRecord) {
    const staleDigest = this.staleUpdateDigests.get(record.manifest.id) || null
    const update = presentModuleUpdate(record, staleDigest)
    const busy = this.busyModuleIds.has(record.manifest.id)
    const section = element('section', 'module-update-panel')
    section.dataset.testid = 'module-update'

    const heading = element('div', 'module-update-heading')
    heading.append(element('h3', 'module-update-title', '更新'))
    const checkButton = element('button', 'secondary-button module-update-check', update ? '重新检查' : '检查更新')
    checkButton.type = 'button'
    checkButton.dataset.testid = 'module-update-check'
    checkButton.dataset.action = 'update-check'
    checkButton.dataset.moduleId = record.manifest.id
    checkButton.disabled = busy
    heading.append(checkButton)
    section.append(heading)

    const message = this.updateMessages.get(record.manifest.id)
    if (message) {
      const status = element('p', 'module-update-message', message.message)
      status.dataset.state = message.error ? 'error' : 'ready'
      status.dataset.testid = 'module-update-message'
      section.append(status)
    }

    if (!update) {
      section.append(element('p', 'module-update-empty', '尚未检查远程候选。检查不会自动安装更新。'))
      return section
    }

    const summary = element('div', 'module-update-summary')
    const badge = element('span', `module-update-state is-${update.state}`, update.statusLabel)
    badge.dataset.testid = 'module-update-state'
    badge.dataset.state = update.state
    const version = element(
      'strong',
      'module-update-version',
      `${update.currentVersion} → ${update.candidateVersion}`,
    )
    const checkedAt = element('time', 'module-update-checked', formatModuleUpdateCheckedAt(update.checkedAt))
    checkedAt.dateTime = update.checkedAt
    summary.append(badge, version, checkedAt)
    section.append(summary)

    if (update.state === 'rejected') {
      const diagnostics = element('div', 'module-update-diagnostics')
      diagnostics.append(element('h4', 'module-update-change-label', '不可变边界变更'))
      const list = element('ul', 'module-update-change-list')
      for (const reason of update.rejectionReasons)
        list.append(element('li', '', reason))
      diagnostics.append(list)
      section.append(diagnostics)
      return section
    }

    if (update.copyChanges.length) {
      const copy = element('div', 'module-update-copy')
      copy.append(element('h4', 'module-update-change-label', '文案变化'))
      for (const change of update.copyChanges) {
        const row = element('div', 'module-update-copy-row')
        row.append(
          element('span', 'module-update-copy-label', change.label),
          element('del', 'module-update-copy-before', change.previous),
          element('span', 'module-update-copy-arrow', '→'),
          element('ins', 'module-update-copy-after', change.next),
        )
        copy.append(row)
      }
      section.append(copy)
    }

    const changes = element('div', 'module-update-changes')
    appendUpdateChangeList(changes, '新增适用页面', update.addedMatches)
    appendUpdateChangeList(changes, '移除适用页面', update.removedMatches)
    appendUpdateChangeList(changes, '新增上下文', update.addedContexts)
    appendUpdateChangeList(changes, '移除上下文', update.removedContexts)
    for (const fields of update.contextFieldChanges) {
      appendUpdateChangeList(
        changes,
        `${fields.contextLabel} · 新增字段`,
        fields.added,
      )
      appendUpdateChangeList(
        changes,
        `${fields.contextLabel} · 移除字段`,
        fields.removed,
      )
    }
    appendUpdateChangeList(changes, '新增浏览器能力', update.addedCapabilities)
    appendUpdateChangeList(changes, '移除浏览器能力', update.removedCapabilities)
    appendUpdateChangeList(changes, '激活方式', update.activationChange ? [update.activationChange] : [])
    if (changes.childElementCount)
      section.append(changes)

    if (update.outcome === 'approval-required') {
      const approval = element('div', 'module-update-approval')
      approval.append(element(
        'p',
        'module-update-approval-note',
        update.state === 'approved'
          ? '审批已保存。应用仍需单独确认，且会再次获取并校验 manifest。'
          : '新增适用页面、上下文和激活方式按候选整体审批；只勾选需要新增授权的字段与能力。',
      ))
      if (update.contextFieldChoices.length || update.capabilityChoices.length) {
        const choices = element('div', 'module-update-choices')
        for (const choice of update.contextFieldChoices) {
          const label = element('label', 'grant-option')
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'
          checkbox.checked = choice.selected
          checkbox.disabled = busy || update.state === 'approved' || update.requiresFreshCheck
          checkbox.dataset.updateContextId = choice.contextId
          checkbox.dataset.updateContextField = choice.field
          label.append(checkbox, document.createTextNode(`${choice.contextLabel}：${choice.field}`))
          choices.append(label)
        }
        for (const choice of update.capabilityChoices) {
          const label = element('label', 'grant-option')
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'
          checkbox.checked = choice.selected
          checkbox.disabled = busy || update.state === 'approved' || update.requiresFreshCheck
          checkbox.dataset.updateCapability = choice.capabilityId
          label.append(checkbox, document.createTextNode(choice.label))
          choices.append(label)
        }
        approval.append(choices)
      }
      section.append(approval)
    }

    if (update.requiresFreshCheck) {
      section.append(element(
        'p',
        'module-update-stale-note',
        '远程内容与已检查候选不一致。请重新检查，旧审批不能继续使用。',
      ))
    }

    const actions = element('div', 'module-update-actions')
    if (update.canApprove) {
      const approveButton = element('button', 'secondary-button', '保存审批')
      approveButton.type = 'button'
      approveButton.dataset.testid = 'module-update-approve'
      approveButton.dataset.action = 'update-approve'
      approveButton.dataset.moduleId = record.manifest.id
      approveButton.disabled = busy
      actions.append(approveButton)
    }
    if (update.canApply) {
      const applyButton = element('button', 'primary-button', '应用更新')
      applyButton.type = 'button'
      applyButton.dataset.testid = 'module-update-apply'
      applyButton.dataset.action = 'update-apply'
      applyButton.dataset.moduleId = record.manifest.id
      applyButton.disabled = busy
      actions.append(applyButton)
    }
    if (actions.childElementCount)
      section.append(actions)
    return section
  }

  private renderToggle(record: InstalledModuleRecord) {
    const button = element('button', 'module-toggle')
    button.type = 'button'
    button.dataset.testid = 'module-toggle'
    button.dataset.action = 'toggle'
    button.dataset.moduleId = record.manifest.id
    button.setAttribute('role', 'switch')
    button.setAttribute('aria-checked', String(record.enabled))
    button.setAttribute('aria-label', `${record.enabled ? '停用' : '启用'} ${record.manifest.name}`)
    button.disabled = this.busyModuleIds.has(record.manifest.id)
    button.append(
      element('span', 'module-toggle-track'),
      element('span', 'module-toggle-copy', record.enabled ? '启用' : '停用'),
    )
    return button
  }

  private readonly handleListClick = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element))
      return
    const button = target.closest<HTMLButtonElement>('button[data-action][data-module-id]')
    if (!button || button.disabled)
      return
    const record = this.records.find(candidate => candidate.manifest.id === button.dataset.moduleId)
    if (!record)
      return
    if (button.dataset.action === 'toggle') {
      void this.setEnabled(record, !record.enabled)
    }
    else if (button.dataset.action === 'remove' && record.source === 'user') {
      this.openRemovalConfirmation(record)
    }
    else if (button.dataset.action === 'update-check') {
      void this.checkUpdate(record)
    }
    else if (button.dataset.action === 'update-approve') {
      void this.approveUpdate(record, this.collectUpdateApproval(button.closest('.module-update-panel')))
    }
    else if (button.dataset.action === 'update-apply') {
      void this.applyUpdate(record)
    }
    else if (button.dataset.action === 'browser-journal-start') {
      void this.startBrowserJournal()
    }
    else if (button.dataset.action === 'browser-journal-stop') {
      void this.stopBrowserJournal()
    }
    else if (button.dataset.action === 'browser-journal-save') {
      void this.saveBrowserJournal()
    }
    else if (button.dataset.action === 'browser-journal-select-saved') {
      this.selectSavedBrowserJournal(button.dataset.savedSessionId)
    }
    else if (button.dataset.action === 'browser-journal-delete-saved') {
      void this.deleteSavedBrowserJournal(button.dataset.savedSessionId)
    }
    else if (button.dataset.action === 'browser-journal-clear-saved') {
      void this.clearSavedBrowserJournal(button.closest('.browser-journal-archive'))
    }
    else if (button.dataset.action === 'bookmark-authorize') {
      void this.authorizeBookmarkDoctor()
    }
    else if (button.dataset.action === 'bookmark-prepare') {
      void this.prepareBookmarkScan()
    }
    else if (button.dataset.action === 'bookmark-start') {
      void this.startBookmarkScan()
    }
    else if (button.dataset.action === 'bookmark-stop') {
      void this.stopBookmarkScan()
    }
    else if (button.dataset.action === 'bookmark-authorize-repairs') {
      void this.authorizeBookmarkRepairs()
    }
    else if (button.dataset.action === 'bookmark-result-filter') {
      this.setBookmarkResultFilter(button.dataset.filter)
    }
    else if (button.dataset.action === 'bookmark-result-repair') {
      this.openBookmarkRepairDraft(button.dataset.entryId, button.dataset.operation)
    }
    else if (button.dataset.action === 'bookmark-repair-cancel') {
      this.cancelBookmarkRepairDraft()
    }
    else if (button.dataset.action === 'bookmark-repair-prepare') {
      void this.prepareBookmarkRepair(button.closest('.bookmark-repair-panel'))
    }
    else if (button.dataset.action === 'bookmark-repair-confirm') {
      void this.confirmBookmarkRepair(button.closest('.bookmark-repair-panel'))
    }
    else if (button.dataset.action === 'bookmark-unignore') {
      void this.unignoreBookmark(button.dataset.bookmarkId)
    }
    else if (button.dataset.action === 'bookmark-local-clear') {
      void this.clearBookmarkLocalData(button.closest('.bookmark-doctor-local-state'))
    }
    else if (button.dataset.action === 'bookmark-restore-prepare') {
      void this.prepareBookmarkRestore(button.dataset.backupToken)
    }
    else if (button.dataset.action === 'bookmark-restore-confirm') {
      void this.confirmBookmarkRestore()
    }
    else if (button.dataset.action === 'bookmark-revoke') {
      void this.revokeBookmarkDoctorAccess()
    }
    else if (button.dataset.action === 'clash-prepare') {
      void this.prepareClashConnection(button.closest('.clash-control-panel'))
    }
    else if (button.dataset.action === 'clash-connect') {
      void this.connectClashController()
    }
    else if (button.dataset.action === 'clash-refresh') {
      void this.refreshClashSnapshot()
    }
    else if (button.dataset.action === 'clash-switch-prepare') {
      void this.prepareClashProxySwitch(button.closest('.clash-proxy-group'))
    }
    else if (button.dataset.action === 'clash-switch-confirm') {
      void this.confirmClashProxySwitch()
    }
    else if (button.dataset.action === 'clash-switch-cancel') {
      this.cancelClashProxySwitch()
    }
    else if (button.dataset.action === 'clash-disconnect') {
      void this.disconnectClashController()
    }
    else if (button.dataset.action === 'page-toolbox-prepare-site') {
      void this.preparePageToolboxSite()
    }
    else if (button.dataset.action === 'page-toolbox-confirm-site') {
      void this.confirmPageToolboxSite()
    }
    else if (button.dataset.action === 'page-toolbox-cancel-site') {
      this.cancelPageToolboxSitePreparation()
    }
    else if (button.dataset.action === 'page-toolbox-save') {
      void this.savePageToolboxSettings()
    }
    else if (button.dataset.action === 'page-toolbox-discard') {
      this.discardPageToolboxDraft()
    }
    else if (button.dataset.action === 'page-toolbox-refresh') {
      void this.refreshPageToolboxControl(true)
    }
    else if (button.dataset.action === 'page-toolbox-revoke-site') {
      void this.revokePageToolboxSite()
    }
    else if (button.dataset.action === 'send-openlist-prepare') {
      void this.prepareSendToOpenList(button.closest('.send-openlist-panel'))
    }
    else if (button.dataset.action === 'send-openlist-connect') {
      void this.connectSendToOpenList()
    }
    else if (button.dataset.action === 'send-openlist-disconnect') {
      void this.disconnectSendToOpenList()
    }
    else if (button.dataset.action === 'send-openlist-delete-profile') {
      void this.deleteSendToOpenListProfile()
    }
    else if (button.dataset.action === 'send-openlist-parse') {
      this.parseSendToOpenListCandidates(button.closest('.send-openlist-panel'))
    }
    else if (button.dataset.action === 'send-openlist-tools') {
      void this.discoverSendToOpenListTools(button.closest('.send-openlist-panel'))
    }
    else if (button.dataset.action === 'send-openlist-submit') {
      void this.submitSendToOpenList(button.closest('.send-openlist-panel'))
    }
    else if (button.dataset.action === 'send-openlist-list-undone') {
      void this.listSendToOpenListTasks('undone')
    }
    else if (button.dataset.action === 'send-openlist-list-done') {
      void this.listSendToOpenListTasks('done')
    }
    else if (button.dataset.action === 'send-openlist-prepare-cancel') {
      void this.prepareSendToOpenListCancel(button.dataset.taskId)
    }
    else if (button.dataset.action === 'send-openlist-confirm-cancel') {
      void this.confirmSendToOpenListCancel()
    }
    else if (button.dataset.action === 'send-openlist-abandon-cancel') {
      this.sendCancelPlan = null
      this.render()
    }
  }

  private readonly handleListChange = (event: Event) => {
    const control = event.target
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement))
      return
    if (control.dataset.sendCandidateId) {
      if (control instanceof HTMLInputElement && control.checked)
        this.sendSelected.add(control.dataset.sendCandidateId)
      else
        this.sendSelected.delete(control.dataset.sendCandidateId)
      this.render()
      return
    }
    if (control.dataset.sendTool === 'true') {
      this.sendSelectedTool = control.value
      return
    }
    const toolId = control.dataset.toolId
    if (!toolId || !control.closest(`[data-module-id="${PAGE_TOOLBOX_MODULE_ID}"]`))
      return
    const state = this.pageToolboxControlState
    const draft = state.draft
    if (state.phase !== 'ready' || !draft || !Object.hasOwn(draft.toolSettings, toolId))
      return
    const currentSettings = draft.toolSettings[toolId]
    if (!currentSettings || typeof currentSettings !== 'object' || Array.isArray(currentSettings))
      return
    const enabledControl = control.dataset.pageToolboxEnabled === 'true'
    const enabled = enabledControl
      ? control instanceof HTMLInputElement && control.checked
      : draft.enabledToolIds.includes(toolId)
    const settings = structuredClone(currentSettings) as Record<string, import('~/modules/builtin/page-toolbox').PageToolJsonValue>
    const settingKey = control.dataset.pageToolboxSetting
    if (!enabledControl) {
      if (!settingKey || !Object.hasOwn(settings, settingKey))
        return
      settings[settingKey] = control instanceof HTMLInputElement && control.type === 'checkbox'
        ? control.checked
        : control.value
    }
    this.pageToolboxControlState = reducePageToolboxControlState(state, {
      type: 'edit-tool',
      toolId: toolId as import('~/modules/builtin/page-toolbox').PageToolId,
      enabled,
      settings,
    })
    this.pageToolboxMessage = null
    this.render()
  }

  private sendToOpenListError(reason: string) {
    const messages: Record<string, string> = {
      'module-unavailable': 'Send to OpenList 内置模块不可用',
      'module-disabled': 'Send to OpenList 已停用',
      'invalid-profile': '服务地址必须是没有路径、查询或凭据的 HTTP(S) exact origin',
      'permission-missing': '服务 exact-origin 权限缺失或已撤销',
      'permission-check-failed': '无法核验服务 origin 权限',
      'permission-denied': '未授权审查中的精确服务 origin',
      'token-missing': '请输入 Token，或重新保存此 Profile 的 Token',
      'authentication-failed': 'Token 无效或账号没有所需权限',
      'http-error': '服务返回 HTTP 错误',
      'upstream-rejected': '服务拒绝了本次操作',
      'network-failed': '无法连接服务；读取操作可以手动重试',
      'outcome-unknown': '写请求结果未知；不会自动重试，请刷新服务端任务确认',
      'protocol-incompatible': '服务响应与已审计 OpenList/AList 契约不兼容',
      'response-too-large': '服务响应超过本地安全上限',
      'local-use-blocked': '候选指向本地、私网或保留地址，MVP 拒绝提交',
      'operation-not-allowed': '操作未绑定当前工具、任务快照或审查计划',
      'stale-generation': '审查计划或任务快照已过期，请重新刷新',
      'lifecycle-invalidated': '连接生命周期已变化，请重新连接或刷新',
      'active-tab-unavailable': '无法读取当前活动的普通标签页',
      'page-scan-failed': '当前页临时扫描失败；未改变已有候选',
      'discovery-empty': '没有发现受支持的 http、https、magnet 或 ed2k 地址',
      'quota-exceeded': '浏览器候选超过发现数量或总字节上限',
      'transport-error': '无法连接受信后台',
      'invalid-response': '受信后台返回无效结果',
    }
    return messages[reason] || 'Send to OpenList 操作失败'
  }

  private sendToOpenListClientFailure(error: unknown) {
    return error instanceof SendToOpenListClientError ? error.code : 'transport-error'
  }

  private setSendToOpenListMessage(message: string, error = false) {
    this.sendMessage = { message, error }
  }

  private async refreshSendToOpenListStatus(render = false) {
    if (!this.sendToOpenList)
      return
    try {
      const result = readSendActionResult<SendToOpenListConnectionSnapshotV1>(await this.sendToOpenList.status())
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      this.sendConnection = structuredClone(result.value)
      if (result.value.profile) {
        this.sendProfileOrigin = result.value.profile.controllerOrigin
        this.sendProfileLabel = result.value.profile.label
      }
      if (result.value.phase !== 'preparing')
        this.sendPreparation = null
      if (result.value.phase !== 'connected') {
        this.sendTools = []
        this.sendSelectedTool = ''
        this.sendTaskSnapshots = {}
        this.sendCancelPlan = null
      }
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      if (render)
        this.render()
    }
  }

  private async prepareSendToOpenList(panel: Element | null) {
    if (!this.sendToOpenList)
      return
    this.sendProfileLabel = panel?.querySelector<HTMLInputElement>('[data-testid="send-openlist-profile-label"]')?.value.trim() || ''
    this.sendProfileOrigin = panel?.querySelector<HTMLInputElement>('[data-testid="send-openlist-origin"]')?.value.trim() || ''
    this.sendBusy = true
    this.setSendToOpenListMessage('正在后台规范化 exact origin；尚未请求权限或联网。')
    this.render()
    try {
      const result = readSendActionResult<SendToOpenListConnectionPreparationV1>(await this.sendToOpenList.prepare({
        schemaVersion: 1,
        id: 'primary',
        label: this.sendProfileLabel,
        controllerOrigin: this.sendProfileOrigin,
      }))
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      this.sendPreparation = result.value
      this.sendConnection = {
        phase: 'preparing',
        generation: result.value.generation,
        profile: result.value.profile,
        hasStoredToken: false,
        preparationExpiresAt: result.value.expiresAt,
      }
      this.setSendToOpenListMessage('连接审查已建立；下一步仅请求显示的 exact origin。')
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      this.sendBusy = false
      this.render()
    }
  }

  private async connectSendToOpenList() {
    if (!this.sendToOpenList || !this.sendPreparation)
      return
    const preparation = this.sendPreparation
    // A modal password input keeps the transient token out of the document tree after confirmation.
    // eslint-disable-next-line no-alert
    let token = window.prompt('输入 OpenList/AList Token（仅保存到受信后台专用本地记录）', '')
    if (token === null)
      return
    this.sendBusy = true
    this.setSendToOpenListMessage('正在申请 exact-origin 权限并验证固定 /api/me…')
    this.render()
    try {
      const pending = this.sendToOpenList.connect(preparation, token)
      token = ''
      const result = readSendActionResult<SendToOpenListConnectionSnapshotV1>(await pending)
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        await this.refreshSendToOpenListStatus()
        return
      }
      this.sendConnection = result.value
      this.sendPreparation = null
      this.setSendToOpenListMessage('连接成功；工具、提交和任务读取都只在用户操作时执行。')
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      token = ''
      this.sendBusy = false
      this.render()
    }
  }

  private async disconnectSendToOpenList() {
    if (!this.sendToOpenList)
      return
    this.sendBusy = true
    this.render()
    try {
      const result = readSendActionResult(await this.sendToOpenList.disconnect())
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      await this.refreshSendToOpenListStatus()
      this.setSendToOpenListMessage('已断开并清除 Token；不会自动重连。')
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      this.sendBusy = false
      this.render()
    }
  }

  private async deleteSendToOpenListProfile() {
    if (!this.sendToOpenList)
      return
    this.sendBusy = true
    this.render()
    try {
      const result = readSendActionResult(await this.sendToOpenList.deleteProfile())
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      this.sendProfileOrigin = ''
      this.sendProfileLabel = 'OpenList/AList'
      await this.refreshSendToOpenListStatus()
      this.setSendToOpenListMessage('Profile 与专用 Token 已删除。')
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      this.sendBusy = false
      this.render()
    }
  }

  private parseSendToOpenListCandidates(panel: Element | null) {
    this.sendManualText = panel?.querySelector<HTMLTextAreaElement>('[data-testid="send-openlist-manual-input"]')?.value || ''
    const parsed = parseManualResourceCandidates(this.sendManualText)
    if (parsed.error) {
      this.setSendToOpenListMessage(parsed.error, true)
    }
    else {
      const browserCandidates = this.sendCandidates.filter(candidate => candidate.source !== 'manual')
      const merged = mergePresentedResourceCandidates(browserCandidates, parsed.candidates)
      if (!merged.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError('quota-exceeded'), true)
        this.render()
        return
      }
      this.sendCandidates = merged.value
      this.sendSelected.clear()
      for (const candidate of this.sendCandidates) {
        if (this.sendSelected.size >= 50)
          break
        if (!presentResourceCandidate(candidate).blocked)
          this.sendSelected.add(candidate.id)
      }
      this.setSendToOpenListMessage(
        `已规范化并去重 ${this.sendCandidates.length} 项；仅展示，尚未提交。${this.sendCandidates.length > 50 ? ' 默认只选前 50 个可提交项。' : ''}`,
      )
    }
    this.sendSubmission = null
    this.render()
  }

  private async discoverSendToOpenListTools(panel: Element | null) {
    if (!this.sendToOpenList)
      return
    this.sendDestinationPath = panel?.querySelector<HTMLInputElement>('[data-testid="send-openlist-path"]')?.value.trim() || ''
    this.sendBusy = true
    this.render()
    try {
      const result = readSendActionResult<readonly string[]>(await this.sendToOpenList.discoverTools(this.sendDestinationPath))
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      this.sendTools = result.value
      this.sendSelectedTool = result.value[0] || ''
      this.setSendToOpenListMessage(`服务端返回 ${result.value.length} 个可用工具；没有硬编码工具名称。`)
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      this.sendBusy = false
      this.render()
    }
  }

  private async submitSendToOpenList(panel: Element | null) {
    if (!this.sendToOpenList)
      return
    this.sendDestinationPath = panel?.querySelector<HTMLInputElement>('[data-testid="send-openlist-path"]')?.value.trim() || this.sendDestinationPath
    this.sendSelectedTool = panel?.querySelector<HTMLSelectElement>('[data-testid="send-openlist-tool"]')?.value || this.sendSelectedTool
    const candidates = this.sendCandidates.filter(candidate => this.sendSelected.has(candidate.id)).slice(0, 50)
    this.sendBusy = true
    this.setSendToOpenListMessage(`正在逐条提交 ${candidates.length} 项，后台并发上限为 2…`)
    this.render()
    try {
      const result = readSendActionResult<SendToOpenListSubmissionStateV1>(await this.sendToOpenList.submit(
        candidates,
        this.sendDestinationPath,
        this.sendSelectedTool,
      ))
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      this.sendSubmission = result.value
      this.setSendToOpenListMessage('逐条提交已结束；结果未知项不会自动重试。')
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      this.sendBusy = false
      this.render()
    }
  }

  private async listSendToOpenListTasks(list: 'undone' | 'done') {
    if (!this.sendToOpenList)
      return
    this.sendBusy = true
    this.sendCancelPlan = null
    this.render()
    try {
      const result = readSendActionResult<SendToOpenListTaskSnapshotV1>(await this.sendToOpenList.listTasks(list))
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      this.sendTaskSnapshots[list] = result.value
      this.setSendToOpenListMessage(`${list === 'undone' ? '未完成' : '已完成'}任务已手动刷新；不会自动轮询。`)
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      this.sendBusy = false
      this.render()
    }
  }

  private async prepareSendToOpenListCancel(taskId: string | undefined) {
    if (!this.sendToOpenList || !taskId)
      return
    this.sendBusy = true
    this.render()
    try {
      const result = readSendActionResult<SendToOpenListCancelReviewPlanV1>(await this.sendToOpenList.prepareCancel(taskId))
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      this.sendCancelPlan = result.value
      this.setSendToOpenListMessage('取消计划已绑定最新未完成任务快照；尚未执行。')
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      this.sendBusy = false
      this.render()
    }
  }

  private async confirmSendToOpenListCancel() {
    if (!this.sendToOpenList || !this.sendCancelPlan)
      return
    const plan = this.sendCancelPlan
    this.sendCancelPlan = null
    this.sendBusy = true
    this.render()
    try {
      const result = readSendActionResult<{ taskId: string }>(await this.sendToOpenList.confirmCancel(plan.token))
      if (!result || !result.ok) {
        this.setSendToOpenListMessage(this.sendToOpenListError(result?.reason || 'invalid-response'), true)
        return
      }
      this.sendTaskSnapshots.undone = undefined
      this.setSendToOpenListMessage(`任务 ${result.value.taskId} 已请求取消；请手动刷新确认服务端状态。`)
    }
    catch (error) {
      this.setSendToOpenListMessage(this.sendToOpenListError(this.sendToOpenListClientFailure(error)), true)
    }
    finally {
      this.sendBusy = false
      this.render()
    }
  }

  private pageToolboxErrorMessage(reason: string) {
    const messages: Record<string, string> = {
      'module-unavailable': 'Page Toolbox 内置模块不可用',
      'module-disabled': 'Page Toolbox 已停用；请先启用模块',
      'active-tab-unavailable': '无法读取当前活动标签页',
      'invalid-origin': '当前页面不是可授权的 HTTP(S) 顶层页面',
      'permission-check-failed': '无法核验当前站点权限',
      'permission-missing': '当前站点的 exact-origin 权限缺失或已撤销',
      'invalid-preparation': '站点授权审查已失效，请重新开始',
      'settings-read-failed': '无法读取 Page Toolbox 本地设置',
      'settings-invalid': 'Page Toolbox 本地设置无效',
      'settings-write-failed': '无法保存当前站点设置，原 revision 保持不变',
      'tool-settings-invalid': '设置不符合固定工具 schema',
      'revision-conflict': '设置已在其他位置变化，请重新读取',
      'revision-exhausted': '当前站点 revision 已耗尽，拒绝继续写入',
      'permission-remove-failed': '设置已撤销，但浏览器未能安全回收共享 origin 权限',
      'permission-denied': '未授权审查中的精确站点 origin',
      'transport-error': '无法连接 Page Toolbox 后台',
      'invalid-response': 'Page Toolbox 后台返回无效结果',
    }
    return messages[reason] || 'Page Toolbox 操作失败'
  }

  private pageToolboxClientFailure(error: unknown) {
    return error instanceof PageToolboxClientError ? error.code : 'transport-error'
  }

  private nextPageToolboxRequestId(kind: 'load' | 'save') {
    this.pageToolboxRequestSequence += 1
    return `page-toolbox:${kind}:${this.pageToolboxRequestSequence}`
  }

  private reducePageToolboxControl(event: Parameters<typeof reducePageToolboxControlState>[1]) {
    const next = reducePageToolboxControlState(this.pageToolboxControlState, event)
    if (next === this.pageToolboxControlState)
      return false
    this.pageToolboxControlState = next
    return true
  }

  private async refreshPageToolboxControl(render = false) {
    if (!this.pageToolbox)
      return false
    const requestId = this.nextPageToolboxRequestId('load')
    this.pageToolboxPreparation = null
    this.reducePageToolboxControl({
      type: 'load-started',
      requestId,
    })
    this.pageToolboxMessage = null
    let succeeded = false
    if (render)
      this.render()
    try {
      const result = await this.pageToolbox.status()
      if (result.operation !== 'control-status' || !result.ok) {
        const reason = result.ok ? 'invalid-response' : result.reason
        const accepted = this.reducePageToolboxControl({
          type: 'load-failed',
          requestId,
          errorCode: 'load-failed',
        })
        if (accepted)
          this.pageToolboxMessage = { message: this.pageToolboxErrorMessage(reason), error: true }
      }
      else {
        succeeded = this.reducePageToolboxControl({
          type: 'load-succeeded',
          requestId,
          snapshot: result.snapshot,
        })
      }
    }
    catch (error) {
      const accepted = this.reducePageToolboxControl({
        type: 'load-failed',
        requestId,
        errorCode: 'load-failed',
      })
      if (accepted) {
        this.pageToolboxMessage = {
          message: this.pageToolboxErrorMessage(this.pageToolboxClientFailure(error)),
          error: true,
        }
      }
    }
    if (render)
      this.render()
    return succeeded
  }

  private async preparePageToolboxSite() {
    if (!this.pageToolbox)
      return
    this.pageToolboxMessage = { message: '正在由后台派生并审查当前 exact origin…', error: false }
    this.render()
    try {
      const result = await this.pageToolbox.prepare()
      if (result.operation !== 'prepare' || !result.ok) {
        this.pageToolboxMessage = {
          message: this.pageToolboxErrorMessage(result.ok ? 'invalid-response' : result.reason),
          error: true,
        }
        return
      }
      this.pageToolboxPreparation = result.preparation
      this.pageToolboxMessage = { message: '审查已建立；尚未请求站点权限。', error: false }
    }
    catch (error) {
      this.pageToolboxMessage = {
        message: this.pageToolboxErrorMessage(this.pageToolboxClientFailure(error)),
        error: true,
      }
    }
    finally {
      this.render()
    }
  }

  private async confirmPageToolboxSite() {
    if (!this.pageToolbox || !this.pageToolboxPreparation)
      return
    const preparation = this.pageToolboxPreparation
    this.pageToolboxPreparation = null
    this.pageToolboxMessage = { message: `正在请求 ${preparation.exactOrigin} 的精确权限…`, error: false }
    this.render()
    try {
      const result = await this.pageToolbox.confirm(preparation)
      if (result.operation !== 'confirm' || !result.ok) {
        this.pageToolboxMessage = {
          message: this.pageToolboxErrorMessage(result.ok ? 'invalid-response' : result.reason),
          error: true,
        }
        return
      }
      if (await this.refreshPageToolboxControl())
        this.pageToolboxMessage = { message: '当前站点已授权；三个工具仍默认关闭。', error: false }
    }
    catch (error) {
      this.pageToolboxMessage = {
        message: this.pageToolboxErrorMessage(this.pageToolboxClientFailure(error)),
        error: true,
      }
    }
    finally {
      this.render()
    }
  }

  private cancelPageToolboxSitePreparation() {
    this.pageToolboxPreparation = null
    this.pageToolboxMessage = { message: '已取消站点授权审查。', error: false }
    this.render()
  }

  private discardPageToolboxDraft() {
    this.pageToolboxControlState = reducePageToolboxControlState(this.pageToolboxControlState, {
      type: 'discard-draft',
    })
    this.pageToolboxMessage = { message: '未保存的当前站点草稿已放弃。', error: false }
    this.render()
  }

  private async savePageToolboxSettings() {
    if (!this.pageToolbox)
      return
    const state = this.pageToolboxControlState
    if (state.phase !== 'ready' || state.snapshot?.access !== 'ready' || !state.draft || !state.dirty)
      return
    const requestId = this.nextPageToolboxRequestId('save')
    const expectedRevision = state.snapshot.revision
    const draft = state.draft
    this.reducePageToolboxControl({
      type: 'save-started',
      requestId,
    })
    this.pageToolboxMessage = null
    this.render()
    try {
      const result = await this.pageToolbox.replace(expectedRevision, draft)
      if (result.operation !== 'replace-site-settings') {
        const accepted = this.reducePageToolboxControl({
          type: 'save-failed',
          requestId,
          errorCode: 'save-failed',
        })
        if (accepted)
          this.pageToolboxMessage = { message: this.pageToolboxErrorMessage('invalid-response'), error: true }
      }
      else if (result.ok) {
        const accepted = this.reducePageToolboxControl({
          type: 'save-succeeded',
          requestId,
          snapshot: result.snapshot,
        })
        if (accepted)
          this.pageToolboxMessage = { message: '当前站点设置已按 revision 原子保存并同步。', error: false }
      }
      else if (result.reason === 'revision-conflict') {
        const accepted = this.reducePageToolboxControl({
          type: 'save-conflicted',
          requestId,
          revision: result.snapshot.revision,
        })
        if (accepted)
          this.pageToolboxMessage = { message: this.pageToolboxErrorMessage(result.reason), error: true }
      }
      else {
        const accepted = this.reducePageToolboxControl({
          type: 'save-failed',
          requestId,
          errorCode: 'save-failed',
        })
        if (accepted)
          this.pageToolboxMessage = { message: this.pageToolboxErrorMessage(result.reason), error: true }
      }
    }
    catch (error) {
      const accepted = this.reducePageToolboxControl({
        type: 'save-failed',
        requestId,
        errorCode: 'save-failed',
      })
      if (accepted) {
        this.pageToolboxMessage = {
          message: this.pageToolboxErrorMessage(this.pageToolboxClientFailure(error)),
          error: true,
        }
      }
    }
    finally {
      this.render()
    }
  }

  private async revokePageToolboxSite() {
    if (!this.pageToolbox)
      return
    this.pageToolboxPreparation = null
    this.pageToolboxMessage = { message: '正在撤销当前站点设置并协调回收 origin 权限…', error: false }
    this.render()
    try {
      const result = await this.pageToolbox.revoke()
      if (result.operation !== 'revoke' || !result.ok) {
        this.pageToolboxMessage = {
          message: this.pageToolboxErrorMessage(result.ok ? 'invalid-response' : result.reason),
          error: true,
        }
        return
      }
      if (await this.refreshPageToolboxControl()) {
        this.pageToolboxMessage = {
          message: result.releasedOrigin
            ? '当前站点设置已删除，独占 origin 权限已回收。'
            : '当前站点设置已删除；共享或预先存在的 origin 权限已保留。',
          error: false,
        }
      }
    }
    catch (error) {
      this.pageToolboxMessage = {
        message: this.pageToolboxErrorMessage(this.pageToolboxClientFailure(error)),
        error: true,
      }
    }
    finally {
      this.render()
    }
  }

  private clashErrorMessage(reason: string) {
    const messages: Record<string, string> = {
      'module-unavailable': 'Clash Control 内置模块不可用',
      'module-disabled': 'Clash Control 已停用',
      'invalid-controller-url': '请输入不含路径、凭据、查询或片段的完整 controller origin',
      'controller-not-loopback': '只允许明确的 localhost 或 loopback controller',
      'connection-active': '已有连接或连接请求正在运行，请先断开',
      'invalid-preparation': '连接审查已失效，请重新检查地址',
      'permission-denied': '未授权该 controller 的精确 origin',
      'permission-missing': 'controller origin 权限缺失或已撤销',
      'permission-check-failed': '无法核验 controller origin 权限',
      'connection-required': '请先手动连接 controller',
      'network-failure': '无法连接本地 controller',
      'authentication-failed': 'Controller 拒绝了认证 secret',
      'protocol-incompatible': 'Controller 响应不兼容 Clash 只读协议',
      'response-too-large': 'Controller 响应超过 64 KiB 安全限制',
      'response-malformed': 'Controller 返回了畸形或缺少必要字段的响应',
      'operation-active': '已有一次刷新或节点切换正在运行',
      'switch-snapshot-required': '请先手动刷新并取得当前代理组快照',
      'switch-target-invalid': '所选代理组或节点不属于当前快照',
      'switch-no-change': '目标节点与当前选择相同',
      'switch-plan-not-found': '节点切换审查已失效或后台已重启，请重新审查',
      'switch-plan-expired': '节点切换审查已过期，请重新审查',
      'switch-plan-stale': '代理组或当前节点已经变化，请手动刷新后重新审查',
      'switch-outcome-unknown': '未收到可信的节点切换结果；请手动刷新后重新审查，不会自动重试',
      'lifecycle-cancelled': '连接因停用、断开或权限变化而取消',
      'capability-sync-failed': '无法更新 Clash Control 的专用授权',
      'permission-remove-failed': '无法安全回收 controller origin 权限',
      'profile-read-failed': '无法读取已保存的 controller origin',
      'profile-write-failed': '无法保存规范化 controller origin',
      'transport-error': '无法连接 Clash Control 后台',
      'invalid-response': 'Clash Control 后台返回无效结果',
    }
    return messages[reason] || 'Clash Control 操作失败'
  }

  private setClashMessage(message: string, error = false) {
    this.clashMessage = { message, error }
  }

  private beginClashUiOperation() {
    this.clashOperationGeneration += 1
    return this.clashOperationGeneration
  }

  private isCurrentClashUiOperation(generation: number) {
    return generation === this.clashOperationGeneration
  }

  private supersedeClashUiOperation() {
    this.clashOperationGeneration += 1
    this.clashBusy = false
    this.clashSwitchPlan = null
  }

  private clashClientFailure(error: unknown) {
    return error instanceof ClashControlClientError ? error.code : 'transport-error'
  }

  private async prepareClashConnection(panel: Element | null) {
    if (!this.clashControl)
      return
    const operationGeneration = this.beginClashUiOperation()
    const controllerUrl = panel?.querySelector<HTMLInputElement>('[data-testid="clash-controller-url"]')?.value.trim() || ''
    this.clashControllerUrl = controllerUrl
    this.clashBusy = true
    this.clashPreparation = null
    this.setClashMessage('正在后台规范化 loopback origin…')
    this.render()
    try {
      const result = await this.clashControl.prepare(controllerUrl)
      if (!this.isCurrentClashUiOperation(operationGeneration))
        return
      if (result.operation !== 'prepare' || !result.ok) {
        this.setClashMessage(this.clashErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.clashPreparation = result.preparation
      this.clashControllerUrl = result.preparation.controllerOrigin
      this.setClashMessage('地址已规范化；下一步只授权这个精确 origin。')
    }
    catch (error) {
      if (this.isCurrentClashUiOperation(operationGeneration))
        this.setClashMessage(this.clashErrorMessage(this.clashClientFailure(error)), true)
    }
    finally {
      if (this.isCurrentClashUiOperation(operationGeneration)) {
        this.clashBusy = false
        this.render()
      }
    }
  }

  private async connectClashController() {
    if (!this.clashControl || !this.clashPreparation)
      return
    const preparation = this.clashPreparation
    // Browser modal input keeps the one-shot secret out of the document tree.
    // eslint-disable-next-line no-alert
    let secret = window.prompt('输入 Clash controller secret（不会显示或保存）', '')
    if (secret === null) {
      this.setClashMessage('已取消 secret 输入。')
      this.render()
      return
    }
    const operationGeneration = this.beginClashUiOperation()
    this.clashBusy = true
    this.setClashMessage('正在受信后台读取固定只读端点…')
    this.render()
    try {
      const pending = this.clashControl.connect(preparation, secret)
      secret = ''
      const result = await pending
      if (!this.isCurrentClashUiOperation(operationGeneration))
        return
      if (result.operation !== 'connect' || !result.ok) {
        this.clashPreparation = null
        this.setClashMessage(this.clashErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.clashPreparation = null
      this.clashStatus = result.status
      this.clashReadState = { status: 'empty', snapshot: null, diagnostic: null }
      this.clashSwitchPlan = null
      this.replaceRecord(result.record)
      this.onRecordChanged?.(result.record)
      this.setClashMessage('只读连接成功；secret 未被持久化。')
    }
    catch (error) {
      if (this.isCurrentClashUiOperation(operationGeneration)) {
        this.clashPreparation = null
        this.setClashMessage(this.clashErrorMessage(this.clashClientFailure(error)), true)
      }
    }
    finally {
      secret = ''
      if (this.isCurrentClashUiOperation(operationGeneration)) {
        this.clashBusy = false
        this.render()
      }
    }
  }

  private async disconnectClashController() {
    if (!this.clashControl)
      return
    const operationGeneration = this.beginClashUiOperation()
    this.clashBusy = true
    this.clashSwitchPlan = null
    this.setClashMessage('正在取消连接并回收专用权限…')
    this.render()
    try {
      const result = await this.clashControl.disconnect()
      if (!this.isCurrentClashUiOperation(operationGeneration))
        return
      if (result.operation !== 'disconnect' || !result.ok) {
        this.setClashMessage(this.clashErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.clashPreparation = null
      this.clashStatus = null
      this.clashReadState = { status: 'empty', snapshot: null, diagnostic: null }
      this.replaceRecord(result.record)
      this.onRecordChanged?.(result.record)
      this.setClashMessage(result.releasedOrigin ? '连接已断开，专用 origin 权限已回收。' : '连接已断开；预先存在或共享的 origin 权限已保留。')
    }
    catch (error) {
      if (this.isCurrentClashUiOperation(operationGeneration))
        this.setClashMessage(this.clashErrorMessage(this.clashClientFailure(error)), true)
    }
    finally {
      if (this.isCurrentClashUiOperation(operationGeneration)) {
        this.clashBusy = false
        this.render()
      }
    }
  }

  private async refreshClashSnapshot() {
    if (!this.clashControl)
      return
    const operationGeneration = this.beginClashUiOperation()
    this.clashBusy = true
    this.clashSwitchPlan = null
    this.setClashMessage('正在受信后台手动读取 /version、/configs 与 /proxies…')
    this.render()
    try {
      const result = await this.clashControl.refresh()
      if (!this.isCurrentClashUiOperation(operationGeneration))
        return
      if (result.operation !== 'refresh' || !result.ok) {
        await this.refreshClashStatus(operationGeneration)
        if (!this.isCurrentClashUiOperation(operationGeneration))
          return
        this.setClashMessage(this.clashErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.clashReadState = { status: 'ready', snapshot: result.snapshot, diagnostic: null }
      if (this.clashStatus) {
        this.clashStatus = {
          ...this.clashStatus,
          implementation: result.snapshot.implementation,
          version: result.snapshot.controllerVersion,
          mode: result.snapshot.mode,
        }
      }
      this.setClashMessage('只读快照已刷新；不会自动轮询。')
    }
    catch (error) {
      await this.refreshClashStatus(operationGeneration)
      if (this.isCurrentClashUiOperation(operationGeneration))
        this.setClashMessage(this.clashErrorMessage(this.clashClientFailure(error)), true)
    }
    finally {
      if (this.isCurrentClashUiOperation(operationGeneration)) {
        this.clashBusy = false
        this.render()
      }
    }
  }

  private async prepareClashProxySwitch(card: Element | null) {
    if (!this.clashControl || this.clashReadState.status !== 'ready')
      return
    const select = card?.querySelector<HTMLSelectElement>('[data-testid="clash-switch-target"]')
    const groupName = select?.dataset.groupName || ''
    const targetNode = select?.value || ''
    if (!groupName || !targetNode)
      return
    const operationGeneration = this.beginClashUiOperation()
    this.clashBusy = true
    this.clashSwitchPlan = null
    this.setClashMessage('正在后台建立一次性节点切换审查…')
    this.render()
    try {
      const result = await this.clashControl.prepareProxySwitch(groupName, targetNode)
      if (!this.isCurrentClashUiOperation(operationGeneration))
        return
      if (result.operation !== 'prepare-proxy-switch' || !result.ok) {
        this.setClashMessage(this.clashErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.clashSwitchPlan = result.plan
      const presented = presentClashProxySwitchReview(
        this.clashReadState.snapshot,
        result.plan,
        this.now(),
      )
      this.setClashMessage(
        presented.canConfirm
          ? '审查已建立；节点尚未切换，请单独确认执行。'
          : presented.message,
        !presented.canConfirm,
      )
    }
    catch (error) {
      if (this.isCurrentClashUiOperation(operationGeneration))
        this.setClashMessage(this.clashErrorMessage(this.clashClientFailure(error)), true)
    }
    finally {
      if (this.isCurrentClashUiOperation(operationGeneration)) {
        this.clashBusy = false
        this.render()
      }
    }
  }

  private async confirmClashProxySwitch() {
    if (!this.clashControl || !this.clashSwitchPlan)
      return
    const plan = this.clashSwitchPlan
    const presented = presentClashProxySwitchReview(
      this.clashReadState.status === 'ready' ? this.clashReadState.snapshot : null,
      plan,
      this.now(),
    )
    if (!presented.canConfirm) {
      this.setClashMessage(presented.message, true)
      this.render()
      return
    }
    const operationGeneration = this.beginClashUiOperation()
    this.clashBusy = true
    this.clashSwitchPlan = null
    this.setClashMessage(`正在确认 ${plan.groupName}：${plan.originalNode} → ${plan.targetNode}…`)
    this.render()
    try {
      const result = await this.clashControl.confirmProxySwitch(plan.token)
      if (!this.isCurrentClashUiOperation(operationGeneration))
        return
      if (result.operation !== 'confirm-proxy-switch' || !result.ok) {
        await this.refreshClashStatus(operationGeneration)
        if (!this.isCurrentClashUiOperation(operationGeneration))
          return
        const reason = result.ok ? 'invalid-response' : result.reason
        this.setClashMessage(
          reason === 'network-failure' || reason === 'switch-outcome-unknown'
            ? '未收到节点切换结果，无法确认是否执行；请手动刷新后重新审查，不会自动重试。'
            : this.clashErrorMessage(reason),
          true,
        )
        return
      }
      this.clashReadState = { status: 'empty', snapshot: null, diagnostic: null }
      this.setClashMessage(
        `${result.groupName} 已从 ${result.previousNode} 切换到 ${result.selectedNode}；旧快照已失效，请手动刷新。`,
      )
    }
    catch (error) {
      await this.refreshClashStatus(operationGeneration)
      if (this.isCurrentClashUiOperation(operationGeneration))
        this.setClashMessage(this.clashErrorMessage(this.clashClientFailure(error)), true)
    }
    finally {
      if (this.isCurrentClashUiOperation(operationGeneration)) {
        this.clashBusy = false
        this.render()
      }
    }
  }

  private cancelClashProxySwitch() {
    this.supersedeClashUiOperation()
    this.setClashMessage('已放弃本次节点切换审查；如需操作请重新选择。')
    this.render()
  }

  private async refreshClashStatus(operationGeneration?: number) {
    if (!this.clashControl)
      return
    const generation = operationGeneration ?? this.beginClashUiOperation()
    if (operationGeneration === undefined)
      this.clashBusy = false
    try {
      const result = await this.clashControl.status()
      if (this.isCurrentClashUiOperation(generation) && result.operation === 'status' && result.ok) {
        this.clashStatus = result.status
        this.clashReadState = result.readState
        if (result.readState.status !== 'ready')
          this.clashSwitchPlan = null
        if (result.connection.profile)
          this.clashControllerUrl = result.connection.profile.controllerOrigin
        if (result.connection.phase === 'error') {
          this.setClashMessage(
            this.clashErrorMessage(result.connection.diagnostic.code),
            true,
          )
        }
      }
    }
    catch {}
  }

  private bookmarkErrorMessage(reason: string) {
    const messages: Record<string, string> = {
      'module-unavailable': 'Bookmark Doctor 内置模块不可用',
      'module-disabled': 'Bookmark Doctor 已停用',
      'permission-denied': '未获得所需的浏览器权限',
      'permission-missing': '书签权限已撤销，请重新授权',
      'permission-check-failed': '无法核验浏览器权限',
      'capability-sync-failed': '无法保存 Bookmark Doctor 的本地授权',
      'capability-not-granted': 'Bookmark Doctor 尚未获得书签读取授权',
      'bookmark-read-failed': '无法读取浏览器书签',
      'invalid-tree': '浏览器返回了无效书签树',
      'scan-active': '已有一次扫描正在运行',
      'invalid-preparation': '扫描计划已失效，请重新准备',
      'origin-permission-missing': '精确来源权限未生效，请重新准备',
      'scan-failed': '扫描启动失败，请重新准备',
      'repair-unavailable': '书签修复服务当前不可用',
      'write-capability-not-granted': '尚未单独启用书签修复权限',
      'invalid-repair-request': '修复字段无效或没有实际变化',
      'bookmark-target-not-found': '目标书签或文件夹已不存在',
      'bookmark-target-invalid': '目标不是可修复的 URL 书签或有效文件夹',
      'repair-plan-not-found': '修复计划已失效，请重新审查',
      'repair-plan-expired': '修复计划已过期，请重新审查',
      'repair-plan-stale': '书签在确认前已变化，本次操作已拒绝',
      'invalid-confirmation': '确认强度与修复操作不匹配',
      'repair-state-failed': '无法写入本地忽略或恢复记录，未执行破坏性操作',
      'bookmark-update-failed': '浏览器拒绝更新书签',
      'bookmark-move-failed': '浏览器拒绝移动书签',
      'bookmark-delete-failed': '浏览器拒绝删除书签；本地恢复记录已保留',
      'restore-backup-not-found': '恢复记录已不存在，请刷新本地记录',
      'restore-backup-stale': '恢复记录或审查计划已变化，请重新审查',
      'restore-parent-invalid': '原书签文件夹已不存在，无法安全恢复',
      'restore-conflict': '原文件夹已有相同标题和 URL 的书签',
      'bookmark-restore-failed': '浏览器拒绝恢复书签',
      'restore-state-failed': '书签已恢复，但无法清理本地恢复记录',
      'invalid-local-data-confirmation': '清理本地记录前必须明确确认',
      'permission-remove-failed': '浏览器权限未能完整撤销；本地授权已关闭',
      'transport-error': '无法连接 Bookmark Doctor 后台',
      'invalid-response': 'Bookmark Doctor 后台返回无效结果',
    }
    return messages[reason] || 'Bookmark Doctor 操作失败'
  }

  private setBookmarkMessage(message: string, error = false) {
    this.bookmarkMessage = { message, error }
  }

  private bookmarkClientFailure(error: unknown) {
    return error instanceof BookmarkDoctorClientError ? error.code : 'transport-error'
  }

  private async authorizeBookmarkDoctor() {
    if (!this.bookmarkDoctor)
      return
    this.bookmarkBusy = true
    this.setBookmarkMessage('正在请求只读书签权限…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.authorize()
      if (result.operation !== 'authorize' || !result.ok) {
        const reason = result.ok ? 'invalid-response' : result.reason
        this.setBookmarkMessage(this.bookmarkErrorMessage(reason), true)
        return
      }
      this.replaceRecord(result.record)
      this.onRecordChanged?.(result.record)
      this.setBookmarkMessage('书签读取权限已授权。请准备一次扫描。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private async authorizeBookmarkRepairs() {
    if (!this.bookmarkDoctor)
      return
    this.bookmarkBusy = true
    this.setBookmarkMessage('正在单独启用书签修复权限…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.authorizeRepairs()
      if (result.operation !== 'authorize-repairs' || !result.ok) {
        this.setBookmarkMessage(this.bookmarkErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.replaceRecord(result.record)
      this.onRecordChanged?.(result.record)
      this.setBookmarkMessage('修复权限已启用；每次操作仍需审查并确认。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private setBookmarkResultFilter(filter: string | undefined) {
    if (filter !== 'problems' && filter !== 'all' && filter !== 'reachable')
      return
    this.bookmarkResultFilter = filter
    this.render()
  }

  private openBookmarkRepairDraft(entryId: string | undefined, operation: string | undefined) {
    if (!this.bookmarkSnapshot
      || !entryId
      || (operation !== 'update' && operation !== 'move' && operation !== 'ignore' && operation !== 'delete')) {
      return
    }
    const result = this.bookmarkSnapshot.results.find(candidate => candidate.entryId === entryId)
    if (!result)
      return
    this.bookmarkRepairDraft = createBookmarkRepairDraft(result, operation)
    this.bookmarkRepairPlan = null
    this.bookmarkRestorePlan = null
    this.setBookmarkMessage(this.bookmarkRepairDraft
      ? '已从扫描结果选择目标；请补充变更后生成审查计划。'
      : '该扫描结果没有可修复的浏览器书签标识。', !this.bookmarkRepairDraft)
    this.render()
  }

  private cancelBookmarkRepairDraft() {
    this.bookmarkRepairDraft = null
    this.bookmarkRepairPlan = null
    this.setBookmarkMessage('已取消本次修复。')
    this.render()
  }

  private collectBookmarkRepairDraft(panel: Element | null): BookmarkRepairDraft | null {
    if (!this.bookmarkRepairDraft)
      return null
    const read = (name: string) => panel?.querySelector<HTMLInputElement>(`[data-repair-field="${name}"]`)?.value.trim() || ''
    return {
      ...this.bookmarkRepairDraft,
      ...(this.bookmarkRepairDraft.operation === 'update' ? { title: read('title'), url: read('url') } : {}),
      ...(this.bookmarkRepairDraft.operation === 'move' ? { parentId: read('parentId'), index: read('index') } : {}),
    }
  }

  private async prepareBookmarkRepair(panel: Element | null) {
    if (!this.bookmarkDoctor)
      return
    const draft = this.collectBookmarkRepairDraft(panel)
    const request = draft ? bookmarkRepairRequestFromDraft(draft) : null
    if (!request) {
      this.setBookmarkMessage(this.bookmarkErrorMessage('invalid-repair-request'), true)
      this.render()
      return
    }
    this.bookmarkRepairDraft = draft
    this.bookmarkBusy = true
    this.setBookmarkMessage('正在重新读取目标并生成短期修复计划…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.prepareRepair(request)
      if (result.operation !== 'prepare-repair' || !result.ok) {
        this.setBookmarkMessage(this.bookmarkErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.bookmarkRepairPlan = result.plan
      this.bookmarkRepairDraft = null
      this.setBookmarkMessage('请核对旧值、新值和影响，再明确确认。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private async confirmBookmarkRepair(panel: Element | null) {
    if (!this.bookmarkDoctor || !this.bookmarkRepairPlan)
      return
    const plan = this.bookmarkRepairPlan
    if (plan.operation === 'delete'
      && !panel?.querySelector<HTMLInputElement>('[data-testid="bookmark-repair-delete-confirmation"]')?.checked) {
      this.setBookmarkMessage('删除前必须勾选永久删除确认。', true)
      this.render()
      return
    }
    this.bookmarkBusy = true
    this.setBookmarkMessage('正在重新比较书签快照并执行…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.confirmRepairs([{
        token: plan.token,
        confirmation: plan.confirmation,
      }])
      if (result.operation !== 'confirm-repairs' || !result.ok || result.results.length !== 1) {
        this.setBookmarkMessage(this.bookmarkErrorMessage('invalid-response'), true)
        return
      }
      const [item] = result.results
      this.bookmarkRepairPlan = null
      if (item.ok) {
        this.applyBookmarkRepairToSnapshot(plan)
        await this.refreshBookmarkWorkspaceState()
      }
      this.setBookmarkMessage(
        item.ok ? '修复已执行。重新扫描可刷新结果。' : this.bookmarkErrorMessage(item.reason),
        !item.ok,
      )
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private applyBookmarkRepairToSnapshot(plan: BookmarkRepairPlan) {
    if (!this.bookmarkSnapshot)
      return
    if (plan.operation === 'delete') {
      this.bookmarkSnapshot = {
        ...this.bookmarkSnapshot,
        results: this.bookmarkSnapshot.results.filter(result => result.bookmarkId !== plan.before.bookmarkId),
      }
      return
    }
    this.bookmarkSnapshot = {
      ...this.bookmarkSnapshot,
      results: this.bookmarkSnapshot.results.map((result) => {
        if (result.bookmarkId !== plan.before.bookmarkId)
          return result
        if (plan.operation === 'update') {
          return {
            ...result,
            ...(plan.proposed.title === undefined ? {} : { title: plan.proposed.title }),
            ...(plan.proposed.url === undefined ? {} : { url: plan.proposed.url }),
          }
        }
        if (plan.operation === 'move') {
          return {
            ...result,
            parentId: plan.proposed.parentId,
            index: plan.proposed.index ?? null,
            folderPath: [`文件夹 ${plan.proposed.parentId}`],
          }
        }
        return result
      }),
    }
  }

  private async refreshBookmarkWorkspaceState() {
    if (!this.bookmarkDoctor)
      return
    try {
      const result = await this.bookmarkDoctor.workspaceState()
      if (result.operation === 'workspace-state' && result.ok)
        this.bookmarkWorkspaceState = result.state
    }
    catch {}
  }

  private async unignoreBookmark(bookmarkId: string | undefined) {
    if (!this.bookmarkDoctor || !bookmarkId)
      return
    this.bookmarkBusy = true
    this.setBookmarkMessage('正在取消本地忽略记录…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.unignore(bookmarkId)
      if (result.operation !== 'unignore' || !result.ok) {
        this.setBookmarkMessage(this.bookmarkErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.bookmarkWorkspaceState = result.state
      this.setBookmarkMessage('已取消忽略；原扫描结果会重新显示。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private async clearBookmarkLocalData(panel: Element | null) {
    if (!this.bookmarkDoctor)
      return
    if (!panel?.querySelector<HTMLInputElement>('[data-testid="bookmark-local-clear-confirmation"]')?.checked) {
      this.setBookmarkMessage(this.bookmarkErrorMessage('invalid-local-data-confirmation'), true)
      this.render()
      return
    }
    this.bookmarkBusy = true
    this.setBookmarkMessage('正在清除 Bookmark Doctor 本地记录…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.clearLocalData()
      if (result.operation !== 'clear-local-data' || !result.ok) {
        this.setBookmarkMessage(this.bookmarkErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.bookmarkWorkspaceState = result.state
      this.bookmarkRepairDraft = null
      this.bookmarkRepairPlan = null
      this.bookmarkRestorePlan = null
      this.setBookmarkMessage('本地忽略与恢复记录已清除；浏览器书签未被修改。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private async prepareBookmarkRestore(backupToken: string | undefined) {
    if (!this.bookmarkDoctor || !backupToken)
      return
    this.bookmarkBusy = true
    this.bookmarkRestorePlan = null
    this.setBookmarkMessage('正在核验原文件夹与重复冲突…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.prepareRestore(backupToken)
      if (result.operation !== 'prepare-restore' || !result.ok) {
        this.setBookmarkMessage(this.bookmarkErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        await this.refreshBookmarkWorkspaceState()
        return
      }
      this.bookmarkRestorePlan = result.plan
      this.setBookmarkMessage('请核对恢复内容与原位置，再明确确认。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private async confirmBookmarkRestore() {
    if (!this.bookmarkDoctor || !this.bookmarkRestorePlan)
      return
    const confirmation: BookmarkRestoreConfirmation = {
      token: this.bookmarkRestorePlan.token,
      confirmation: this.bookmarkRestorePlan.confirmation,
    }
    this.bookmarkBusy = true
    this.setBookmarkMessage('正在重新校验恢复记录并创建书签…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.confirmRestore(confirmation)
      if (result.operation !== 'confirm-restore' || !result.ok) {
        this.setBookmarkMessage(this.bookmarkErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        this.bookmarkRestorePlan = null
        await this.refreshBookmarkWorkspaceState()
        return
      }
      this.bookmarkRestorePlan = null
      await this.refreshBookmarkWorkspaceState()
      this.setBookmarkMessage('书签已恢复到原文件夹。重新扫描可刷新结果。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private async revokeBookmarkDoctorAccess() {
    if (!this.bookmarkDoctor)
      return
    this.bookmarkBusy = true
    this.setBookmarkMessage('正在停止扫描并撤销书签与本阶段来源权限…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.revoke()
      if (result.operation !== 'revoke' || !result.ok) {
        await this.tryReloadRecords()
        this.setBookmarkMessage(this.bookmarkErrorMessage(result.ok ? 'invalid-response' : result.reason), true)
        return
      }
      this.replaceRecord(result.record)
      this.onRecordChanged?.(result.record)
      this.bookmarkPreparation = null
      this.bookmarkSnapshot = null
      this.bookmarkRepairDraft = null
      this.bookmarkRepairPlan = null
      this.bookmarkRestorePlan = null
      this.bookmarkStarting = false
      this.clearBookmarkStatusPoll()
      this.setBookmarkMessage('书签读写授权已撤销；本地忽略与恢复记录仍保留。')
    }
    catch (error) {
      await this.tryReloadRecords()
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private async prepareBookmarkScan() {
    if (!this.bookmarkDoctor)
      return
    this.bookmarkBusy = true
    this.bookmarkPreparation = null
    this.setBookmarkMessage('正在本机读取并规范化书签…')
    this.render()
    try {
      const result = await this.bookmarkDoctor.prepare()
      if (result.operation !== 'prepare' || !result.ok) {
        const reason = result.ok ? 'invalid-response' : result.reason
        this.setBookmarkMessage(this.bookmarkErrorMessage(reason), true)
        return
      }
      this.bookmarkPreparation = result.preparation
      this.setBookmarkMessage('扫描计划已准备；下一步只申请本批次实际来源。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkBusy = false
      this.render()
    }
  }

  private async startBookmarkScan() {
    if (!this.bookmarkDoctor || !this.bookmarkPreparation)
      return
    const preparation = this.bookmarkPreparation
    this.bookmarkStarting = true
    this.setBookmarkMessage('正在请求精确来源权限…')
    this.render()
    const pending = this.bookmarkDoctor.start(preparation)
    this.scheduleBookmarkStatusPoll()
    try {
      const result = await pending
      if (result.operation !== 'start' || !result.ok) {
        const reason = result.ok ? 'invalid-response' : result.reason
        this.setBookmarkMessage(this.bookmarkErrorMessage(reason), true)
        return
      }
      this.bookmarkPreparation = null
      this.bookmarkSnapshot = result.snapshot
      this.setBookmarkMessage(result.snapshot.status === 'completed' ? '本次扫描完成。' : '本次扫描已停止。')
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
    }
    finally {
      this.bookmarkStarting = false
      this.clearBookmarkStatusPoll()
      this.render()
    }
  }

  private async stopBookmarkScan() {
    if (!this.bookmarkDoctor)
      return
    try {
      const result = await this.bookmarkDoctor.stop()
      if (result.operation !== 'stop') {
        this.setBookmarkMessage(this.bookmarkErrorMessage('invalid-response'), true)
        return
      }
      this.bookmarkSnapshot = result.snapshot
      this.setBookmarkMessage(result.changed ? '停止请求已生效。' : '当前没有运行中的扫描。')
      this.render()
    }
    catch (error) {
      this.setBookmarkMessage(this.bookmarkErrorMessage(this.bookmarkClientFailure(error)), true)
      this.render()
    }
  }

  private async refreshBookmarkScanStatus() {
    if (!this.bookmarkDoctor)
      return
    try {
      this.bookmarkSnapshot = await this.bookmarkDoctor.status()
    }
    catch {}
  }

  private scheduleBookmarkStatusPoll() {
    this.clearBookmarkStatusPoll()
    this.bookmarkPollTimer = window.setTimeout(async () => {
      if (!this.bookmarkStarting || !this.bookmarkDoctor)
        return
      try {
        const snapshot = await this.bookmarkDoctor.status()
        if (snapshot) {
          this.bookmarkSnapshot = snapshot
          this.render()
        }
      }
      catch {}
      if (this.bookmarkStarting)
        this.scheduleBookmarkStatusPoll()
    }, 250)
  }

  private clearBookmarkStatusPoll() {
    if (this.bookmarkPollTimer !== null)
      window.clearTimeout(this.bookmarkPollTimer)
    this.bookmarkPollTimer = null
  }

  private collectUpdateApproval(panel: Element | null): ModuleUpdateApprovalSelection {
    const approvedContextFields: ModuleContextFieldGrants = {}
    for (const checkbox of panel?.querySelectorAll<HTMLInputElement>(
      'input[data-update-context-id][data-update-context-field]:checked',
    ) || []) {
      const contextId = checkbox.dataset.updateContextId as ModuleContextId
      approvedContextFields[contextId] ||= []
      approvedContextFields[contextId]!.push(checkbox.dataset.updateContextField!)
    }
    const approvedCapabilities = [...(panel?.querySelectorAll<HTMLInputElement>(
      'input[data-update-capability]:checked',
    ) || [])].map(checkbox => checkbox.dataset.updateCapability as ModuleCapabilityId)
    return { approvedContextFields, approvedCapabilities }
  }

  private async setEnabled(record: InstalledModuleRecord, enabled: boolean) {
    if (record.manifest.runtime === 'builtin'
      && record.manifest.entry_id === CLASH_CONTROL_ENTRY_ID
      && !enabled) {
      this.supersedeClashUiOperation()
    }
    this.busyModuleIds.add(record.manifest.id)
    this.render()
    try {
      const result = await this.client.setEnabled(record.manifest.id, enabled)
      if (!result.ok) {
        this.setFeedback('模块已不存在，正在刷新列表', true)
        await this.refresh()
        return
      }
      this.records = this.records.map(candidate => candidate.manifest.id === record.manifest.id ? result.record : candidate)
      if (record.manifest.runtime === 'builtin'
        && record.manifest.entry_id === BROWSER_JOURNAL_ENTRY_ID
        && !enabled) {
        await this.refreshBrowserJournalStatus()
      }
      if (record.manifest.runtime === 'builtin'
        && record.manifest.entry_id === BOOKMARK_DOCTOR_ENTRY_ID
        && !enabled) {
        this.bookmarkPreparation = null
        this.bookmarkRepairDraft = null
        this.bookmarkRepairPlan = null
        this.bookmarkRestorePlan = null
        this.bookmarkStarting = false
        this.clearBookmarkStatusPoll()
        await this.refreshBookmarkScanStatus()
      }
      if (record.manifest.runtime === 'builtin'
        && record.manifest.entry_id === CLASH_CONTROL_ENTRY_ID
        && !enabled) {
        this.clashPreparation = null
        this.clashStatus = null
        this.clashReadState = { status: 'empty', snapshot: null, diagnostic: null }
        this.clashSwitchPlan = null
      }
      if (record.manifest.runtime === 'builtin'
        && record.manifest.entry_id === PAGE_TOOLBOX_ENTRY_ID) {
        this.pageToolboxPreparation = null
        await this.refreshPageToolboxControl()
      }
      this.setFeedback(`${result.record.manifest.name} 已${enabled ? '启用' : '停用'}`)
      this.onRecordChanged?.(result.record)
    }
    catch {
      this.setFeedback(`无法${enabled ? '启用' : '停用'} ${record.manifest.name}`, true)
    }
    finally {
      this.busyModuleIds.delete(record.manifest.id)
      this.render()
    }
  }

  private browserJournalErrorMessage(reason: string) {
    const messages: Record<string, string> = {
      'module-unavailable': 'Browser Journal 内置模块不可用',
      'module-disabled': 'Browser Journal 已停用',
      'lifecycle-cancelled': '模块生命周期已变化，请重新开始',
      'listener-failed': '无法启动标签页监听',
      'archive-unavailable': 'Browser Journal 本地保存服务不可用',
      'archive-read-failed': '无法读取已保存会话',
      'archive-write-failed': '无法写入已保存会话',
      'session-not-stopped': '只有已停止的会话可以保存',
      'session-empty': '当前会话没有可保存的条目',
      'saved-session-not-found': '保存记录已变化，列表已刷新',
      'invalid-clear-confirmation': '必须明确确认清除全部保存记录',
      'transport-error': '无法连接 Browser Journal 后台',
      'invalid-response': 'Browser Journal 后台返回无效结果',
    }
    return messages[reason] || 'Browser Journal 操作失败'
  }

  private browserJournalFailure(error: unknown) {
    return error instanceof BrowserJournalClientError ? error.code : 'transport-error'
  }

  private async startBrowserJournal() {
    if (!this.browserJournal || this.browserJournalBusy)
      return
    this.browserJournalBusy = true
    this.browserJournalMessage = null
    this.render()
    try {
      const result = await this.browserJournal.start()
      if (result.operation !== 'start') {
        this.browserJournalMessage = { message: this.browserJournalErrorMessage('invalid-response'), error: true }
      }
      else if (!result.ok) {
        this.browserJournalMessage = { message: this.browserJournalErrorMessage(result.reason), error: true }
      }
      else {
        this.browserJournalSnapshot = result.snapshot
        this.browserJournalMessage = {
          message: result.changed ? '已开始新的内存会话。' : '当前已经在记录。',
          error: false,
        }
      }
    }
    catch (error) {
      this.browserJournalMessage = {
        message: this.browserJournalErrorMessage(this.browserJournalFailure(error)),
        error: true,
      }
    }
    finally {
      this.browserJournalBusy = false
      this.render()
    }
  }

  private async stopBrowserJournal() {
    if (!this.browserJournal || this.browserJournalBusy)
      return
    this.browserJournalBusy = true
    this.render()
    try {
      const result = await this.browserJournal.stop()
      if (result.operation !== 'stop') {
        this.browserJournalMessage = { message: this.browserJournalErrorMessage('invalid-response'), error: true }
      }
      else {
        this.browserJournalSnapshot = result.snapshot
        this.browserJournalMessage = {
          message: result.changed ? '本次记录已停止；结果仅保留到后台重启。' : '当前没有运行中的记录。',
          error: false,
        }
      }
    }
    catch (error) {
      this.browserJournalMessage = {
        message: this.browserJournalErrorMessage(this.browserJournalFailure(error)),
        error: true,
      }
    }
    finally {
      this.browserJournalBusy = false
      this.render()
    }
  }

  private async refreshBrowserJournalStatus() {
    if (!this.browserJournal)
      return
    try {
      const result = await this.browserJournal.status()
      if (result.operation === 'status' && result.ok)
        this.browserJournalSnapshot = result.snapshot
    }
    catch {}
  }

  private async refreshBrowserJournalArchive() {
    if (!this.browserJournal)
      return
    try {
      const result = await this.browserJournal.archive()
      if (result.operation === 'archive') {
        if (result.ok)
          this.replaceBrowserJournalArchive(result.state)
        else
          this.browserJournalMessage = { message: this.browserJournalErrorMessage(result.reason), error: true }
      }
    }
    catch {}
  }

  private async saveBrowserJournal() {
    if (!this.browserJournal || this.browserJournalBusy)
      return
    this.browserJournalBusy = true
    this.render()
    try {
      const result = await this.browserJournal.save()
      if (result.operation !== 'save') {
        this.browserJournalMessage = { message: this.browserJournalErrorMessage('invalid-response'), error: true }
      }
      else if (!result.ok) {
        this.browserJournalMessage = { message: this.browserJournalErrorMessage(result.reason), error: true }
      }
      else {
        this.replaceBrowserJournalArchive(result.state, result.savedSession.id)
        this.browserJournalMessage = {
          message: result.changed ? '本次会话已明确保存到本机，最多保留 7 天。' : '本次会话已经保存。',
          error: false,
        }
      }
    }
    catch (error) {
      this.browserJournalMessage = {
        message: this.browserJournalErrorMessage(this.browserJournalFailure(error)),
        error: true,
      }
    }
    finally {
      this.browserJournalBusy = false
      this.render()
    }
  }

  private async deleteSavedBrowserJournal(savedSessionId: string | undefined) {
    if (!this.browserJournal || this.browserJournalBusy || !savedSessionId)
      return
    this.browserJournalBusy = true
    this.render()
    try {
      const result = await this.browserJournal.deleteSaved(savedSessionId)
      if (result.operation !== 'delete-saved') {
        this.browserJournalMessage = { message: this.browserJournalErrorMessage('invalid-response'), error: true }
      }
      else if (!result.ok) {
        await this.refreshBrowserJournalArchive()
        this.browserJournalMessage = { message: this.browserJournalErrorMessage(result.reason), error: true }
      }
      else {
        this.replaceBrowserJournalArchive(result.state)
        this.browserJournalMessage = { message: '已删除这份保存记录。', error: false }
      }
    }
    catch (error) {
      this.browserJournalMessage = {
        message: this.browserJournalErrorMessage(this.browserJournalFailure(error)),
        error: true,
      }
    }
    finally {
      this.browserJournalBusy = false
      this.render()
    }
  }

  private async clearSavedBrowserJournal(archive: Element | null) {
    if (!this.browserJournal || this.browserJournalBusy)
      return
    if (!archive?.querySelector<HTMLInputElement>('[data-testid="browser-journal-clear-confirmation"]')?.checked) {
      this.browserJournalMessage = { message: this.browserJournalErrorMessage('invalid-clear-confirmation'), error: true }
      this.render()
      return
    }
    this.browserJournalBusy = true
    this.render()
    try {
      const result = await this.browserJournal.clearSaved()
      if (result.operation !== 'clear-saved') {
        this.browserJournalMessage = { message: this.browserJournalErrorMessage('invalid-response'), error: true }
      }
      else if (!result.ok) {
        this.browserJournalMessage = { message: this.browserJournalErrorMessage(result.reason), error: true }
      }
      else {
        this.replaceBrowserJournalArchive(result.state)
        this.browserJournalMessage = {
          message: result.changed ? '全部保存记录已清除。' : '当前没有保存记录。',
          error: false,
        }
      }
    }
    catch (error) {
      this.browserJournalMessage = {
        message: this.browserJournalErrorMessage(this.browserJournalFailure(error)),
        error: true,
      }
    }
    finally {
      this.browserJournalBusy = false
      this.render()
    }
  }

  private replaceBrowserJournalArchive(
    state: BrowserJournalArchiveState,
    requestedSessionId = this.browserJournalSelectedSavedSessionId,
  ) {
    this.browserJournalArchive = state
    this.browserJournalSelectedSavedSessionId = presentBrowserJournalArchive(
      state,
      requestedSessionId,
    ).selectedSessionId
  }

  private selectSavedBrowserJournal(savedSessionId: string | undefined) {
    if (this.browserJournalBusy || !savedSessionId)
      return
    const selected = presentBrowserJournalArchive(this.browserJournalArchive, savedSessionId)
    if (selected.selectedSessionId !== savedSessionId)
      return
    this.browserJournalSelectedSavedSessionId = savedSessionId
    this.render()
  }

  private setUpdateMessage(moduleId: string, message: string, error = false) {
    this.updateMessages.set(moduleId, { message, error })
  }

  private replaceRecord(record: InstalledModuleRecord) {
    this.records = this.records.map(candidate => (
      candidate.manifest.id === record.manifest.id ? record : candidate
    ))
  }

  private async checkUpdate(record: InstalledModuleRecord) {
    const moduleId = record.manifest.id
    this.busyModuleIds.add(moduleId)
    this.setUpdateMessage(moduleId, '正在从固定来源检查候选…')
    this.render()
    try {
      const result = await this.client.checkUpdate(moduleId)
      if (!result.ok) {
        const refreshed = await this.tryReloadRecords()
        if (!refreshed && record.update)
          this.staleUpdateDigests.set(moduleId, record.update.normalizedManifestDigest)
        const message = updateErrorMessage(result.reason)
        this.setUpdateMessage(moduleId, message, true)
        this.setFeedback(message, true)
        return
      }
      this.replaceRecord(result.record)
      this.staleUpdateDigests.delete(moduleId)
      this.setUpdateMessage(moduleId, '检查完成。候选仅供审查，不会自动应用。')
      this.setFeedback(`${result.record.manifest.name} 已完成更新检查`)
    }
    catch (error) {
      const refreshed = await this.tryReloadRecords()
      if (!refreshed && record.update)
        this.staleUpdateDigests.set(moduleId, record.update.normalizedManifestDigest)
      const message = updateErrorMessage(updateErrorReason(error))
      this.setUpdateMessage(moduleId, message, true)
      this.setFeedback(message, true)
    }
    finally {
      this.busyModuleIds.delete(moduleId)
      this.render()
    }
  }

  private async approveUpdate(
    record: InstalledModuleRecord,
    selection: ModuleUpdateApprovalSelection,
  ) {
    const update = record.update
    if (!update)
      return
    const moduleId = record.manifest.id
    this.busyModuleIds.add(moduleId)
    this.setUpdateMessage(moduleId, '正在保存与当前 digest 绑定的审批…')
    this.render()
    try {
      const result = await this.client.approveUpdate(
        moduleId,
        update.normalizedManifestDigest,
        selection,
      )
      if (!result.ok) {
        if ([
          'not-found',
          'no-update-candidate',
          'update-candidate-changed',
        ].includes(result.reason)) {
          const refreshed = await this.tryReloadRecords()
          if (!refreshed)
            this.staleUpdateDigests.set(moduleId, update.normalizedManifestDigest)
        }
        const message = updateErrorMessage(result.reason)
        this.setUpdateMessage(moduleId, message, true)
        this.setFeedback(message, true)
        return
      }
      this.replaceRecord(result.record)
      this.setUpdateMessage(moduleId, '审批已保存。请单独确认应用更新。')
      this.setFeedback(`${result.record.manifest.name} 的更新审批已保存`)
    }
    catch (error) {
      const refreshed = await this.tryReloadRecords()
      if (!refreshed)
        this.staleUpdateDigests.set(moduleId, update.normalizedManifestDigest)
      const message = updateErrorMessage(updateErrorReason(error))
      this.setUpdateMessage(moduleId, message, true)
      this.setFeedback(message, true)
    }
    finally {
      this.busyModuleIds.delete(moduleId)
      this.render()
    }
  }

  private async applyUpdate(record: InstalledModuleRecord) {
    const moduleId = record.manifest.id
    const candidateDigest = record.update?.normalizedManifestDigest || null
    this.busyModuleIds.add(moduleId)
    this.setUpdateMessage(moduleId, '正在重新获取、校验并应用候选…')
    this.render()
    try {
      const result = await this.client.applyUpdate(moduleId)
      if (!result.ok) {
        if (result.reason === 'update-candidate-changed' && candidateDigest)
          this.staleUpdateDigests.set(moduleId, candidateDigest)
        if ([
          'not-found',
          'installed-record-changed',
          'no-update-candidate',
          'update-approval-required',
        ].includes(result.reason)) {
          const refreshed = await this.tryReloadRecords()
          if (!refreshed && candidateDigest)
            this.staleUpdateDigests.set(moduleId, candidateDigest)
        }
        const message = updateErrorMessage(result.reason)
        this.setUpdateMessage(moduleId, message, true)
        this.setFeedback(message, true)
        return
      }
      this.replaceRecord(result.record)
      this.staleUpdateDigests.delete(moduleId)
      this.updateMessages.delete(moduleId)
      this.setFeedback(`${result.record.manifest.name} 已更新至 ${result.record.manifest.version}`)
      this.onRecordChanged?.(result.record)
    }
    catch (error) {
      const refreshed = await this.tryReloadRecords()
      if (!refreshed && candidateDigest)
        this.staleUpdateDigests.set(moduleId, candidateDigest)
      const message = updateErrorMessage(updateErrorReason(error))
      this.setUpdateMessage(moduleId, message, true)
      this.setFeedback(message, true)
    }
    finally {
      this.busyModuleIds.delete(moduleId)
      this.render()
    }
  }

  private openRemovalConfirmation(record: InstalledModuleRecord) {
    this.pendingRemovalId = record.manifest.id
    this.confirmName.textContent = record.manifest.name
    this.confirmOverlay.hidden = false
    this.confirmButton.focus()
  }

  private readonly closeRemovalConfirmation = () => {
    this.pendingRemovalId = null
    this.confirmOverlay.hidden = true
  }

  private readonly handleConfirmationKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape')
      this.closeRemovalConfirmation()
  }

  private readonly handleConfirmRemoval = () => {
    if (this.pendingRemovalId)
      void this.remove(this.pendingRemovalId)
  }

  private async remove(moduleId: string) {
    const record = this.records.find(candidate => candidate.manifest.id === moduleId)
    if (!record)
      return
    this.busyModuleIds.add(moduleId)
    this.confirmButton.disabled = true
    this.cancelButton.disabled = true
    try {
      const result = await this.client.remove(moduleId)
      if (!result.ok) {
        this.setFeedback(
          result.reason === 'protected-seed' ? 'OneWeb 预置模块不可移除' : '模块已不存在',
          true,
        )
        await this.refresh()
        return
      }
      this.records = this.records.filter(candidate => candidate.manifest.id !== moduleId)
      this.setFeedback(`${result.removed.manifest.name} 已移除`)
      this.onRecordRemoved?.(result.removed)
    }
    catch {
      this.setFeedback(`无法移除 ${record.manifest.name}`, true)
    }
    finally {
      this.busyModuleIds.delete(moduleId)
      this.confirmButton.disabled = false
      this.cancelButton.disabled = false
      this.closeRemovalConfirmation()
      this.render()
    }
  }
}
