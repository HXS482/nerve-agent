/**
 * Routines 面板：某个 Bot 的定时任务列表 + 新建 + 调度器心跳。
 *
 * 单独成视图而不是塞进设置页：routine 是"Bot 自己会干活"的入口，
 * 用户需要能随时看到"下次什么时候跑"和"调度器还活着吗"。
 */

import { useEffect, useMemo, useState } from 'react'
import { useRoutineStore, type Routine } from '../stores/routineStore'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function relative(ts: number): string {
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const unit = abs < 60_000 ? '秒' : abs < 3_600_000 ? '分钟' : abs < 86_400_000 ? '小时' : '天'
  const n = Math.round(abs / (unit === '秒' ? 1000 : unit === '分钟' ? 60_000 : unit === '小时' ? 3_600_000 : 86_400_000))
  return diff >= 0 ? `${n} ${unit}后` : `${n} ${unit}前`
}

const SCHEDULE_PRESETS = [
  { label: '每 15 分钟', value: 'interval:15m' },
  { label: '每 30 分钟', value: 'interval:30m' },
  { label: '每小时', value: 'interval:60m' },
  { label: '每天 09:00', value: 'daily:09:00' },
  { label: '每天 18:00', value: 'daily:18:00' },
  { label: '工作日 09:00', value: 'weekly:1-5:09:00' },
]

function RoutineRow({ r }: { r: Routine }) {
  const setEnabled = useRoutineStore((s) => s.setEnabled)
  const remove = useRoutineStore((s) => s.remove)
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-accent/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-foreground truncate" title={r.instruction}>{r.instruction}</div>
        <div className="text-[10px] text-[var(--text-on-surface-variant)] mt-0.5 truncate">
          {r.schedule} · {r.enabled ? `下次 ${fmtTime(r.nextRunAt)}（${relative(r.nextRunAt)}）` : '已停用'}
          {r.consecutiveFailures > 0 && <span className="text-[var(--error)]"> · 连续失败 {r.consecutiveFailures}</span>}
        </div>
      </div>
      <button
        onClick={() => setEnabled(r.id, !r.enabled)}
        className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-[var(--text-on-surface-variant)] hover:text-foreground shrink-0"
        title={r.enabled ? '停用' : '启用'}
      >
        {r.enabled ? '停用' : '启用'}
      </button>
      <button
        onClick={() => remove(r.id)}
        className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-[var(--text-on-surface-variant)] hover:text-[var(--error)] shrink-0"
        title="删除"
      >
        删除
      </button>
    </div>
  )
}

