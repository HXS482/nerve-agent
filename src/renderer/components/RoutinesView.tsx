/**
 * Routines 面板：某个 Bot 的定时任务 + 这个 Bot 的外观与设定。
 *
 * 单独成视图而不是塞进设置页：routine 是「Bot 自己会干活」的入口，
 * 用户需要随时看到「下次什么时候跑」和「调度器还活着吗」。
 *
 * 排版原则（窄面板里唯一要紧的三件事）：
 *   1. 任务和外观分两个页签。改之前它们挤在同一列，任务列表和编辑表单抢高度，
 *      窗口一矮表单就被裁掉一半，看起来像坏了。
 *   2. 每个控件都带标题。光看输入框分不清它要的是分组名还是会话 id。
 *   3. 长表单切成分区，靠分隔线扫读；颜色选择配一个实时预览。
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useRoutineStore } from '../stores/routineStore'
import { UpcomingRuns } from './UpcomingRuns'
import { BotAvatar, AVATAR_PALETTE } from './BotList'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function relative(ts: number): string {
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const unit = abs < 60000 ? '秒' : abs < 3600000 ? '分钟' : abs < 86400000 ? '小时' : '天'
  const div = unit === '秒' ? 1000 : unit === '分钟' ? 60000 : unit === '小时' ? 3600000 : 86400000
  const n = Math.round(abs / div)
  return diff >= 0 ? n + ' ' + unit + '后' : n + ' ' + unit + '前'
}

const SCHEDULE_PRESETS = [
  { label: '每 15 分钟', value: 'interval:15m' },
  { label: '每 30 分钟', value: 'interval:30m' },
  { label: '每小时', value: 'interval:60m' },
  { label: '每天 09:00', value: 'daily:09:00' },
  { label: '每天 18:00', value: 'daily:18:00' },
  { label: '工作日 09:00', value: 'weekly:1-5:09:00' },
]

/**
 * 岗位模板。
 *
 * 为什么要有它：现有 4 个 Bot 里 3 个的「角色设定」是空字符串，
 * 第 4 个是「15556」。空白 textarea 没人填 —— 这不是用户懒，
 * 是「你是谁都行」这种开放题太难回答。
 *
 * 模板把开放题变成选择题：选一个岗位，instructions 就有内容打底，
 * 想改再改。**不预填技能**：现在全系统只有 2 个技能，都跟岗位无关，
 * 硬分配只会造出「研发不给画图」这种没依据的规矩。
 */
const BOT_TEMPLATES: Array<{ id: string; label: string; emoji: string; instructions: string }> = [
  {
    id: 'research',
    label: '调研',
    emoji: '🔍',
    instructions: '你负责查资料、比方案、给结论。结论要有出处，拿不准就说拿不准。',
  },
  {
    id: 'dev',
    label: '研发',
    emoji: '⚙️',
    instructions: '你是这个工作区的工程负责人。看代码先读再改，改完说清为什么。',
  },
  {
    id: 'writing',
    label: '文案',
    emoji: '✍️',
    instructions: '你负责写。先问清给谁看、要多长，再动笔。',
  },
  {
    id: 'life',
    label: '生活',
    emoji: '🌤',
    instructions: '你负责日程、提醒、杂事。记不住的事主动记下来。',
  },
  {
    id: 'blank',
    label: '空白',
    emoji: '○',
    instructions: '',
  },
]

/* ------------------------------------------------------------------ 表单积木 */

/*
 * 单色（mono）体系：整套面板只用「墨 → 纸」之间的灰阶，不出现任何色相。
 *
 * 彩色在这里没有信息量 —— 蓝色主按钮、紫色时间线点、绿色心跳，它们表达的不是
 * 「不同的状态」，只是不同位置的装饰。去掉之后层级只能靠**明度**和**字重**来
 * 区分，这正是这套 UI 看起来「贵」而不是「花」的原因。
 *
 * 三个 token 撑起全部层级：
 *   --text-on-surface          墨（主文字 / 主按钮填充）
 *   --text-on-surface-variant  中灰（次文字 / 控件描边）
 *   --text-outline             淡灰（说明 / 占位）
 * 底色用 --bg-background（凹）与 --bg-surface-container（平）两级。
 *
 * 唯一保留 --error：错误必须一眼看见，它承载信息，不是装饰。
 */

const BOX: CSSProperties = {
  width: '100%',
  fontSize: 10.5,
  lineHeight: 1.5,
  padding: '6px 8px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-background)',
  border: '1px solid var(--border-default)',
  color: 'var(--text-on-surface)',
  outline: 'none',
  boxSizing: 'border-box',
}

