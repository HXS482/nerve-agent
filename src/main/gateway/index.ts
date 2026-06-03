/**
 * Gateway 模块
 *
 * 导出：
 * - NerveGateway: Gateway 主入口
 * - GatewayWSServer: WebSocket 服务
 * - SessionRouter: 会话路由器
 * - WebSocketChannel: WebSocket 输出通道
 * - AdapterChannel: 适配器输出通道
 * - GatewayProcessManager: 进程管理器
 * - adapters: IM 适配器模块
 * - protocol: 协议定义（Zod schema + TypeScript 类型）
 */

export { NerveGateway } from './gateway'
export type { GatewayConfig } from './gateway'
export { GatewayWSServer } from './ws-server'
export type { WSServerConfig, WSClient, MessageHandler } from './ws-server'
export { SessionRouter } from './session-router'
export { WebSocketChannel } from './ws-channel'
export { AdapterChannel } from './adapter-channel'
export { GatewayProcessManager } from './process-manager'
export type { ProcessManagerConfig } from './process-manager'
export * from './adapters'
export * from './protocol'
