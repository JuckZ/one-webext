import type {
  ResourceCandidateV1,
  SendToOpenListSubmissionStateV1,
  SendToOpenListTaskSnapshotV1,
} from '~/modules/builtin/send-to-openlist'
import {
  classifyResourceCandidateSsr,
  normalizeResourceCandidateList,
} from '~/modules/builtin/send-to-openlist'

export interface ManualCandidateDraft {
  readonly candidates: readonly ResourceCandidateV1[]
  readonly error: string | null
}

export function parseManualResourceCandidates(input: unknown): ManualCandidateDraft {
  if (typeof input !== 'string')
    return { candidates: [], error: '请输入资源地址。' }
  const lines = input
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
  if (!lines.length)
    return { candidates: [], error: '每行输入一个 http、https、magnet 或 ed2k 地址。' }
  const normalized = normalizeResourceCandidateList(
    lines.map(url => ({ url, source: 'manual' })),
    'discovery',
  )
  if (!normalized.ok) {
    const messages: Record<string, string> = {
      'candidate-limit': '候选超过 200 条发现上限。',
      'candidate-bytes-limit': '候选总大小超过 512 KiB。',
      'url-limit': '至少一个 URL 超过 8 KiB。',
      'unsupported-scheme': '只接受 http、https、magnet 和 ed2k。',
      'credentials-forbidden': 'URL 不得包含用户名或密码。',
      'control-character': 'URL 包含空格或控制字符。',
    }
    return { candidates: [], error: messages[normalized.code] || '至少一个资源地址无效。' }
  }
  return { candidates: normalized.value, error: null }
}

export function mergePresentedResourceCandidates(
  current: readonly ResourceCandidateV1[],
  incoming: readonly ResourceCandidateV1[],
) {
  return normalizeResourceCandidateList([...current, ...incoming], 'discovery')
}

export function presentResourceCandidate(candidate: ResourceCandidateV1) {
  const ssrf = classifyResourceCandidateSsr(candidate)
  return {
    candidate,
    blocked: ssrf.decision === 'block-local-use',
    riskLabel: ssrf.decision === 'block-local-use'
      ? `已阻止本地/私网目标 · ${ssrf.risk}`
      : '提交后由 OpenList/AList 与其出站策略负责下载安全',
  }
}

export function presentSubmissionStatus(state: SendToOpenListSubmissionStateV1 | null) {
  if (!state)
    return []
  return state.entries.map(entry => ({
    id: entry.candidate.id,
    url: entry.candidate.url,
    status: entry.status,
    label: entry.status === 'accepted'
      ? `已受理${entry.taskId ? ` · ${entry.taskId}` : ' · 服务端未返回任务 ID'}`
      : entry.status === 'outcome-unknown'
        ? '结果未知；不会自动重试，请刷新服务端任务确认'
        : entry.status === 'failed'
          ? `失败 · ${entry.errorCode || 'unknown'}`
          : entry.status === 'cancelled'
            ? '已取消'
            : entry.status === 'in-flight'
              ? '提交中'
              : '等待提交',
  }))
}

export function presentTaskSnapshot(snapshot: SendToOpenListTaskSnapshotV1 | null) {
  if (!snapshot)
    return { label: '尚未手动刷新。', tasks: [] }
  return {
    label: `${snapshot.list === 'undone' ? '未完成' : '已完成'} · ${snapshot.tasks.length} 项 · ${snapshot.refreshedAt}`,
    tasks: snapshot.tasks.map(task => ({
      ...task,
      label: `${task.name || '未命名任务'} · ${task.status || `状态 ${task.state}`} · ${task.progress}%`,
    })),
  }
}
