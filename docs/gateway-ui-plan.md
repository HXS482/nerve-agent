# Gateway 管理面板 UI 设计

## 1. 整体布局

```
RightSidebar (280-380px)
┌────────────────────────────────┐
│ [Flow] [Files] [Git] [Gateway] │  ← 顶部 Tab 切换
├────────────────────────────────┤
│                                │
│   GatewayView 内容区           │
│   (可滚动)                     │
│                                │
└────────────────────────────────┘
```

## 2. GatewayView 组件结构

```
GatewayView
├── StatusCard (状态概览)
│   ├── Gateway 状态 (运行中/已停止)
│   ├── 运行时间
│   ├── 连接数
│   ├── 会话数
│   └── 内存使用
│
├── AdaptersCard (适配器管理)
│   ├── Telegram
│   │   ├── 状态 (已连接/未连接)
│   │   ├── 启用/禁用开关
│   │   └── 配置按钮
│   ├── Discord
│   │   ├── 状态
│   │   ├── 启用/禁用开关
│   │   └── 配置按钮
│   └── WebSocket
│       ├── 状态
│       ├── 端口
│       └── 连接数
│
├── SessionsCard (活跃会话)
│   ├── 会话列表
│   │   ├── 用户 ID
│   │   ├── 平台 (telegram/discord/ws)
│   │   ├── 最后活跃时间
│   │   └── 操作按钮 (查看/删除)
│   └── 分页/加载更多
│
└── LogsCard (日志)
    ├── 日志级别过滤 (INFO/WARN/ERROR)
    ├── 实时日志流
    └── 清除按钮
```

## 3. 数据流

```
┌─────────────────────────────────────────────────┐
│                GatewayView (React)               │
│                                                 │
│  useEffect(() => {                              │
│    // 通过 IPC 获取 Gateway 状态                │
│    window.electron.ipc.invoke('gateway:status') │
│  }, [])                                         │
│                                                 │
│  useEffect(() => {                              │
│    // 订阅 Gateway 事件                         │
│    window.electron.ipc.on('gateway:event', ...) │
│  }, [])                                         │
└─────────────────────────────────────────────────┘
                        │
                        ▼ IPC
┌─────────────────────────────────────────────────┐
│           Electron Main Process                 │
│                                                 │
│  ipcMain.handle('gateway:status', () => {       │
│    return gateway.getHealth()                   │
│  })                                             │
│                                                 │
│  ipcMain.handle('gateway:adapters', () => {     │
│    return gateway.getAdapters()                 │
│  })                                             │
│                                                 │
│  ipcMain.handle('gateway:sessions', () => {     │
│    return gateway.getSessions()                 │
│  })                                             │
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│              Gateway 后端 (已有)                 │
└─────────────────────────────────────────────────┘
```

## 4. 组件详细设计

### 4.1 StatusCard

```tsx
function StatusCard() {
  const [health, setHealth] = useState<GatewayHealth | null>(null)

  useEffect(() => {
    // 初始加载
    window.electron.ipc.invoke('gateway:status').then(setHealth)

    // 定时刷新 (每 5 秒)
    const timer = setInterval(() => {
      window.electron.ipc.invoke('gateway:status').then(setHealth)
    }, 5000)

    return () => clearInterval(timer)
  }, [])

  return (
    <div className="status-card">
      <div className="status-header">
        <StatusDot status={health?.status} />
        <span>Gateway</span>
        <span className="uptime">{formatUptime(health?.uptime)}</span>
      </div>
      <div className="status-metrics">
        <Metric icon="link" label="连接" value={health?.clientCount} />
        <Metric icon="session" label="会话" value={health?.activeSessions} />
        <Metric icon="memory" label="内存" value={formatMemory(health?.memoryUsage)} />
      </div>
    </div>
  )
}
```

### 4.2 AdaptersCard

```tsx
function AdaptersCard() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([])

  useEffect(() => {
    window.electron.ipc.invoke('gateway:adapters').then(setAdapters)
  }, [])

  const toggleAdapter = async (name: string, enabled: boolean) => {
    await window.electron.ipc.invoke('gateway:adapter:toggle', name, enabled)
    // 刷新状态
    window.electron.ipc.invoke('gateway:adapters').then(setAdapters)
  }

  return (
    <div className="adapters-card">
      <h3>适配器</h3>
      {adapters.map(adapter => (
        <div key={adapter.name} className="adapter-item">
          <AdapterIcon name={adapter.name} />
          <span className="adapter-name">{adapter.name}</span>
          <StatusBadge connected={adapter.connected} />
          <Toggle
            checked={adapter.enabled}
            onChange={(enabled) => toggleAdapter(adapter.name, enabled)}
          />
        </div>
      ))}
    </div>
  )
}
```

