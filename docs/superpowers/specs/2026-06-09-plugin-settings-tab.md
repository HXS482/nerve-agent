# Plugin Management in Settings Panel

**Date:** 2026-06-09
**Status:** Draft
**Scope:** Add "Plugins" tab to Settings panel with enable/disable, Reload, expandable details

---

## 1. Overview

Replace the standalone PluginPanel modal with a "Plugins" tab in the existing Settings panel. Each installed plugin gets a card with enable/disable toggle, Reload button, and expandable details (tools, skills, permissions).

## 2. Current State

- `SettingsPanel.tsx` has tabs: General, Provider, MCP, Skills, Voice, Channels
- `PluginPanel.tsx` is a standalone modal with basic list + Reload
- `togglePlugin` IPC exists but AgentCore implementation is a stub
- `saveNerveSettings()` has a fixed field whitelist — cannot persist `disabledPlugins` directly
- `pluginBus.loadAll()` does not check disabled state
- `pluginBus.listPlugins()` does not return `enabled` field
- `import()` caching prevents reloadPlugin from picking up code changes

## 3. Design

### 3.1 Settings Tab

Add `'plugins'` to the `Tab` type union in `SettingsPanel.tsx`. Add a "Plugins" entry to the `TABS` array with a puzzle-piece icon.

### 3.2 Plugin Card Layout

Each plugin card contains:
- **Header row**: name (bold), version (gray), trust badge (local/project)
- **Description**: one-line summary
- **Controls row**: enable/disable toggle (circular switch) + Reload button
- **Expandable details** (click to toggle):
  - Tools: `pluginId:toolName` list
  - Skills: skill name list
  - Permissions: permission string list

### 3.3 Enable/Disable — Backend Changes Required

**Problem:** `saveNerveSettings()` has a fixed field whitelist and will silently drop `disabledPlugins`. The same bug exists for `disabledSkills` (pre-existing).

**Solution:** Add a dedicated `togglePluginSetting()` function in `settings.ts` that reads raw JSON, mutates `disabledPlugins`, and writes back with `atomicWriteFile`:

```typescript
// settings.ts
export async function togglePluginSetting(pluginId: string, enabled: boolean) {
  await ensureNerveDir()
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  let existing: Record<string, unknown> = {}
  if (existsSync(nerveSettingsPath)) {
    try { existing = JSON.parse(await readFile(nerveSettingsPath, 'utf-8')) } catch { /* ignore */ }
  }
  const disabled: string[] = (existing.disabledPlugins as string[]) || []
  if (enabled) {
    existing.disabledPlugins = disabled.filter(d => d !== pluginId)
  } else {
    existing.disabledPlugins = [...disabled, pluginId]
  }
  await atomicWriteFile(nerveSettingsPath, JSON.stringify(existing, null, 2))
}
```

AgentCore delegates:
```typescript
async togglePlugin(pluginId: string, enabled: boolean) {
  await togglePluginSetting(pluginId, enabled)
  return { success: true }
}
```

**Also fix:** `toggleSkill` in `skills.ts` has the same broken pattern. Apply the same raw-file-read-write approach.

### 3.4 loadAll() Must Filter Disabled Plugins

`pluginBus.loadAll()` currently loads every discovered plugin unconditionally. It must accept a `disabledIds` skip list:

```typescript
async loadAll(disabledIds: string[] = []): Promise<...> {
  const disabled = new Set(disabledIds)
  // For each discovered dir, pre-read manifest name
  // If disabled.has(name) → skip with log
}
```

`AgentCore.initPlugins()` reads `disabledPlugins` from raw settings and passes to `loadAll()`.

### 3.5 listPlugins() Must Return `enabled` State

`listPlugins()` needs an `enabled` field for the UI toggle:

```typescript
listPlugins(disabled?: Set<string>): Array<{ id: string; ...; enabled: boolean }> {
  return Array.from(this.plugins.values()).map(p => ({
    ...existing fields,
    enabled: disabled ? !disabled.has(p.id) : true,
  }))
}
```

`AgentCore.getPlugins()` reads `disabledPlugins` from settings and passes to `listPlugins()`.

### 3.6 reloadPlugin Must Bust import() Cache

Node.js caches `import()` by URL. Re-importing the same path returns cached module. Fix:

```typescript
const cacheBust = `?v=${Date.now()}`
const mod = await import(modulePath + cacheBust)
```

### 3.7 Remove PluginPanel Modal

The standalone `PluginPanel.tsx` modal is replaced by the Settings tab. Remove it and its sidebar entry.

## 4. Files

| Action | File | Change |
|---|---|---|
| Modify | `src/renderer/components/SettingsPanel.tsx` | Add `plugins` tab + PluginsTab component |
| Modify | `src/main/settings.ts` | Add `togglePluginSetting()` + fix `toggleSkillSetting()` |
| Modify | `src/main/core/agent-core.ts` | Implement `togglePlugin`, fix `getPlugins` to pass disabled set |
| Modify | `src/main/plugin-bus.ts` | `loadAll(disabledIds)` + `listPlugins(disabled)` + cache-bust import |
| Modify | `src/main/skills.ts` | Fix `toggleSkill` persistence (same pattern) |
| Modify | `src/renderer/App.tsx` | Remove PluginPanel modal + sidebar entry |
| Delete | `src/renderer/components/PluginPanel.tsx` | Replaced by Settings tab |

## 5. IPC

No new IPC channels needed. Existing channels are sufficient:
- `getPlugins` — list plugins (now includes `enabled` field)
- `togglePlugin` — enable/disable (now properly persists)
- `reloadPlugin` — reload from disk (now busts import cache)
