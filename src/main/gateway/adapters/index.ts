/**
 * IM 适配器模块
 *
 * 导出：
 * - BaseAdapter: 适配器基类
 * - TelegramAdapter: Telegram 适配器
 * - DiscordAdapter: Discord 适配器
 */

export { BaseAdapter } from './base-adapter'
export type { IncomingMessage, MessageAttachment, AdapterConfig } from './base-adapter'
export { TelegramAdapter } from './telegram'
export type { TelegramAdapterConfig } from './telegram'
export { DiscordAdapter } from './discord'
export type { DiscordAdapterConfig } from './discord'
