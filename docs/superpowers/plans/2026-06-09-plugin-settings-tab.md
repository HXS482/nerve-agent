# Plugin Settings Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Plugins" tab to the Settings panel with enable/disable toggle, Reload button, and expandable details, with proper backend persistence.

**Architecture:** Add `togglePluginSetting()` to settings.ts for raw JSON persistence (bypassing saveNerveSettings's field whitelist). Fix plugin-bus.ts to filter disabled plugins at load time, return `enabled` in listPlugins, and bust import() cache on reload. Add PluginsTab component to SettingsPanel.tsx. Remove standalone PluginPanel modal.

**Tech Stack:** TypeScript, React, existing settings.ts atomicWriteFile pattern

**Spec reference:** `docs/superpowers/specs/2026-06-09-plugin-settings-tab.md`

---

## File Map

| Action | File | Change |
|---|---|---|
| Modify | `src/main/settings.ts` | Add `togglePluginSetting()` + `toggleSkillSetting()` |
| Modify | `src/main/skills.ts` | Use `toggleSkillSetting()` instead of broken pattern |
| Modify | `src/main/plugin-bus.ts` | `loadAll(disabledIds)`, `listPlugins(disabled)`, cache-bust import |
| Modify | `src/main/core/agent-core.ts` | Implement `togglePlugin`, fix `getPlugins` |
| Modify | `src/renderer/components/SettingsPanel.tsx` | Add `plugins` tab + PluginsTab component |
| Modify | `src/renderer/App.tsx` | Remove PluginPanel modal + sidebar entry |
| Delete | `src/renderer/components/PluginPanel.tsx` | Replaced by Settings tab |

---

### Task 1: Add togglePluginSetting + fix toggleSkillSetting in settings.ts

**Files:**
- Modify: `src/main/settings.ts`

- [ ] **Step 1: Add togglePluginSetting function**

At the end of `src/main/settings.ts`, add:

```typescript
/**
 * Toggle plugin enabled/disabled state.
 * Uses raw file read/write to bypass saveNerveSettings's field whitelist.
 */
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

/**
 * Toggle skill enabled/disabled state.
 * Same raw file pattern as togglePluginSetting.
 * Replaces the broken pattern in skills.ts that used saveNerveSettings.
 */
export async function toggleSkillSetting(skillId: string, enabled: boolean) {
  await ensureNerveDir()
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  let existing: Record<string, unknown> = {}
  if (existsSync(nerveSettingsPath)) {
    try { existing = JSON.parse(await readFile(nerveSettingsPath, 'utf-8')) } catch { /* ignore */ }
  }
  const disabled: string[] = (existing.disabledSkills as string[]) || []
  if (enabled) {
    existing.disabledSkills = disabled.filter(d => d !== skillId)
  } else {
    existing.disabledSkills = [...disabled, skillId]
  }
  await atomicWriteFile(nerveSettingsPath, JSON.stringify(existing, null, 2))
}

/**
 * Read disabled plugin IDs from settings file.
 */
export function getDisabledPlugins(): string[] {
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  if (!existsSync(nerveSettingsPath)) return []
  try {
    const raw = JSON.parse(readFileSync(nerveSettingsPath, 'utf-8'))
    return (raw.disabledPlugins as string[]) || []
  } catch {
    return []
  }
}

/**
 * Read disabled skill IDs from settings file.
 */
export function getDisabledSkills(): string[] {
  const nerveSettingsPath = join(NERVE_DIR, 'settings.json')
  if (!existsSync(nerveSettingsPath)) return []
  try {
    const raw = JSON.parse(readFileSync(nerveSettingsPath, 'utf-8'))
    return (raw.disabledSkills as string[]) || []
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/settings.ts
git commit -m "feat: add togglePluginSetting/toggleSkillSetting with raw file persistence"
```

---

### Task 2: Fix toggleSkill in skills.ts

**Files:**
- Modify: `src/main/skills.ts`

- [ ] **Step 1: Update toggleSkill to use toggleSkillSetting**

In `src/main/skills.ts`, find the `toggleSkill` function (around line 55). Add the import at the top:

```typescript
import { toggleSkillSetting } from './settings'
```

Replace the toggleSkill function body:

```typescript
export async function toggleSkill(id: string, enabled: boolean) {
  await toggleSkillSetting(id, enabled)
}
```

- [ ] **Step 2: Update getSkills to use getDisabledSkills**

In `src/main/skills.ts`, find `getSkills` function (around line 20). Add the import (if not already done):

```typescript
import { getDisabledSkills } from './settings'
```

In `getSkills`, find the line:
```typescript
  const disabled = new Set<string>((settings as any).disabledSkills || [])
```

Replace with:
```typescript
  const disabled = new Set<string>(getDisabledSkills())
```

Also remove the `getNerveSettings()` call if it's now unused in this function (check if `settings` is used elsewhere in `getSkills`). If `settings` is only used for `disabledSkills`, remove it. If it's used for other things, keep it.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/main/skills.ts
git commit -m "fix: use raw file persistence for toggleSkill (same pattern as togglePlugin)"
```

---

### Task 3: Fix plugin-bus.ts — loadAll, listPlugins, cache-bust

**Files:**
- Modify: `src/main/plugin-bus.ts`

- [ ] **Step 1: Update loadAll to accept disabledIds**

In `src/main/plugin-bus.ts`, replace the `loadAll` method:

```typescript
  async loadAll(disabledIds: string[] = []): Promise<{ loaded: string[]; errors: string[] }> {
    const { dirs, errors: discoverErrors } = this.discover()
    const disabled = new Set(disabledIds)
    const loaded: string[] = []
    const errors = [...discoverErrors]

    for (const dir of dirs) {
      // Pre-read manifest to check disabled status
      const manifestPath = join(dir, 'plugin.json')
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        if (disabled.has(manifest.name)) {
          console.log(`[PluginBus] Skipping disabled plugin: ${manifest.name}`)
          continue
        }
      } catch { /* let loadPlugin handle the error */ }

      const result = await this.loadPlugin(dir)
      if (result.error) {
        errors.push(`[${dir}]: ${result.error}`)
      } else if (result.plugin) {
        loaded.push(result.plugin.id)
      }
    }

    return { loaded, errors }
  }