export function RoutinesView() {
  const { bots, routines, activeBotId, sweep, loading, error, loadBots, loadRoutines, refreshSweep, create, selectBot, saveBot, createBot, clearError } =
    useRoutineStore()

  const [instruction, setInstruction] = useState('')
  const [schedule, setSchedule] = useState(SCHEDULE_PRESETS[0].value)
  const [sessionId, setSessionId] = useState('')
  const [editing, setEditing] = useState(false)
  const [botName, setBotName] = useState('')
  const [botInstructions, setBotInstructions] = useState('')
  const [botGroup, setBotGroup] = useState('')
  const [botEmoji, setBotEmoji] = useState('')
  const [adding, setAdding] = useState(false)
  const [newBotName, setNewBotName] = useState('')

  useEffect(() => {
    void loadBots()
  }, [loadBots])

  useEffect(() => {
    if (activeBotId) void loadRoutines(activeBotId)
  }, [activeBotId, loadRoutines])

  // 心跳：与 Scheduler 的 30s 周期对齐，只查这一个轻量接口
  useEffect(() => {
    void refreshSweep()
    const t = setInterval(() => void refreshSweep(), 30_000)
    return () => clearInterval(t)
  }, [refreshSweep])

  const activeBot = useMemo(() => bots.find((b) => b.id === activeBotId) ?? null, [bots, activeBotId])

  // 切 Bot 或重新拉取后把编辑框同步到该 Bot 的当前值（只在非编辑态覆盖，别打断输入）
  useEffect(() => {
    if (!activeBot || editing) return
    setBotName(activeBot.name)
    setBotInstructions(activeBot.instructions)
    setBotGroup(activeBot.group ?? '')
    setBotEmoji(activeBot.emoji ?? '')
  }, [activeBot, editing])

  const submit = async () => {
    if (!activeBotId || !instruction.trim()) return
    const ok = await create({ botId: activeBotId, sessionId: sessionId.trim(), instruction: instruction.trim(), schedule })
    if (ok) {
      setInstruction('')
      setSessionId('')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">Routines</span>
          <div className="flex items-center gap-1">
            <select
              value={activeBotId ?? ''}
              onChange={(e) => selectBot(e.target.value)}
              className="text-[11px] bg-transparent border border-white/10 rounded px-1.5 py-0.5 text-foreground"
            >
              {bots.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#1a1a1c]">{b.name}</option>
              ))}
            </select>
            <button
              onClick={() => setAdding((v) => !v)}
              title="新建 Bot"
              className="text-[11px] px-1.5 py-0.5 rounded border border-white/10 text-[var(--text-on-surface-variant)] hover:text-foreground"
            >
              +
            </button>
          </div>
        </div>
        {adding && (
          <div className="flex items-center gap-1 mt-1.5">
            <input
              value={newBotName}
              onChange={(e) => setNewBotName(e.target.value)}
              placeholder="新 Bot 名字"
              className="flex-1 text-[11px] bg-white/5 rounded px-2 py-1 text-foreground outline-none"
            />
            <button
              onClick={async () => {
                const name = newBotName.trim()
                if (!name) return
                const id = await createBot({ name })
                if (id) { setNewBotName(''); setAdding(false) }
              }}
              className="text-[11px] px-2 py-1 rounded bg-white/10 text-foreground"
            >
              建
            </button>
          </div>
        )}

        <div className={`text-[10px] mt-1 ${sweep.healthy ? 'text-[var(--text-on-surface-variant)]' : 'text-[var(--error)]'}`}>
          {sweep.healthy && sweep.lastSweep
            ? `调度器：${relative(sweep.lastSweep)}巡检`
            : '调度器未运行（app 刚启动或已停止）'}
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 text-[10px] text-[var(--error)] flex items-start gap-1">
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="shrink-0">×</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {loading && routines.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-[var(--text-on-surface-variant)]">加载中…</div>
        )}
        {!loading && routines.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-[var(--text-on-surface-variant)]">
            这个 Bot 还没有定时任务。也可以直接跟它说「每天 9 点提醒我…」，它会自己建。
          </div>
        )}
        {routines.map((r) => <RoutineRow key={r.id} r={r} />)}
      </div>

      <div className="border-t border-white/5 p-2 flex flex-col gap-1.5">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="到点要做什么"
          rows={2}
          className="w-full text-[11px] bg-white/5 rounded px-2 py-1.5 text-foreground resize-none outline-none"
        />
        <div className="flex items-center gap-1.5">
          <select
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="flex-1 text-[11px] bg-white/5 rounded px-1.5 py-1 text-foreground outline-none"
          >
            {SCHEDULE_PRESETS.map((p) => (
              <option key={p.value} value={p.value} className="bg-[#1a1a1c]">{p.label}</option>
            ))}
          </select>
          <button
            onClick={submit}
            disabled={!activeBotId || !instruction.trim()}
            className="text-[11px] px-2.5 py-1 rounded bg-white/10 text-foreground disabled:opacity-40"
          >
            新建
          </button>
        </div>
        <input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="投递到会话 id（留空 = 该 Bot 的默认会话）"
          className="w-full text-[10px] bg-white/5 rounded px-2 py-1 text-foreground outline-none"
        />
        {activeBot && !editing && (
          <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-on-surface-variant)]">
            <span className="truncate">
              Bot：{activeBot.name}{activeBot.homeSessionId ? ` · 默认会话 ${activeBot.homeSessionId.slice(0, 8)}…` : ''}
            </span>
            <button onClick={() => setEditing(true)} className="shrink-0 hover:text-foreground">编辑</button>
          </div>
        )}

        {/* Bot 的角色设定：instructions 会拼进 system prompt 的 bot 层 */}
        {activeBot && editing && (
          <div className="flex flex-col gap-1 pt-1 border-t border-white/5">
            <input
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              placeholder="Bot 名称"
              className="w-full text-[11px] bg-white/5 rounded px-2 py-1 text-foreground outline-none"
            />
            <div className="flex items-center gap-1.5">
              <input
                value={botEmoji}
                onChange={(e) => setBotEmoji(e.target.value.slice(0, 2))}
                placeholder="🙂"
                className="w-10 text-center text-[12px] bg-white/5 rounded px-1 py-1 text-foreground outline-none"
              />
              <input
                value={botGroup}
                onChange={(e) => setBotGroup(e.target.value)}
                placeholder="分组（研发 / 调研 / 闲聊…）"
                className="flex-1 text-[11px] bg-white/5 rounded px-2 py-1 text-foreground outline-none"
              />
            </div>
            <textarea
              value={botInstructions}
              onChange={(e) => setBotInstructions(e.target.value)}
              placeholder="角色设定：这个 Bot 是谁、负责什么（会拼进系统提示）"
              rows={3}
              className="w-full text-[11px] bg-white/5 rounded px-2 py-1.5 text-foreground resize-none outline-none"
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={async () => {
                  await saveBot(activeBot.id, {
                    name: botName.trim() || activeBot.name,
                    group: botGroup.trim(),
                    emoji: botEmoji.trim(),
                    instructions: botInstructions,
                  })
                  setEditing(false)
                }}
                className="text-[11px] px-2.5 py-1 rounded bg-white/10 text-foreground"
              >
                保存
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-[11px] px-2.5 py-1 rounded border border-white/10 text-[var(--text-on-surface-variant)]"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
