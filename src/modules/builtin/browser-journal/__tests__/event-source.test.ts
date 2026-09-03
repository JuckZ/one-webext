import type { BrowserJournalObservation } from '../contracts'
import { createBrowserJournalTabEventSource } from '../event-source'

function browserEvent<T extends (..._args: any[]) => void>() {
  const listeners = new Set<T>()
  return {
    addListener: vi.fn((listener: T) => listeners.add(listener)),
    removeListener: vi.fn((listener: T) => listeners.delete(listener)),
    emit: (...args: Parameters<T>) => [...listeners].forEach(listener => listener(...args)),
    get size() { return listeners.size },
  }
}

describe('browser journal tab event source', () => {
  it('owns listeners only while active and projects browser tabs through a narrow shape', async () => {
    const onActivated = browserEvent<(_info: { tabId: number, windowId: number }) => void>()
    const onUpdated = browserEvent<(
      _tabId: number,
      _change: { status?: string, title?: string, url?: string },
      _tab: { active?: boolean, windowId?: number, incognito?: boolean, title?: string, url?: string },
    ) => void>()
    const tabs = {
      onActivated,
      onUpdated,
      get: vi.fn(async () => ({
        active: true,
        windowId: 2,
        incognito: false,
        title: 'Activated',
        url: 'https://activated.example/',
      })),
    }
    const events: BrowserJournalObservation[] = []
    const source = createBrowserJournalTabEventSource(tabs, () => '2026-08-29T08:00:00.000Z')
    source.start(event => events.push(event))
    expect(onActivated.size).toBe(1)
    expect(onUpdated.size).toBe(1)

    onActivated.emit({ tabId: 7, windowId: 2 })
    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toMatchObject({ kind: 'activation', tabId: 7, title: 'Activated' })

    onUpdated.emit(8, { status: 'loading' }, { active: true, windowId: 2, url: 'https://ignored.example/' })
    onUpdated.emit(8, { url: 'https://navigated.example/' }, {
      active: true,
      windowId: 2,
      incognito: false,
      title: 'Navigated',
      url: 'https://navigated.example/',
    })
    onUpdated.emit(9, { url: 'https://background.example/' }, {
      active: false,
      windowId: 2,
      url: 'https://background.example/',
    })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ kind: 'navigation', tabId: 8, title: 'Navigated' })

    source.stop()
    expect(onActivated.size).toBe(0)
    expect(onUpdated.size).toBe(0)
  })
})