### 4.3 SessionsCard

```tsx
function SessionsCard() {
  const [sessions, setSessions] = useState<SessionInfo[]>([])

  useEffect(() => {
    window.electron.ipc.invoke('gateway:sessions').then(setSessions)
  }, [])

  return (
    <div className="sessions-card">
      <h3>活跃会话</h3>
      {sessions.length === 0 ? (
        <EmptyState text="暂无活跃会话" />
      ) : (
        sessions.map(session => (
          <div key={session.sessionId} className="session-item">
            <PlatformIcon platform={session.platform} />
            <span className="user-id">{session.userId}</span>
            <span className="last-active">{formatTime(session.lastActive)}</span>
            <button onClick={() => deleteSession(session.sessionId)}>
              <TrashIcon />
            </button>
          </div>
        ))
      )}
    </div>
  )
}
```

### 4.4 LogsCard

```tsx
function LogsCard() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 订阅日志事件
    window.electron.ipc.on('gateway:log', (entry: LogEntry) => {
      setLogs(prev => [...prev.slice(-100), entry]) // 保留最近 100 条
    })
  }, [])

  useEffect(() => {
    // 自动滚动到底部
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length])

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter(log => log.level === filter)

  return (
    <div className="logs-card">
      <div className="logs-header">
        <h3>日志</h3>
        <div className="logs-filters">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterButton>
          <FilterButton active={filter === 'info'} onClick={() => setFilter('info')}>Info</FilterButton>
          <FilterButton active={filter === 'warn'} onClick={() => setFilter('warn')}>Warn</FilterButton>
          <FilterButton active={filter === 'error'} onClick={() => setFilter('error')}>Error</FilterButton>
        </div>
        <button onClick={() => setLogs([])}>Clear</button>
      </div>
      <div ref={scrollRef} className="logs-content">
        {filteredLogs.map((log, i) => (
          <div key={i} className={`log-entry log-${log.level}`}>
            <span className="log-time">{formatTime(log.timestamp)}</span>
            <span className="log-message">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

## 5. IPC 接口定义

```typescript
// src/shared/types.ts 新增

export interface GatewayHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  uptime: number
  activeSessions: number
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number }
  clientCount: number
  adapters: Record<string, boolean>
}

export interface AdapterInfo {
  name: string
  platform: string
  enabled: boolean
  connected: boolean
  config: Record<string, unknown>
}

export interface SessionInfo {
  sessionId: string
  platform: string
  userId: string
  chatId: string
  lastActive: number
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: number
}

// IPC Channels
export const GATEWAY_IPC = {
  STATUS: 'gateway:status',
  ADAPTERS: 'gateway:adapters',
  ADAPTER_TOGGLE: 'gateway:adapter:toggle',
  SESSIONS: 'gateway:sessions',
  SESSION_DELETE: 'gateway:session:delete',
  LOG: 'gateway:log',
} as const
```

## 6. 样式设计

遵循现有设计语言：
- Proton Dark + Glassmorphism
- `backdrop-filter: blur()` + `rgba` 半透明
- 圆角 8-12px
- 字号 11-12px
- 动态岛风格胶囊按钮

```css
/* 状态卡片 */
.status-card {
  background: var(--bg-surface-container);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 12px;
}

/* 适配器项 */
.adapter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}

/* 日志条目 */
.log-entry {
  font-family: monospace;
  font-size: 11px;
  padding: 2px 0;
}

.log-info { color: var(--text-outline-variant); }
.log-warn { color: #f59e0b; }
.log-error { color: #ef4444; }
```

## 7. 实现步骤

1. **添加 IPC 接口** - 在 preload 和 main 中注册
2. **创建 GatewayView 组件** - 实现上述 UI
3. **修改 RightSidebar** - 添加 gateway view
4. **连接 Gateway 后端** - 获取状态和日志
5. **测试和优化**

## 8. 预估工作量

| 任务 | 工作量 |
|------|--------|
| IPC 接口 | 2-3 小时 |
| GatewayView 组件 | 4-6 小时 |
| RightSidebar 修改 | 1 小时 |
| 测试和调试 | 2-3 小时 |
| **总计** | **1-2 天** |
