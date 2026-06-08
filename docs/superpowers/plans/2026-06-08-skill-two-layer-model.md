# Phase 1a: Skill Two-Layer Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace eager skill injection with a two-layer model (skill index in system prompt + `load_skill` tool for on-demand loading), reducing token overhead while maintaining backward compatibility.

**Architecture:** SkillRegistry manages skill metadata and content. The system prompt gets a lightweight skill index (~100 tokens/skill). A new `load_skill` built-in tool lets the LLM fetch full skill instructions on demand. A `skillLoading: 'eager'` setting preserves the current full-injection behavior.

**Tech Stack:** TypeScript, Zod, existing `estimateTokens` / `zodToInputSchema` utilities

**Spec reference:** `docs/superpowers/specs/2026-06-08-plugin-system-design.md` Sections 8.1–8.4, 14.5

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/main/skill-registry.ts` | SkillRegistry class — register, get, list, update |
| Modify | `src/shared/types.ts:272-278` | Add `skillDir` to `Skill`, add `SkillIndexEntry` type |
| Modify | `src/main/skills.ts:20-63` | Return `skillDir` from `getSkills()` |
| Modify | `src/main/tools.ts:84-120` | Add `load_skill` tool, accept optional `SkillRegistry` |
| Modify | `src/main/core/agent-core.ts:390-403` | Two-layer injection with eager fallback |
| Modify | `src/main/settings.ts:25-43` | Add `skillLoading?: 'lazy' | 'eager'` to `ClaudeSettings` |

---

### Task 1: Extend Skill types in shared/types.ts

**Files:**
- Modify: `src/shared/types.ts:272-278`

- [ ] **Step 1: Add `skillDir` to Skill and add SkillIndexEntry type**

In `src/shared/types.ts`, replace the existing `Skill` interface (line 272–278) and add `SkillIndexEntry`:

```typescript
// Skill — reusable prompt template invoked as a tool by the agent
export interface Skill {
  id: string
  name: string
  description: string
  prompt: string
  skillDir: string       // absolute path to the skill's directory
  enabled: boolean
}

// Lightweight skill metadata for system prompt index
export interface SkillIndexEntry {
  name: string
  description: string
}
```

- [ ] **Step 2: Verify type compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (existing Skill usage will need `skillDir` added in Task 2)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add skillDir to Skill type, add SkillIndexEntry"
```

---

### Task 2: Return skillDir from getSkills() in skills.ts

**Files:**
- Modify: `src/main/skills.ts:45-58`

- [ ] **Step 1: Update getSkills() to return skillDir**

In `src/main/skills.ts`, modify the `getSkills` function's mapping block (lines 45–58). The `dirs.map` callback needs to compute `skillDir` and include it in the returned object:

```typescript
    return dirs.map((dir) => {
      const skillPath = join(skillsDir, dir, 'SKILL.md')
      if (!existsSync(skillPath)) return null
      const raw = readFileSync(skillPath, 'utf-8')
      const parsed = parseSkillFrontmatter(raw)
      if (!parsed) return null
      return {
        id: dir,
        name: parsed.meta.name || dir,
        description: parsed.meta.description || '',
        prompt: parsed.body,
        skillDir: join(skillsDir, dir),
        enabled: !disabled.has(dir),
      }
    }).filter(Boolean) as Skill[]
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/skills.ts
git commit -m "feat: return skillDir from getSkills()"
```

---

### Task 3: Create SkillRegistry

**Files:**
- Create: `src/main/skill-registry.ts`

- [ ] **Step 1: Create SkillRegistry class**

Create `src/main/skill-registry.ts`:

```typescript
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Skill, SkillIndexEntry } from '../shared/types'
import { estimateTokens } from './core/token-estimator'

function parseSkillFrontmatter(content: string): { meta: Record<string, string>; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return null
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
  }
  return { meta, body: match[2] }
}

export class SkillRegistry {
  private skills = new Map<string, Skill>()
  private disabled = new Set<string>()

  setDisabled(disabledSkills: string[]) {
    this.disabled = new Set(disabledSkills)
  }

  register(skill: Skill) {
    this.skills.set(skill.id, skill)
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  getEnabled(): Skill[] {
    return Array.from(this.skills.values()).filter(s => !this.disabled.has(s.id))
  }

  listIndex(): SkillIndexEntry[] {
    return this.getEnabled().map(s => ({ name: s.name, description: s.description }))
  }

  listNames(): string[] {
    return this.getEnabled().map(s => s.name)
  }

  update(skills: Skill[]) {
    this.skills.clear()
    for (const skill of skills) {
      this.skills.set(skill.id, skill)
    }
  }

  resolvePrompt(skill: Skill, sessionId: string): string {
    return skill.prompt
      .replace(/\$\{CLAUDE_SKILL_DIR\}/g, skill.skillDir)
      .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId)
  }

  /**
   * Scan legacy .agents/skills/ directories (backward compat)
   * and new ~/.nerve/skills/ directories
   */
  async discoverFromDirs(candidates: string[], disabledSkills: string[]) {
    this.setDisabled(disabledSkills)

    for (const base of candidates) {
      const skillsDir = join(base, '.agents', 'skills')
      if (!existsSync(skillsDir)) continue

      const { readdirSync } = await import('fs')
      const dirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)

      for (const dir of dirs) {
        const skillPath = join(skillsDir, dir, 'SKILL.md')
        if (!existsSync(skillPath)) continue
        const raw = readFileSync(skillPath, 'utf-8')
        const parsed = parseSkillFrontmatter(raw)
        if (!parsed) continue
        this.register({
          id: dir,
          name: parsed.meta.name || dir,
          description: parsed.meta.description || '',
          prompt: parsed.body,
          skillDir: join(skillsDir, dir),
          enabled: !this.disabled.has(dir),
        })
      }
    }
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main/skill-registry.ts
git commit -m "feat: add SkillRegistry class"
```

