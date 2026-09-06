import { describe, it, expect } from 'vitest'
import { applyEdit } from '../edit-utils'

describe('applyEdit', () => {
  it('replaces a unique match', () => {
    const res = applyEdit('a\nb\nc', 'b', 'B')
    expect(res).toMatchObject({ ok: true, content: 'a\nB\nc', replacements: 1, fuzzy: false, firstChangedLine: 2 })
  })

  it('rejects empty old_string', () => {
    const res = applyEdit('abc', '', 'x')
    expect(res.ok).toBe(false)
  })

  it('rejects multiple occurrences without replace_all', () => {
    const res = applyEdit('x\ny\nx\ny', 'x', 'z')
    expect(res).toMatchObject({ ok: false })
    if (!res.ok) expect(res.error).toMatch(/2 times/)
  })

  it('replaces all occurrences with replace_all', () => {
    const res = applyEdit('x\ny\nx', 'x', 'z', true)
    expect(res).toMatchObject({ ok: true, content: 'z\ny\nz', replacements: 2 })
  })

  it('falls back to trailing-whitespace tolerant match', () => {
    // 文件里 "b" 行尾部有空格，模型给的多行 old_string 没有 → 精确匹配失败，容错命中
    const res = applyEdit('a\nb  \nc', 'a\nb\nc', 'x')
    expect(res).toMatchObject({ ok: true, fuzzy: true, replacements: 1, firstChangedLine: 1 })
    if (res.ok) expect(res.content).toBe('x')
  })

  it('supports deletion via empty new_string', () => {
    const res = applyEdit('a\nb\nc', 'b\n', '')
    expect(res).toMatchObject({ ok: true, content: 'a\nc' })
  })

  it('hints the closest line when old_string differs only by whitespace', () => {
    const res = applyEdit('const a = 1', 'const  a  = 1', 'x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/line 1/)
  })

  it('hints first-line location for multi-line near misses', () => {
    const content = 'function foo() {\n  return 42\n}'
    const res = applyEdit(content, 'function foo() {\n    return 42\n}', 'x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/line 1/)
  })

  it('plain not-found gives an error without crashing', () => {
    const res = applyEdit('hello world', 'nonexistent', 'x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/not found/)
  })
})
