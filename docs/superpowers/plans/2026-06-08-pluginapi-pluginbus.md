# Phase 1b: PluginAPI + PluginBus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plugin discovery, manifest validation, PluginAPI context injection, and tool namespacing so that plugins in `~/.nerve/plugins/` and `.nerve/plugins/` can register tools that the LLM calls with `pluginId:toolName` naming.

**Architecture:** PluginBus scans plugin directories for `plugin.json` manifests, validates them, dynamically imports tool modules, wraps executors with PluginContext injection, and registers tools with `pluginId:` namespace prefixes. AgentCore's `buildTools` merges plugin tools with builtin/MCP/orchestrator tools. Phase 1b provides convenience isolation (PluginAPI as the only intended surface) — security isolation comes in Phase 2 with Worker threads.

**Tech Stack:** TypeScript, Zod, dynamic import(), existing `zodToInputSchema` utility

**Spec reference:** `docs/superpowers/specs/2026-06-08-plugin-system-design.md` Sections 4, 5, 6.1, 6.3, 7.1, 7.2, 14.4

**Prerequisite:** Phase 1a (SkillRegistry + load_skill) must be complete.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/main/plugin-types.ts` | Plugin manifest schema (Zod), LoadedPlugin, PluginToolDef types |
| Create | `src/main/plugin-context.ts` | PluginContext factory — creates capability-injected context per plugin |
| Create | `src/main/plugin-bus.ts` | PluginBus — discover, load, register tools with namespace prefix |
| Modify | `src/main/core/agent-core.ts:437-517` | Wire PluginBus into `buildTools`, merge plugin tools |
| Modify | `src/shared/types.ts` | Add `PluginToolDef` type export (optional) |

---

### Task 1: Plugin types and manifest schema

**Files:**
- Create: `src/main/plugin-types.ts`

- [ ] **Step 1: Create plugin-types.ts**

Create `src/main/plugin-types.ts`:

```typescript
import { z } from 'zod'

// --- Manifest Schema (Zod) ---

const shellCommandSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
})

const toolEntrySchema = z.object({
  name: z.string(),
  module: z.string(),
  description: z.string().optional(),
})

export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  description: z.string().optional().default(''),
  permissions: z.array(z.string()).optional().default([]),
  tools: z.array(toolEntrySchema).optional().default([]),
  hooks: z.record(z.string()).optional(),
  lifecycle: z.object({
    onLoad: z.string().optional(),
    onUnload: z.string().optional(),
    onReload: z.string().optional(),
  }).optional(),
  shell: z.object({
    allowedCommands: z.array(shellCommandSchema).optional().default([]),
  }).optional(),
  dependencies: z.record(z.string()).optional().default({}),
  conflicts: z.record(z.string()).optional().default({}),
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

// --- Loaded Plugin ---

export interface LoadedPlugin {
  id: string
  dir: string
  manifest: PluginManifest
  trust: 'local' | 'project' | 'marketplace'
  tools: Map<string, PluginToolDef>
}

// --- Plugin Tool Definition ---

export interface PluginToolDef {
  name: string           // namespaced: "pluginId:toolName"
  rawName: string        // original name from manifest
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<any>
  pluginId: string
}

// --- Plugin Context (capability injection surface) ---

export interface PluginContext {
  readonly pluginId: string
  readonly pluginDir: string
  readonly sessionId: string
  readonly scope: 'user' | 'project'
  readonly trust: 'local' | 'project' | 'marketplace'
  readonly projectDir?: string

  readonly fs?: PluginFs
  readonly shell?: PluginShell
  readonly net?: PluginNet
  readonly nerve?: PluginNerve
}

export interface PluginFs {
  readFile(path: string): Promise<string>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
}

export interface PluginShell {
  exec(command: string, opts?: {
    cwd?: string
    timeout?: number
    env?: Record<string, string>
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

export interface PluginNet {
  fetch(url: string, opts?: RequestInit): Promise<Response>
}

export interface PluginNerve {
  callTool(name: string, args: unknown): Promise<string>
  getSession(): Promise<{ sessionId: string }>
  sendMessage(text: string): Promise<void>
}

// --- Valid Permissions ---

export const VALID_PERMISSIONS = new Set([
  'fs:read',
  'fs:write',
  'shell:execute',
  'net:http',
  'nerve:mcp',
  'nerve:session',
  'nerve:memory',
  'nerve:channel',
])
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/plugin-types.ts
git commit -m "feat: add plugin types and manifest schema"
```

---

### Task 2: PluginContext factory

**Files:**
- Create: `src/main/plugin-context.ts`

- [ ] **Step 1: Create plugin-context.ts**

Create `src/main/plugin-context.ts`:

```typescript
import { join } from 'path'
import { readFile, readdir, stat, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PluginContext, PluginManifest, PluginFs, PluginShell, PluginNet, PluginNerve } from './plugin-types'

const execFileAsync = promisify(execFile)

// Safe env keys for shell execution
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'USER', 'SHELL', 'TERM', 'TEMP', 'TMP', 'SystemRoot', 'windir']

function buildSafeEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!
  }
  if (extra) Object.assign(env, extra)
  return env
}