---

### Task 4: Add load_skill tool

**Files:**
- Modify: `src/main/tools.ts:84` — update `getBuiltinTools` signature and add load_skill

- [ ] **Step 1: Update getBuiltinTools signature**

In `src/main/tools.ts`, line 84, update the function signature to accept an optional `SkillRegistry`:

```typescript
export function getBuiltinTools(
  cwd: string,
  gitNotify?: { refresh: () => void },
  projectDir?: string,
  skillRegistry?: import('./skill-registry').SkillRegistry
): Record<string, { description: string; input_schema: Record<string, unknown>; execute: (args: any) => Promise<any> }> {
```

- [ ] **Step 2: Add load_skill tool definition**

At the end of `getBuiltinTools`, before the final `return tools`, add the load_skill tool:

```typescript
  // load_skill — on-demand skill loading (two-layer model)
  if (skillRegistry) {
    const loadSkillSchema = z.object({
      skill_name: z.string().describe('Name of the skill to load'),
    })

    tools.load_skill = {
      description: `Load a skill by name to access its full instructions. Available skills: ${skillRegistry.listNames().join(', ')}. Only load when the skill is relevant to the current task.`,
      input_schema: zodToInputSchema(loadSkillSchema),
      execute: async (args: { skill_name: string }) => {
        const skill = skillRegistry.get(args.skill_name)
        if (!skill) {
          return { error: `Skill "${args.skill_name}" not found. Available: ${skillRegistry.listNames().join(', ')}` }
        }
        const prompt = skillRegistry.resolvePrompt(skill, '')
        const promptTokens = estimateTokens(prompt)
        return {
          skill_name: skill.name,
          description: skill.description,
          content: prompt,
          tokens: promptTokens,
        }
      },
    }
  }
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/tools.ts
git commit -m "feat: add load_skill built-in tool"
```

---

### Task 5: Two-layer skill injection in AgentCore

**Files:**
- Modify: `src/main/core/agent-core.ts:390-403` — replace eager injection
- Modify: `src/main/core/agent-core.ts:1-25` — add SkillRegistry import

- [ ] **Step 1: Add SkillRegistry to AgentCore**

In `src/main/core/agent-core.ts`, add the import and a private field:

At the top imports (around line 15), add:
```typescript
import { SkillRegistry } from '../skill-registry'
```

In the `AgentCore` class, add a field after the existing fields (around line 76):
```typescript
  private skillRegistry: SkillRegistry = new SkillRegistry()
```

- [ ] **Step 2: Update prepareMessages for two-layer injection**

In `src/main/core/agent-core.ts`, replace lines 390–403 (the skill injection block inside `prepareMessages`) with:

```typescript
    // 注入 Skills（两层模型 or eager 兼容模式）
    const disabledSkills: string[] = (this.settings as any).disabledSkills || []
    await this.skillRegistry.discoverFromDirs(
      [this.sourceDir, join(homedir(), '.nerve'), join(homedir(), '.claude')],
      disabledSkills
    )

    const skillLoading = (this.settings as any).skillLoading || 'lazy'

    if (skillLoading === 'eager') {
      // 兼容模式：全量注入（现有行为）
      const skills = this.skillRegistry.getEnabled()
      for (const skill of skills) {
        const resolvedPrompt = this.skillRegistry.resolvePrompt(skill, sessionId)
        systemPrompt += `\n\n---\n\n# Skill: ${skill.name}\n\nBase directory for this skill: ${skill.skillDir}\n\n${resolvedPrompt}`
      }
    } else {
      // 两层模型：只注入 index，LLM 通过 load_skill 按需加载
      const skillIndex = this.skillRegistry.listIndex()
      if (skillIndex.length > 0) {
        const indexText = skillIndex
          .map(s => `- **${s.name}**: ${s.description}`)
          .join('\n')
        systemPrompt += `\n\n## Available Skills\n\n${indexText}\n\nUse the \`load_skill\` tool to access a skill's full instructions when relevant to the user's request.`
      }
    }
```

- [ ] **Step 3: Pass skillRegistry to getBuiltinTools**

In the `buildTools` method of `AgentCore` (around line 465), find the call to `getBuiltinTools` and add `this.skillRegistry` as the 4th argument:

```typescript
    const builtinTools = getBuiltinTools(this.projectDir, {
      refresh: () => {
        if (isElectronChannel(channel)) channel.sendGitRefresh()
      },
    }, this.sourceDir, this.skillRegistry)
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/main/core/agent-core.ts
git commit -m "feat: two-layer skill injection with load_skill tool"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Verify skill index appears in system prompt**

Start the app with at least one skill installed (e.g., `image-generator` in `.agents/skills/`). Send a message and check the console logs. The system prompt should contain a "## Available Skills" section with the skill name and description, instead of the full skill prompt.

- [ ] **Step 3: Verify load_skill works**

In the chat, ask the agent to do something that would require the installed skill. The agent should call `load_skill` tool to get the full instructions. Check the tool call/result in the stream output.

- [ ] **Step 4: Verify eager fallback**

In `~/.nerve/settings.json`, add `"skillLoading": "eager"`. Restart and verify skills are fully injected into the system prompt (old behavior).

- [ ] **Step 5: Commit final state**

```bash
git status
# If all looks good:
git commit --allow-empty -m "verify: skill two-layer model working"
```
