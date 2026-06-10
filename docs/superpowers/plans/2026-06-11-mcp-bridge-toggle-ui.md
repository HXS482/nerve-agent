# MCP Bridge Toggle UI 实施计划

> 在 GatewayView 适配器面板添加 MCP Bridge 开关卡片

**Goal:** 在 GatewayView 的适配器列表下方添加 MCP Bridge 行，支持开关控制和状态显示

**Architecture:** 复用 AdapterList 的胶囊 toggle 样式，新增 MCP_BRIDGE_TOGGLE IPC channel 实现 start/stop + 配置持久化

---

## 文件改动

| 文件 | 改动 |
|------|------|
| `src/shared/types.ts` | 新增 `MCP_BRIDGE_TOGGLE` channel |
| `src/main/ipc.ts` | 新增 toggle handler |
| `src/preload/index.ts` | 新增桥接方法 |
| `src/renderer/components/GatewayView.tsx` | 获取 bridge 状态，传给 AdapterList |
| `src/renderer/components/gateway/AdapterList.tsx` | 渲染 MCP Bridge 卡片行 |

---

## Task 1: 后端 IPC

### shared/types.ts

在 `MCP_BRIDGE_STATUS` 之后追加：
```typescript
MCP_BRIDGE_TOGGLE: 'mcp-bridge:toggle',
```

### ipc.ts

在 `if (mcpBridge)` guard 内追加 toggle handler：

```typescript
ipcMain.handle(IPC_CHANNELS.MCP_BRIDGE_TOGGLE, async (_event, enabled: boolean) => {
  try {
    if (enabled) {
      await mcpBridge.start()
    } else {
      await mcpBridge.stop()
    }
    const config = await loadMcpBridgeConfig()
    config.enabled = enabled
    await saveMcpBridgeConfig(config)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
})
```

### preload/index.ts

在 Gateway 区域追加：
```typescript
mcpBridgeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_BRIDGE_STATUS),
mcpBridgeToggle: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.MCP_BRIDGE_TOGGLE, enabled),
```

---

## Task 2: 前端 UI

### GatewayView.tsx

1. GatewayAPI 接口追加：
```typescript
mcpBridgeStatus: () => Promise<{ status: string; toolCount: number; port: number; tunnelUrl: string | null }>;
mcpBridgeToggle: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
```

2. 新增 state：`const [bridgeHealth, setBridgeHealth] = useState<{ toolCount: number; tunnelUrl: string | null } | null>(null)`

3. 新增 fetchBridgeHealth callback，与 fetchAdapters 一起轮询

4. 传给 `<AdapterList>` 新增 props：`bridgeHealth` 和 `onBridgeToggle`

### AdapterList.tsx

在适配器列表容器**下方**追加 MCP Bridge 行（独立的 card container）：

```
┌─────────────────────────────────────┐
│ ● MCP Bridge              10 tools  │
│   ○ OFF                   [toggle]  │
└─────────────────────────────────────┘
```

- 圆点：bridgeHealth 存在且 tunnelUrl 有值 → 绿色带 glow；否则灰色
- 名称：`MCP Bridge`
- 信息：`{toolCount} tools` 或 tunnelUrl
- ON/OFF 标签 + 胶囊 toggle（复用已有样式）
- 点击 toggle 调用 `onBridgeToggle(!enabled)`

---

## Commit

```bash
git add src/shared/types.ts src/main/ipc.ts src/preload/index.ts src/renderer/components/GatewayView.tsx src/renderer/components/gateway/AdapterList.tsx
git commit -m "feat(mcp-bridge): add toggle UI in GatewayView adapter panel"
```
