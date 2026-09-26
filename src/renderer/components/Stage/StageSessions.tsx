import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useStageStore } from '../../stores/stageStore'

// 路径末段：兼容 win/posix 分隔符与结尾斜杠
function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}

function formatSessionTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

interface Props {
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onPickDirectory: () => void
}

// Stage 模式的会话抽屉：项目头 + 三段式条目（仓库 / 标题 / 分支）
export function StageSessions({ onSelectSession, onNewSession, onPickDirectory }: Props) {
  const sessions = useChatStore((s) => s.sessions)
  const configCwd = useChatStore((s) => s.config.cwd)
  const currentSessionId = useStageStore((s) => s.stageSessionId)
  const deleteSession = useChatStore((s) => s.deleteSession)

  const stageSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.mode === 'stage')
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  )

  // 机器名：进程级常量，进组件取一次
  const [host, setHost] = useState('')
  useEffect(() => {
    window.claude.getHostname().then(setHost).catch(() => {})
  }, [])

  // 条目涉及的所有目录，一次批量取当前分支
  const cwds = useMemo(() => {
    const set = new Set<string>()
    for (const s of stageSessions) set.add(s.cwd || configCwd)
    set.delete('')
    return [...set]
  }, [stageSessions, configCwd])

  const [branches, setBranches] = useState<Record<string, string>>({})
  useEffect(() => {
    if (cwds.length === 0) return
    let alive = true
    window.claude
      .gitCurrentBranches(cwds)
      .then((map) => {
        if (alive) setBranches(map)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [cwds])

  const repo = configCwd ? baseName(configCwd) : ''

  return (
    <div className="stage-sessions">
      {/* 项目头：当前工作目录 + 机器名；点开切目录，右侧 + 新建会话 */}
      <div className="stage-project-head">
        <button className="stage-project-pick" onClick={onPickDirectory} title="切换工作目录">
          {/* 实心填充（单 path 三段子路径：外轮廓 + 内挖空 + 顶部横条），尺寸由 CSS 的 clamp 控制。
              线宽烤在几何里（墙厚 64/1024），没有 stroke 可调；叠一层同色描边等比加粗：
              外缘外扩、内孔内缩，线宽净增一个 stroke-width（64 → 96，+50%） */}
          <svg
            className="stage-project-icon"
            viewBox="0 0 1024 1024"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={32}
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M725.333333 96A202.666667 202.666667 0 0 1 928 298.666667v482.602666a117.333333 117.333333 0 0 1-151.04 112.426667l-225.109333-67.541333a138.624 138.624 0 0 0-79.701334 0L247.04 893.696a117.333333 117.333333 0 0 1-151.04-112.426667V298.666667A202.666667 202.666667 0 0 1 298.666667 96h426.666666zM298.666667 160A138.666667 138.666667 0 0 0 160 298.666667v482.602666a53.333333 53.333333 0 0 0 68.693333 51.114667l225.066667-67.498667a202.752 202.752 0 0 1 116.48 0l225.109333 67.498667a53.333333 53.333333 0 0 0 68.650667-51.114667V298.666667A138.666667 138.666667 0 0 0 725.333333 160H298.666667z m298.666666 106.666667a32 32 0 0 1 0 64h-170.666666a32 32 0 0 1 0-64h170.666666z" />
          </svg>
          <span className="stage-project-text">
            <span className="stage-project-name">{repo || '未设目录'}</span>
            {host && <span className="stage-project-host">@ {host}</span>}
          </span>
          <svg className="stage-project-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button className="stage-project-new" onClick={onNewSession} title="新建会话">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="stage-sessions-list">
        {stageSessions.length === 0 && (
          <div className="stage-sessions-empty">还没有空间会话</div>
        )}
        {stageSessions.map((s) => {
          const cwd = s.cwd || configCwd
          const branch = cwd ? branches[cwd] : ''
          return (
            <div
              key={s.id}
              className={`stage-session-item${s.id === currentSessionId ? ' is-active' : ''}`}
              onClick={() => onSelectSession(s.id)}
            >
              <div className="stage-session-head">
                <span className="stage-session-scope">
                  {cwd ? baseName(cwd) : 'local'}
                  {host && ` @ ${host}`}
                </span>
                {/* 时间与操作同格：hover 时时间淡出、操作浮出 */}
                <span className="stage-session-aside">
                  <span className="stage-session-time">{formatSessionTime(s.updatedAt)}</span>
                  <span className="stage-session-actions">
                    <button
                      className="stage-session-act"
                      title="移至聊天"
                      onClick={(e) => {
                        e.stopPropagation()
                        useChatStore.getState().markSessionMode(s.id, 'chat')
                        useChatStore.getState().updateSession(s.id, { mode: 'chat' })
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M11 6l-6 6 6 6" />
                      </svg>
                    </button>
                    <button
                      className="stage-session-act is-danger"
                      title="删除会话"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(s.id)
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </span>
                </span>
              </div>
              <div className="stage-session-title">{s.title || 'Untitled'}</div>
              {/* 分支行：非 git 目录留空，行高由 CSS 固定 */}
              <div className="stage-session-meta">
                {branch && (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="6" r="2.4" />
                      <circle cx="6" cy="18" r="2.4" />
                      <circle cx="18" cy="8" r="2.4" />
                      <path d="M6 8.4v7.2M18 10.4c0 3.2-3.2 4.6-6.4 4.6H8.4" />
                    </svg>
                    <span className="stage-session-branch">{branch}</span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
