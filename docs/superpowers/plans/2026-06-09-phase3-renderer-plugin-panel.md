# Phase 3: Renderer Hardening + Plugin Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Electron renderer security (sandbox: true) and add a Plugin Panel UI for managing plugins, viewing status, and triggering reload/rollback.

**Architecture:** Register a `nerve-file://` custom protocol for local file access, migrate `file://` URLs in Gallery/MessageBubble, then enable sandbox mode. Add IPC handlers for plugin management and a React PluginPanel component in the sidebar.

**Tech Stack:** Electron protocol API, React, Zustand, existing IPC pattern

**Spec reference:** `docs/superpowers/specs/2026-06-08-plugin-system-design.md` Sections 11, 12.3, 14.3

**Prerequisite:** Phase 1 + Phase 2 complete.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `src/main/index.ts` | Register `nerve-file://` protocol, enable sandbox |
| Modify | `src/renderer/components/Gallery.tsx` | Migrate `file://` → `nerve-file://` |
| Modify | `src/renderer/components/MessageBubble.tsx` | Migrate `file://` → `nerve-file://` |
| Modify | `src/shared/types.ts` | Add plugin IPC channel names |
| Modify | `src/preload/index.ts` | Expose plugin IPC methods |
| Modify | `src/main/ipc.ts` | Add plugin IPC handlers |
| Create | `src/renderer/components/PluginPanel.tsx` | Plugin management UI |
| Modify | `src/renderer/App.tsx` or `Sidebar.tsx` | Add Plugin Panel entry |

---

### Task 1: Register nerve-file:// protocol + enable sandbox

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Register custom protocol before app ready**

In `src/main/index.ts`, find where Electron's `app` is imported. Add protocol registration before `app.whenReady()` or before window creation:

```typescript
import { protocol } from 'electron'

// Register custom protocol for local file access (sandbox-safe)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nerve-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])
```

This must be called before `app.whenReady()`.

- [ ] **Step 2: Handle nerve-file:// protocol after app ready**

After `app.whenReady()` resolves, register the protocol handler:

```typescript
protocol.registerFileProtocol('nerve-file', (request, callback) => {
  const url = request.url.replace('nerve-file://', '')
  // Decode URL-encoded characters
  const filePath = decodeURIComponent(url)
  callback({ path: filePath })
})
```

- [ ] **Step 3: Enable sandbox on main window**

In the main window BrowserWindow options, change:
```typescript
sandbox: false,
webSecurity: false,
```
to:
```typescript
sandbox: true,
webSecurity: true,
```

- [ ] **Step 4: Enable sandbox on pet window**

Same change for the pet window (around line 166-170).

- [ ] **Step 5: Build and test**

Run: `npm run build`
Start the app and verify:
- Window renders correctly (DWM transparency works)
- Pet window works
- Chat messages display normally

If anything breaks, it's likely a `file://` URL that needs migration.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: enable renderer sandbox, register nerve-file:// protocol"
```

---

### Task 2: Migrate file:// URLs in renderer

**Files:**
- Modify: `src/renderer/components/Gallery.tsx:167,209`
- Modify: `src/renderer/components/MessageBubble.tsx:791,793`

- [ ] **Step 1: Read Gallery.tsx and find file:// usage**

Read `src/renderer/components/Gallery.tsx` around lines 160-215. Find all `file:///` URL constructions. Replace them with `nerve-file:///` URLs.

The pattern is likely:
```typescript
// Before:
const url = `file:///${path.replace(/\\/g, '/')}`
// After:
const url = `nerve-file:///${path.replace(/\\/g, '/')}`
```

- [ ] **Step 2: Read MessageBubble.tsx and find file:// usage**

Read `src/renderer/components/MessageBubble.tsx` around lines 785-800. Same migration.

- [ ] **Step 3: Build and test**

Run: `npm run build`
Start the app. Send a message with an image attachment. Verify images display correctly in chat and gallery.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Gallery.tsx src/renderer/components/MessageBubble.tsx
git commit -m "fix: migrate file:// URLs to nerve-file:// for sandbox compatibility"
```

---

### Task 3: Add plugin IPC channels

**Files:**
- Modify: `src/shared/types.ts` — add channel names
- Modify: `src/preload/index.ts` — expose methods
- Modify: `src/main/ipc.ts` — add handlers

- [ ] **Step 1: Add channel names to types.ts**

In `src/shared/types.ts`, add to the `IPC_CHANNELS` object:

```typescript
  // Plugins
  GET_PLUGINS: 'nerve:get-plugins',
  TOGGLE_PLUGIN: 'nerve:toggle-plugin',
  RELOAD_PLUGIN: 'nerve:reload-plugin',
  ROLLBACK_MCP: 'nerve:rollback-mcp',
```

- [ ] **Step 2: Expose methods in preload**

In `src/preload/index.ts`, add inside the `api` object:

```typescript
  // Plugins
  getPlugins: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PLUGINS),
  togglePlugin: (pluginId: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_PLUGIN, pluginId, enabled),
  reloadPlugin: (pluginId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RELOAD_PLUGIN, pluginId),
  rollbackMcp: (serverId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ROLLBACK_MCP, serverId),
```

