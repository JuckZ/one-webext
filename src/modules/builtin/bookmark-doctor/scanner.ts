import type {
  BookmarkScanResult,
  BookmarkScanSnapshot,
  BookmarkUrlProbeResult,
  NormalizedBookmarkEntry,
} from './contracts'
import {
  BOOKMARK_DOCTOR_PROBE_TIMEOUT_MS,
  BOOKMARK_DOCTOR_SCAN_CONCURRENCY,
} from './contracts'

export interface BookmarkDoctorProbe {
  probe: (_url: string, _signal: AbortSignal, _timeoutMs?: number) => Promise<BookmarkUrlProbeResult>
}

export interface BookmarkScanCoordinatorOptions {
  probe: BookmarkDoctorProbe
  concurrency?: number
  timeoutMs?: number
  now?: () => string
  createRunId?: () => string
}

interface ActiveRun {
  generation: number
  controller: AbortController
  snapshot: BookmarkScanSnapshot
}

function copySnapshot(snapshot: BookmarkScanSnapshot): BookmarkScanSnapshot {
  return structuredClone(snapshot)
}

function scannableEntries(entries: NormalizedBookmarkEntry[]) {
  return entries.filter((entry): entry is NormalizedBookmarkEntry & { urlClassification: { normalizedUrl: string } } => (
    entry.urlClassification.eligibility === 'scannable'
    && typeof entry.urlClassification.normalizedUrl === 'string'
  ))
}

export class BookmarkScanCoordinator {
  private readonly probe: BookmarkDoctorProbe
  private readonly concurrency: number
  private readonly timeoutMs: number
  private readonly now: () => string
  private readonly createRunId: () => string
  private generation = 0
  private active: ActiveRun | null = null
  private latest: BookmarkScanSnapshot | null = null

  constructor({
    probe,
    concurrency = BOOKMARK_DOCTOR_SCAN_CONCURRENCY,
    timeoutMs = BOOKMARK_DOCTOR_PROBE_TIMEOUT_MS,
    now = () => new Date().toISOString(),
    createRunId = () => crypto.randomUUID(),
  }: BookmarkScanCoordinatorOptions) {
    this.probe = probe
    this.concurrency = concurrency
    this.timeoutMs = timeoutMs
    this.now = now
    this.createRunId = createRunId
  }

  getSnapshot() {
    return this.latest ? copySnapshot(this.latest) : null
  }

  isScanning() {
    return this.latest?.status === 'scanning'
  }

  async start(entries: NormalizedBookmarkEntry[]) {
    if (this.isScanning())
      throw new Error('scan-active')

    const queue = scannableEntries(entries)
    const generation = ++this.generation
    const snapshot: BookmarkScanSnapshot = {
      runId: this.createRunId(),
      status: 'scanning',
      total: queue.length,
      completed: 0,
      results: [],
      startedAt: this.now(),
      completedAt: null,
    }
    const run: ActiveRun = {
      generation,
      controller: new AbortController(),
      snapshot,
    }
    this.active = run
    this.latest = snapshot

    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < queue.length) {
        const entry = queue[nextIndex++]
        const outcome = await this.probe.probe(
          entry.urlClassification.normalizedUrl,
          run.controller.signal,
          this.timeoutMs,
        )
        if (this.generation !== generation || snapshot.status !== 'scanning')
          return
        const result: BookmarkScanResult = {
          entryId: entry.entryId,
          bookmarkId: entry.bookmarkId,
          parentId: entry.parentId,
          index: Number.isSafeInteger(entry.treePath.at(-1)) ? entry.treePath.at(-1)! : null,
          title: entry.title,
          url: entry.urlClassification.normalizedUrl,
          folderPath: [...entry.folderPath],
          ...outcome,
        }
        snapshot.results.push(result)
        snapshot.completed = snapshot.results.length
      }
    }

    await Promise.all(Array.from(
      { length: Math.min(this.concurrency, queue.length) },
      () => worker(),
    ))
    if (this.generation === generation && snapshot.status === 'scanning') {
      snapshot.status = 'completed'
      snapshot.completedAt = this.now()
      this.active = null
    }
    return copySnapshot(snapshot)
  }

  stop() {
    const run = this.active
    if (!run || run.snapshot.status !== 'scanning')
      return false
    run.snapshot.status = 'stopped'
    run.snapshot.completedAt = this.now()
    run.controller.abort()
    this.active = null
    this.generation += 1
    return true
  }
}
