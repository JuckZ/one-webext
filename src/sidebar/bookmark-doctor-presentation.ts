import type {
  BookmarkDoctorWorkspaceState,
  BookmarkProbeOutcome,
  BookmarkRepairPlan,
  BookmarkRepairRequest,
  BookmarkRestorePlan,
  BookmarkScanResult,
  BookmarkScanSnapshot,
} from '~/modules/builtin/bookmark-doctor'

const resultLabels: Record<BookmarkProbeOutcome, string> = {
  'reachable': '可访问',
  'http-error': 'HTTP 错误',
  'timeout': '超时',
  'network-failure': '网络失败',
}

export interface BookmarkDoctorScanPresentation {
  statusLabel: string
  progressLabel: string
  counts: Record<BookmarkProbeOutcome, number>
}

export function bookmarkProbeOutcomeLabel(outcome: BookmarkProbeOutcome) {
  return resultLabels[outcome]
}

export function presentBookmarkDoctorScan(snapshot: BookmarkScanSnapshot): BookmarkDoctorScanPresentation {
  const counts: Record<BookmarkProbeOutcome, number> = {
    'reachable': 0,
    'http-error': 0,
    'timeout': 0,
    'network-failure': 0,
  }
  for (const result of snapshot.results)
    counts[result.outcome] += 1
  return {
    statusLabel: snapshot.status === 'scanning'
      ? '扫描中'
      : snapshot.status === 'completed' ? '扫描完成' : '已停止',
    progressLabel: `${snapshot.completed} / ${snapshot.total}`,
    counts,
  }
}

const repairOperationLabels: Record<BookmarkRepairPlan['operation'], string> = {
  update: '更新标题或 URL',
  move: '移动书签',
  ignore: '忽略该书签',
  delete: '永久删除书签',
}

export interface BookmarkRepairPlanPresentation {
  operationLabel: string
  targetLabel: string
  beforeValues: string[]
  proposedValues: string[]
  destructive: boolean
  expiresAt: string
}

export function presentBookmarkRepairPlan(plan: BookmarkRepairPlan): BookmarkRepairPlanPresentation {
  const beforeValues = [
    `标题：${plan.before.title}`,
    `URL：${plan.before.url}`,
    `位置：${plan.before.parentId ?? '根目录'} / ${plan.before.index ?? '未知顺序'}`,
  ]
  let proposedValues: string[]
  if (plan.operation === 'update') {
    proposedValues = [
      ...(plan.proposed.title === undefined ? [] : [`新标题：${plan.proposed.title}`]),
      ...(plan.proposed.url === undefined ? [] : [`新 URL：${plan.proposed.url}`]),
    ]
  }
  else if (plan.operation === 'move') {
    proposedValues = [`新位置：${plan.proposed.parentId} / ${plan.proposed.index ?? '末尾'}`]
  }
  else if (plan.operation === 'ignore') {
    proposedValues = ['仅写入 Bookmark Doctor 本地忽略记录；不修改浏览器书签。']
  }
  else {
    proposedValues = ['删除前保存最小本地恢复记录，然后永久删除浏览器书签。']
  }
  return {
    operationLabel: repairOperationLabels[plan.operation],
    targetLabel: `书签 ${plan.before.bookmarkId}`,
    beforeValues,
    proposedValues,
    destructive: plan.operation === 'delete',
    expiresAt: plan.expiresAt,
  }
}

export type BookmarkDoctorResultFilter = 'problems' | 'all' | 'reachable'

export interface BookmarkDoctorWorkspacePresentation {
  visibleResults: BookmarkScanResult[]
  problemCount: number
  reachableCount: number
  ignoredCount: number
  backupCount: number
  emptyLabel: string
}

export function presentBookmarkDoctorWorkspace(
  snapshot: BookmarkScanSnapshot | null,
  state: BookmarkDoctorWorkspaceState,
  filter: BookmarkDoctorResultFilter,
): BookmarkDoctorWorkspacePresentation {
  const results = snapshot?.results || []
  const ignoredIds = new Set(state.ignoredBookmarks.map(entry => entry.bookmarkId))
  const activeResults = results.filter(result => !result.bookmarkId || !ignoredIds.has(result.bookmarkId))
  const problemCount = activeResults.filter(result => result.outcome !== 'reachable').length
  const reachableCount = activeResults.length - problemCount
  const visibleResults = activeResults.filter(result => (
    filter === 'all'
    || (filter === 'problems' && result.outcome !== 'reachable')
    || (filter === 'reachable' && result.outcome === 'reachable')
  ))
  const emptyLabel = !snapshot
    ? '尚未运行扫描'
    : snapshot.status === 'scanning'
      ? '等待首批结果…'
      : filter === 'problems'
        ? '当前结果中没有问题链接'
        : filter === 'reachable' ? '当前结果中没有可访问链接' : '本次扫描没有结果'
  return {
    visibleResults: structuredClone(visibleResults),
    problemCount,
    reachableCount,
    ignoredCount: state.ignoredBookmarks.length,
    backupCount: state.deletionBackups.length,
    emptyLabel,
  }
}

export interface BookmarkRepairDraft {
  operation: BookmarkRepairRequest['operation']
  bookmarkId: string
  title: string
  url: string
  parentId: string
  index: string
}

export function createBookmarkRepairDraft(
  result: BookmarkScanResult,
  operation: BookmarkRepairRequest['operation'],
): BookmarkRepairDraft | null {
  if (!result.bookmarkId)
    return null
  return {
    operation,
    bookmarkId: result.bookmarkId,
    title: operation === 'update' ? result.title : '',
    url: operation === 'update' ? result.url : '',
    parentId: '',
    index: '',
  }
}

export function bookmarkRepairRequestFromDraft(draft: BookmarkRepairDraft): BookmarkRepairRequest | null {
  if (draft.operation === 'update') {
    if (!draft.title && !draft.url)
      return null
    return {
      operation: 'update',
      bookmarkId: draft.bookmarkId,
      changes: {
        ...(draft.title ? { title: draft.title } : {}),
        ...(draft.url ? { url: draft.url } : {}),
      },
    }
  }
  if (draft.operation === 'move') {
    if (!draft.parentId || (draft.index && !/^\d+$/.test(draft.index)))
      return null
    return {
      operation: 'move',
      bookmarkId: draft.bookmarkId,
      destination: {
        parentId: draft.parentId,
        ...(draft.index ? { index: Number(draft.index) } : {}),
      },
    }
  }
  return { operation: draft.operation, bookmarkId: draft.bookmarkId }
}

export function presentBookmarkRestorePlan(plan: BookmarkRestorePlan) {
  return {
    title: plan.backup.title,
    url: plan.backup.url,
    destination: `${plan.backup.parentId ?? '原目录不可用'} / ${plan.backup.index ?? '末尾'}`,
    expiresAt: plan.expiresAt,
  }
}