/*
 * 主按钮：实心墨底 + 纸色字。
 *
 * 单色设计里的主按钮不靠色相吸引注意力，靠**最高的明度反差**。
 * 暗色下墨 #e5e2e1 / 纸 #111111 ≈ 14.6:1；亮色下正好反过来。
 * 两个主题自动成立，因为用的是同一对相对语义的 token。
 */
const PRIMARY_BTN: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  background: 'var(--text-on-surface)',
  border: '1px solid var(--text-on-surface)',
  color: 'var(--bg-background)',
  letterSpacing: '0.01em',
}

/*
 * 次按钮：只有描边。
 *
 * 描边用 border-default 而不是 border-subtle —— 后者是 rgba(255,255,255,0.06)，
 * 在面板底上几乎不可见，一整排按钮看起来像几段浮空的文字。
 */
const GHOST_BTN: CSSProperties = {
  fontSize: 9.5,
  padding: '5px 9px',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  background: 'transparent',
  border: '1px solid var(--border-default)',
  color: 'var(--text-on-surface-variant)',
}

/*
 * 说明文字。9px + --text-outline-variant 是这套 UI 里最糟的一处组合：
 * 暗色 #424754 on #201f1f = 1.77:1，等于看不见；亮色 1.47:1 更糟。
 * 提到 10px + --text-outline（暗 5.17 / 亮 3.92）。
 */
const HINT: CSSProperties = {
  fontSize: 9.5,
  lineHeight: 1.55,
  color: 'var(--text-outline)',
}

/** 一行表单：小标题 + 控件 +（可选）说明。 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-on-surface-variant)', letterSpacing: '0.01em' }}>
        {label}
      </span>
      {children}
      {hint ? <span style={HINT}>{hint}</span> : null}
    </div>
  )
}

/** 分区：上分隔线 + 极小的大写标题，把长表单切成能扫读的几块。 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11, paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 650, color: 'var(--text-on-surface)', flexShrink: 0 }}>
          {title}
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      </div>
      {children}
    </div>
  )
}

/**
 * 分段选择器。
 *
 * 选中态同时改背景、描边、字重 —— 只靠背景深浅区分的话，浅色主题下几乎看不出来。
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        padding: 2,
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-background)',
        border: '1px solid var(--border-default)',
      }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              fontSize: 10,
              padding: '4px 6px',
              borderRadius: 5,
              whiteSpace: 'nowrap',
              fontWeight: on ? 600 : 500,
              cursor: 'pointer',
              background: on ? 'var(--text-on-surface)' : 'transparent',
              border: 'none',
              color: on ? 'var(--bg-background)' : 'var(--text-outline)',
              transition: 'background 0.14s, color 0.14s',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 色板。
 *
 * 17px 是能稳稳点中的下限（原来的 13px 加上边框，在触控板上很难点中）；
 * 末尾那个虚线圆是「自动」：清空 avatarColor，回到按 id 散列的默认色。
 */
