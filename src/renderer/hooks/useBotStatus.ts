import { useEffect, useRef, useState } from 'react'
import type { BotStatus } from '../components/GrokBot/GrokBot'
import { DONE_HOLD, ERROR_HOLD, deriveBotStatus } from '../components/GrokBot/botStatus'
import { useChatStore } from '../stores/chatStore'
import { useSubagentTracker } from '../stores/subagentTracker'
import { selectTodos, useTodoStore } from '../stores/todoStore'

/**
 * 把"这一轮到底在干嘛"翻译成 Grok Bot 的状态：三点脉动是等模型，轨道环是真在干活，
 * 眨眼是刚收尾，红点是挂了。判定全落在时间窗上，所以既要被 store 变化叫醒，
 * 也要在窗口到期时自己补一次渲染（见下面那个 setTimeout）。
 */
export function useBotStatus(sessionId: string | null): BotStatus {
  const isLoading = useChatStore((s) => s.isLoading)
  const lastRunErrorAt = useChatStore((s) => s.lastRunErrorAt)
  // 只看本条会话的清单：别的会话残留的 in_progress 不该让这只球转起来
  const hasRunningTodo = useTodoStore((s) =>
    selectTodos(s, sessionId).some((t) => t.status === 'in_progress')
  )
  // 子任务卡不按会话隔离，有在跑的就算
  const hasRunningSubagent = useSubagentTracker((s) =>
    s.cards.some((c) => c.tasks.some((t) => t.status === 'running'))
  )
  // 子任务失败也算错误收尾，取最近一次
  const subagentErrorAt = useSubagentTracker((s) => {
    let max = 0
    for (const c of s.cards) {
      for (const t of c.tasks) {
        if (t.status === 'error' && (t.completedAt ?? 0) > max) max = t.completedAt ?? 0
      }
    }
    return max
  })

  const errorAt = Math.max(lastRunErrorAt, subagentErrorAt)
  const [now, setNow] = useState(() => Date.now())
  const [doneUntil, setDoneUntil] = useState(0)

  const errorAtRef = useRef(errorAt)
  const prevLoading = useRef(isLoading)

  // 输入变了就刷新一次"现在"，否则拿旧的 now 去比时间窗会判反
  useEffect(() => {
    errorAtRef.current = errorAt
    setNow(Date.now())
  }, [errorAt, isLoading])

  // 收尾：loading 由真变假、且这一轮不是错误收尾 → 播一次眨眼
  useEffect(() => {
    const wasLoading = prevLoading.current
    prevLoading.current = isLoading
    if (!wasLoading || isLoading) return
    if (Date.now() - errorAtRef.current < ERROR_HOLD) {
      setDoneUntil(0)
      return
    }
    setDoneUntil(Date.now() + DONE_HOLD)
  }, [isLoading])

  // error / done 只在窗口内成立，到点补一次渲染，别指望 store 再发通知
  useEffect(() => {
    const deadlines: number[] = []
    if (errorAt > 0 && now - errorAt < ERROR_HOLD) deadlines.push(errorAt + ERROR_HOLD)
    if (doneUntil > now) deadlines.push(doneUntil)
    if (deadlines.length === 0) return
    const next = Math.min(...deadlines)
    const id = setTimeout(() => setNow(Date.now()), Math.max(next - Date.now(), 0) + 32)
    return () => clearTimeout(id)
  }, [errorAt, doneUntil, now])

  return deriveBotStatus({ isLoading, errorAt, now, doneUntil, hasRunningTodo, hasRunningSubagent })
}