- [ ] **Step 3: Add IPC handlers**

In `src/main/ipc.ts`, find where other handlers are registered. Add:

```typescript
  ipcMain.handle(IPC_CHANNELS.GET_PLUGINS, () => {
    return claude.getPlugins()
  })

  ipcMain.handle(IPC_CHANNELS.TOGGLE_PLUGIN, (_event, pluginId: string, enabled: boolean) => {
    return claude.togglePlugin(pluginId, enabled)
  })

  ipcMain.handle(IPC_CHANNELS.RELOAD_PLUGIN, (_event, pluginId: string) => {
    return claude.reloadPlugin(pluginId)
  })

  ipcMain.handle(IPC_CHANNELS.ROLLBACK_MCP, (_event, serverId: string) => {
    return claude.rollbackMcp(serverId)
  })
```

Note: These delegate to `claude` (the ClaudeService instance). You need to add corresponding methods to `ClaudeService` that delegate to `AgentCore` → `PluginBus` / `McpPool`. Check how other IPC handlers are wired and follow the same pattern.

- [ ] **Step 4: Add ClaudeService passthrough methods**

In `src/main/claude.ts`, add:

```typescript
  getPlugins() { return this.core.getPlugins() }
  togglePlugin(pluginId: string, enabled: boolean) { return this.core.togglePlugin(pluginId, enabled) }
  reloadPlugin(pluginId: string) { return this.core.reloadPlugin(pluginId) }
  rollbackMcp(serverId: string) { return this.core.rollbackMcp(serverId) }
```

In `src/main/core/agent-core.ts`, add:

```typescript
  getPlugins() { return this.pluginBus.listPlugins() }
  async togglePlugin(pluginId: string, enabled: boolean) {
    // Phase 3: toggle enable/disable (stub for now)
    return { success: true }
  }
  async reloadPlugin(pluginId: string) {
    await this.pluginBus.reloadPlugin(pluginId)
    return { success: true }
  }
  async rollbackMcp(serverId: string) {
    const result = await this.mcpPool.rollbackServer(serverId)
    return { success: result }
  }
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts src/main/ipc.ts src/main/claude.ts src/main/core/agent-core.ts
git commit -m "feat: add plugin management IPC channels"
```

---

### Task 4: Plugin Panel component

**Files:**
- Create: `src/renderer/components/PluginPanel.tsx`
- Modify: `src/renderer/Sidebar.tsx` (or wherever navigation is)

- [ ] **Step 1: Read existing sidebar navigation**

Read `src/renderer/Sidebar.tsx` to understand how navigation items are structured. Find where views like "Gateway", "Settings", "Brain" are defined.

- [ ] **Step 2: Create PluginPanel.tsx**

Create `src/renderer/components/PluginPanel.tsx`:

```tsx
import { useState, useEffect } from 'react'

interface PluginInfo {
  id: string
  version: string
  description: string
  trust: string
  toolCount: number
}

export function PluginPanel() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadPlugins = async () => {
    setLoading(true)
    const list = await window.claude.getPlugins()
    setPlugins(list)
    setLoading(false)
  }

  useEffect(() => { loadPlugins() }, [])

  const handleReload = async (pluginId: string) => {
    await window.claude.reloadPlugin(pluginId)
    await loadPlugins()
  }

  const handleRollback = async (serverId: string) => {
    await window.claude.rollbackMcp(serverId)
  }

  if (loading) return <div className="p-4 text-neutral-400">Loading plugins...</div>

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-neutral-800">
        <h2 className="text-lg font-semibold text-neutral-200">Plugins</h2>
        <p className="text-sm text-neutral-500">{plugins.length} plugin(s) loaded</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {plugins.length === 0 ? (
          <div className="text-neutral-500 text-sm">
            No plugins installed. Place plugins in <code className="text-neutral-400">~/.nerve/plugins/</code>
          </div>
        ) : (
          plugins.map(plugin => (
            <div key={plugin.id} className="rounded-lg border border-neutral-800 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-neutral-200">{plugin.id}</span>
                  <span className="ml-2 text-xs text-neutral-500">v{plugin.version}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReload(plugin.id)}
                    className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  >
                    Reload
                  </button>
                </div>
              </div>
              {plugin.description && (
                <p className="text-sm text-neutral-400 mt-1">{plugin.description}</p>
              )}
              <div className="flex gap-3 mt-2 text-xs text-neutral-500">
                <span>Trust: {plugin.trust}</span>
                <span>Tools: {plugin.toolCount}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add to sidebar navigation**

Read the sidebar file and add a "Plugins" entry following the pattern of existing items (like Gateway, Settings). The Plugin Panel should be accessible from the sidebar.

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Start the app. Click "Plugins" in the sidebar. Verify the panel shows loaded plugins.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/PluginPanel.tsx src/renderer/Sidebar.tsx
git commit -m "feat: add Plugin Panel UI with reload and status"
```

---

### Task 5: Build verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Smoke test**

Start the app:
1. Verify window renders (sandbox didn't break DWM transparency)
2. Send a message — images should display
3. Open Plugin Panel — should show installed plugins
4. If a plugin exists, verify Reload button works

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "verify: Phase 3 renderer hardening + plugin panel working"
```
