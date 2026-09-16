import { useState } from 'react'
import { motion } from 'motion/react'
import type { TodoItem } from '../../../shared/types'

// TaskRows —— Stage 画布的 TodoWrite 任务卡
// 每行一个 todo：completed → 绿勾徽章；in_progress → 数字 spinner 环；pending → 灰序号环。
// 行可点击展开细节（note / 状态），grid-rows 0fr→1fr 展开动画与 toolflow-detail 同语法。

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

function SpinnerRing({ active, n }: { active?: boolean; n: number }) {
  const size = 22, stroke = 2
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <span className="stage-task-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="stage-task-ring-svg" style={active ? { animation: 'spin 1.1s linear infinite' } : undefined}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--stage-task-line)" strokeWidth={stroke} />
        {active && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="var(--stage-task-run)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="stage-task-ring-num">{n}</span>
    </span>
  )
}

function Badge({ tone, children }: { tone: 'green'; children: React.ReactNode }) {
  return (
    <span
      className="stage-task-badge"
      style={{ background: '#34d399', animation: `fade-up 300ms ${EASE_OUT} both` }}
    >
      {children}
    </span>
  )
}

const CheckIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
)

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    className="stage-task-chevron"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: `transform 300ms ${EASE_OUT}` }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
)

const STATUS_LABEL: Record<TodoItem['status'], string> = {
  completed: '已完成',
  in_progress: '进行中',
  pending: '待开始',
}

export function TaskRows({ todos }: { todos: TodoItem[] }) {
  const [manualOpen, setManualOpen] = useState<Record<number, boolean>>({})

  const doneCount = todos.filter((t) => t.status === 'completed').length

  return (
    <div className="stage-task-card">
      <div className="stage-task-header">
        <span className="stage-task-title">Tasks</span>
        <span className="stage-task-count tabular-nums">{doneCount}/{todos.length}</span>
      </div>
      <div className="stage-task-rows">
        {todos.map((t, i) => {
          const open = manualOpen[i] ?? false
          const details: { label: string; meta: string }[] = []
          if (t.note) details.push({ label: t.note, meta: '' })
          details.push({ label: '状态', meta: STATUS_LABEL[t.status] })
          return (
            <div key={i} className="stage-task-row" data-status={t.status}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setManualOpen((c) => ({ ...c, [i]: !open }))}
                className="stage-task-row-btn"
              >
                <span className="stage-task-badge-slot">
                  {t.status === 'completed' ? (
                    <Badge tone="green">{CheckIcon}</Badge>
                  ) : (
                    <SpinnerRing active={t.status === 'in_progress'} n={i + 1} />
                  )}
                </span>
                <span className="stage-task-label">{t.content}</span>
                {t.status === 'completed' && (
                  <span className="stage-task-pill" style={{ animation: 'fade-up 300ms ease-out both' }}>
                    已完成
                  </span>
                )}
                {t.status === 'in_progress' && <span className="stage-task-pill is-running">进行中</span>}
                <Chevron open={open} />
              </button>

              {/* 下拉细节 — 竖线 + 逐行 fade-up，与 ThinkTrace/toolflow 同语法 */}
              <div
                className="stage-task-detail-wrap"
                style={{
                  gridTemplateRows: open ? '1fr' : '0fr',
                  opacity: open ? 1 : 0,
                }}
              >
                <div className="stage-task-detail-clip">
                  <div className="stage-task-detail">
                    <span aria-hidden className="stage-task-line" />
                    <div className="stage-task-detail-rows">
                      {details.map((d, j) => (
                        <div
                          key={j}
                          className="stage-task-detail-row"
                          style={open ? { animation: `fade-up 300ms ${EASE_OUT} ${100 + j * 90}ms both` } : undefined}
                        >
                          <span className="stage-task-detail-label">{d.label}</span>
                          {d.meta && <span className="stage-task-detail-meta">{d.meta}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
