import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { Skill } from '../shared/types'
import { toggleSkillSetting, getDisabledSkills } from './settings'
import { parseSkillFrontmatter } from './skill-parser'

export async function getSkills(projectDir?: string): Promise<Skill[]> {
  const candidates = [
    projectDir,
    join(homedir(), '.nerve'),
    join(homedir(), '.claude'),
  ].filter(Boolean) as string[]

  // 聚合所有候选目录（与 SkillRegistry.discoverFromDirs 对齐），
  // 同名 skill 先到先得：项目级覆盖用户级（.nerve → .claude）
  const byId = new Map<string, Skill>()
  for (const base of candidates) {
    const skillsDir = join(base, '.agents', 'skills')
    if (!existsSync(skillsDir)) continue

    const disabled = new Set<string>(getDisabledSkills())

    try {
      const dirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)

      for (const dir of dirs) {
        if (byId.has(dir)) continue
        const skillPath = join(skillsDir, dir, 'SKILL.md')
        if (!existsSync(skillPath)) continue
        const raw = readFileSync(skillPath, 'utf-8')
        const parsed = parseSkillFrontmatter(raw)
        if (!parsed) continue
        byId.set(dir, {
          id: dir,
          name: parsed.meta.name || dir,
          description: parsed.meta.description || '',
          prompt: parsed.body,
          skillDir: join(skillsDir, dir),
          enabled: !disabled.has(dir),
        })
      }
    } catch (err) {
      console.error('[Skills] error:', err)
    }
  }

  return Array.from(byId.values())
}

export async function toggleSkill(id: string, enabled: boolean) {
  await toggleSkillSetting(id, enabled)
}
