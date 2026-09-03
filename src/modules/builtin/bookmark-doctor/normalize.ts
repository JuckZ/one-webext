import type {
  BookmarkTreeDiagnostic,
  BookmarkTreeNormalizationResult,
  BookmarkUrlClassification,
  NormalizedBookmarkEntry,
} from './contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nonEmptyString(value: unknown) {
  if (typeof value !== 'string')
    return null
  const normalized = value.trim()
  return normalized || null
}

function stableHash(value: string) {
  let hash = 0x811C9DC5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createStableBookmarkEntryId(bookmarkId: string | null, treePath: readonly number[]) {
  return bookmarkId
    ? `bookmark:${encodeURIComponent(bookmarkId)}`
    : `synthetic:${stableHash(treePath.join('.'))}`
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

export function classifyBookmarkUrl(value: unknown): BookmarkUrlClassification {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return { eligibility: 'unscannable', reason: 'missing', normalizedUrl: null }
  }
  if (typeof value !== 'string')
    return { eligibility: 'unscannable', reason: 'invalid', normalizedUrl: null }

  let parsed: URL
  try {
    parsed = new URL(value.trim())
  }
  catch {
    return { eligibility: 'unscannable', reason: 'invalid', normalizedUrl: null }
  }

  if (isLoopbackHostname(parsed.hostname))
    return { eligibility: 'scannable', reason: 'loopback', normalizedUrl: parsed.href }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return {
      eligibility: 'scannable',
      reason: parsed.protocol === 'https:' ? 'https' : 'http',
      normalizedUrl: parsed.href,
    }
  }
  if (parsed.protocol === 'file:')
    return { eligibility: 'unscannable', reason: 'local-resource', normalizedUrl: parsed.href }
  if (['about:', 'brave:', 'chrome:', 'chrome-extension:', 'edge:', 'moz-extension:', 'opera:', 'vivaldi:'].includes(parsed.protocol)) {
    return { eligibility: 'unscannable', reason: 'browser-internal', normalizedUrl: parsed.href }
  }
  return { eligibility: 'unscannable', reason: 'unsupported-scheme', normalizedUrl: parsed.href }
}

function normalizedDateAdded(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function addDiagnostic(
  diagnostics: BookmarkTreeDiagnostic[],
  code: BookmarkTreeDiagnostic['code'],
  treePath: readonly number[],
  bookmarkId: string | null,
) {
  diagnostics.push({ code, treePath: [...treePath], bookmarkId })
}

export function normalizeBookmarkTree(value: unknown): BookmarkTreeNormalizationResult {
  const entries: NormalizedBookmarkEntry[] = []
  const diagnostics: BookmarkTreeDiagnostic[] = []
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, 'invalid-tree', [], null)
    return { valid: false, entries, diagnostics }
  }

  const activeNodes = new Set<object>()
  const seenNodeIds = new Set<string>()

  function visit(rawNode: unknown, treePath: number[], folderPath: string[]) {
    if (!isRecord(rawNode)) {
      addDiagnostic(diagnostics, 'malformed-node', treePath, null)
      return
    }
    if (activeNodes.has(rawNode)) {
      addDiagnostic(diagnostics, 'cyclic-node', treePath, nonEmptyString(rawNode.id))
      return
    }
    activeNodes.add(rawNode)

    const bookmarkId = nonEmptyString(rawNode.id)
    const parentId = nonEmptyString(rawNode.parentId)
    const title = typeof rawNode.title === 'string' ? rawNode.title.trim() : ''
    if (!bookmarkId || (rawNode.title !== undefined && typeof rawNode.title !== 'string'))
      addDiagnostic(diagnostics, 'malformed-node', treePath, bookmarkId)

    const duplicateId = Boolean(bookmarkId && seenNodeIds.has(bookmarkId))
    if (bookmarkId) {
      if (duplicateId)
        addDiagnostic(diagnostics, 'duplicate-node-id', treePath, bookmarkId)
      else
        seenNodeIds.add(bookmarkId)
    }

    const hasUrl = Object.hasOwn(rawNode, 'url')
    if (hasUrl) {
      const urlClassification = classifyBookmarkUrl(rawNode.url)
      const rawUrl = typeof rawNode.url === 'string' ? rawNode.url.trim() || null : null
      const baseEntryId = createStableBookmarkEntryId(bookmarkId, treePath)
      entries.push({
        entryId: duplicateId ? `${baseEntryId}:duplicate:${stableHash(treePath.join('.'))}` : baseEntryId,
        bookmarkId,
        parentId,
        title,
        url: urlClassification.normalizedUrl || rawUrl,
        folderPath: [...folderPath],
        treePath: [...treePath],
        dateAdded: normalizedDateAdded(rawNode.dateAdded),
        urlClassification,
      })
      if (typeof rawNode.url !== 'string')
        addDiagnostic(diagnostics, 'malformed-node', treePath, bookmarkId)
    }

    let children: unknown[] | null = null
    if (Object.hasOwn(rawNode, 'children')) {
      if (Array.isArray(rawNode.children))
        children = rawNode.children
      else
        addDiagnostic(diagnostics, 'invalid-children', treePath, bookmarkId)
    }
    if (children) {
      const childFolderPath = title ? [...folderPath, title] : folderPath
      children.forEach((child, index) => visit(child, [...treePath, index], childFolderPath))
    }
    activeNodes.delete(rawNode)
  }

  value.forEach((node, index) => visit(node, [index], []))
  return { valid: true, entries, diagnostics }
}
