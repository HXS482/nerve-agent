/* ─────────────────────────────────────────────────────────
 * ASK USER CARD (human-in-the-loop)
 * agent 通过 AskUser 工具发起的结构化提问卡片：
 * 一次一个问题，问题栈垂直滑动（卡片高度随内容动画），
 * 计数器像里程表一样滚动，radio 选中后自动前进。
 * 关闭/跳过也会回应当前已答内容 —— 必须始终回应，
 * 否则主进程里挂起的工具调用永远无法返回。
 * ───────────────────────────────────────────────────────── */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import type { AskUserAnswers, AskUserRequest } from '../../shared/types'

const ROLL_MS = 400
const SLIDE = '360ms cubic-bezier(0.22, 1, 0.36, 1)'
const SENT_CLOSE_MS = 700

/* odometer digits — 变化的字符向上（或向下）滚动 */
function RollingDigits({ value }: { value: string }) {
  const prevRef = useRef(value)
  const [oldVal, setOldVal] = useState(value)
  const [newVal, setNewVal] = useState(value)
  const [rolling, setRolling] = useState(false)
  const [shifted, setShifted] = useState(false)
  const [dir, setDir] = useState<'up' | 'down'>('up')

  useEffect(() => {
    if (prevRef.current === value) return
    const from = prevRef.current
    prevRef.current = value
    const fromN = parseInt(from, 10)
    const toN = parseInt(value, 10)
    setDir(Number.isFinite(fromN) && Number.isFinite(toN) && toN < fromN ? 'down' : 'up')
    setOldVal(from)
    setNewVal(value)
    setRolling(true)
    setShifted(false)

    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShifted(true))
    })
    const done = setTimeout(() => {
      setRolling(false)
      setOldVal(value)
      setShifted(false)
    }, ROLL_MS)

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearTimeout(done)
    }
  }, [value])

  const chars = rolling ? newVal : oldVal

  return (
    <>
      {Array.from({ length: chars.length }, (_, i) => {
        const o = oldVal[i] ?? ''
        const n = chars[i] ?? ''
        if (!rolling || o === n) {
          return <span key={`${i}-${n}`}>{n}</span>
        }
        const top = dir === 'down' ? n : o
        const bottom = dir === 'down' ? o : n
        const restY = dir === 'down' ? '0' : '-1em'
        const startY = dir === 'down' ? '-1em' : '0'
        return (
          <span
            key={`${i}-${o}-${n}-${dir}`}
            style={{ display: 'inline-block', position: 'relative', overflow: 'hidden', height: '1em', lineHeight: '1em', verticalAlign: '-0.05em' }}
          >
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                transition: 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)',
                transform: `translateY(${shifted ? restY : startY})`,
              }}
            >
              <span style={{ height: '1em', lineHeight: '1em' }}>{top}</span>
              <span style={{ height: '1em', lineHeight: '1em' }}>{bottom}</span>
            </span>
          </span>
        )
      })}
    </>
  )
}

function Ico({ path, size = 14, sw = 2 }: { path: React.ReactNode; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  )
}

export function AskUserCard() {
  const ask = useChatStore((s) => s.pendingAsks[0])
  if (!ask) return null
  // key 保证每个新提问拿到全新状态
  return <AskUserCardInner key={ask.askId} ask={ask} />
}

