# Phase 2: Hot-Reload + Tool Snapshot + MCP Drain-and-Replace + Hooks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable plugin hot-reload (file changes auto-update tools/skills without restarting), safe tool version pinning during in-flight conversations, graceful MCP server replacement, and an extensible hook system for plugin event handling.

**Architecture:** ToolSnapshot with ref/unref pins plugin tool versions per sendMessage call. FileWatcher (chokidar) monitors plugin directories with per-plugin debounce and a global mutex for serialized reloads. MCP drain-and-replace gracefully swaps servers by draining in-flight calls before switching. HookRegistry provides ordered, context-aware hook execution with priority enforcement per trust level.

**Tech Stack:** TypeScript, chokidar, async-mutex, existing PluginBus/McpPool/AgenticLoop infrastructure

**Spec reference:** `docs/superpowers/specs/2026-06-08-plugin-system-design.md` Sections 6.4, 6.5, 7.3, 7.4, 9.2, 9.4, 10.1–10.3

**Prerequisite:** Phase 1a + 1b + 1d complete.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/main/tool-snapshot.ts` | PluginToolSnapshot — ref/unref, immutable tool defs + executors |
| Create | `src/main/hook-registry.ts` | HookRegistry — register, execute hooks with priority + context |
| Modify | `src/main/plugin-bus.ts` | Add FileWatcher, snapshot management, reload logic |
| Modify | `src/main/mcp-pool.ts` | Add drain mode, rollback window for server replacement |
| Modify | `src/main/core/agent-core.ts` | Use ToolSnapshot in sendMessage, integrate hooks |
| Modify | `src/main/agentic-loop.ts` | Add hook call points (onToolCall, onToolComplete) |
| Modify | `src/main/plugin-types.ts` | Add HookContext, HookResult, HookData types |

---

### Task 1: PluginToolSnapshot

**Files:**
- Create: `src/main/tool-snapshot.ts`

- [ ] **Step 1: Create tool-snapshot.ts**

Create `src/main/tool-snapshot.ts`:

```typescript
import type { PluginToolDef } from './plugin-types'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export class PluginToolSnapshot {
  readonly version: number
  readonly toolDefs: ToolDefinition[]
  readonly toolExecutors: Map<string, (args: any) => Promise<any>>
  private refCount = 0
  private disposed = false
  private onDispose: (() => void) | null = null

  constructor(
    version: number,
    pluginTools: PluginToolDef[],
    onDispose?: () => void,
  ) {
    this.version = version
    this.onDispose = onDispose || null

    this.toolDefs = pluginTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))

    this.toolExecutors = new Map()
    for (const t of pluginTools) {
      this.toolExecutors.set(t.name, t.execute)
    }
  }

  ref(): void {
    if (this.disposed) throw new Error('Cannot ref a disposed snapshot')
    this.refCount++
  }

  unref(): void {
    this.refCount--
    if (this.refCount <= 0 && this.onDispose) {
      this.disposed = true
      this.onDispose()
      this.onDispose = null
    }
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  get refs(): number {
    return this.refCount
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/tool-snapshot.ts
git commit -m "feat: add PluginToolSnapshot with ref/unref lifecycle"
```

---

### Task 2: Integrate ToolSnapshot into PluginBus + AgentCore

**Files:**
- Modify: `src/main/plugin-bus.ts` — add snapshot management
- Modify: `src/main/core/agent-core.ts` — use snapshot in sendMessage

- [ ] **Step 1: Add snapshot management to PluginBus**

In `src/main/plugin-bus.ts`, add imports and snapshot fields:

Add at the top:
```typescript
import { PluginToolSnapshot } from './tool-snapshot'
```

Add fields to the `PluginBus` class (after `private sourceDir`):
```typescript
private snapshotVersion = 0
private activeSnapshot: PluginToolSnapshot | null = null
private pendingSnapshot: PluginToolSnapshot | null = null
```

Add these methods to the `PluginBus` class:

```typescript
  // --- Snapshot management ---

  getSnapshot(): PluginToolSnapshot {
    if (!this.activeSnapshot) {
      this.activeSnapshot = new PluginToolSnapshot(
        this.snapshotVersion,
        this.getAllPluginTools(),
      )
    }
    return this.activeSnapshot
  }

  promotePending(): void {
    if (this.pendingSnapshot) {
      this.activeSnapshot = this.pendingSnapshot
      this.pendingSnapshot = null
    }
  }

  private invalidateSnapshot(): void {
    this.snapshotVersion++
    const newTools = this.getAllPluginTools()
    const newSnapshot = new PluginToolSnapshot(this.snapshotVersion, newTools)

    // If active snapshot has refs (in-flight conversations), store as pending
    if (this.activeSnapshot && this.activeSnapshot.refs > 0) {
      this.pendingSnapshot = newSnapshot
    } else {
      this.activeSnapshot = newSnapshot
    }
  }
```

Update `loadPlugin` to call `this.invalidateSnapshot()` after `this.plugins.set(manifest.name, plugin)`.

- [ ] **Step 2: Use snapshot in AgentCore.sendMessage**

In `src/main/core/agent-core.ts`, find the `sendMessage` method. After the line `const { messages, systemPrompt, mcpTools } = await this.prepareMessages(payload, sessionId)` (around line 249), add:

```typescript
      // Promote pending tool snapshot (if hot-reload happened)
      this.pluginBus.promotePending()
```

In the `buildTools` method, replace the direct `getAllPluginTools()` call with the snapshot:

Find (around line 498):
```typescript
    const pluginTools = this.pluginBus.getAllPluginTools()
```

Replace with:
```typescript
    const snapshot = this.pluginBus.getSnapshot()
    snapshot.ref()
    const pluginTools = snapshot
```

Wait — `pluginTools` is used to get both defs and executors. Instead, change the approach. After the `getSnapshot()` call, use `snapshot.toolDefs` and `snapshot.toolExecutors` directly.

Replace the plugin tools section in `buildTools`. Find the block that adds plugin tools to `allToolDefs` and `allToolExecutors`:

```typescript
    const pluginTools = this.pluginBus.getAllPluginTools()
```

and the subsequent `.map` and executor loop. Replace the entire plugin tools section with:

```typescript
    // Plugin tools via snapshot (pinned for this conversation)
    const pluginSnapshot = this.pluginBus.getSnapshot()
    pluginSnapshot.ref()

    const allToolDefs = [
      ...Object.entries(builtinTools).map(([name, tool]) => ({
        name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
      ...Object.entries(mcpTools).map(([name, tool]) => ({
        name,
        description: (tool as any).description || '',
        input_schema: (tool as any).input_schema || (tool as any).parameters || {},
      })),
      ...Object.entries(orchestratorTools).map(([name, tool]) => ({
        name,
        description: (tool as any).description || '',
        input_schema: (tool as any).input_schema || {},
      })),
      ...pluginSnapshot.toolDefs,
    ]

    const allToolExecutors = new Map<string, (args: any) => Promise<any>>()
    for (const [name, tool] of Object.entries(builtinTools)) {
      allToolExecutors.set(name, tool.execute)
    }
    for (const [name, tool] of Object.entries(orchestratorTools)) {
      allToolExecutors.set(name, (tool as any).execute)
    }
    for (const [name, executor] of this.mcpPool.getAllToolExecutors()) {
      allToolExecutors.set(name, executor)
    }
    for (const [name, executor] of pluginSnapshot.toolExecutors) {
      allToolExecutors.set(name, executor)
    }

    return { allToolDefs, allToolExecutors, orchestratorTools, allToolCalls, allToolResults, pluginSnapshot }
```

Then in `sendMessage`, after `buildTools` returns, ensure snapshot is unreffed. Find the try block after `buildTools` and wrap the agent loop call:

```typescript
      const { allToolDefs, allToolExecutors, orchestratorTools, pluginSnapshot } = await this.buildTools(...)
      
      try {
        // ... runAgentLoop ...
      } finally {
        pluginSnapshot.unref()
      }
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/plugin-bus.ts src/main/core/agent-core.ts
git commit -m "feat: integrate ToolSnapshot for pinned plugin tools per conversation"
```

---

### Task 3: FileWatcher hot-reload in PluginBus

**Files:**
- Modify: `src/main/plugin-bus.ts` — add FileWatcher + reload

- [ ] **Step 1: Install chokidar and async-mutex**

Run: `npm install chokidar async-mutex`
Run: `npm install -D @types/chokidar` (if needed)

- [ ] **Step 2: Add FileWatcher to PluginBus**

In `src/main/plugin-bus.ts`, add imports:

```typescript
import chokidar from 'chokidar'
import { Mutex } from 'async-mutex'
```

Add fields to PluginBus class:

```typescript
private watcher: chokidar.FSWatcher | null = null
private debounceTimers = new Map<string, NodeJS.Timeout>()
private reloadMutex = new Mutex()
```

Add `startWatching()` method:

```typescript
  startWatching(): void {
    const pluginDirs = [
      join(this.projectDir, '.nerve', 'plugins'),
      join(this.sourceDir, '.nerve', 'plugins'),
      join(homedir(), '.nerve', 'plugins'),
    ].filter(d => existsSync(d))

    if (pluginDirs.length === 0) return

    this.watcher = chokidar.watch(pluginDirs, {
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**'],
      depth: 3,
    })

    this.watcher.on('all', (event, filePath) => {
      const pluginId = this.resolvePluginId(filePath)
      if (!pluginId) return

      // Per-plugin debounce: 300ms
      clearTimeout(this.debounceTimers.get(pluginId))
      this.debounceTimers.set(pluginId, setTimeout(async () => {
        this.debounceTimers.delete(pluginId)
        await this.reloadMutex.runExclusive(async () => {
          await this.reloadPlugin(pluginId)
        })
      }, 300))
    })

    console.log('[PluginBus] FileWatcher started for', pluginDirs)
  }

  private resolvePluginId(filePath: string): string | null {
    for (const [id, plugin] of this.plugins) {
      if (filePath.startsWith(plugin.dir)) return id
    }
    return null
  }

  async reloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return

    console.log(`[PluginBus] Reloading plugin: ${pluginId}`)
    const result = await this.loadPlugin(plugin.dir)
    if (result.error) {
      console.error(`[PluginBus] Reload failed for ${pluginId}:`, result.error)
      return
    }
    this.invalidateSnapshot()
    console.log(`[PluginBus] Reloaded plugin: ${pluginId}`)
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }
```

- [ ] **Step 3: Call startWatching from AgentCore.initPlugins**

In `src/main/core/agent-core.ts`, in the `initPlugins` method, add after `pluginBus.loadAll()`:

```typescript
this.pluginBus.startWatching()
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/main/plugin-bus.ts src/main/core/agent-core.ts package.json
git commit -m "feat: add FileWatcher hot-reload for plugins with debounce and mutex"
```

---

### Task 4: MCP drain-and-replace with rollback

**Files:**
- Modify: `src/main/mcp-pool.ts` — add drain mode and rollback

- [ ] **Step 1: Add drain mode to PooledClient**

In `src/main/mcp-pool.ts`, update the `PooledClient` interface:

```typescript
interface PooledClient {
  client: InstanceType<typeof Client>
  tools: Record<string, unknown>
  lastHealthCheck: number
  drainMode: boolean
  inflightCalls: number
}
```

- [ ] **Step 2: Add drain and rollback methods to McpPool**

Add these methods to the `McpPool` class:

```typescript
  // Drain mode: stop accepting new tool calls, wait for in-flight to complete
  async drainServer(name: string, timeoutMs = 30_000): Promise<void> {
    const entry = this.pool.get(name)
    if (!entry) return

    entry.drainMode = true
    const start = Date.now()
    while (entry.inflightCalls > 0 && Date.now() - start < timeoutMs) {
      await sleep(100)
    }
  }

  // Check if a server is in drain mode (callers should skip it)
  isDraining(name: string): boolean {
    const entry = this.pool.get(name)
    return entry?.drainMode ?? false
  }

  // Track tool call lifecycle
  trackCallStart(name: string): void {
    const entry = this.pool.get(name)
    if (entry) entry.inflightCalls++
  }

  trackCallEnd(name: string): void {
    const entry = this.pool.get(name)
    if (entry) entry.inflightCalls--
  }

  // Replace a server with a new one (drain → swap → old kept for rollback)
  private pendingRollback = new Map<string, { oldEntry: PooledClient; deadline: ReturnType<typeof setTimeout> }>()

  async replaceServer(name: string, newConfig: McpServerConfig): Promise<void> {
    const old = this.pool.get(name)
    if (!old) {
      await this.connectWithTimeout(name, newConfig)
      return
    }

    // Drain old server
    await this.drainServer(name)

    // Connect new server
    const client = await this.connectServer(name, newConfig)
    const { tools: toolList } = await client.listTools()
    const toolsMap: Record<string, unknown> = {}
    for (const tool of toolList) {
      toolsMap[tool.name] = { description: tool.description, parameters: tool.inputSchema }
    }

    const newEntry: PooledClient = {
      client,
      tools: toolsMap,
      lastHealthCheck: Date.now(),
      drainMode: false,
      inflightCalls: 0,
    }

    // Atomic swap
    this.pool.set(name, newEntry)

    // Keep old for rollback (10s window)
    const deadline = setTimeout(() => {
      old.client.close().catch(() => {})
      this.pendingRollback.delete(name)
    }, 10_000)
    this.pendingRollback.set(name, { oldEntry: old, deadline })
  }

  async rollbackServer(name: string): Promise<boolean> {
    const pending = this.pendingRollback.get(name)
    if (!pending) return false

    clearTimeout(pending.deadline)
    const current = this.pool.get(name)
    this.pool.set(name, pending.oldEntry)
    pending.oldEntry.drainMode = false
    this.pendingRollback.delete(name)

    // Close the rolled-back server
    if (current) await current.client.close().catch(() => {})
    return true
  }
```

- [ ] **Step 3: Update connectWithTimeout to initialize new fields**

In the `connectWithTimeout` method, where `PooledClient` is constructed (around line 70), add the new fields:

```typescript
      this.pool.set(name, {
        client,
        tools: toolsMap,
        lastHealthCheck: Date.now(),
        drainMode: false,
        inflightCalls: 0,
      })
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-pool.ts
git commit -m "feat: add MCP drain-and-replace with rollback window"
```

---

### Task 5: Hook system — types + HookRegistry

**Files:**
- Modify: `src/main/plugin-types.ts` — add HookContext, HookResult, HookData types
- Create: `src/main/hook-registry.ts` — HookRegistry class

- [ ] **Step 1: Add hook types to plugin-types.ts**

In `src/main/plugin-types.ts`, add at the end (before `VALID_PERMISSIONS`):

```typescript
// --- Hook types ---

export type HookEvent =
  | 'onMessageSend'
  | 'onToolCall'
  | 'onToolComplete'
  | 'onStreamDelta'
  | 'onSessionStart'
  | 'onSessionEnd'

export interface HookData {
  message?: { prompt: string }
  toolCall?: {
    id: string
    name: string
    input: unknown
    result?: string
    isError?: boolean
    pluginSource?: string
  }
  streamDelta?: {
    text: string
    accumulated: string
  }
}

export interface HookContext {
  readonly sessionId: string
  readonly pluginId: string
  readonly data: Readonly<HookData>
  readonly metadata: Map<string, unknown>
}

export interface HookResult {
  handled: boolean
  modified?: Partial<HookData>
  error?: Error
}

export type HookFn = (ctx: HookContext) => Promise<HookResult>

export interface PrioritizedHook {
  pluginId: string
  event: HookEvent
  fn: HookFn
  priority: number
}

// Trust-level priority floors
export const HOOK_PRIORITY_FLOORS: Record<string, number> = {
  builtin: 0,
  local: 200,
  project: 200,
  marketplace: 300,
}
```

- [ ] **Step 2: Create hook-registry.ts**

Create `src/main/hook-registry.ts`:

```typescript
import type { HookEvent, HookFn, HookContext, HookResult, HookData, PrioritizedHook } from './plugin-types'
import { HOOK_PRIORITY_FLOORS } from './plugin-types'

const HOOK_TIMEOUT_MS = 5_000

export class HookRegistry {
  private hooks = new Map<HookEvent, PrioritizedHook[]>()

  register(pluginId: string, trust: string, event: HookEvent, fn: HookFn, requestedPriority?: number): void {
    const floor = HOOK_PRIORITY_FLOORS[trust] ?? 200
    const priority = Math.max(requestedPriority ?? floor, floor)

    const list = this.hooks.get(event) || []
    list.push({ pluginId, event, fn, priority })
    list.sort((a, b) => a.priority - b.priority)
    this.hooks.set(event, list)
  }

  async execute(event: HookEvent, data: HookData, sessionId: string): Promise<HookResult> {
    const hooks = this.hooks.get(event)
    if (!hooks || hooks.length === 0) return { handled: false }

    let currentData = { ...data }

    for (const hook of hooks) {
      const ctx: HookContext = {
        sessionId,
        pluginId: hook.pluginId,
        data: Object.freeze({ ...currentData }),
        metadata: new Map(),
      }

      try {
        const result = await Promise.race([
          hook.fn(ctx),
          new Promise<HookResult>((_, reject) =>
            setTimeout(() => reject(new Error('hook timeout')), HOOK_TIMEOUT_MS)
          ),
        ])

        if (result.handled) {
          return { handled: true, modified: result.modified }
        }

        if (result.modified) {
          currentData = { ...currentData, ...result.modified }
        }
      } catch (err) {
        console.error(`[HookRegistry] ${hook.pluginId}:${event} error:`, err)
      }
    }

    return {
      handled: false,
      modified: currentData !== data ? currentData : undefined,
    }
  }

  unregister(pluginId: string): void {
    for (const [event, list] of this.hooks) {
      this.hooks.set(event, list.filter(h => h.pluginId !== pluginId))
    }
  }

  hasHooks(event: HookEvent): boolean {
    const hooks = this.hooks.get(event)
    return !!hooks && hooks.length > 0
  }
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/plugin-types.ts src/main/hook-registry.ts
git commit -m "feat: add HookRegistry with priority ordering and timeout"
```

---

### Task 6: Integrate hooks into agentic loop

**Files:**
- Modify: `src/main/agentic-loop.ts` — add hook call points
- Modify: `src/main/core/agent-core.ts` — pass HookRegistry, call hooks

- [ ] **Step 1: Add HookRegistry to AgenticLoopParams**

In `src/main/agentic-loop.ts`, add to `AgenticLoopParams` interface:

```typescript
  hookRegistry?: import('./hook-registry').HookRegistry
  sessionId?: string
```

- [ ] **Step 2: Add hook calls in the Anthropic loop**

Find the tool execution section in the Anthropic loop (where `toolExecutors.get(toolName)` is called). Before the tool execution, add:

```typescript
          // onToolCall hook
          if (params.hookRegistry && params.sessionId) {
            const hookResult = await params.hookRegistry.execute('onToolCall', {
              toolCall: { id: toolUseId, name: toolName, input: toolInput },
            }, params.sessionId)
            if (hookResult.handled) {
              // Hook intercepted — use its result
              const hookContent = JSON.stringify(hookResult.modified?.toolCall?.result || 'intercepted by hook')
              // ... add tool result and continue
            }
          }
```

After tool execution (where `toolResult` is available), add:

```typescript
          // onToolComplete hook
          if (params.hookRegistry && params.sessionId) {
            const hookResult = await params.hookRegistry.execute('onToolComplete', {
              toolCall: { id: toolUseId, name: toolName, input: toolInput, result: toolResult, isError: isToolError },
            }, params.sessionId)
            if (hookResult.modified?.toolCall?.result !== undefined) {
              toolResult = hookResult.modified.toolCall.result
            }
          }
```

Note: The exact integration points depend on the current structure of the Anthropic loop. Read the file carefully to find the right locations.

- [ ] **Step 3: Pass HookRegistry from AgentCore**

In `src/main/core/agent-core.ts`, create a `HookRegistry` instance and pass it to the agentic loop:

Add a field:
```typescript
private hookRegistry: HookRegistry = new HookRegistry()
```

Add the import:
```typescript
import { HookRegistry } from '../hook-registry'
```

In `runAgentLoop`, pass `hookRegistry: this.hookRegistry` and `sessionId` to `runAgenticLoop` params.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/main/agentic-loop.ts src/main/core/agent-core.ts
git commit -m "feat: integrate HookRegistry into agentic loop"
```

---

### Task 7: Build verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Verify hot-reload works**

1. Start the app
2. Note the console log `[PluginBus] Loaded N plugins`
3. Add/remove a SKILL.md in a watched directory
4. Verify console shows `[PluginBus] Reloaded plugin: xxx`
5. Send a message — tools should reflect the updated state

- [ ] **Step 3: Commit verification**

```bash
git commit --allow-empty -m "verify: Phase 2 hot-reload + hooks working"
```
