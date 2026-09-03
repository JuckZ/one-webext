import type { InstalledModuleRecord } from '../../types'
import type {
  BookmarkDoctorErrorCode,
  BookmarkDoctorReadResult,
} from './contracts'
import { BOOKMARK_DOCTOR_ENTRY_ID, BOOKMARK_DOCTOR_MODULE_ID } from './contracts'
import { normalizeBookmarkTree } from './normalize'

export interface BookmarkDoctorRegistryReader {
  get: (_moduleId: string) => Promise<InstalledModuleRecord | null>
}

export interface BookmarkPermissionBoundary {
  contains: (_permissions: { permissions: string[] }) => Promise<boolean>
}

export interface BookmarkTreeReader {
  readTree: () => Promise<unknown>
}

export interface BrowserBookmarksReadApi {
  getTree: () => Promise<unknown>
}

export function createBrowserBookmarkTreeReader(api: BrowserBookmarksReadApi): BookmarkTreeReader {
  return { readTree: () => api.getTree() }
}

export interface BookmarkDoctorReaderOptions {
  registry: BookmarkDoctorRegistryReader
  permissions: BookmarkPermissionBoundary
  bookmarks: BookmarkTreeReader
  now?: () => string
}

const errorMessages: Record<BookmarkDoctorErrorCode, string> = {
  'module-unavailable': 'Bookmark Doctor is not installed as a packaged builtin module',
  'module-disabled': 'Bookmark Doctor is disabled',
  'capability-not-granted': 'Bookmark Doctor has no bookmark-read capability grant',
  'permission-missing': 'The optional bookmarks permission has not been granted',
  'permission-check-failed': 'The optional bookmarks permission could not be verified',
  'bookmark-read-failed': 'The browser bookmark tree could not be read',
  'invalid-tree': 'The browser returned an invalid bookmark tree',
}

function errorResult(
  code: BookmarkDoctorErrorCode,
  completedAt: string,
  status: 'blocked' | 'failed',
  diagnostics: BookmarkDoctorReadResult['diagnostics'] = [],
): BookmarkDoctorReadResult {
  return {
    status,
    completedAt,
    entries: [],
    diagnostics,
    error: { code, message: errorMessages[code] },
  }
}

export class BookmarkDoctorReader {
  private readonly registry: BookmarkDoctorRegistryReader
  private readonly permissions: BookmarkPermissionBoundary
  private readonly bookmarks: BookmarkTreeReader
  private readonly now: () => string

  constructor({
    registry,
    permissions,
    bookmarks,
    now = () => new Date().toISOString(),
  }: BookmarkDoctorReaderOptions) {
    this.registry = registry
    this.permissions = permissions
    this.bookmarks = bookmarks
    this.now = now
  }

  async read(): Promise<BookmarkDoctorReadResult> {
    const record = await this.registry.get(BOOKMARK_DOCTOR_MODULE_ID)
    const completedAt = this.now()
    if (!record
      || record.manifest.id !== BOOKMARK_DOCTOR_MODULE_ID
      || record.source !== 'seeded'
      || record.manifest.runtime !== 'builtin'
      || record.manifest.entry_id !== BOOKMARK_DOCTOR_ENTRY_ID) {
      return errorResult('module-unavailable', completedAt, 'blocked')
    }
    if (!record.enabled)
      return errorResult('module-disabled', completedAt, 'blocked')
    if (!record.manifest.capabilities.includes('bookmarks.read')
      || !record.grantedCapabilities.includes('bookmarks.read')) {
      return errorResult('capability-not-granted', completedAt, 'blocked')
    }

    let hasPermission: boolean
    try {
      hasPermission = await this.permissions.contains({ permissions: ['bookmarks'] })
    }
    catch {
      return errorResult('permission-check-failed', completedAt, 'failed')
    }
    if (!hasPermission)
      return errorResult('permission-missing', completedAt, 'blocked')

    let tree: unknown
    try {
      tree = await this.bookmarks.readTree()
    }
    catch {
      return errorResult('bookmark-read-failed', completedAt, 'failed')
    }
    const normalized = normalizeBookmarkTree(tree)
    if (!normalized.valid)
      return errorResult('invalid-tree', completedAt, 'failed', normalized.diagnostics)
    return {
      status: 'ready',
      completedAt,
      entries: normalized.entries,
      diagnostics: normalized.diagnostics,
      error: null,
    }
  }
}
