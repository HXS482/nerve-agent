import { describe, it, expect } from 'vitest'
import { resolveCwd } from '../../core/session-cwd'

describe('resolveCwd', () => {
  it('prefers the payload cwd', () => {
    expect(resolveCwd('/fallback', '/project-a')).toBe('/project-a')
  })
  it('falls back when payload cwd is missing (old sessions)', () => {
    expect(resolveCwd('/fallback', undefined)).toBe('/fallback')
  })
  it('falls back when payload cwd is an empty string', () => {
    expect(resolveCwd('/fallback', '')).toBe('/fallback')
  })
  // 纯空白既不是「有意义的目录」也不是老会话的 undefined：当它是有效 cwd 会让工具
  // 跑在一个不存在的路径上（getBuiltinTools 里 existsSync 失败会静默退回 $HOME）。
  it('falls back when payload cwd is whitespace only', () => {
    expect(resolveCwd('/fallback', ' ')).toBe('/fallback')
    expect(resolveCwd('/fallback', '\t\n ')).toBe('/fallback')
  })
  // 反转守卫过度收紧：带空格/中文的真实目录必须原样返回（不 trim 掉路径本身）
  it('keeps a real path that merely contains spaces or CJK', () => {
    expect(resolveCwd('/fallback', '/projects/my app')).toBe('/projects/my app')
    expect(resolveCwd('/fallback', '/projects/我的 项目')).toBe('/projects/我的 项目')
  })
})
