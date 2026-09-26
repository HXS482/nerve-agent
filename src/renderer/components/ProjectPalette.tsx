import { Fragment, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  CornerDownLeft,
  Folder,
  HardDrive,
  Monitor,
  Search,
} from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { useStageStore } from '../stores/stageStore'
import { baseName, parentPath, pathSegments } from '../utils/projectPaths'
import type { DirEntry } from '../../shared/types'

type Level = 'device' | 'browse'

interface Item {
  key: string
  label: string
  kind: 'device' | 'root' | 'dir' | 'use'
  path?: string
}

// 居中命令面板：设备 → 目录浏览 → 选定项目。全程应用内，不动系统文件夹对话框
export function ProjectPalette({ onSelect }: { onSelect: (path: string) => void }) {
  const open = useStageStore((s) => s.projectPickerOpen)
  const setOpen = useStageStore((s) => s.setProjectPickerOpen)
  const currentCwd = useChatStore((s) => s.config.cwd)

  const [level, setLevel] = useState<Level>('device')
  // browse 层的当前目录；null = 磁盘根列表
  const [dir, setDir] = useState<string | null>(null)
  const [roots, setRoots] = useState<string[]>([])
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [error, setError] = useState('')
  const [host, setHost] = useState('')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // 下钻 / 回退的滑动方向
  const [nav, setNav] = useState<'forward' | 'back'>('forward')

  // 关闭即复位：下次打开直接就是设备层，不会先闪一帧上次停留的目录
  useEffect(() => {
    if (open) return
    setLevel('device')
    setDir(null)
    setQuery('')
    setActive(0)
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    window.claude.getHostname().then(setHost).catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open || level !== 'browse') return
    let alive = true
    setActive(0)
    setError('')
    if (dir === null) {
      setEntries([])
      window.claude.listRoots().then((r) => { if (alive) setRoots(r) }).catch(() => {})
      return () => { alive = false }
    }
    window.claude.listDir(dir).then((res) => {
      if (!alive) return
      if (!res.success) {
        setError(res.error || '无法读取目录')
        setEntries([])
        return
      }
      setEntries(res.entries.filter((e) => e.isDirectory))
    }).catch(() => {
      if (!alive) return
      setError('无法读取目录')
      setEntries([])
    })
    return () => { alive = false }
  }, [open, level, dir])

  const items = useMemo<Item[]>(() => {
    if (level === 'device') return [{ key: 'device', label: host || 'This machine', kind: 'device' }]
    if (dir === null) return roots.map((r) => ({ key: r, label: r, kind: 'root' as const, path: r }))
    return [
      { key: '__use__', label: 'Use this folder', kind: 'use', path: dir },
      ...entries.map((e) => ({ key: e.path, label: e.name, kind: 'dir' as const, path: e.path })),
    ]
  }, [level, dir, roots, entries, host])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // 「Use this folder」是动作行，搜索时不过滤掉
    if (!q) return items
    return items.filter((it) => it.kind === 'use' || it.label.toLowerCase().includes(q))
  }, [items, query])

  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0))
  const crumbs = useMemo(() => (dir ? pathSegments(dir) : []), [dir])
  // 一页 = 一个层级：设备层 / 盘列表 / 某个具体目录
  const pageKey = level === 'device' ? 'device' : (dir ?? 'roots')

  const commit = (path: string) => {
    setOpen(false)
    onSelect(path)
  }

  const openItem = (item?: Item) => {
    if (!item) return
    if (item.kind === 'use') {
      commit(item.path!)
      return
    }
    setQuery('')
    setNav('forward')
    if (item.kind === 'device') {
      // 直接落在当前项目所在目录，省掉逐级下钻
      setLevel('browse')
      setDir(currentCwd || null)
      return
    }
    setLevel('browse')
    setDir(item.path!)
  }

  const goUp = () => {
    setQuery('')
    setActive(0)
    setNav('back')
    if (level === 'device') {
      setOpen(false)
      return
    }
    if (!dir) {
      setLevel('device')
      return
    }
    // 盘根没有上一级 → 退回盘列表
    setDir(parentPath(dir))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 方向键在空列表上不做游标位移（否则 activeIndex 会走到 -1）
    if (filtered.length === 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setActive(Math.min(activeIndex + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setActive(Math.max(activeIndex - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      openItem(filtered[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  if (!open) return null

  const iconFor = (item: Item) => {
    if (item.kind === 'device') return <Monitor size={16} strokeWidth={1.7} />
    if (item.kind === 'root') return <HardDrive size={16} strokeWidth={1.7} />
    if (item.kind === 'use') return <Check size={16} strokeWidth={1.9} />
    return <Folder size={16} strokeWidth={1.7} />
  }

  return (
    <div className="project-palette-mask" onMouseDown={() => setOpen(false)}>
      <div
        className="project-palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="project-palette-head">
          <Search size={16} strokeWidth={1.8} className="project-palette-search-icon" />
          <input
            className="project-palette-input"
            autoFocus
            spellCheck={false}
            placeholder={level === 'device' ? 'Search devices...' : 'Search folders...'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
          />
          <span className="project-kbd">esc</span>
        </div>

        <div className="project-palette-sep" />

        <div className="project-palette-crumbs scrollbar-hide">
          <button className="project-palette-back" onClick={goUp} title="返回上一级">
            <ArrowLeft size={15} strokeWidth={1.9} />
          </button>
          <span className="project-palette-crumb-sep" />
          <button
            className={`project-palette-crumb${level === 'device' ? ' is-current' : ''}`}
            onClick={() => {
              setNav('back')
              setLevel('device')
              setDir(null)
              setQuery('')
            }}
          >
            New project
          </button>
          {crumbs.map((seg, i) => (
            <Fragment key={seg.path}>
              <ChevronRight size={12} strokeWidth={2} className="project-palette-crumb-arrow" />
              <button
                className={`project-palette-crumb${i === crumbs.length - 1 ? ' is-current' : ''}`}
                title={seg.path}
                onClick={() => {
                  // 第 i 级相对当前层：往深了点是前推，往回跳是后退
                  setNav(i < crumbs.length - 1 ? 'back' : 'forward')
                  setDir(seg.path)
                  setQuery('')
                }}
              >
                {seg.name}
              </button>
            </Fragment>
          ))}
        </div>

        <div className="project-palette-list">
          {/* 换目录 = 换页：新页推入、旧页推出（popLayout 让旧页脱流，面板高度立刻跟着新页走） */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={pageKey}
              className="project-palette-page"
              initial={{ opacity: 0, x: nav === 'forward' ? 28 : -28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: nav === 'forward' ? -28 : 28 }}
              // 位移走弹簧（收尾有回弹，比定时 tween 顺）；透明度单独用短 tween，跟弹簧解耦
              transition={{
                x: { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 },
                opacity: { duration: 0.16, ease: 'easeOut' },
              }}
            >
              {error && <div className="project-palette-note">{error}</div>}
              {!error && filtered.length === 0 && (
                <div className="project-palette-note">没有子目录</div>
              )}
              {filtered.map((item, i) => (
                <button
                  key={item.key}
                  className={`project-palette-row${i === activeIndex ? ' is-active' : ''}${item.kind === 'use' ? ' is-action' : ''}`}
                  title={item.path}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => openItem(item)}
                >
                  {iconFor(item)}
                  <span className="project-palette-row-label">{item.label}</span>
                  {item.kind === 'device' && <span className="project-dot" />}
                </button>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="project-palette-sep" />

        <div className="project-palette-foot">
          <span className="project-hint">
            <span className="project-kbd"><ArrowUp size={10} strokeWidth={2.2} /></span>
            <span className="project-kbd"><ArrowDown size={10} strokeWidth={2.2} /></span>
            Navigate
          </span>
          <span className="project-hint">
            <span className="project-kbd"><CornerDownLeft size={10} strokeWidth={2.2} /></span>
            Open
          </span>
          <span className="project-hint">
            <span className="project-kbd">esc</span>
            Close
          </span>
        </div>
      </div>
    </div>
  )
}
