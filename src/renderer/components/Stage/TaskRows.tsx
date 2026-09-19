import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ListTodo } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { TodoItem } from '../../../shared/types'

// TaskRows —— Stage 右上角的 TodoWrite 任务卡（beui TodoList 移植）
// 头栏：全部完成时 ListTodo↔绿勾圆标 swap 动画 + 计数 + chevron；
// 行：状态图标（pending 虚线圈 / in_progress 旋转进度弧 / completed 打勾 pathLength 动画），
// 完成行文字上划线生长动画；全部完成自动折叠，新一轮任务自动展开。
// maxHeight 内滚动，新行追加自动滚底。

const EASE_OUT = [0.22, 1, 0.36, 1] as const
const SPRING_SWAP = { type: 'spring' as const, stiffness: 500, damping: 32, mass: 0.8 }
const SPRING_LAYOUT = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.9 }

type Status = TodoItem['status']

function TodoHeaderIcon({ complete }: { complete: boolean }) {
  const reduce = useReducedMotion() ?? false
  return (
    <span aria-hidden="true" className="stage-task-hicon">
      <AnimatePresence initial={false} mode="popLayout">
        {complete ? (
          <motion.svg
            key="complete"
            viewBox="0 0 24 24"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="stage-task-hicon-svg is-complete"
          >
            <circle cx="12" cy="12" r="9" fill="currentColor" />
            <motion.path
              d="M7.5 12.25 10.5 15.25 16.75 8.75"
              fill="none"
              stroke="#fff"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
            />
          </motion.svg>
        ) : (
          <motion.span
            key="todo"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="stage-task-hicon-fallback"
          >
            <ListTodo size={15} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

function TodoStatusIcon({ status }: { status: Status }) {
  const reduce = useReducedMotion() ?? false
  return (
    <motion.svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      initial={false}
      className={`stage-task-sicon${status === 'in_progress' ? ' is-run' : ''}`}
    >
      {/* 底圈：pending 虚线环；completed 时淡填充 */}
      <motion.circle
        cx="12" cy="12" r="9"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={status === 'pending' ? '2 3' : undefined}
        strokeLinecap="round"
        initial={false}
        animate={{ fillOpacity: status === 'completed' ? 0.06 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
        className={status === 'in_progress' ? 'is-run-base' : undefined}
      />
      {/* 进度弧：in_progress 旋转（无 progress 数据时）；completed/pending 隐藏 */}
      <motion.circle
        cx="12" cy="12" r="9"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        initial={false}
        animate={{
          pathLength: status === 'in_progress' ? 0.68 : 0,
          opacity: status === 'in_progress' ? 1 : 0,
          rotate: status === 'in_progress' && !reduce ? 360 : -90,
        }}
        transition={
          status === 'in_progress' && !reduce
            ? { rotate: { duration: 1.1, repeat: Infinity, ease: 'linear' } }
            : reduce
              ? { duration: 0 }
              : SPRING_LAYOUT
        }
        style={{ transformOrigin: '12px 12px' }}
      />
      {/* 完成勾：pathLength 生长 */}
      <motion.path
        d="M7.5 12.25 10.5 15.25 16.75 8.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{
          pathLength: status === 'completed' ? 1 : 0,
          opacity: status === 'completed' ? 1 : 0,
        }}
        transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
      />
    </motion.svg>
  )
}

export const TaskRows = memo(function TaskRows({
  todos,
  title = 'To-dos',
  maxHeight = 220,
}: {
  todos: TodoItem[]
  title?: string
  maxHeight?: number
}) {
  const reduce = useReducedMotion() ?? false
  const baseId = useId()
  const viewportRef = useRef<HTMLDivElement>(null)
  const previousComplete = useRef(false)
  const [internalOpen, setInternalOpen] = useState(true)
  const currentOpen = internalOpen
  const completed = todos.filter((t) => t.status === 'completed').length
  const allComplete = todos.length > 0 && completed === todos.length
  const setOpen = useCallback((next: boolean) => setInternalOpen(next), [])

  // 全部完成自动折叠；从全完成回到未完成（新一轮任务）自动展开
  useEffect(() => {
    if (previousComplete.current && !allComplete) setOpen(true)
    if (!previousComplete.current && allComplete) setOpen(false)
    previousComplete.current = allComplete
  }, [allComplete, setOpen])

  // 行追加时滚到底
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || todos.length === 0) return
    const frame = requestAnimationFrame(() => {
      if (viewport.scrollHeight <= viewport.clientHeight) return
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [todos.length, reduce])

  const triggerId = `${baseId}-trigger`
  const contentId = `${baseId}-content`

  return (
    <section aria-label="Agent task list" className="stage-task-card">
      <button
        id={triggerId}
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="stage-task-header"
      >
        <TodoHeaderIcon complete={allComplete} />
        <span className="stage-task-title">{title}</span>
        <span className={`stage-task-count tabular-nums${allComplete ? ' is-done' : ''}`}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={completed}
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={reduce ? { duration: 0 } : SPRING_SWAP}
              style={{ display: 'inline-block' }}
            >
              {completed}
            </motion.span>
          </AnimatePresence>
          /{todos.length}
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="stage-task-chevron"
        >
          <ChevronDown size={13} />
        </motion.span>
      </button>

      {/* 展开/收起：grid-rows 0fr→1fr（AgentDisclosure 同语法） */}
      <div
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        className="stage-task-disclose"
        data-open={currentOpen}
      >
        <div className="stage-task-clip">
          <div className="stage-task-viewport" ref={viewportRef} style={{ maxHeight }}>
            {todos.length ? (
              <ol aria-live="polite" className="stage-task-rows">
                <AnimatePresence initial={false} mode="popLayout">
                  {todos.map((t, i) => (
                    <motion.li
                      layout="position"
                      // key 用下标：TodoWrite 每次全量替换、行位置基本稳定；
                      // 用内容做 key 会在"同一行内容改动"时把行当成新节点全部重播动画
                      key={i}
                      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
                      transition={
                        reduce
                          ? { duration: 0 }
                          : {
                              opacity: { duration: 0.18, ease: EASE_OUT },
                              y: SPRING_LAYOUT,
                              layout: SPRING_LAYOUT,
                            }
                      }
                      className="stage-task-row"
                      data-status={t.status}
                    >
                      <TodoStatusIcon status={t.status} />
                      <span className="stage-task-label">
                        <span className="stage-task-label-inner">
                          {t.content}
                          <motion.span
                            aria-hidden="true"
                            initial={false}
                            animate={{
                              scaleX: t.status === 'completed' ? 1 : 0,
                              opacity: t.status === 'completed' ? 1 : 0,
                            }}
                            transition={reduce ? { duration: 0 } : { duration: 0.28, ease: EASE_OUT, delay: 0.06 }}
                            className="stage-task-strike"
                          />
                        </span>
                      </span>
                      {t.note && <span className="stage-task-note">{t.note}</span>}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            ) : (
              <p className="stage-task-empty">No tasks yet</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
})
