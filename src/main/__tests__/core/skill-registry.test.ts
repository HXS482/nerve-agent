import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SkillRegistry } from '../../skill-registry'
import type { Skill } from '../../../shared/types'

function skill(id: string, name: string): Skill {
  return { id, name, description: '', prompt: 'body', skillDir: `/skills/${id}`, enabled: true }
}

function registryOf(...skills: Skill[]): SkillRegistry {
  const reg = new SkillRegistry()
  for (const s of skills) reg.register(s)
  return reg
}

describe('SkillRegistry 白名单', () => {
  it('空数组 = 不限制', () => {
    const reg = registryOf(skill('a', 'A'), skill('b', 'B'))
    expect(reg.getAvailable('a', [])).toBeDefined()
    expect(reg.getAvailable('b', [])).toBeDefined()
  })

  it('非空白名单只放行名单里的', () => {
    const reg = registryOf(skill('a', 'A'), skill('b', 'B'))
    expect(reg.getAvailable('a', ['a'])).toBeDefined()
    expect(reg.getAvailable('b', ['a'])).toBeUndefined()
  })

  it('白名单是调用方传参，不挂在实例上 —— 两个 Bot 并发不会互相冲掉', () => {
    const reg = registryOf(skill('a', 'A'), skill('b', 'B'))
    // A 这轮只给 a，B 这轮不限制：两次调用交错也只读自己的参数
    expect(reg.getAvailable('b', ['a'])).toBeUndefined()
    expect(reg.getAvailable('b', [])).toBeDefined()
    expect(reg.getAvailable('a', ['a'])).toBeDefined()
  })

  it('全局 disabled 优先于白名单', () => {
    const reg = registryOf(skill('a', 'A'))
    reg.setDisabled(['a'])
    expect(reg.getAvailable('a', [])).toBeUndefined()
    expect(reg.getAvailable('a', ['a'])).toBeUndefined()
  })

  it('按 frontmatter 的 name 也能查到（系统提示给的是 name，不是目录 id）', () => {
    const reg = registryOf({ ...skill('dir-id', 'Pretty Name') })
    expect(reg.getAvailable('Pretty Name', [])?.id).toBe('dir-id')
    expect(reg.getAvailable('pretty name', [])?.id).toBe('dir-id')
  })
})

describe('SkillRegistry 发现', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'skillreg-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function writeSkill(id: string, name: string) {
    const p = join(dir, '.agents', 'skills', id)
    mkdirSync(p, { recursive: true })
    writeFileSync(join(p, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\nbody`)
  }

  it('被禁用的技能不进 enabled 列表', () => {
    writeSkill('image-generator', 'image-generator')
    writeSkill('svg', 'svg')
    const reg = new SkillRegistry()
    reg.discoverFromDirs([dir], ['svg'])
    expect(reg.getEnabled().map((s) => s.id)).toEqual(['image-generator'])
    expect(reg.get('svg')).toBeDefined() // 存在，但不可用
    expect(reg.getAvailable('svg', [])).toBeUndefined()
  })
})
