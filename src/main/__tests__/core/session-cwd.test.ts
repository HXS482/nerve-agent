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
})