```

- [ ] **Step 2: Update listPlugins to return enabled field**

Replace the `listPlugins` method:

```typescript
  listPlugins(disabled?: Set<string>): Array<{ id: string; version: string; description: string; trust: string; toolCount: number; enabled: boolean }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      version: p.manifest.version,
      description: p.manifest.description || '',
      trust: p.trust,
      toolCount: p.tools.size,
      enabled: disabled ? !disabled.has(p.id) : true,
    }))
  }
```

- [ ] **Step 3: Bust import() cache in loadPlugin**

In the `loadPlugin` method, find line 114:

```typescript
        const mod = await import(modulePath)
```

Replace with:

```typescript
        const mod = await import(modulePath + `?v=${Date.now()}`)
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/main/plugin-bus.ts
git commit -m "fix: loadAll filters disabled plugins, listPlugins returns enabled, bust import cache"
```

---

### Task 4: Fix agent-core.ts — togglePlugin + getPlugins

**Files:**
- Modify: `src/main/core/agent-core.ts`

- [ ] **Step 1: Add imports**

At the top of agent-core.ts, add:

```typescript
import { togglePluginSetting, getDisabledPlugins } from '../settings'
```

- [ ] **Step 2: Implement togglePlugin**

Replace the stub:

```typescript
  async togglePlugin(pluginId: string, enabled: boolean) {
    await togglePluginSetting(pluginId, enabled)
    return { success: true }
  }
```

- [ ] **Step 3: Fix getPlugins to pass disabled set**

Replace:

```typescript
  getPlugins() { return this.pluginBus.listPlugins() }
```

With:

```typescript
  getPlugins() {
    const disabled = new Set<string>(getDisabledPlugins())
    return this.pluginBus.listPlugins(disabled)
  }
```

- [ ] **Step 4: Fix initPlugins to pass disabled list**

In the `initPlugins` method, find:

```typescript
  const result = await this.pluginBus.loadAll()
```

Replace with:

```typescript
  const disabledPlugins = getDisabledPlugins()
  const result = await this.pluginBus.loadAll(disabledPlugins)
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/main/core/agent-core.ts
git commit -m "feat: implement togglePlugin with persistence, fix getPlugins to return enabled state"
```

---

### Task 5: Add Plugins tab to SettingsPanel.tsx

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`

- [ ] **Step 1: Add 'plugins' to Tab type**

In `src/renderer/components/SettingsPanel.tsx`, find:

```typescript
type Tab = 'general' | 'provider' | 'mcp' | 'skills' | 'voice' | 'channels'
```

Replace with:

```typescript
type Tab = 'general' | 'provider' | 'mcp' | 'skills' | 'voice' | 'channels' | 'plugins'
```

- [ ] **Step 2: Add Plugins entry to TABS array**

In the `TABS` array (around line 17), add after the 'channels' entry:

```typescript
  {
    id: 'plugins',
    label: 'Plugins',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
```

- [ ] **Step 3: Add PluginsTab component**

Before the main `SettingsPanel` component, add:

