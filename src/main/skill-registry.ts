import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Skill, SkillIndexEntry } from '../shared/types'
import { parseSkillFrontmatter } from './skill-parser'

export class SkillRegistry {
  private skills = new Map<string, Skill>()
  private disabled = new Set<string>()
  private currentSessionId: string = ''

  setSessionId(sessionId: string) {
    this.currentSessionId = sessionId
  }

  setDisabled(disabledSkills: string[]) {
    this.disabled = new Set(disabledSkills)
  }

  register(skill: Skill) {
    this.skills.set(skill.id, skill)
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /**
   * 取一个「真的能用」的技能：同时过全局 disabled 和 Bot 白名单。
   *
   * 为什么单独一个方法而不是改 get()：get() 是「有没有这个技能」，
   * 语义上不该掺权限。而 load_skill 工具问的是「这个 Bot 能不能用它」，
   * 两者混在一起会让调用方猜不透。
   */
  getAvailable(name: string): Skill | undefined {
    const skill = this.skills.get(name)
    if (!skill) return undefined
    if (this.disabled.has(skill.id)) return undefined
    const allow = this.allowedSkills
    if (allow.length > 0 && !allow.includes(skill.id)) return undefined
    return skill
  }

  /** 当前 Bot 的技能白名单；空数组 = 不限制（由调用方在每轮设置）。 */
  private allowedSkills: string[] = []

  /**
   * 设置当前 Bot 的技能白名单。空数组 = 不限制。
   *
   * 由 AgentCore 在每轮 prepareMessages 时设置 —— 不能放在构造里，
   * 因为同一个 registry 实例会服务多个 Bot（会话切换、routine、交接）。
   */
  setAllowedSkills(ids: string[]) {
    this.allowedSkills = ids
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

  resolvePrompt(skill: Skill, sessionId?: string): string {
    return skill.prompt
      .replace(/\$\{CLAUDE_SKILL_DIR\}/g, skill.skillDir)
      .replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId ?? this.currentSessionId)
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