function ColorRow({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
      {AVATAR_PALETTE.map((c) => {
        const on = value.toLowerCase() === c.toLowerCase()
        return (
          <button
            key={c}
            onClick={() => onChange(c)}
            title={c}
            style={{
              width: 17,
              height: 17,
              padding: 0,
              borderRadius: '50%',
              background: c,
              cursor: 'pointer',
              border: on ? '2px solid var(--text-on-surface)' : '1px solid var(--border-default)',
            }}
          />
        )
      })}
      <button
        onClick={() => onChange('')}
        title="自动（按 Bot id 取色）"
        style={{
          width: 17,
          height: 17,
          padding: 0,
          borderRadius: '50%',
          cursor: 'pointer',
          background: 'transparent',
          border: '1px dashed ' + (value ? 'var(--border-default)' : 'var(--text-on-surface-variant)'),
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ 主视图 */

type Tab = 'routines' | 'look'

export function RoutinesView() {
  const {
    bots,
    routines,
    activeBotId,
    sweep,
    loading,
    error,
    loadBots,
    loadRoutines,
    refreshSweep,
    create,
    selectBot,
    saveBot,
    createBot,
    clearError,
  } = useRoutineStore()

  const [tab, setTab] = useState<Tab>('routines')

  /* 新建任务的表单 */
  const [instruction, setInstruction] = useState('')
  const [schedule, setSchedule] = useState(SCHEDULE_PRESETS[0].value)
  const [sessionId, setSessionId] = useState('')

  /* 新建 Bot 的行内输入 */
  const [adding, setAdding] = useState(false)
  const [newBotName, setNewBotName] = useState('')
  /** 新建时选中的岗位模板；选完可以改，不是锁定 */
  const [newBotTemplate, setNewBotTemplate] = useState('research')

  /* 外观表单 */
  const [botName, setBotName] = useState('')
  const [botInstructions, setBotInstructions] = useState('')
  const [botGroup, setBotGroup] = useState('')
  const [botEmoji, setBotEmoji] = useState('')
  const [botAvatarColor, setBotAvatarColor] = useState('')
  const [botAvatarOrb, setBotAvatarOrb] = useState(true)
  /**
   * 交接授权：这个 Bot 能把活派给谁。
   *
   * null = 所有其他 Bot 都能问，[] = 谁都不能问。两者在 UI 上是两个明确的选择，
   * 不是「没填 = 全部」这种含混状态 —— 用户得看得见自己选了什么。
   */
  const [botCanAsk, setBotCanAsk] = useState<string[] | null>(null)
  /**
   * 技能白名单。
   *
   * 空数组 = 全部可见（不是「一个都没有」）。这个默认值必须和 agent-core 的
   * visibleSkills 保持一致，否则用户看到全勾选、实际却被过滤光。
   */
  const [botSkills, setBotSkills] = useState<string[]>([])
  /** 磁盘上能发现的所有技能（id + 描述），用于勾选列表 */
  const [allSkills, setAllSkills] = useState<Array<{ id: string; name: string; description: string }>>([])
  /** 表单是否已被改动过：决定要不要显示「未保存」以及保存按钮的强调程度 */
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    void loadBots()
    // 技能列表：和 Bot 列表一起拉一次就够，它是目录扫描的结果
    void window.claude
      .getSkills()
      .then((list) =>
        setAllSkills(
          (list ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description ?? '' })),
        ),
      )
      .catch(() => setAllSkills([]))
  }, [loadBots])

  useEffect(() => {
    if (activeBotId) void loadRoutines(activeBotId)
  }, [activeBotId, loadRoutines])

  // 心跳：与 Scheduler 的 30s 周期对齐，只查这一个轻量接口
  useEffect(() => {
    void refreshSweep()
    const t = setInterval(() => void refreshSweep(), 30000)
    return () => clearInterval(t)
  }, [refreshSweep])

  const activeBot = useMemo(() => bots.find((b) => b.id === activeBotId) ?? null, [bots, activeBotId])

  /*
   * 把编辑框同步到当前 Bot。
   *
   * 依赖只有「当前是哪个 Bot」：不带 activeBot 对象本身，否则列表每刷新一次
   * （心跳 30s 一轮）就把用户正在输的内容冲掉。切到另一个 Bot 时必须重置，
   * 否则会把 A 的改动存到 B 头上 —— 所以判据是 id。
   */
  const syncedBotId = activeBot?.id ?? ''
  useEffect(() => {
    if (!activeBot) return
    setBotName(activeBot.name)
    setBotInstructions(activeBot.instructions)
    setBotGroup(activeBot.group ?? '')
    setBotEmoji(activeBot.emoji ?? '')
    setBotAvatarColor(activeBot.avatarColor ?? '')
    setBotAvatarOrb(activeBot.avatarOrb !== false)
    setBotCanAsk(activeBot.canAskBots ?? null)
    setBotSkills(activeBot.boundSkills ?? [])
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedBotId])

  const submit = async () => {
    if (!activeBotId || !instruction.trim()) return
    const ok = await create({ botId: activeBotId, sessionId: sessionId.trim(), instruction: instruction.trim(), schedule })
    if (ok) {
      setInstruction('')
      setSessionId('')
    }
  }

  const resetLookForm = () => {
    if (!activeBot) return
    setBotName(activeBot.name)
    setBotInstructions(activeBot.instructions)
    setBotGroup(activeBot.group ?? '')
    setBotEmoji(activeBot.emoji ?? '')
    setBotAvatarColor(activeBot.avatarColor ?? '')
    setBotAvatarOrb(activeBot.avatarOrb !== false)
    setBotCanAsk(activeBot.canAskBots ?? null)
    setBotSkills(activeBot.boundSkills ?? [])
    setDirty(false)
  }

  /**
   * 建 Bot：名字 + 岗位模板 → instructions。
   *
   * 模板只提供 instructions 打底，不锁任何东西 —— 建完可以改名字、改角色、改技能、
   * 改头像。它的作用是把「你想让它是谁」这道开放题降级成选择题。
   */
  const submitNewBot = async () => {
    const name = newBotName.trim()
    if (!name) return
    const tpl = BOT_TEMPLATES.find((t) => t.id === newBotTemplate)
    const id = await createBot({
      name,
      ...(tpl?.instructions ? { instructions: tpl.instructions } : {}),
      ...(tpl && tpl.id !== 'blank' ? { emoji: tpl.emoji } : {}),
    })
    if (!id) return
    setNewBotName('')
    setAdding(false)
  }

  /** 包一层 setter：改动即标脏。手写 setDirty(true) 每处都要记得，一定会漏。 */
  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setDirty(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── 头部：标题 + Bot 选择 + 调度器心跳 ── */}
      <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-on-surface)', flex: 1, letterSpacing: '-0.01em' }}>Routines</span>
          <select
            value={activeBotId ?? ''}
            onChange={(e) => selectBot(e.target.value)}
            style={{
              fontSize: 10,
              maxWidth: 100,
              padding: '3px 5px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-background)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-on-surface-variant)',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setAdding((v) => !v)}
            title="新建 Bot"
            style={{
              width: 21,
              height: 21,
              padding: 0,
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              background: adding ? 'var(--text-on-surface)' : 'transparent',
              border: '1px solid ' + (adding ? 'var(--text-on-surface)' : 'var(--border-default)'),
              color: adding ? 'var(--bg-background)' : 'var(--text-outline)',
              transition: 'background 0.14s, color 0.14s, border-color 0.14s',
            }}
          >
            +
          </button>
        </div>

        {adding && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <input
              value={newBotName}
              onChange={(e) => setNewBotName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewBot()
              }}
              placeholder="新 Bot 名字"
              style={{ ...BOX, fontSize: 10, padding: '5px 7px' }}
            />
            {/*
             * 岗位模板。
             *
             * 选一个就有 instructions 打底 —— 空白 textarea 是没人填的（实测 3/4 是空的）。
             * 这不是限制：建完照样能在「外观 → 身份」里改。
             */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {BOT_TEMPLATES.map((t) => {
                const on = newBotTemplate === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setNewBotTemplate(t.id)}
                    style={{
                      fontSize: 9.5,
                      padding: '3px 9px',
                      borderRadius: 'var(--radius-full)',
                      cursor: 'pointer',
                      background: on ? 'var(--text-on-surface)' : 'transparent',
                      border: '1px solid ' + (on ? 'var(--text-on-surface)' : 'var(--border-default)'),
                      color: on ? 'var(--bg-background)' : 'var(--text-outline)',
                      transition: 'background 0.14s, color 0.14s, border-color 0.14s',
                    }}
                  >
                    {t.emoji} {t.label}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => submitNewBot()}
              style={{ ...PRIMARY_BTN, fontSize: 10, padding: '5px 9px' }}
            >
              建
            </button>
          </div>
        )}

        {/* 心跳点：绿=在巡检。文字用相对时间，不用绝对时间戳（那个每 30 秒都长得一样） */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 7,
            fontSize: 10,
            color: sweep.healthy ? 'var(--text-outline)' : 'var(--error)',
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              flexShrink: 0,
              background: sweep.healthy ? 'var(--text-on-surface)' : 'var(--error)',
            }}
          />
          <span className="truncate">
            {sweep.healthy && sweep.lastSweep ? '调度器 ' + relative(sweep.lastSweep) + '巡检' : '调度器未运行'}
          </span>
        </div>
      </div>

      {/* ── 页签：任务 / 外观 ── */}
      <div style={{ padding: '8px 10px 0' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'routines', label: '任务' },
            { value: 'look', label: '外观' },
          ]}
        />
      </div>

      {error && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 10px 0', fontSize: 10, color: 'var(--error)' }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={clearError}
            style={{ background: 'transparent', border: 'none', color: 'var(--error)', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── 任务页签 ── */}
      {tab === 'routines' && (
        <>
          {/* UpcomingRuns 自己带 10px 水平 margin，这里不能再给 padding，否则双重缩进 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 0' }}>
            {loading && routines.length === 0 ? (
              <div style={{ padding: '12px 2px', fontSize: 10, color: 'var(--text-outline)' }}>加载中…</div>
            ) : (
              <UpcomingRuns routines={routines} botId={activeBotId || ''} />
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid var(--border-default)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            }}
          >
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="到点要做什么"
              rows={2}
              style={{ ...BOX, resize: 'none' }}
            />
            <div style={{ display: 'flex', gap: 5 }}>
              <select
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                style={{ ...BOX, flex: 1, cursor: 'pointer' }}
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                onClick={submit}
                disabled={!activeBotId || !instruction.trim()}
                style={{
                  ...PRIMARY_BTN,
                  flexShrink: 0,
                  opacity: !activeBotId || !instruction.trim() ? 0.4 : 1,
                }}
              >
                新建
              </button>
            </div>
            <Field label="投递到会话" hint="留空 = 这个 Bot 的默认会话">
              <input
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder={activeBot?.homeSessionId ? activeBot.homeSessionId.slice(0, 8) + '…（默认）' : '默认会话'}
                style={{ ...BOX, fontSize: 10, padding: '5px 7px' }}
              />
            </Field>
          </div>
        </>
      )}

      {/* ── 外观页签 ── */}
      {tab === 'look' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px 22px' }}>
          {!activeBot ? (
            <div style={{ fontSize: 10, color: 'var(--text-outline)' }}>先选一个 Bot</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/*
                实时预览。
                改颜色 / 换头像形式 / 改名字都立刻反映到这里 —— 否则用户得先保存、
                再回头看侧栏，而侧栏那行还混在别的 Bot 里，很难确认「刚才到底改了啥」。
              */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 10,
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--bg-background)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <BotAvatar
                  bot={{
                    ...activeBot,
                    name: botName || activeBot.name,
                    emoji: botEmoji,
                    avatarColor: botAvatarColor,
                    avatarOrb: botAvatarOrb,
                  }}
                  size={38}
                  animate
                  paper="var(--bg-background)"
                />
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-on-surface)' }}>
                    {botName || activeBot.name}
                  </div>
                  <div className="truncate" style={{ fontSize: 10, color: 'var(--text-outline)', marginTop: 2 }}>
                    {botGroup || '未分组'}
                    {activeBot.isDefault ? ' · 默认 Bot' : ''}
                  </div>
                </div>
              </div>

              <Section title="身份">
                <Field label="名称">
                  <input value={botName} onChange={(e) => touch(setBotName)(e.target.value)} style={BOX} />
                </Field>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Field label="分组">
                      <input
                        value={botGroup}
                        onChange={(e) => touch(setBotGroup)(e.target.value)}
                        placeholder="研发 / 调研…"
                        style={BOX}
                      />
                    </Field>
                  </div>
                  <div style={{ width: 48 }}>
                    <Field label="标记">
                      <input
                        value={botEmoji}
                        onChange={(e) => touch(setBotEmoji)(e.target.value.slice(0, 2))}
                        placeholder="🙂"
                        style={{ ...BOX, textAlign: 'center', fontSize: 11 }}
                      />
                    </Field>
                  </div>
                </div>
                <Field label="角色设定" hint="拼进系统提示的 bot 层，决定这个 Bot 是谁、负责什么">
                  <textarea
                    value={botInstructions}
                    onChange={(e) => touch(setBotInstructions)(e.target.value)}
                    rows={4}
                    placeholder="你负责…"
                    style={{ ...BOX, resize: 'none' }}
                  />
                </Field>
              </Section>

              <Section title="外观">
                <Field label="头像形式">
                  <Segmented
                    value={botAvatarOrb ? 'orb' : 'block'}
                    onChange={(v) => touch(setBotAvatarOrb)(v === 'orb')}
                    options={[
                      { value: 'orb', label: '动画圆球' },
                      { value: 'block', label: '文字方块' },
                    ]}
                  />
                </Field>
                <Field label="颜色" hint={botAvatarColor || '自动：按 Bot id 取一个稳定的颜色'}>
                  <ColorRow value={botAvatarColor} onChange={touch(setBotAvatarColor)} />
                </Field>
              </Section>

              <Section title="技能">
                {/*
                 * 技能勾选。
                 *
                 * 一个都不勾 = 全部可见。这一点必须写在 UI 上：
                 * 空数组的语义是「不过滤」，不是「什么都没有」—— 用户很容易理解反。
                 */}
                {allSkills.length === 0 ? (
                  <div style={HINT}>
                    还没有技能。放到 &lt;项目&gt;/.agents/skills/ 或 ~/.nerve/.agents/skills/ 下即可被发现。
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {allSkills.map((sk) => {
                        const on = botSkills.includes(sk.id)
                        return (
                          <label
                            key={sk.id}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 7,
                              padding: '6px 8px',
                              borderRadius: 'var(--radius-md)',
                              cursor: 'pointer',
                              background: on ? 'var(--bg-surface-container-high)' : 'transparent',
                              border: '1px solid ' + (on ? 'var(--text-on-surface-variant)' : 'var(--border-default)'),
                              transition: 'background 0.14s, border-color 0.14s',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                touch(setBotSkills)(
                                  on ? botSkills.filter((x) => x !== sk.id) : [...botSkills, sk.id],
                                )
                              }
                              style={{ marginTop: 2, flexShrink: 0, cursor: 'pointer' }}
                            />
                            <span style={{ minWidth: 0 }}>
                              <span
                                className="block truncate"
                                style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-on-surface)' }}
                              >
                                {sk.name}
                              </span>
                              {sk.description ? (
                                <span
                                  style={{
                                    display: 'block',
                                    fontSize: 9.5,
                                    lineHeight: 1.55,
                                    color: 'var(--text-outline)',
                                  }}
                                >
                                  {sk.description.length > 60 ? sk.description.slice(0, 60) + '…' : sk.description}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    <div style={HINT}>
                      一个都不勾 = 全部可见。技能只是「怎么用工具」的说明书，
                      能不能真的执行取决于这个 Bot 有哪些工具。
                    </div>
                  </>
                )}
              </Section>

              <Section title="协作">
                <Field label="可以把活派给" hint="选「都不行」时，这个 Bot 的工具列表里不会出现 message_bot">
                  <Segmented
                    value={botCanAsk === null ? 'all' : (botCanAsk.length ?? 0) > 0 ? 'some' : 'none'}
                    onChange={(v) => {
                      /*
                       * 三态映射到两个值上的取舍：
                       *   all  → null（所有其他 Bot）
                       *   none → []（谁都不行）
                       *   some → 保留当前勾选；还没勾过就是 []，也就是「先空着让你挑」
                       * 这不含混：勾上谁就是谁，一个都没勾等于谁都派不了，和 none 同效，
                       * 但界面上仍停在「指定」，用户不会以为自己的选择被吃掉了。
                       */
                      if (v === 'all') touch(setBotCanAsk)(null)
                      else if (v === 'none') touch(setBotCanAsk)([])
                      else touch(setBotCanAsk)(botCanAsk ?? [])
                    }}
                    options={[
                      { value: 'all', label: '所有' },
                      { value: 'some', label: '指定' },
                      { value: 'none', label: '都不行' },
                    ]}
                  />
                </Field>
                {(botCanAsk?.length ?? 0) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {bots
                      .filter((b) => b.id !== activeBot.id)
                      .map((b) => {
                        const on = (botCanAsk ?? []).includes(b.id)
                        return (
                          <button
                            key={b.id}
                            onClick={() =>
                              touch(setBotCanAsk)(
                                on ? (botCanAsk ?? []).filter((x) => x !== b.id) : [...(botCanAsk ?? []), b.id],
                              )
                            }
                            style={{
                              fontSize: 9.5,
                              padding: '3px 8px',
                              borderRadius: 'var(--radius-full)',
                              cursor: 'pointer',
                              background: on ? 'var(--text-on-surface)' : 'transparent',
                              border: '1px solid ' + (on ? 'var(--text-on-surface)' : 'var(--border-default)'),
                              color: on ? 'var(--bg-background)' : 'var(--text-outline)',
                            }}
                          >
                            {b.name}
                          </button>
                        )
                      })}
                  </div>
                )}
              </Section>

              {/* 底部动作条：和上面隔一条线，避免「保存」混在字段之间被漏看 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-default)',
                }}
              >
                <button
                  onClick={async () => {
                    await saveBot(activeBot.id, {
                      name: botName.trim() || activeBot.name,
                      group: botGroup.trim(),
                      emoji: botEmoji.trim(),
                      avatarColor: botAvatarColor,
                      avatarOrb: botAvatarOrb,
                      instructions: botInstructions,
                      canAskBots: botCanAsk,
                      boundSkills: botSkills,
                    })
                    setDirty(false)
                  }}
                  style={{ ...PRIMARY_BTN, opacity: dirty ? 1 : 0.55 }}
                >
                  保存
                </button>
                <button onClick={resetLookForm} disabled={!dirty} style={{ ...GHOST_BTN, opacity: dirty ? 1 : 0.45 }}>
                  还原
                </button>
                {dirty && (
                  <span style={{ fontSize: 9.5, marginLeft: 'auto', color: 'var(--text-on-surface-variant)' }}>未保存</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
