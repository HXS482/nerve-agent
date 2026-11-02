import { describe, it, expect, vi } from 'vitest'
import { createQuitDrain } from '../quit-drain'

// before-quit 里的异步监听器拦不住 Electron：不 preventDefault() + 自己 quit()，
// 那些 await 等于没跑，mid-turn 退出就会让整个 turn 在下次启动被重放。
describe('createQuitDrain — 退出前排空', () => {
  const makeEvent = () => {
    let prevented = false
    return {
      event: { preventDefault: () => { prevented = true } },
      get prevented() { return prevented },
    }
  }

  it('blocks the quit, runs teardown, then quits once', async () => {
    const order: string[] = []
    const quit = vi.fn(() => order.push('quit'))
    const drain = createQuitDrain({
      quit,
      teardown: async () => { order.push('teardown') },
    })

    const e = makeEvent()
    drain.handler(e.event)
    // 同步：必须已经拦住这一次退出（否则 Electron 当场就走）
    expect(e.prevented).toBe(true)
    expect(quit).not.toHaveBeenCalled()

    await drain.whenSettled()
    expect(order).toEqual(['teardown', 'quit'])
    expect(quit).toHaveBeenCalledTimes(1)
    expect(drain.isFinished()).toBe(true)
  })

  it('calls preventDefault synchronously before any await', () => {
    const quit = vi.fn()
    const drain = createQuitDrain({ quit, teardown: () => new Promise<void>(() => {}) })
    const e = makeEvent()
    drain.handler(e.event)
    expect(e.prevented).toBe(true)
    expect(quit).not.toHaveBeenCalled()
  })

  it('does not re-run teardown or preventDefault when the re-entrant quit arrives', async () => {
    const quit = vi.fn()
    const teardown = vi.fn(async () => {})
    const drain = createQuitDrain({ quit, teardown })

    const first = makeEvent()
    drain.handler(first.event)
    await drain.whenSettled()

    // app.quit() 会再次触发 before-quit：这一次必须直接放行，不能再拦、更不能重复收尾
    const second = makeEvent()
    drain.handler(second.event)
    expect(second.prevented).toBe(false)
    expect(teardown).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('ignores a second quit request that lands while the first drain is running', async () => {
    let release!: () => void
    const quit = vi.fn()
    const teardown = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const drain = createQuitDrain({ quit, teardown })

    const a = makeEvent()
    const b = makeEvent()
    drain.handler(a.event)
    drain.handler(b.event) // 收尾还没完，用户又点了退出
    expect(b.prevented).toBe(true) // 仍然要拦住，但不再起第二轮
    expect(teardown).toHaveBeenCalledTimes(1)

    release()
    await drain.whenSettled()
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('quits anyway when teardown throws', async () => {
    const quit = vi.fn()
    const warn = vi.fn()
    const drain = createQuitDrain({
      quit,
      teardown: async () => { throw new Error('gateway exploded') },
      warn,
    })

    drain.handler(makeEvent().event)
    await drain.whenSettled()

    // 收尾失败不能让用户关不掉 app
    expect(quit).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    expect(drain.isFinished()).toBe(true)
  })

  it('quits anyway when teardown never settles (bounded wait)', async () => {
    vi.useFakeTimers()
    try {
      const quit = vi.fn()
      const warn = vi.fn()
      const drain = createQuitDrain({
        quit,
        teardown: () => new Promise<void>(() => {}), // 永不返回
        timeoutMs: 50,
        warn,
      })

      drain.handler(makeEvent().event)
      expect(quit).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(60)
      await drain.whenSettled()

      expect(quit).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not finish'))
    } finally {
      vi.useRealTimers()
    }
  })
})
