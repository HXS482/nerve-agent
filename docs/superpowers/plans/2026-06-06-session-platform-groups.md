# Session Platform Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在左侧 Sidebar 的 SessionList 中按平台分组显示会话（Recent / Telegram / Discord 等），每组有 SVG 图标 + 颜色标识。

**Architecture:** SessionRouter 已有 sessionId → platform 映射，通过 GATEWAY_SESSIONS IPC 暴露给前端。前端 syncSessions 时注入 platform 到 Session 对象，SessionList 按 platform 分组渲染。

**Tech Stack:** TypeScript, React, Zustand, Electron IPC

---

### Task 1: 后端 — 完善 GATEWAY_SESSIONS IPC

**Files:**
- Modify: `src/main/gateway/gateway.ts`
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: 在 NerveGateway 暴露 session mappings**

在 `gateway.ts` 的 `getAdapters()` 方法后面加：

```ts
/**
 * 获取 Gateway 会话映射（sessionId → platform/userId）
 */
getSessionMappings() {
  return this.sessionRouter.getAllMappings()
}
```

- [ ] **Step 2: 完善 IPC handler**

在 `ipc.ts` 中找到：
```ts
ipcMain.handle(IPC_CHANNELS.GATEWAY_SESSIONS, async () => {
  // TODO: 实现会话列表
  return []
})
```

替换为：
```ts
ipcMain.handle(IPC_CHANNELS.GATEWAY_SESSIONS, async () => {
  if (!gateway) return []
  return gateway.getSessionMappings()
})
```

- [ ] **Step 3: Build 验证**

Run: `npx electron-vite build`
Expected: 成功

- [ ] **Step 4: Commit**

```bash
git add src/main/gateway/gateway.ts src/main/ipc.ts
git commit -m "feat: implement GATEWAY_SESSIONS IPC handler"
```

---

### Task 2: 前端 — Session 接口加 platform + syncSessions 注入

**Files:**
- Modify: `src/renderer/stores/chatStore.ts:7-13`
- Modify: `src/renderer/hooks/useClaude.ts:131-137`

- [ ] **Step 1: Session 接口加 platform**

在 `chatStore.ts` 中找到：
```ts
export interface Session {
  id: string
  title: string
  preview: string
  createdAt: number
  updatedAt: number
}
```

改为：
```ts
export interface Session {
  id: string
  title: string
  preview: string
  createdAt: number
  updatedAt: number
  platform?: string
}
```

- [ ] **Step 2: syncSessions 注入 platform**

在 `useClaude.ts` 中找到 `syncSessions` 函数（约 line 121），修改 `remoteMapped` 的构建：

```ts
const syncSessions = useCallback(async () => {
  try {
    const remoteSessions = await window.claude.listSessions()
    console.log('[Nerve] syncSessions remote:', Array.isArray(remoteSessions) ? remoteSessions.length + ' sessions' : remoteSessions)
    if (!Array.isArray(remoteSessions)) return

    // 查询 gateway 会话映射，获取 platform 信息
    let platformMap: Record<string, string> = {}
    try {
      const mappings = await (window.claude as any).gatewaySessionsGet()
      if (Array.isArray(mappings)) {
        for (const m of mappings) {
          platformMap[m.sessionId] = m.platform
        }
      }
    } catch {}

    const store = useChatStore.getState()
    const tempSessions = store.sessions.filter((s) => s.id.startsWith('session-'))

    const remoteMapped: Session[] = remoteSessions.map((rs) => ({
      id: rs.sessionId,
      title: rs.customTitle || rs.firstPrompt?.slice(0, 50) || rs.summary?.slice(0, 50) || 'Untitled',
      preview: rs.summary?.slice(0, 80) || '',
      createdAt: rs.createdAt || rs.lastModified,
      updatedAt: rs.lastModified,
      platform: platformMap[rs.sessionId],
    }))

    const remoteIds = new Set(remoteMapped.map((s) => s.id))
    const merged = [...remoteMapped, ...tempSessions.filter((s) => !remoteIds.has(s.id))]

    console.log('[Nerve] syncSessions merged:', merged.length, 'sessions')
    useChatStore.setState({ sessions: merged })
  } catch (err) {
    console.error('[Nerve] syncSessions error:', err)
  }
}, [])
```

- [ ] **Step 3: Build 验证**

