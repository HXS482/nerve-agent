import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { Skill } from '../shared/types'
import { getNerveSettings, saveNerveSettings } from './settings'

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

  const settings = await getNerveSettings()
  const disabled = new Set<string>((settings as any).disabledSkills || [])

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
        enabled: !disabled.has(dir),
      }
    }).filter(Boolean) as Skill[]
  } catch (err) {
    console.error('[Skills] error:', err)
    return []
  }
}

export async function toggleSkill(id: string, enabled: boolean) {
  const settings = await getNerveSettings()
  const disabled: string[] = (settings as any).disabledSkills || []
  if (enabled) {
    ;(settings as any).disabledSkills = disabled.filter((d) => d !== id)
  } else {
    ;(settings as any).disabledSkills = [...disabled, id]
  }
  await saveNerveSettings(settings)
}
