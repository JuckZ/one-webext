import { BuiltinExactOriginUsageCoordinator } from '../origin-usage'

describe('builtin exact-origin usage coordinator', () => {
  it('queries only other registered owners', async () => {
    const coordinator = new BuiltinExactOriginUsageCoordinator()
    const bookmark = vi.fn(() => true)
    const clash = vi.fn(() => true)
    coordinator.register('bookmark-doctor', bookmark)
    coordinator.register('clash-control', clash)

    await expect(coordinator.usedByAnother('clash-control', 'http://127.0.0.1:9090/*')).resolves.toBe(true)
    expect(bookmark).toHaveBeenCalledOnce()
    expect(clash).not.toHaveBeenCalled()
  })

  it('supports unregister and rejects duplicate owners', async () => {
    const coordinator = new BuiltinExactOriginUsageCoordinator()
    const unregister = coordinator.register('clash-control', () => true)
    expect(() => coordinator.register('clash-control', () => false)).toThrow(TypeError)
    unregister()
    await expect(coordinator.usedByAnother('bookmark-doctor', 'http://localhost:9090/*')).resolves.toBe(false)
  })
})