function AskUserCardInner({ ask }: { ask: AskUserRequest }) {
  const removeAsk = useChatStore((s) => s.removeAsk)
  const questions = ask.questions
  const [qi, setQi] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number[]>>({})
  const [custom, setCustom] = useState<Record<number, string>>({})
  const [sent, setSent] = useState(false)

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const questionRefs = useRef<(HTMLDivElement | null)[]>([])
  const measured = useRef(false)
  const [viewportH, setViewportH] = useState<number | undefined>(undefined)
  const [trackY, setTrackY] = useState(0)
  const [animate, setAnimate] = useState(false)
  // 首次测量前只挂载当前问题，避免初始渲染闪一下全高度再收缩
  const [ready, setReady] = useState(false)

  // radio 自动前进的 480ms 定时器闭包拿到的是旧渲染的 state，
  // 用 ref 镜像保证 buildAnswers 永远读到最新答案
  const stateRef = useRef({ answers, custom })
  stateRef.current = { answers, custom }

  const last = qi === questions.length - 1
  const selected = answers[qi] ?? []
  const hasAnswer = selected.length > 0 || Boolean(custom[qi]?.trim())

  const sync = (withAnim: boolean) => {
    const item = questionRefs.current[qi]
    if (!item) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setViewportH(item.offsetHeight)
    setTrackY(item.offsetTop)
    setAnimate(withAnim && !reduce)
  }

  useLayoutEffect(() => {
    const withAnim = measured.current
    measured.current = true
    sync(withAnim)
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi, answers, custom, sent])

  useEffect(() => {
    const id = requestAnimationFrame(() => sync(measured.current))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi])

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const goTo = (next: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    setQi(Math.min(Math.max(next, 0), questions.length - 1))
  }

  const buildAnswers = (): AskUserAnswers => {
    const { answers: picked, custom: texts } = stateRef.current
    const out: AskUserAnswers = {}
    questions.forEach((question, i) => {
      const indices = picked[i] ?? []
      const text = (texts[i] ?? '').trim()
      if (indices.length === 0 && !text) return // 未作答 → 主进程侧显示“跳过”
      out[i] = { selected: indices.map((idx) => question.options[idx]), custom: text }
    })
    return out
  }

  const send = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    window.claude.respondAskUser({ askId: ask.askId, answers: buildAnswers() })
    setSent(true)
    closeTimer.current = setTimeout(() => removeAsk(ask.askId), SENT_CLOSE_MS)
  }

  /* 关闭/跳过到底：回应当前已答内容（可为空），绝不挂起 agent */
  const dismiss = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    window.claude.respondAskUser({ askId: ask.askId, answers: buildAnswers() })
    removeAsk(ask.askId)
  }

  const advance = () => {
    if (last) send()
    else goTo(qi + 1)
  }

  const toggle = (index: number) => {
    const type = questions[qi].type
    setAnswers((current) => {
      const picked = current[qi] ?? []
      const next = type === 'radio'
        ? [index]
        : picked.includes(index)
          ? picked.filter((item) => item !== index)
          : [...picked, index]
      return { ...current, [qi]: next }
    })
    if (type === 'radio') {
      setCustom((current) => ({ ...current, [qi]: '' }))
      if (advanceTimer.current) clearTimeout(advanceTimer.current)
      advanceTimer.current = setTimeout(() => {
        if (last) send()
        else setQi((current) => Math.min(questions.length - 1, current + 1))
      }, 480)
    }
  }

  if (sent) {
    return (
      <div className="ask-card-wrap">
        <div className="ask-card ask-card-sent">
          <span className="ask-card-sent-badge">
            <span className="ask-card-sent-ico">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </span>
            答案已发送
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="ask-card-wrap">
      <div className="ask-card">
        <button type="button" aria-label="关闭" onClick={dismiss} className="ask-card-x">
          <Ico size={14} sw={2.2} path={<path d="M18 6L6 18M6 6l12 12" />} />
        </button>
        <div className="ask-card-pad">
          {/* 问题即标题 */}
          <div
            className="ask-card-viewport"
            style={{ height: viewportH, transition: animate ? `height ${SLIDE}` : undefined }}
            aria-live="polite"
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 26,
                transform: `translate3d(0, ${-trackY}px, 0)`,
                transition: animate ? `transform ${SLIDE}` : undefined,
                willChange: 'transform',
              }}
            >
              {questions.map((question, qIdx) => {
                const active = qIdx === qi
                if (!ready && !active) return null
                const picked = answers[qIdx] ?? []
                return (
                  <div
                    key={qIdx}
                    ref={(el) => { questionRefs.current[qIdx] = el }}
                    aria-hidden={active ? undefined : true}
                    style={{
                      opacity: active ? 1 : 0,
                      transition: animate ? `opacity ${SLIDE}` : undefined,
                      pointerEvents: active ? undefined : 'none',
                    }}
                  >
                    <div className="ask-card-q">{question.q}</div>
                    <div className="ask-card-options">
                      {question.options.map((option, i) => {
                        const on = picked.includes(i)
                        return (
                          <button
                            key={option}
                            type="button"
                            aria-pressed={on}
                            tabIndex={active ? 0 : -1}
                            onClick={() => { if (active) toggle(i) }}
                            className="ask-card-option"
                          >
                            <span className={`ask-card-mark ${question.type === 'radio' ? 'is-radio' : 'is-check'}${on ? ' is-on' : ''}`}>
                              {question.type === 'radio' ? (
                                <span className="ask-card-dot" style={{ transform: on ? 'scale(1)' : 'scale(0)' }} />
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                              )}
                            </span>
                            <span className={`ask-card-option-text${on ? ' is-on' : ''}`}>{option}</span>
                          </button>
                        )
                      })}
                      <label className="ask-card-option">
                        <input
                          value={custom[qIdx] ?? ''}
                          tabIndex={active ? 0 : -1}
                          onChange={(event) => {
                            if (!active) return
                            setCustom((current) => ({ ...current, [qIdx]: event.target.value }))
                            if (question.type === 'radio') setAnswers((current) => ({ ...current, [qIdx]: [] }))
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && hasAnswer) {
                              event.preventDefault()
                              advance()
                            }
                          }}
                          placeholder="其他，自己补充…"
                          aria-label="自定义回答"
                          className="ask-card-input"
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* footer — 步进导航（滚动计数）+ 跳过/继续 */}
        <div className="ask-card-footer">
          <div className="ask-card-stepnav">
            <button
              type="button"
              aria-label="上一个问题"
              disabled={qi <= 0}
              onClick={() => goTo(qi - 1)}
              className="ask-card-step-btn"
            >
              <Ico size={14} path={<path d="M18 15l-6-6-6 6" />} />
            </button>
            <span className="ask-card-counter">
              <RollingDigits value={`${qi + 1} / ${questions.length}`} />
            </span>
            <button
              type="button"
              aria-label="下一个问题"
              disabled={last}
              onClick={() => goTo(qi + 1)}
              className="ask-card-step-btn"
            >
              <Ico size={14} path={<path d="M6 9l6 6 6-6" />} />
            </button>
          </div>

          <div className="ask-card-actions">
            <button type="button" className="ask-card-btn-ghost" onClick={() => (last ? dismiss() : goTo(qi + 1))}>
              跳过
            </button>
            <button type="button" className="ask-card-btn-primary" disabled={!hasAnswer} onClick={advance}>
              {last ? '发送' : '继续'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
