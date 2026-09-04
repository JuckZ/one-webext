import type { InstalledModuleRecord } from '../../types'
import type {
  ResourceCandidateV1,
  SendToOpenListCandidateSource,
  SendToOpenListDiscoverySnapshotV1,
  SendToOpenListStableErrorCode,
} from './contracts'
import { normalizeResourceCandidate, normalizeResourceCandidateList } from './candidate'
import {
  SEND_TO_OPENLIST_ENTRY_ID,
  SEND_TO_OPENLIST_MAX_DISCOVERY_CANDIDATES,
  SEND_TO_OPENLIST_MAX_TITLE_BYTES,
  SEND_TO_OPENLIST_MAX_URL_BYTES,
  SEND_TO_OPENLIST_MODULE_ID,
} from './contracts'
import { createSendToOpenListSeed } from './manifest'
import { utf8ByteLength } from './validation'

export interface SendToOpenListDiscoveryTab {
  readonly id?: number
  readonly url?: string
  readonly title?: string
  readonly incognito?: boolean
}

export interface SendToOpenListRawDiscoveryCandidate {
  readonly url: string
  readonly source: SendToOpenListCandidateSource
  readonly title?: string
}

export interface SendToOpenListScanInjectionResult {
  readonly frameId?: number
  readonly result?: unknown
}

export interface SendToOpenListDiscoveryTabsBoundary {
  query: (_query: { active: true, currentWindow: true }) => Promise<SendToOpenListDiscoveryTab[]>
}

export interface SendToOpenListDiscoveryScriptingBoundary {
  executeScript: (_injection: {
    target: { tabId: number, frameIds: [0] }
    func: typeof collectSendToOpenListTopFrameCandidates
  }) => Promise<SendToOpenListScanInjectionResult[]>
}

export interface SendToOpenListDiscoveryRegistryBoundary {
  get: (_moduleId: string) => Promise<InstalledModuleRecord | null>
}

export interface SendToOpenListDiscoveryControllerOptions {
  readonly registry: SendToOpenListDiscoveryRegistryBoundary
  readonly tabs: SendToOpenListDiscoveryTabsBoundary
  readonly scripting: SendToOpenListDiscoveryScriptingBoundary
  readonly now?: () => string
}

export type SendToOpenListDiscoveryResult =
  | { readonly ok: true, readonly value: SendToOpenListDiscoverySnapshotV1 }
  | { readonly ok: false, readonly reason: SendToOpenListStableErrorCode }

interface ScanValue {
  readonly url: string
  readonly title?: string
}

function validModuleRecord(record: InstalledModuleRecord | null): record is InstalledModuleRecord {
  const manifest = createSendToOpenListSeed().manifest
  return Boolean(record
    && record.source === 'seeded'
    && record.manifest.id === manifest.id
    && record.manifest.runtime === 'builtin'
    && record.manifest.entry_id === SEND_TO_OPENLIST_ENTRY_ID)
}

function validTimestamp(value: string) {
  return Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString()
}

function isScanValue(value: unknown): value is ScanValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate)
  return keys.every(key => key === 'url' || key === 'title')
    && typeof candidate.url === 'string'
    && utf8ByteLength(candidate.url) <= SEND_TO_OPENLIST_MAX_URL_BYTES
    && (candidate.title === undefined
      || (typeof candidate.title === 'string'
        && utf8ByteLength(candidate.title) <= SEND_TO_OPENLIST_MAX_TITLE_BYTES))
}

export function collectSendToOpenListTopFrameCandidates() {
  const maximumItems = 200
  const maximumUrlLength = 8192
  const maximumTitleLength = 512
  const values: Array<{ url: string, title?: string }> = []
  const push = (url: unknown, title?: unknown) => {
    if (values.length >= maximumItems || typeof url !== 'string' || !url || url.length > maximumUrlLength)
      return
    const item: { url: string, title?: string } = { url }
    if (typeof title === 'string' && title && title.length <= maximumTitleLength)
      item.title = title
    values.push(item)
  }
  const attributeUrl = (element: Element & { href?: string, src?: string }, name: 'href' | 'src') => {
    const attribute = element.getAttribute(name)
    if (attribute && /^[a-z][a-z0-9+.-]*:/iu.test(attribute))
      return attribute
    return element[name]
  }

  push(globalThis.location.href, globalThis.document.title)
  for (const anchor of globalThis.document.getElementsByTagName('a'))
    push(attributeUrl(anchor, 'href'), anchor.title || anchor.textContent?.trim())
  for (const image of globalThis.document.getElementsByTagName('img'))
    push(image.currentSrc || attributeUrl(image, 'src'), image.alt || image.title)
  for (const media of [
    ...globalThis.document.getElementsByTagName('audio'),
    ...globalThis.document.getElementsByTagName('video'),
    ...globalThis.document.getElementsByTagName('source'),
  ]) {
    push('currentSrc' in media && media.currentSrc ? media.currentSrc : attributeUrl(media, 'src'), media.title)
  }
  return values
}

