import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Skill, SkillIndexEntry } from '../shared/types'

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
   */
  async discoverFromDirs(candidates: string[], disabledSkills: string[]) {
    this.setDisabled(disabledSkills)

    for (const base of candidates) {
      const skillsDir = join(base, '.agents', 'skills')
      if (!existsSync(skillsDir)) continue

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