function isPathWithin(base: string, target: string): boolean {
  const resolved = require('path').resolve(target)
  return resolved.startsWith(require('path').resolve(base) + require('path').sep) || resolved === require('path').resolve(base)
}

const METACHARACTERS = /[;|&`$()]/ 

export function createPluginContext(opts: {
  pluginId: string
  pluginDir: string
  manifest: PluginManifest
  sessionId: string
  scope: 'user' | 'project'
  trust: 'local' | 'project' | 'marketplace'
  projectDir?: string
}): PluginContext {
  const { pluginId, pluginDir, manifest, sessionId, scope, trust, projectDir } = opts
  const permissions = new Set(manifest.permissions)

  const ctx: PluginContext = {
    pluginId,
    pluginDir,
    sessionId,
    scope,
    trust,
    projectDir,
  }

  // --- fs ---
  if (permissions.has('fs:read') || permissions.has('fs:write')) {
    const allowedRoots = [pluginDir]
    if (projectDir) allowedRoots.push(projectDir)

    const checkPath = (p: string) => {
      const resolved = require('path').resolve(p)
      if (!allowedRoots.some(root => isPathWithin(root, resolved))) {
        throw new Error(`[plugin:${pluginId}] Access denied: ${p} is outside allowed directories`)
      }
    }

    const fs: PluginFs = {
      async readFile(path: string) {
        checkPath(path)
        return readFile(path, 'utf-8')
      },
      async readDir(path: string) {
        checkPath(path)
        const entries = await readdir(path)
        return entries
      },
      async exists(path: string) {
        checkPath(path)
        return existsSync(path)
      },
      async writeFile(path: string, content: string) {
        if (!permissions.has('fs:write')) throw new Error(`[plugin:${pluginId}] fs:write permission required`)
        checkPath(path)
        await writeFile(path, content, 'utf-8')
      },
      async mkdir(path: string) {
        if (!permissions.has('fs:write')) throw new Error(`[plugin:${pluginId}] fs:write permission required`)
        checkPath(path)
        await mkdir(path, { recursive: true })
      },
    }
    ;(ctx as any).fs = fs
  }

  // --- shell ---
  if (permissions.has('shell:execute')) {
    const allowedCommands = manifest.shell?.allowedCommands || []

    const isCommandAllowed = (command: string, args: string[]): boolean => {
      if (allowedCommands.length === 0) return false
      return allowedCommands.some(allowed => {
        if (allowed.command !== command) return false
        if (allowed.args && allowed.args.length > 0) {
          return allowed.args.every((a, i) => args[i] === a)
        }
        return true
      })
    }

    const shell: PluginShell = {
      async exec(command: string, opts?: { cwd?: string; timeout?: number; env?: Record<string, string> }) {
        const parts = command.split(/\s+/)
        const cmd = parts[0]
        const args = parts.slice(1)

        if (!isCommandAllowed(cmd, args)) {
          throw new Error(`[plugin:${pluginId}] Command not allowed: ${command}`)
        }

        // Check for metacharacters in args
        for (const arg of args) {
          if (METACHARACTERS.test(arg)) {
            throw new Error(`[plugin:${pluginId}] Unsafe characters in argument: ${arg}`)
          }
        }

        const timeout = opts?.timeout || 30_000
        const env = buildSafeEnv(opts?.env)
        const cwd = opts?.cwd || pluginDir

        try {
          const result = await execFileAsync(cmd, args, { timeout, env, cwd, maxBuffer: 10 * 1024 * 1024 })
          return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
        } catch (err: any) {
          return { stdout: err.stdout || '', stderr: err.stderr || err.message, exitCode: err.code || 1 }
        }
      },
    }
    ;(ctx as any).shell = shell
  }

  // --- net ---
  if (permissions.has('net:http')) {
    const net: PluginNet = {
      async fetch(url: string, opts?: RequestInit) {
        return globalThis.fetch(url, opts)
      },
    }
    ;(ctx as any).net = net
  }

  return Object.freeze(ctx)
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/plugin-context.ts
git commit -m "feat: add PluginContext capability injection factory"
```

---

### Task 3: PluginBus core — discovery, loading, tool registration

**Files:**
- Create: `src/main/plugin-bus.ts`

- [ ] **Step 1: Create plugin-bus.ts**

Create `src/main/plugin-bus.ts`:

```typescript
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { EventEmitter } from 'events'
import { pluginManifestSchema, VALID_PERMISSIONS } from './plugin-types'
import type { PluginManifest, LoadedPlugin, PluginToolDef, PluginContext } from './plugin-types'
import { createPluginContext } from './plugin-context'
import { zodToInputSchema } from './tool-schema'
import { z } from 'zod'

export class PluginBus extends EventEmitter {
  private plugins = new Map<string, LoadedPlugin>()
  private projectDir: string
  private sourceDir: string

  constructor(sourceDir: string, projectDir: string) {
    super()
    this.sourceDir = sourceDir
    this.projectDir = projectDir
  }

  // --- Discovery ---

  discover(): { dirs: string[]; errors: string[] } {
    const dirs: string[] = []
    const errors: string[] = []

    const candidates = [
      join(this.projectDir, '.nerve', 'plugins'),
      join(this.sourceDir, '.nerve', 'plugins'),
      join(require('os').homedir(), '.nerve', 'plugins'),
    ]

    for (const dir of candidates) {
      if (!existsSync(dir)) continue
      try {
        const entries = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
        for (const entry of entries) {
          const pluginDir = join(dir, entry.name)
          const manifestPath = join(pluginDir, 'plugin.json')
          if (!existsSync(manifestPath)) continue
          dirs.push(pluginDir)
        }
      } catch (err: any) {
        errors.push(`Failed to scan ${dir}: ${err.message}`)
      }
    }

    return { dirs, errors }
  }

  // --- Loading ---

  async loadPlugin(pluginDir: string): Promise<{ plugin?: LoadedPlugin; error?: string }> {
    const manifestPath = join(pluginDir, 'plugin.json')

    // Read and validate manifest
    let raw: string
    try {
      raw = readFileSync(manifestPath, 'utf-8')
    } catch (err: any) {
      return { error: `Cannot read manifest: ${err.message}` }
    }

    let manifestJson: unknown
    try {
      manifestJson = JSON.parse(raw)
    } catch {
      return { error: 'Invalid JSON in plugin.json' }
    }

    const result = pluginManifestSchema.safeParse(manifestJson)
    if (!result.success) {
      return { error: `Manifest validation failed: ${result.error.message}` }
    }
    const manifest = result.data

    // Validate permissions
    for (const perm of manifest.permissions) {
      if (!VALID_PERMISSIONS.has(perm)) {
        return { error: `Unknown permission: ${perm}` }
      }
    }

    // Determine trust level
    const trust = this.resolveTrust(pluginDir)

    // Reject marketplace in Phase 1
    if (trust === 'marketplace') {
      return { error: 'Marketplace plugins not supported in Phase 1 (requires Worker isolation)' }
    }

    // Create PluginContext
    const ctx = createPluginContext({
      pluginId: manifest.name,
      pluginDir,
      manifest,
      sessionId: '',
      scope: trust === 'project' ? 'project' : 'user',
      trust,
      projectDir: this.projectDir,
    })

    // Load tools
    const tools = new Map<string, PluginToolDef>()
    for (const toolEntry of manifest.tools) {
      const modulePath = join(pluginDir, toolEntry.module)
      if (!existsSync(modulePath)) {
        return { error: `Tool module not found: ${modulePath}` }
      }

      try {
        const mod = await import(modulePath)
        if (!mod.schema || !mod.execute) {
          return { error: `Tool "${toolEntry.name}" must export { schema, execute }` }
        }

        const input_schema = zodToInputSchema(mod.schema)
        const qualifiedName = `${manifest.name}:${toolEntry.name}`

        const executor = async (args: any) => {
          try {
            const parsed = mod.schema.parse(args)
            return await mod.execute(parsed, ctx)
          } catch (err: any) {
            return { error: `[plugin:${manifest.name}] ${toolEntry.name}: ${err.message}` }
          }
        }

        tools.set(toolEntry.name, {
          name: qualifiedName,
          rawName: toolEntry.name,
          description: toolEntry.description || mod.description || '',
          input_schema,
          execute: executor,
          pluginId: manifest.name,
        })
      } catch (err: any) {
        return { error: `Failed to import tool "${toolEntry.name}": ${err.message}` }
      }
    }

    const plugin: LoadedPlugin = {
      id: manifest.name,
      dir: pluginDir,
      manifest,
      trust,
      tools,
    }

    this.plugins.set(manifest.name, plugin)
    this.emit('plugin:loaded', { pluginId: manifest.name })
    return { plugin }
  }

  async loadAll(): Promise<{ loaded: string[]; errors: string[] }> {
    const { dirs, errors: discoverErrors } = this.discover()
    const loaded: string[] = []
    const errors = [...discoverErrors]

    for (const dir of dirs) {
      const result = await this.loadPlugin(dir)
      if (result.error) {
        errors.push(`[${dir}]: ${result.error}`)
      } else if (result.plugin) {
        loaded.push(result.plugin.id)
      }
    }

    return { loaded, errors }
  }

  // --- Tool access ---

  getAllPluginTools(): PluginToolDef[] {
    const tools: PluginToolDef[] = []
    for (const plugin of this.plugins.values()) {
      for (const tool of plugin.tools.values()) {
        tools.push(tool)
      }
    }
    return tools
  }

  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId)
  }

  listPlugins(): Array<{ id: string; version: string; description: string; trust: string; toolCount: number }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      version: p.manifest.version,
      description: p.manifest.description || '',
      trust: p.trust,
      toolCount: p.tools.size,
    }))
  }

  // --- Trust resolution ---

  private resolveTrust(pluginDir: string): 'local' | 'project' | 'marketplace' {
    if (pluginDir.includes(join(this.projectDir, '.nerve', 'plugins'))) return 'project'
    if (pluginDir.includes(join(require('os').homedir(), '.nerve', 'marketplace'))) return 'marketplace'
    return 'local'
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/plugin-bus.ts
git commit -m "feat: add PluginBus with discovery, loading, and tool registration"
```

---

### Task 4: Wire PluginBus into AgentCore

**Files:**
- Modify: `src/main/core/agent-core.ts` — multiple changes

- [ ] **Step 1: Add imports and PluginBus field**

In `src/main/core/agent-core.ts`, add the import (near line 15):
```typescript
import { PluginBus } from '../plugin-bus'
```

Add a private field in the `AgentCore` class (near line 79, after `skillRegistry`):
```typescript
private pluginBus: PluginBus
```

In the constructor (around line 100, after `this.mcpPool = new McpPool()`), initialize:
```typescript
this.pluginBus = new PluginBus(this.sourceDir, this.projectDir)
```

- [ ] **Step 2: Load plugins in initPlugins**

Add a public method for plugin initialization (after the constructor):
```typescript
async initPlugins(): Promise<void> {
  const result = await this.pluginBus.loadAll()
  if (result.errors.length > 0) {
    console.warn('[PluginBus] Load errors:', result.errors)
  }
  console.log(`[PluginBus] Loaded ${result.loaded.length} plugins:`, result.loaded)
}
```

- [ ] **Step 3: Merge plugin tools in buildTools**

In the `buildTools` method, after the `builtinTools` declaration (around line 485) and before the `allToolDefs` array construction (around line 487), add plugin tools:

```typescript
    // Plugin tools
    const pluginTools = this.pluginBus.getAllPluginTools()
```

Then update `allToolDefs` to include plugin tools. Replace the current `allToolDefs` construction (lines 487-503) with:

```typescript
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
      ...pluginTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
    ]
```

And update `allToolExecutors` to include plugin tool executors. After the existing executor loops (around line 514), add:

```typescript
    for (const tool of pluginTools) {
      allToolExecutors.set(tool.name, tool.execute)
    }
```

- [ ] **Step 4: Call initPlugins from entry point**

In `src/main/index.ts`, find where `AgentCore` is constructed and call `initPlugins()`. Look for the pattern where other services are initialized (like `memoryCore`, `offloadBridge`). Add after those:

```typescript
await agentCore.initPlugins()
```

Read `src/main/index.ts` first to find the exact location and pattern.

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/main/core/agent-core.ts src/main/index.ts
git commit -m "feat: wire PluginBus into AgentCore, merge plugin tools"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Create a test plugin**

Create a minimal test plugin at `~/.nerve/plugins/hello-test/plugin.json`:
```json
{
  "name": "hello-test",
  "version": "0.1.0",
  "description": "Test plugin",
  "permissions": [],
  "tools": [
    { "name": "greet", "module": "./tools/greet.ts" }
  ]
}
```

Create `~/.nerve/plugins/hello-test/tools/greet.ts`:
```typescript
import { z } from 'zod'

export const description = 'Greet someone by name'

export const schema = z.object({
  name: z.string().describe('Name to greet'),
})

export const execute = async (args: { name: string }, ctx: any) => {
  return { output: `Hello, ${args.name}! From plugin ${ctx.pluginId}` }
}
```

- [ ] **Step 3: Start the app and verify plugin loaded**

Start the app and check console for `[PluginBus] Loaded 1 plugins: [ 'hello-test' ]`

- [ ] **Step 4: Verify tool appears with namespace**

In the chat, ask the agent to greet someone. The tool should appear as `hello-test:greet` in the tool list.

- [ ] **Step 5: Clean up test plugin**

```bash
rm -rf ~/.nerve/plugins/hello-test
```

- [ ] **Step 6: Commit verification**

```bash
git commit --allow-empty -m "verify: Phase 1b plugin system working"
```
