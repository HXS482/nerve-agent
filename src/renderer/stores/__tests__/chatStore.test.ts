import { describe, it, expect } from 'vitest'
import { useChatStore } from '../../stores/chatStore'

// sessionModes 是会话工作区归属的权威持久化映射：
// sessions 列表会被 syncSessions 用远端数据重建，mode 不能只靠列表项携带。
describe('chatStore — sessionModes 权威映射', () => {
  it('addSession 带 mode 时同步记录映射', () => {
    useChatStore.getState().addSession({ id: 's1', title: 't', preview: '', createdAt: 1, updatedAt: 1, mode: 'stage' })
    expect(useChatStore.getState().sessionModes['s1']).toBe('stage')
  })

  it('addSession 无 mode 时不写映射', () => {
    useChatStore.getState().addSession({ id: 's2', title: 't', preview: '', createdAt: 1, updatedAt: 1 })
    expect(useChatStore.getState().sessionModes['s2']).toBeUndefined()
  })

  it('markSessionMode 补标/覆盖', () => {
    useChatStore.getState().markSessionMode('s2', 'stage')
    expect(useChatStore.getState().sessionModes['s2']).toBe('stage')
  })

  it('deleteSession 同时清理映射', () => {
    useChatStore.getState().deleteSession('s1')
    expect(useChatStore.getState().sessionModes['s1']).toBeUndefined()
    expect(useChatStore.getState().sessions.find((s) => s.id === 's1')).toBeUndefined()
  })
})
