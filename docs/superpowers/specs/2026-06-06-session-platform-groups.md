# Session Platform Groups — 左侧面板按平台分组

**日期:** 2026-06-06
**分支:** feat/session-platform-groups

## 问题

所有会话（本地 + Telegram + Discord 等）混在一个扁平列表里，无法区分来源。

## 方案

在左侧 Sidebar 的 SessionList 中按平台分组显示，每组有 SVG 图标 + 颜色标识，可折叠。

## 数据流

```
SessionRouter.getAllMappings()          ← 已有，含 sessionId → platform 映射
  ↓
GATEWAY_SESSIONS IPC handler           ← 当前是 stub，需实现
  ↓
preload: gatewaySessionsGet()          ← 新增
  ↓
useClaude.syncSessions()               ← 注入 platform 到 Session 对象
  ↓
SessionList                            ← 按 platform 分组渲染
```

## 改动清单

### 1. 后端 IPC — 完善 GATEWAY_SESSIONS handler

**文件:** `src/main/ipc.ts`

当前:
```ts
ipcMain.handle(IPC_CHANNELS.GATEWAY_SESSIONS, async () => {
  return [] // TODO
})
```

改为:
```ts
ipcMain.handle(IPC_CHANNELS.GATEWAY_SESSIONS, async () => {
  if (!gateway) return []
  return gateway.getSessionMappings()
})
```

**文件:** `src/main/gateway/gateway.ts`

新增方法:
```ts
getSessionMappings() {
  return this.sessionRouter.getAllMappings()
}
```

### 2. 前端数据注入

**文件:** `src/renderer/stores/chatStore.ts`

Session 接口加 `platform`:
```ts
interface Session {
  id: string
  title: string
  preview: string
  createdAt: number
  updatedAt: number
  platform?: string  // 'telegram' | 'discord' | undefined (本地)
}
```

**文件:** `src/renderer/hooks/useClaude.ts`

syncSessions 时查询 gateway sessions，根据 sessionId 匹配注入 platform。

### 3. UI — SessionList 分组渲染

**文件:** `src/renderer/components/SessionList.tsx`

分组逻辑:
1. 将 sessions 按 `platform` 分组：`undefined` → "Recent"，其余按平台名
2. 每组渲染一个可折叠 header（SVG 图标 + 平台名 + 会话数 badge）
3. 组内会话保持原有样式（绿点、标题、删除按钮）
4. 平台颜色复用 `PLATFORM_COLOR`

### 4. SVG 图标

每个平台一个内联 SVG 图标（16x16），放在 `SessionList.tsx` 内：
- **Telegram** — 纸飞机
- **Discord** — Discord logo
- **WeChat** — 微信气泡
- **Feishu** — 飞书 logo
- **DingTalk** — 钉钉 logo
- **Recent** — 时钟图标

## 不做的事

- 不改 SessionStore 持久化逻辑
- 不改 FileSessionStore（platform 信息来自 SessionRouter，不写入 JSONL）
- 不做搜索功能（当前搜索栏是装饰，不在本次范围）

## 验证

- 本地会话显示在 "Recent" 分组
- Telegram 会话显示在 "Telegram" 分组，带蓝色纸飞机图标
- 每个分组可折叠
- 无 channel 会话时只显示 "Recent"
