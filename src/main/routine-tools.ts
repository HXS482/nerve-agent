/**
 * Routine 管理工具（模型侧）。
 *
 * 单独成文件而不是塞进 tools.ts：这些工具依赖 RoutineStore 和「当前会话/Bot」
 * 上下文，只在 AgentCore 组装工具时存在；未传上下文的老调用点完全不受影响。
 */
import type { RoutineStore } from './store/routine-store'

export interface RoutineToolCtx {
  store: RoutineStore
  getSession: () => { sessionId: string; botId: string }
  /** 解析投递会话：空串或已失效的 id → 该 Bot 的 home 会话；解析不出返回空串。 */
  resolveSession: (requested: string) => Promise<string>
}

type ToolDef = {
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<any>
}

export function buildRoutineTools(ctx: RoutineToolCtx): Record<string, ToolDef> {
  const { store } = ctx

  return {
    create_routine: {
      description:
        '创建一个定时任务（routine）。到点后你会收到一条 [Routine 触发] 消息并执行 instruction。' +
        'schedule 仅支持三种格式：interval:<N>m（N≥15，如 interval:30m）、daily:HH:mm（如 daily:09:30）、' +
        'weekly:<d>-<d>:HH:mm（d=0..6，0=周日，如 weekly:1-5:09:00）。无法表达的时刻表要如实告诉用户，不要硬造。',
      input_schema: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: '到点要做的事，用用户的原话或充分展开的指令' },
          schedule: { type: 'string', description: 'interval:<N>m / daily:HH:mm / weekly:<d>-<d>:HH:mm' },
          session_hint: { type: 'string', description: '结果投递的会话 id；缺省为当前会话' },
        },
        required: ['instruction', 'schedule'],
      },
      execute: async (args: any) => {
        try {
          const row = store.create({
            botId: ctx.getSession().botId,
            sessionId: args.session_hint || ctx.getSession().sessionId,
            instruction: String(args.instruction ?? ''),
            schedule: String(args.schedule ?? ''),
            createdBy: 'model',
          })
          return { id: row.id, nextRunAt: row.nextRunAt, schedule: row.schedule }
        } catch (err: any) {
          return { error: err?.message || String(err) }
        }
      },
    },

    list_routines: {
      description: '列出当前 Bot 的全部定时任务（含停用的）。',
      input_schema: { type: 'object', properties: {} },
      execute: async () => {
        return { routines: store.listByBot(ctx.getSession().botId, { includeDisabled: true }) }
      },
    },

    update_routine: {
      description: '修改当前 Bot 的定时任务（指令/时刻表/启停）。只有 id 必填，其余可选。',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          instruction: { type: 'string' },
          schedule: { type: 'string' },
          enabled: { type: 'boolean' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        const cur = store.get(String(args.id ?? ''))
        if (!cur || cur.botId !== ctx.getSession().botId) return { error: 'not found' }
        try {
          const patch: { instruction?: string; schedule?: string; enabled?: boolean } = {}
          if (args.instruction !== undefined) patch.instruction = String(args.instruction)
          if (args.schedule !== undefined) patch.schedule = String(args.schedule)
          if (args.enabled !== undefined) patch.enabled = !!args.enabled
          const row = store.update(cur.id, patch)
          return { id: row.id, enabled: row.enabled, nextRunAt: row.nextRunAt }
        } catch (err: any) {
          return { error: err?.message || String(err) }
        }
      },
    },

    delete_routine: {
      description: '删除当前 Bot 的一个定时任务。',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async (args: any) => {
        const cur = store.get(String(args.id ?? ''))
        if (!cur || cur.botId !== ctx.getSession().botId) return { error: 'not found' }
        store.remove(cur.id)
        return { deleted: cur.id }
      },
    },
  }
}
