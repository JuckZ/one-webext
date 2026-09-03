import type {
  BookmarkNodeSnapshot,
  BookmarkRepairConfirmation,
  BookmarkRepairPlan,
  BookmarkRepairRequest,
  BookmarkTreeNodeInput,
} from './contracts'
import { BOOKMARK_DOCTOR_REPAIR_PLAN_TTL_MS } from './contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every(key => keys.includes(key))
}

function validId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function normalizeHttpUrl(value: string) {
  if (value.length > 2048)
    return null
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
      return null
    return url.href
  }
  catch {
    return null
  }
}

export function normalizeBookmarkRepairRequest(value: unknown): BookmarkRepairRequest | null {
  if (!isRecord(value) || !validId(value.bookmarkId) || typeof value.operation !== 'string')
    return null

  if (value.operation === 'update') {
    if (!hasOnlyKeys(value, ['operation', 'bookmarkId', 'changes']) || !isRecord(value.changes))
      return null
    const changes = value.changes
    if (!hasOnlyKeys(changes, ['title', 'url']))
      return null
    const normalized: { title?: string, url?: string } = {}
    if (Object.hasOwn(changes, 'title')) {
      if (typeof changes.title !== 'string' || changes.title.length > 255)
        return null
      normalized.title = changes.title
    }
    if (Object.hasOwn(changes, 'url')) {
      if (typeof changes.url !== 'string')
        return null
      const url = normalizeHttpUrl(changes.url)
      if (!url)
        return null
      normalized.url = url
    }
    if (!Object.keys(normalized).length)
      return null
    return { operation: 'update', bookmarkId: value.bookmarkId as string, changes: normalized }
  }

  if (value.operation === 'move') {
    if (!hasOnlyKeys(value, ['operation', 'bookmarkId', 'destination']) || !isRecord(value.destination))
      return null
    const destination = value.destination
    if (!hasOnlyKeys(destination, ['parentId', 'index']) || !validId(destination.parentId))
      return null
    const normalized: { parentId: string, index?: number } = { parentId: destination.parentId as string }
    if (Object.hasOwn(destination, 'index')) {
      if (!Number.isSafeInteger(destination.index) || (destination.index as number) < 0)
        return null
      normalized.index = destination.index as number
    }
    return { operation: 'move', bookmarkId: value.bookmarkId as string, destination: normalized }
  }

  if ((value.operation === 'ignore' || value.operation === 'delete')
    && hasOnlyKeys(value, ['operation', 'bookmarkId'])) {
    return { operation: value.operation, bookmarkId: value.bookmarkId as string }
  }
  return null
}

export function createBookmarkNodeSnapshot(value: unknown): BookmarkNodeSnapshot | null {
  if (!isRecord(value)
    || !validId(value.id)
    || typeof value.title !== 'string'
    || typeof value.url !== 'string') {
    return null
  }
  return {
    bookmarkId: value.id as string,
    parentId: validId(value.parentId) ? value.parentId as string : null,
    index: Number.isSafeInteger(value.index) && (value.index as number) >= 0 ? value.index as number : null,
    title: value.title,
    url: value.url,
  }
}

export function readBookmarkNodeSnapshot(value: unknown): BookmarkNodeSnapshot | null {
  if (!Array.isArray(value) || value.length !== 1)
    return null
  return createBookmarkNodeSnapshot(value[0] as BookmarkTreeNodeInput)
}

export function bookmarkNodeSnapshotsEqual(left: BookmarkNodeSnapshot, right: BookmarkNodeSnapshot) {
  return left.bookmarkId === right.bookmarkId
    && left.parentId === right.parentId
    && left.index === right.index
    && left.title === right.title
    && left.url === right.url
}

export function createBookmarkRepairPlan(
  requestValue: unknown,
  before: BookmarkNodeSnapshot,
  token: string,
  createdAt: string,
  ttlMs = BOOKMARK_DOCTOR_REPAIR_PLAN_TTL_MS,
): BookmarkRepairPlan | null {
  const request = normalizeBookmarkRepairRequest(requestValue)
  const created = Date.parse(createdAt)
  if (!request
    || request.bookmarkId !== before.bookmarkId
    || !validId(token)
    || !Number.isFinite(created)
    || !Number.isSafeInteger(ttlMs)
    || ttlMs <= 0) {
    return null
  }
  const common = {
    token,
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(created + ttlMs).toISOString(),
    before: structuredClone(before),
  }
  if (request.operation === 'update') {
    const proposed = { ...request.changes }
    if ((proposed.title === undefined || proposed.title === before.title)
      && (proposed.url === undefined || proposed.url === before.url)) {
      return null
    }
    return { ...common, operation: 'update', proposed, confirmation: 'reviewed' }
  }
  if (request.operation === 'move') {
    if (request.destination.parentId === before.parentId
      && (request.destination.index === undefined || request.destination.index === before.index)) {
      return null
    }
    return { ...common, operation: 'move', proposed: { ...request.destination }, confirmation: 'reviewed' }
  }
  if (request.operation === 'ignore')
    return { ...common, operation: 'ignore', proposed: { ignored: true }, confirmation: 'reviewed' }
  return { ...common, operation: 'delete', proposed: { deleted: true }, confirmation: 'delete-confirmed' }
}

export function isBookmarkRepairPlanExpired(plan: Pick<BookmarkRepairPlan, 'expiresAt'>, now: string) {
  const nowTimestamp = Date.parse(now)
  const expiresAt = Date.parse(plan.expiresAt)
  return !Number.isFinite(nowTimestamp) || !Number.isFinite(expiresAt) || nowTimestamp >= expiresAt
}

export function isBookmarkRepairConfirmationValid(
  plan: BookmarkRepairPlan,
  confirmation: BookmarkRepairConfirmation,
) {
  return confirmation.token === plan.token && confirmation.confirmation === plan.confirmation
}
