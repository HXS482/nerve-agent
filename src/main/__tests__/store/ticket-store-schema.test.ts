import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { TicketStore } from '../../store/ticket-store'

describe('ticket schema', () => {
  let dir: string, store: TicketStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tk-')); store = TicketStore.open(join(dir, 't.db')) })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

  const base = {
    id: 't1', title: 'first', cwd: '/p', sessionId: 's1',
    threadKey: 'tg:chat:42', stage: 'queued' as const,
    createdAt: 1, lastActiveAt: 1,
  }

  it('建出三张表', () => {
    const names = (store.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ticket','assignment','input')",
    ) as Array<{ name: string }>).map((r) => r.name).sort()
    expect(names).toEqual(['assignment', 'input', 'ticket'])
  })

  it('按 threadKey 找未结束的 Ticket', () => {
    store.insertTicket(base)
    expect(store.findTicketByThread('tg:chat:42')?.id).toBe('t1')
  })

  it('已结束的 Ticket 不再被 threadKey 命中', () => {
    store.insertTicket(base)
    store.endTicket('t1', 2)
    expect(store.findTicketByThread('tg:chat:42')).toBeUndefined()
  })

  it('更新阶段与活跃时间', () => {
    store.insertTicket(base)
    store.updateTicketStage('t1', 'working', 5)
    const t = store.getTicket('t1')!
    expect(t.stage).toBe('working')
    expect(t.lastActiveAt).toBe(5)
  })

  it('latestAssignment 只返回最新一条', () => {
    store.insertTicket(base)
    store.insertAssignment({ id: 'a1', ticketId: 't1', status: 'ended', createdAt: 1 })
    store.insertAssignment({ id: 'a2', ticketId: 't1', status: 'running', createdAt: 2 })
    expect(store.latestAssignment('t1')!.id).toBe('a2')
  })

  it('listTickets 默认不含已结束的', () => {
    store.insertTicket(base)
    store.insertTicket({ ...base, id: 't2', threadKey: 'tg:chat:43' })
    store.endTicket('t2', 3)
    expect(store.listTickets().map((t) => t.id)).toEqual(['t1'])
    expect(store.listTickets({ includeEnded: true })).toHaveLength(2)
  })

  it('重启恢复：running 的 Assignment 退回 pending，Ticket 回到 queued', () => {
    store.insertTicket({ ...base, stage: 'working' })
    store.insertAssignment({ id: 'a1', ticketId: 't1', status: 'running', createdAt: 1 })

    const n = store.recoverRunningAssignments(123)

    expect(n).toBe(1)
    expect(store.latestAssignment('t1')!.status).toBe('pending')
    expect(store.getTicket('t1')!.stage).toBe('queued')
  })

  it('恢复不会碰已结束的 Assignment', () => {
    store.insertTicket(base)
    store.insertAssignment({ id: 'a1', ticketId: 't1', status: 'ended', createdAt: 1 })
    expect(store.recoverRunningAssignments(123)).toBe(0)
  })

  it('Input 序号按 ticket 单调递增，互不串号', () => {
    store.insertTicket(base)
    store.insertTicket({ ...base, id: 't2', threadKey: 'k2' })
    expect(store.nextInputSeq('t1')).toBe(1)
    store.insertInput({ id: 'i1', ticketId: 't1', kind: 'human', body: 'a', seq: 1 })
    expect(store.nextInputSeq('t1')).toBe(2)
    expect(store.nextInputSeq('t2')).toBe(1)   // 另一个 ticket 不受影响
  })

  it('pendingInputCount 反映未投递数量', () => {
    store.insertTicket(base)
    store.insertInput({ id: 'i1', ticketId: 't1', kind: 'human', body: 'a', seq: 1 })
    store.insertInput({ id: 'i2', ticketId: 't1', kind: 'human', body: 'b', seq: 2 })
    expect(store.pendingInputCount('t1')).toBe(2)
    store.markInputDelivered('i1', 99)
    expect(store.pendingInputCount('t1')).toBe(1)
  })

  it('升级兼容：已有库（只有 effect 表）能被 open 补齐新表', () => {
    store.close()
    // 模拟旧版本留下的库：删掉新表，只留 effect
    const p = join(dir, 't.db')
    const probe = TicketStore.open(p)
    probe.rawExec('DROP TABLE ticket')
    probe.rawExec('DROP TABLE assignment')
    probe.rawExec('DROP TABLE input')
    probe.close()

    const reopened = TicketStore.open(p)
    const names = (reopened.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ticket','assignment','input')",
    ) as Array<{ name: string }>).map((r) => r.name).sort()
    expect(names).toEqual(['assignment', 'input', 'ticket'])
    reopened.close()
    store = TicketStore.open(join(dir, 'x.db'))   // 给 afterEach 一个可关闭的实例
  })
})
