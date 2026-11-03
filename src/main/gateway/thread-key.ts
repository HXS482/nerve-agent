/**
 * 把一条入站消息归到一条「线索」上。
 *
 * 同一 threadKey 的后续消息会落到同一个 Ticket（订阅直通），
 * 不同 threadKey 开新 Ticket。
 *
 * 格式一旦定下就不要改：它同时是 ticket 表里的持久化字段，
 * 改了等于把历史 Ticket 全部变成孤儿。
 */

export interface ThreadKeyInput {
  platform: string
  chatId: string
  /** Discord 的 guild / 服务器 id */
  guildId?: string
  /** Telegram 的话题 id（forum topic） */
  topicId?: string
  /** 本地界面的会话 id */
  localSessionId?: string
}

export function deriveThreadKey(msg: ThreadKeyInput): string {
  if (msg.platform === 'local') {
    return `local:${msg.localSessionId ?? ''}`
  }
  if (msg.platform === 'discord') {
    return `dc:guild:${msg.guildId ?? ''}:channel:${msg.chatId}`
  }
  // telegram 及其它：私聊按 chat，话题再细分
  const base = `tg:chat:${msg.chatId}`
  return msg.topicId ? `${base}:topic:${msg.topicId}` : base
}
