import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { useStageStore } from '../../stores/stageStore'
import { buildStageView } from '../../adapters/stageAdapter'
import type { StageCardKind } from './StageCard'

// 用户消息时间轴（右下角）：roadmap 式竖向轨道，每轮一个节点，节点右侧贴该轮用户消息文本。
// 焦点轮之前的轨道段点亮（已行驶过），焦点轮绿色呼吸；产物类型以小图标贴在文本前。
// 点击整行（文字或节点）切换回看该轮，再点回到最新轮。

const KIND_ICON_PATHS: Partial<Record<StageCardKind, ReactNode>> = {
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  code: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 010 18" />
      <path d="M12 3a15 15 0 000 18" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
}

export function UserLogTerminal({ messages }: { messages: ChatMessage[] }) {
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const selectedRoundId = useStageStore((s) => s.selectedRoundId)
  const setSelectedRoundId = useStageStore((s) => s.setSelectedRoundId)

  const vm = useMemo(() => {
    const sessionMsgs = currentSessionId ? messages.filter((m) => m.sessionId === currentSessionId) : []
    return buildStageView(sessionMsgs, selectedRoundId)
  }, [messages, currentSessionId, selectedRoundId])

  // 新轮追加时滚到底，保证最新轮（呼吸节点）在折叠视口内可见；
  // 只随轮数变化触发——点击回看旧轮不改变轮数，不会把列表拽走
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [vm.rounds.length])

  if (vm.rounds.length === 0) return null

  // 焦点轮可能是不进列表的孤儿轮（auto-*），此时无任何行高亮，与改动前一致
  const activeIdx = vm.rounds.findIndex((r) => r.id === vm.focusRoundId)

  return (
    <div className="user-log-timeline" ref={listRef}>
      {vm.rounds.map((r, i) => {
        const state = i === activeIdx ? 'is-active' : activeIdx > 0 && i < activeIdx ? 'is-passed' : ''
        const cls = ['user-log-entry', state, r.hasArtifacts ? 'has-artifacts' : ''].filter(Boolean).join(' ')
        return (
          <button
            key={r.id}
            type="button"
            className={cls}
            title={r.userText}
            aria-label={r.userText || '对话轮'}
            onClick={() => setSelectedRoundId(selectedRoundId === r.id ? null : r.id)}
          >
            <span className="user-log-dot" aria-hidden />
            {r.artifactKinds.length > 0 && (
              <span className="user-log-kinds" aria-hidden>
                {r.artifactKinds.slice(0, 3).map((k) =>
                  KIND_ICON_PATHS[k] ? (
                    <svg key={k} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {KIND_ICON_PATHS[k]}
                    </svg>
                  ) : null,
                )}
              </span>
            )}
            <span className="user-log-text">{r.userText}</span>
          </button>
        )
      })}
    </div>
  )
}