Run: `npx electron-vite build`
Expected: 成功

- [ ] **Step 4: Commit**

```bash
git add src/renderer/stores/chatStore.ts src/renderer/hooks/useClaude.ts
git commit -m "feat: add platform field to Session, inject via syncSessions"
```

---

### Task 3: UI — SessionList 分组渲染 + SVG 图标

**Files:**
- Modify: `src/renderer/components/SessionList.tsx`

- [ ] **Step 1: 添加平台 SVG 图标和常量**

在 `SessionList.tsx` 顶部 import 后面添加：

```ts
const PLATFORM_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  telegram: {
    label: 'Telegram',
    color: '#229ED9',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
      </svg>
    ),
  },
  discord: {
    label: 'Discord',
    color: '#5865F2',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
    ),
  },
  wechat: {
    label: 'WeChat',
    color: '#09C063',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.134 0 .24-.11.24-.245 0-.06-.024-.12-.04-.178l-.325-1.233a.492.492 0 01.177-.554C23.144 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-7.062-6.122zm-2.18 2.768c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.553 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982z"/>
      </svg>
    ),
  },
  feishu: {
    label: 'Feishu',
    color: '#FFC107',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    ),
  },
  dingtalk: {
    label: 'DingTalk',
    color: '#0089FF',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
      </svg>
    ),
  },
}
```

- [ ] **Step 2: 重写 SessionList 为分组渲染**

完全替换 `SessionList.tsx` 的 return 部分（从 `return (` 开始到文件末尾）。保留所有 state/hooks/逻辑不变，只改渲染部分：

```tsx
  // 分组：按 platform 分类
  const groups = new Map<string, typeof sortedSessions>()
  for (const s of sortedSessions) {
    const key = s.platform || 'recent'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  }

  // 排序：Recent 在前，其余按平台名字母序
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
    if (a === 'recent') return -1
    if (b === 'recent') return 1
    return a.localeCompare(b)
  })

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ... 现有的 renderSessionItem 函数保持不变（提取为内部函数）

  return (
    <div>
      {sortedGroups.map(([groupKey, groupSessions]) => {
        const meta = groupKey === 'recent' ? null : PLATFORM_META[groupKey]
        const isCollapsed = collapsedGroups.has(groupKey)

        return (
          <div key={groupKey} style={{ marginBottom: 4 }}>
            {/* Group header */}
            <button
              onClick={() => toggleGroup(groupKey)}
              className="flex items-center gap-1.5 w-full cursor-pointer"
              style={{
                padding: '6px 8px 4px',
                background: 'transparent',
                border: 'none',
                color: meta?.color || 'var(--text-outline)',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              <svg
                width="7" height="7" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s', opacity: 0.6 }}
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
              {meta?.icon}
              <span>{meta?.label || 'Recent'}</span>
              <span style={{
                marginLeft: 'auto',
                background: meta?.color ? `${meta.color}20` : 'var(--bg-surface-container)',
                color: meta?.color || 'var(--text-outline)',
                padding: '1px 5px',
                borderRadius: 8,
                fontSize: 9,
                fontWeight: 500,
              }}>
                {groupSessions.length}
              </span>
            </button>

            {/* Group sessions */}
            {!isCollapsed && groupSessions.map((session) => {
              // ... 现有的 session item 渲染逻辑（和之前完全一样）
              const isActive = session.id === currentSessionId
              const branches = sessionBranches[session.id]
              const isExpanded = expandedSession === session.id && branches && branches.length > 1

              return (
                <div key={session.id}>
                  {/* ... 保持原有 session item JSX 不变 ... */}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
```

- [ ] **Step 3: Build 验证**

Run: `npx electron-vite build`
Expected: 成功

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SessionList.tsx
git commit -m "feat: group sessions by platform with SVG icons in sidebar"
```

---

### Task 4: 集成验证

**Files:**
- None (verification only)

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Build**

Run: `npx electron-vite build`
Expected: 成功

- [ ] **Step 3: 启动 dev server 手动验证**

- 本地会话显示在 "Recent" 分组
- Telegram 会话显示在 "Telegram" 分组（需先通过 Telegram 发过消息）
- 分组可折叠
- 无 channel 会话时只显示 "Recent"

- [ ] **Step 4: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: integration fixes for session platform groups"
```