export class SendToOpenListDiscoveryController {
  private readonly now: () => string
  private candidates: readonly ResourceCandidateV1[] = Object.freeze([])
  private generation = 1
  private updatedAt: string | null = null
  private rejectedCount = 0
  private installationId: string | null = null

  constructor(private readonly options: SendToOpenListDiscoveryControllerOptions) {
    this.now = options.now || (() => new Date().toISOString())
  }

  private snapshot(): SendToOpenListDiscoverySnapshotV1 {
    return structuredClone({
      schemaVersion: 1,
      generation: this.generation,
      updatedAt: this.updatedAt,
      candidates: this.candidates,
      rejectedCount: this.rejectedCount,
    })
  }

  private async available() {
    const record = await this.options.registry.get(SEND_TO_OPENLIST_MODULE_ID)
    if (!validModuleRecord(record))
      return { ok: false as const, reason: 'module-unavailable' as const }
    if (!record.enabled)
      return { ok: false as const, reason: 'module-disabled' as const }
    this.installationId = record.installedAt
    return { ok: true as const, record }
  }

  private clearAuthority() {
    this.generation += 1
    this.candidates = Object.freeze([])
    this.updatedAt = null
    this.rejectedCount = 0
  }

  private ingest(inputs: readonly SendToOpenListRawDiscoveryCandidate[]): SendToOpenListDiscoveryResult {
    if (!inputs.length || inputs.length > SEND_TO_OPENLIST_MAX_DISCOVERY_CANDIDATES)
      return { ok: false, reason: inputs.length ? 'quota-exceeded' : 'discovery-empty' }
    const accepted: ResourceCandidateV1[] = []
    let rejected = 0
    for (const input of inputs) {
      const normalized = normalizeResourceCandidate(input)
      if (normalized.ok)
        accepted.push(normalized.value)
      else
        rejected += 1
    }
    if (!accepted.length)
      return { ok: false, reason: 'discovery-empty' }
    const merged = normalizeResourceCandidateList([...this.candidates, ...accepted], 'discovery')
    if (!merged.ok)
      return { ok: false, reason: 'quota-exceeded' }
    this.candidates = merged.value
    this.rejectedCount += rejected
    this.generation += 1
    this.updatedAt = validTimestamp(this.now())
    return { ok: true, value: this.snapshot() }
  }

  async status(): Promise<SendToOpenListDiscoveryResult> {
    const available = await this.available()
    return available.ok ? { ok: true, value: this.snapshot() } : available
  }

  async clear(): Promise<SendToOpenListDiscoveryResult> {
    const available = await this.available()
    if (!available.ok)
      return available
    this.clearAuthority()
    return { ok: true, value: this.snapshot() }
  }

  private async activeTab() {
    const tabs = await this.options.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    return tab && Number.isSafeInteger(tab.id) && (tab.id ?? -1) >= 0 && !tab.incognito ? tab : null
  }

  async captureCurrentPage(): Promise<SendToOpenListDiscoveryResult> {
    const available = await this.available()
    if (!available.ok)
      return available
    let tab: SendToOpenListDiscoveryTab | null
    try {
      tab = await this.activeTab()
    }
    catch {
      return { ok: false, reason: 'active-tab-unavailable' }
    }
    if (!tab?.url)
      return { ok: false, reason: 'active-tab-unavailable' }
    return this.ingest([{ url: tab.url, title: tab.title, source: 'current-page' }])
  }

  async scanCurrentPage(): Promise<SendToOpenListDiscoveryResult> {
    const available = await this.available()
    if (!available.ok)
      return available
    let tab: SendToOpenListDiscoveryTab | null
    try {
      tab = await this.activeTab()
    }
    catch {
      return { ok: false, reason: 'active-tab-unavailable' }
    }
    if (!tab || tab.id === undefined)
      return { ok: false, reason: 'active-tab-unavailable' }
    let injected: SendToOpenListScanInjectionResult[]
    try {
      injected = await this.options.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        func: collectSendToOpenListTopFrameCandidates,
      })
    }
    catch {
      return { ok: false, reason: 'page-scan-failed' }
    }
    const topFrame = injected.find(result => result.frameId === 0)
    if (!topFrame || !Array.isArray(topFrame.result))
      return { ok: false, reason: 'page-scan-failed' }
    const values = topFrame.result.filter(isScanValue).map(value => ({ ...value, source: 'page-scan' as const }))
    return this.ingest(values)
  }

  async ingestContextCandidate(input: SendToOpenListRawDiscoveryCandidate): Promise<SendToOpenListDiscoveryResult> {
    const available = await this.available()
    if (!available.ok)
      return available
    return this.ingest([input])
  }

  handleInstalledRecordChanged(record: InstalledModuleRecord) {
    if (record.manifest.id !== SEND_TO_OPENLIST_MODULE_ID)
      return
    if (!validModuleRecord(record) || !record.enabled || (this.installationId && record.installedAt !== this.installationId))
      this.clearAuthority()
    this.installationId = validModuleRecord(record) ? record.installedAt : null
  }
}
