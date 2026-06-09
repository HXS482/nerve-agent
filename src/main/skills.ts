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

  let skillsDir = ''
  for (const base of candidates) {
    const dir = join(base, '.agents', 'skills')
    if (existsSync(dir)) {
      skillsDir = dir
      break
    }
  }
  if (!skillsDir) return []

  const disabled = new Set<string>(getDisabledSkills())

  try {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

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
  } catch (err) {
    console.error('[Skills] error:', err)
    return []
  }
}

export async function toggleSkill(id: string, enabled: boolean) {
  await toggleSkillSetting(id, enabled)
}
