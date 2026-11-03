import { describe, it, expect } from 'vitest'
import { deriveThreadKey } from '../../gateway/thread-key'

describe('deriveThreadKey', () => {
  it('telegram 私聊按 chatId', () => {
    expect(deriveThreadKey({ platform: 'telegram', chatId: '42' })).toBe('tg:chat:42')
  })

  it('telegram 话题再细分', () => {
    expect(deriveThreadKey({ platform: 'telegram', chatId: '42', topicId: '7' }))
      .toBe('tg:chat:42:topic:7')
  })

  it('discord 按 guild + channel', () => {
    expect(deriveThreadKey({ platform: 'discord', chatId: 'c1', guildId: 'g1' }))
      .toBe('dc:guild:g1:channel:c1')
  })

  it('本地界面按会话 id', () => {
    expect(deriveThreadKey({ platform: 'local', chatId: '', localSessionId: 's9' }))
      .toBe('local:s9')
  })

  it('同一 chat 的两次调用结果稳定（threadKey 是要落库的，不能抖）', () => {
    const a = deriveThreadKey({ platform: 'telegram', chatId: '42' })
    const b = deriveThreadKey({ platform: 'telegram', chatId: '42' })
    expect(a).toBe(b)
  })

  it('不同 chat 不会撞 key', () => {
    expect(deriveThreadKey({ platform: 'telegram', chatId: '1' }))
      .not.toBe(deriveThreadKey({ platform: 'telegram', chatId: '2' }))
  })
})
