import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { baseName } from '../../utils/projectPaths'

interface Props {
  onSelectProject: (path: string) => void
  onNewProject: () => void
  onClose: () => void
}

// 项目头下拉：搜索 + 最近项目 + New project…（全程应用内，不弹系统对话框）。
// 关闭遮罩由调用方（StageSessions）铺在抽屉里，这里只画面板本身。
export function ProjectMenu({ onSelectProject, onNewProject, onClose }: Props) {
  const currentCwd = useChatStore((s) => s.config.cwd)
  const [projects, setProjects] = useState<string[]>([])
  const [host, setHost] = useState('')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    window.claude.getRecentProjects().then(setProjects).catch(() => {})
    window.claude.getHostname().then(setHost).catch(() => {})
  }, [])

  // 当前项目置顶（与参考图一致：第一行就是当前仓库），其余按最近使用排序；
  // 首次启动时 recentProjects 可能还是空的，这里把当前目录补进去
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = currentCwd && !projects.includes(currentCwd) ? [currentCwd, ...projects] : projects
    const sorted = [...all].sort((a, b) =>
      a === currentCwd ? -1 : b === currentCwd ? 1 : 0,
    )
    return q ? sorted.filter((p) => baseName(p).toLowerCase().includes(q)) : sorted
  }, [projects, query, currentCwd])

  // "New project…" 是列表末尾的一项，参与同一个上下键游标
  const itemCount = filtered.length + 1

  const pick = (index: number) => {
    if (index < filtered.length) onSelectProject(filtered[index])
    else onNewProject()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setActive((i) => Math.min(i + 1, itemCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      pick(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div className="project-menu">
      <input
        className="project-menu-search"
        autoFocus
        spellCheck={false}
        placeholder="Search projects..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="project-menu-label">All projects</div>
      <div className="project-menu-list">
        {filtered.length === 0 && (
          <div className="project-menu-empty">
            {projects.length === 0 ? '还没有打开过项目' : '没有匹配的项目'}
          </div>
        )}
        {filtered.map((path, i) => (
          <button
            key={path}
            className={`project-row${i === active ? ' is-active' : ''}`}
            title={path}
            onMouseEnter={() => setActive(i)}
            onClick={() => onSelectProject(path)}
          >
            <span className="project-row-name">{baseName(path)}</span>
            {host && <span className="project-row-meta">@ {host}</span>}
          </button>
        ))}
      </div>
      <div className="project-menu-sep" />
      <button
        className={`project-row${active === filtered.length ? ' is-active' : ''}`}
        onMouseEnter={() => setActive(filtered.length)}
        onClick={onNewProject}
      >
        <Plus size={12} strokeWidth={2} />
        <span>New project...</span>
      </button>
    </div>
  )
}
