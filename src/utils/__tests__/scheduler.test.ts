import { describe, expect, it } from 'vitest'
import Scheduler from '../scheduler'

describe('scheduler', () => {
  it('limits concurrent async work and drains queued tasks', async () => {
    const scheduler = new Scheduler(2)
    const active: number[] = []
    const observed: number[] = []

    const jobs = Array.from({ length: 5 }, (_, index) => scheduler.add(async () => {
      active.push(index)
      observed.push(active.length)
      await Promise.resolve()
      active.splice(active.indexOf(index), 1)
      return index
    }))

    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3, 4])
    expect(Math.max(...observed)).toBeLessThanOrEqual(2)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('clears pending work', async () => {
    const scheduler = new Scheduler(1)
    const blocker = scheduler.add(() => new Promise(resolve => setTimeout(resolve, 10)))
    void scheduler.add(async () => 'queued')

    expect(scheduler.pendingCount).toBe(1)
    scheduler.clear()
    expect(scheduler.pendingCount).toBe(0)
    await blocker
  })
})
