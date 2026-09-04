import type { InstalledModuleRecord } from '../../../types'
import {
  collectSendToOpenListTopFrameCandidates,
  SendToOpenListDiscoveryController,
} from '../discovery'
import { createSendToOpenListSeed } from '../manifest'

function record(enabled = true, installedAt = '2026-09-04T00:00:00.000Z'): InstalledModuleRecord {
  return {
    manifest: createSendToOpenListSeed().manifest,
    enabled,
    source: 'seeded',
    grantedContexts: [],
    grantedContextFields: {},
    grantedCapabilities: [],
    update: null,
    installedAt,
    updatedAt: installedAt,
  }
}

function harness() {
  let installed = record()
  const tabs = {
    query: vi.fn(async (): Promise<Array<{ id?: number, url?: string, title?: string, incognito?: boolean }>> => [{
      id: 7,
      url: 'https://page.example/path?sig=a%2Bb#fragment',
      title: '<img data-title-xss src=x>',
    }]),
  }
  const scripting = {
    executeScript: vi.fn(async () => [{
      frameId: 0,
      result: [
        { url: 'https://cdn.example/signed?x=a%2Bb#drop', title: '<script>text only</script>' },
        { url: 'https://cdn.example/signed?x=a%2Bb#duplicate' },
        { url: 'javascript:alert(1)' },
        { url: 'http://127.1/private' },
      ],
    }]),
  }
  const controller = new SendToOpenListDiscoveryController({
    registry: { get: vi.fn(async () => structuredClone(installed)) },
    tabs,
    scripting,
    now: () => '2026-09-04T00:01:00.000Z',
  })
  return { controller, scripting, tabs, setRecord: (value: InstalledModuleRecord) => installed = value }
}

describe('send to OpenList explicit browser discovery', () => {
  it('captures only the active page as a normalized review candidate', async () => {
    const { controller } = harness()
    await expect(controller.captureCurrentPage()).resolves.toMatchObject({
      ok: true,
      value: {
        candidates: [{
          url: 'https://page.example/path?sig=a%2Bb',
          source: 'current-page',
          title: '<img data-title-xss src=x>',
        }],
      },
    })
  })

  it('runs one fixed top-frame injection and retains local-use candidates only for review', async () => {
    const { controller, scripting } = harness()
    const result = await controller.scanCurrentPage()
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [0] },
      func: collectSendToOpenListTopFrameCandidates,
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        rejectedCount: 1,
        candidates: [
          { url: 'https://cdn.example/signed?x=a%2Bb', source: 'page-scan' },
          { url: 'http://127.1/private', source: 'page-scan' },
        ],
      },
    })
  })

  it('keeps existing candidates unchanged after a failed injection or empty hostile result', async () => {
    const { controller, scripting } = harness()
    await controller.captureCurrentPage()
    scripting.executeScript.mockRejectedValueOnce(new Error('blocked'))
    await expect(controller.scanCurrentPage()).resolves.toEqual({ ok: false, reason: 'page-scan-failed' })
    const before = await controller.status()
    scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, result: [{ url: 'data:text/plain,no' }] }])
    await expect(controller.scanCurrentPage()).resolves.toEqual({ ok: false, reason: 'discovery-empty' })
    await expect(controller.status()).resolves.toEqual(before)
  })

  it('rejects incognito, missing and disabled authority without injecting', async () => {
    const { controller, scripting, tabs, setRecord } = harness()
    tabs.query.mockResolvedValueOnce([{ id: 7, url: 'https://private.example', incognito: true }])
    await expect(controller.captureCurrentPage()).resolves.toEqual({ ok: false, reason: 'active-tab-unavailable' })
    setRecord(record(false))
    await expect(controller.scanCurrentPage()).resolves.toEqual({ ok: false, reason: 'module-disabled' })
    expect(scripting.executeScript).not.toHaveBeenCalled()
  })

  it('clears transient authority on disable or reinstall and isolates immutable snapshots', async () => {
    const { controller } = harness()
    const captured = await controller.captureCurrentPage()
    if (!captured.ok)
      throw new Error(captured.reason)
    const mutated = captured.value as unknown as { candidates: Array<{ url: string }> }
    expect(() => mutated.candidates[0]!.url = 'https://evil.example').not.toThrow()
    expect((await controller.status())).toMatchObject({
      ok: true,
      value: { candidates: [{ url: 'https://page.example/path?sig=a%2Bb' }] },
    })
    controller.handleInstalledRecordChanged(record(false))
    controller.handleInstalledRecordChanged(record(true, 'reinstalled'))
    await expect(controller.status()).resolves.toMatchObject({ ok: true, value: { candidates: [] } })
  })

  it('extracts fixed URL-bearing elements without evaluating page code', () => {
    document.body.innerHTML = [
      '<a href="https://cdn.example/a?sig=x%2By#part" title="download">A</a>',
      '<img src="https://cdn.example/image.png" alt="image">',
      '<audio src="https://cdn.example/audio.mp3"></audio>',
      '<iframe srcdoc="<a href=https://child.example/>child</a>"></iframe>',
    ].join('')
    const values = collectSendToOpenListTopFrameCandidates()
    expect(values).toEqual(expect.arrayContaining([
      { url: 'https://cdn.example/a?sig=x%2By#part', title: 'download' },
      { url: 'https://cdn.example/image.png', title: 'image' },
      { url: 'https://cdn.example/audio.mp3' },
    ]))
    expect(JSON.stringify(values)).not.toContain('child.example')
  })
})
