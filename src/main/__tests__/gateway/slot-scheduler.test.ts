import { describe, it, expect } from 'vitest'
import { SlotScheduler } from '../../gateway/slot-scheduler'

describe('SlotScheduler', () => {
  it('normal 槽位封顶在 concurrency', async () => {
    const s = new SlotScheduler({ concurrency: 2 })
    const r1 = await s.acquire('normal')
    const r2 = await s.acquire('normal')
    expect(s.active.normal).toBe(2)

    let thirdGot = false
    const p = s.acquire('normal').then((r) => { thirdGot = true; return r })
    await new Promise((r) => setTimeout(r, 10))
    expect(thirdGot).toBe(false)   // 被挡住

    r1()
    const r3 = await p
    expect(thirdGot).toBe(true)
    r2(); r3()
  })

  it('normal 满了，human 仍能立刻拿到', async () => {
    const s = new SlotScheduler({ concurrency: 1 })
    const r1 = await s.acquire('normal')
    const rh = await s.acquire('human')   // 不该等
    expect(s.active.human).toBe(1)
    r1(); rh()
  })

  it('human 同时只允许一个', async () => {
    const s = new SlotScheduler({ concurrency: 1 })
    const rh = await s.acquire('human')
    let secondGot = false
    const p = s.acquire('human').then((r) => { secondGot = true; return r })
    await new Promise((r) => setTimeout(r, 10))
    expect(secondGot).toBe(false)
    rh()
    const rh2 = await p
    expect(secondGot).toBe(true)
    rh2()
  })

  it('重复 release 不会凭空放大容量', async () => {
    const s = new SlotScheduler({ concurrency: 1 })
    const r1 = await s.acquire('normal')
    r1()
    r1()   // 第二次调用必须无效
    const a = await s.acquire('normal')
    let thirdGot = false
    const p = s.acquire('normal').then((r) => { thirdGot = true; return r })
    await new Promise((r) => setTimeout(r, 10))
    expect(thirdGot).toBe(false)   // 容量仍是 1
    a()
  })

  it('human 等待者先于 normal 等待者被叫醒', async () => {
    const s = new SlotScheduler({ concurrency: 1 })
    const r1 = await s.acquire('normal')
    const order: string[] = []
    const pHuman = s.acquire('human').then((r) => { order.push('human'); return r })
    const pNormal = s.acquire('normal').then((r) => { order.push('normal'); return r })

    // 释放一个 normal：同时空出一个 normal 槽位和一个 human 槽位，
    // 两个等待者都会被叫醒 —— 这里断言的是**顺序**，不是"只有 human 拿到"。
    r1()
    const rh = await pHuman
    expect(order[0]).toBe('human')

    rh()
    const rn = await pNormal
    expect(order).toEqual(['human', 'normal'])
    rn()
  })

  it('normal 满且没有空位时，normal 等待者不会被这次释放误放行', async () => {
    // concurrency=2，先占满两个 normal，再排第三个 normal 和一个人
    const s = new SlotScheduler({ concurrency: 2 })
    const a = await s.acquire('normal')
    const b = await s.acquire('normal')
    let normalGot = false
    const pNormal = s.acquire('normal').then((r) => { normalGot = true; return r })
    const rh = await s.acquire('human')

    await new Promise((r) => setTimeout(r, 10))
    expect(normalGot).toBe(false)   // 两个 normal 都还占着

    rh()                            // 只释放 human，不影响 normal 容量
    await new Promise((r) => setTimeout(r, 10))
    expect(normalGot).toBe(false)

    a()                             // 这时才空出 normal
    const rn = await pNormal
    expect(normalGot).toBe(true)
    b(); rn()
  })
})