```typescript
interface PluginInfo {
  id: string
  version: string
  description: string
  trust: string
  toolCount: number
  enabled: boolean
}

function PluginsTab() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const loadPlugins = async () => {
    setLoading(true)
    try {
      const list = await window.claude.getPlugins()
      setPlugins(list || [])
    } catch { setPlugins([]) }
    setLoading(false)
  }

  useEffect(() => { loadPlugins() }, [])

  const handleToggle = async (pluginId: string, enabled: boolean) => {
    await window.claude.togglePlugin(pluginId, enabled)
    await loadPlugins()
  }

  const handleReload = async (pluginId: string) => {
    await window.claude.reloadPlugin(pluginId)
    await loadPlugins()
  }

  if (loading) {
    return <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', padding: '20px 0', textAlign: 'center' }}>Loading plugins...</div>
  }

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      <Section title="Installed Plugins">
        {plugins.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--text-outline-variant)', padding: '12px 0' }}>
            No plugins installed. Place plugins in <code style={{ color: 'var(--text-on-surface-variant)', background: 'var(--bg-surface-container-high)', padding: '1px 5px', borderRadius: 4 }}>~/.nerve/plugins/</code>
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 8 }}>
            {plugins.map(plugin => (
              <div key={plugin.id} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-container)' }}>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <button
                      onClick={() => handleToggle(plugin.id, !plugin.enabled)}
                      className="cursor-pointer transition-colors"
                      style={{
                        width: 32, height: 18, borderRadius: 9, border: 'none', position: 'relative',
                        background: plugin.enabled ? 'var(--accent-primary)' : 'var(--bg-surface-container-highest)',
                      }}
                    >
                      <div style={{
                        width: 14, height: 14, borderRadius: 7, background: '#fff',
                        position: 'absolute', top: 2, left: plugin.enabled ? 16 : 2,
                        transition: 'left 0.15s',
                      }} />
                    </button>
                    <span className="text-[12px] font-medium" style={{ color: plugin.enabled ? 'var(--text-on-surface)' : 'var(--text-outline)' }}>
                      {plugin.id}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-outline-variant)' }}>v{plugin.version}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-outline-variant)', background: 'var(--bg-surface-container-high)', padding: '1px 6px', borderRadius: 4 }}>
                      {plugin.trust}
                    </span>
                  </div>
                  <button
                    onClick={() => handleReload(plugin.id)}
                    className="text-[11px] cursor-pointer transition-colors"
                    style={{ padding: '3px 10px', borderRadius: 6, background: 'var(--bg-surface-container-high)', color: 'var(--text-on-surface-variant)', border: '1px solid var(--border-subtle)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container-highest)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container-high)' }}
                  >
                    Reload
                  </button>
                </div>

                {/* Description */}
                {plugin.description && (
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-on-surface-variant)' }}>{plugin.description}</p>
                )}

                {/* Expandable details */}
                <button
                  onClick={() => setExpanded(expanded === plugin.id ? null : plugin.id)}
                  className="text-[10px] mt-2 cursor-pointer"
                  style={{ color: 'var(--text-outline)', background: 'none', border: 'none', padding: 0 }}
                >
                  {expanded === plugin.id ? '▾' : '▸'} Tools ({plugin.toolCount})
                </button>

                {expanded === plugin.id && (
                  <div className="mt-1 text-[10px]" style={{ color: 'var(--text-outline-variant)', paddingLeft: 8 }}>
                    <div>Tools: {plugin.toolCount} registered</div>
                    {/* Skills and permissions would need additional IPC data */}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
```

- [ ] **Step 4: Add PluginsTab rendering in the content area**

In the SettingsPanel component's content area, find where other tabs are rendered (e.g., `{activeTab === 'skills' && <SkillsSection />}` or similar pattern). Add:

```typescript
{activeTab === 'plugins' && <PluginsTab />}
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/SettingsPanel.tsx
git commit -m "feat: add Plugins tab to Settings panel with toggle, reload, expandable details"
```

---

### Task 6: Remove PluginPanel modal

**Files:**
- Modify: `src/renderer/App.tsx` — remove modal + sidebar entry
- Delete: `src/renderer/components/PluginPanel.tsx`

- [ ] **Step 1: Read App.tsx to find PluginPanel usage**

Read `src/renderer/App.tsx` and find:
1. The `import { PluginPanel }` import
2. The `pluginsOpen` state
3. The `onOpenPlugins` prop passed to Sidebar
4. The `{pluginsOpen && <PluginPanel ... />}` render

- [ ] **Step 2: Remove PluginPanel from App.tsx**

Remove:
- The PluginPanel import
- The `pluginsOpen` state
- The `onOpenPlugins` prop and handler
- The PluginPanel render

- [ ] **Step 3: Remove PluginPanel from Sidebar**

Read the sidebar file (likely `src/renderer/Sidebar.tsx` or `src/renderer/components/GradientButtonGroup.tsx`). Remove the "Plugins" nav item that was added in Phase 3.

- [ ] **Step 4: Delete PluginPanel.tsx**

Run: `rm src/renderer/components/PluginPanel.tsx` (or `del` on Windows)

- [ ] **Step 5: Verify build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add -A src/renderer/
git commit -m "refactor: remove PluginPanel modal, replaced by Settings tab"
```
