/**
 * Gateway WS 协议定义
 *
 * 使用 Zod 做运行时校验，TypeScript 类型推导
 * 参考 OpenClaw 的 TypeBox + JSON Schema 模式
 */

import { z } from 'zod'

// ==================== 连接 ====================

export const ConnectRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.literal('connect'),
  params: z.object({
    auth: z.object({
      token: z.string(),
    }).optional(),
    role: z.enum(['client', 'node']).default('client'),
    deviceId: z.string().optional(),
    platform: z.string().optional(),
  }),
})

export const ConnectResponseSchema = z.object({
  type: z.literal('res'),
  id: z.string(),
  ok: z.boolean(),
  payload: z.object({
    sessionId: z.string(),
    features: z.object({
      methods: z.array(z.string()),
      events: z.array(z.string()),
    }),
  }).optional(),
  error: z.string().optional(),
})

// ==================== Agent ====================

export const AgentRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.literal('agent'),
  params: z.object({
    sessionId: z.string().optional(),
    message: z.string(),
    files: z.array(z.object({
      name: z.string(),
      mimeType: z.string(),
      data: z.string(),
      size: z.number(),
      isImage: z.boolean(),
    })).optional(),
    idempotencyKey: z.string().optional(),
    /** 请求时间戳（用于防重放攻击） */
    timestamp: z.number().optional(),
  }),
})

export const AgentResponseSchema = z.object({
  type: z.literal('res'),
  id: z.string(),
  ok: z.boolean(),
  payload: z.object({
    runId: z.string(),
    sessionId: z.string(),
    status: z.enum(['accepted', 'rejected']),
  }).optional(),
  error: z.string().optional(),
})

// ==================== 会话管理 ====================

export const SessionListRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.literal('sessions.list'),
  params: z.object({}).optional(),
})

export const SessionListResponseSchema = z.object({
  type: z.literal('res'),
  id: z.string(),
  ok: z.boolean(),
  payload: z.array(z.object({
    sessionId: z.string(),
    summary: z.string().optional(),
    firstPrompt: z.string().optional(),
    customTitle: z.string().optional(),
    lastModified: z.number().optional(),
    createdAt: z.number().optional(),
    tag: z.string().optional(),
  })).optional(),
  error: z.string().optional(),
})

export const SessionDeleteRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.literal('sessions.delete'),
  params: z.object({
    sessionId: z.string(),
  }),
})

// ==================== 配置 ====================

export const ConfigSetRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.literal('config.set'),
  params: z.object({
    model: z.string().optional(),
    provider: z.string().optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    permissionMode: z.enum(['bypassPermissions', 'auto', 'acceptEdits', 'ask']).optional(),
  }),
})

export const ConfigGetRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.literal('config.get'),
  params: z.object({}).optional(),
})

// ==================== 取消 ====================

export const CancelRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.literal('cancel'),
  params: z.object({
    runId: z.string().optional(),
  }).optional(),
})

// ==================== 健康检查 ====================

export const HealthRequestSchema = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.literal('health'),
  params: z.object({}).optional(),
})

export const HealthResponseSchema = z.object({
  type: z.literal('res'),
  id: z.string(),
  ok: z.boolean(),
  payload: z.object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    uptime: z.number(),
    activeSessions: z.number(),
    memoryUsage: z.object({
      rss: z.number(),
      heapUsed: z.number(),
      heapTotal: z.number(),
    }),
  }).optional(),
  error: z.string().optional(),
})

// ==================== 事件 ====================

export const StreamEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('stream'),
  sessionId: z.string(),
  runId: z.string().optional(),
  payload: z.object({
    delta: z.string().optional(),
    thinking: z.string().optional(),
  }),
  seq: z.number().optional(),
})

export const ToolEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('tool'),
  sessionId: z.string(),
  runId: z.string().optional(),
  payload: z.object({
    action: z.enum(['call', 'result']),
    id: z.string(),
    name: z.string().optional(),
    input: z.unknown().optional(),
    content: z.string().optional(),
    isError: z.boolean().optional(),
  }),
  seq: z.number().optional(),
})

export const LifecycleEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('lifecycle'),
  sessionId: z.string(),
  runId: z.string().optional(),
  payload: z.object({
    state: z.enum(['started', 'completed', 'error', 'cancelled']),
    cost: z.number().optional(),
    maxContextTokens: z.number().optional(),
    error: z.string().optional(),
  }),
  seq: z.number().optional(),
})

export const ErrorEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('error'),
  sessionId: z.string().optional(),
  payload: z.object({
    code: z.string(),
    message: z.string(),
  }),
  seq: z.number().optional(),
})

// ==================== 联合类型 ====================

export const RequestSchema = z.discriminatedUnion('method', [
  ConnectRequestSchema,
  AgentRequestSchema,
  SessionListRequestSchema,
  SessionDeleteRequestSchema,
  ConfigSetRequestSchema,
  ConfigGetRequestSchema,
  CancelRequestSchema,
  HealthRequestSchema,
])

export const ResponseSchema = z.union([
  ConnectResponseSchema,
  AgentResponseSchema,
  SessionListResponseSchema,
  HealthResponseSchema,
])

export const EventSchema = z.discriminatedUnion('event', [
  StreamEventSchema,
  ToolEventSchema,
  LifecycleEventSchema,
  ErrorEventSchema,
])

export const MessageSchema = z.union([
  RequestSchema,
  ResponseSchema,
  EventSchema,
])

// ==================== TypeScript 类型 ====================

export type ConnectRequest = z.infer<typeof ConnectRequestSchema>
export type ConnectResponse = z.infer<typeof ConnectResponseSchema>
export type AgentRequest = z.infer<typeof AgentRequestSchema>
export type AgentResponse = z.infer<typeof AgentResponseSchema>
export type SessionListRequest = z.infer<typeof SessionListRequestSchema>
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>
export type SessionDeleteRequest = z.infer<typeof SessionDeleteRequestSchema>
export type ConfigSetRequest = z.infer<typeof ConfigSetRequestSchema>
export type ConfigGetRequest = z.infer<typeof ConfigGetRequestSchema>
export type CancelRequest = z.infer<typeof CancelRequestSchema>
export type HealthRequest = z.infer<typeof HealthRequestSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
export type StreamEvent = z.infer<typeof StreamEventSchema>
export type ToolEvent = z.infer<typeof ToolEventSchema>
export type LifecycleEvent = z.infer<typeof LifecycleEventSchema>
export type ErrorEvent = z.infer<typeof ErrorEventSchema>

export type GatewayRequest = z.infer<typeof RequestSchema>
export type GatewayResponse = z.infer<typeof ResponseSchema>
export type GatewayEvent = z.infer<typeof EventSchema>
export type GatewayMessage = z.infer<typeof MessageSchema>

// ==================== 辅助函数 ====================

export function createResponse(id: string, ok: boolean, payload?: unknown, error?: string): GatewayResponse {
  return { type: 'res', id, ok, payload, error } as GatewayResponse
}

export function createEvent(event: string, sessionId: string, payload: unknown, seq?: number): GatewayEvent {
  return { type: 'event', event, sessionId, payload, seq } as GatewayEvent
}
