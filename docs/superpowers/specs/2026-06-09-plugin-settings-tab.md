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

### 3.3 Enable/Disable

Toggle calls `window.claude.togglePlugin(pluginId, enabled)`. The toggle state is persisted in `settings.json` via `disabledPlugins` array (same pattern as `disabledSkills`).

### 3.4 AgentCore.togglePlugin Implementation

Currently a stub. Implement as:
```typescript
async togglePlugin(pluginId: string, enabled: boolean) {
  const settings = await getNerveSettings()
  const disabled: string[] = settings.disabledPlugins || []
  if (enabled) {
    settings.disabledPlugins = disabled.filter(d => d !== pluginId)
  } else {
    settings.disabledPlugins = [...disabled, pluginId]
  }
  await saveNerveSettings(settings)
  return { success: true }
}
```

### 3.5 Remove PluginPanel Modal

The standalone `PluginPanel.tsx` modal is replaced by the Settings tab. Remove it and its sidebar entry.

## 4. Files

| Action | File | Change |
|---|---|---|
| Modify | `src/renderer/components/SettingsPanel.tsx` | Add `plugins` tab + PluginsTab component |
| Modify | `src/main/core/agent-core.ts` | Implement `togglePlugin` |
| Modify | `src/renderer/App.tsx` | Remove PluginPanel modal + sidebar entry |
| Delete | `src/renderer/components/PluginPanel.tsx` | Replaced by Settings tab |

## 5. IPC

No new IPC channels needed. Existing channels are sufficient:
- `getPlugins` — list plugins
- `togglePlugin` — enable/disable (needs real implementation)
- `reloadPlugin` — reload from disk
