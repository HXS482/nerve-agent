import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Skill, SkillIndexEntry } from '../shared/types'
import { parseSkillFrontmatter } from './skill-parser'

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
  discoverFromDirs(candidates: string[], disabledSkills: string[]) {
    this.setDisabled(disabledSkills)

    for (const base of candidates) {
      const skillsDir = join(base, '.agents', 'skills')
      if (!existsSync(skillsDir)) continue

      try {
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
      } catch (err) {
        console.error('[SkillRegistry] discover error:', err)
      }
    }
  }
}
