import { describe, it, expect } from 'vitest'
import { computeStage } from '../../gateway/ticket-stage'

const A = (status: 'pending' | 'running' | 'ended') =>
  ({ id: 'a', ticketId: 't', status, createdAt: 1 })

describe('computeStage', () => {
  it('投递失败优先于一切', () => {
    expect(computeStage({ deliveryFailed: true, hasAttention: true })).toBe('delivery')
  })

  it('待回答优先于待验收', () => {
    expect(computeStage({ hasAttention: true, lastReport: 'ready' })).toBe('answer')
  })

  it('ready 报告进 review', () => {
    expect(computeStage({ lastReport: 'ready' })).toBe('review')
  })

  it('blocked 只在无人发言时成立', () => {
    expect(computeStage({ lastReport: 'blocked', humanMessageSinceReport: false })).toBe('blocked')
    expect(computeStage({ lastReport: 'failed', humanMessageSinceReport: false })).toBe('blocked')
  })

  it('人发言后 blocked 解冻，退回 queued 等下一次执行', () => {
    // 解冻只是"不再是 blocked"，并不等于"正在跑"。
    // 没有 Assignment 的话它应该排队等槽位，而不是假装在工作。
    expect(computeStage({ lastReport: 'blocked', humanMessageSinceReport: true })).toBe('queued')
  })

  it('系统消息不解冻 blocked', () => {
    // CI 重跑一次就把 blocked 冲掉的话，界面会显示"正常工作"，人永远发现不了问题
    expect(computeStage({ lastReport: 'blocked', humanMessageSinceReport: false })).toBe('blocked')
  })

  it('没有 Assignment 时是 queued', () => {
    expect(computeStage({})).toBe('queued')
  })

  it('pending Assignment 是 queued', () => {
    expect(computeStage({ assignment: A('pending') })).toBe('queued')
  })

  it('waiting 报告是 idle', () => {
    expect(computeStage({ assignment: A('ended'), lastReport: 'waiting' })).toBe('idle')
  })

  it('running Assignment 是 working', () => {
    expect(computeStage({ assignment: A('running') })).toBe('working')
  })
})
