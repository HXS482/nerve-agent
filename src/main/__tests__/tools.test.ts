import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getBuiltinTools } from '../tools'

let dir: string
let tools: ReturnType<typeof getBuiltinTools>

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nerve-tools-'))
  tools = getBuiltinTools(dir)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('Read truncation notice', () => {
  it('returns small file without truncated flag', async () => {
    writeFileSync(join(dir, 'small.txt'), 'hello')
    const res: any = await tools.Read.execute({ file_path: join(dir, 'small.txt') })
    expect(res.content).toBe('hello')
    expect(res.truncated).toBeUndefined()
  })

  it('marks truncation for files over 50000 chars', async () => {
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(60000))
    const res: any = await tools.Read.execute({ file_path: join(dir, 'big.txt') })
    expect(res.content.length).toBe(50000)
    expect(res.truncated).toBe(true)
    expect(res.totalChars).toBe(60000)
    expect(res.note).toMatch(/50000 of 60000/)
  })
})

describe('Glob truncation notice', () => {
  it('returns few files without truncated flag', async () => {
    const res: any = await tools.Glob.execute({ pattern: 'small.txt', path: dir })
    expect(res.files.length).toBe(1)
    expect(res.truncated).toBeUndefined()
  })

  it('caps at 200 files and marks truncation', async () => {
    const many = mkdtempSync(join(tmpdir(), 'nerve-glob-'))
    for (let i = 0; i < 205; i++) writeFileSync(join(many, `f${i}.txt`), 'x')
    const res: any = await tools.Glob.execute({ pattern: '*.txt', path: many })
    expect(res.files.length).toBe(200)
    expect(res.truncated).toBe(true)
    expect(res.note).toMatch(/200/)
    rmSync(many, { recursive: true, force: true })
  })

  it('does not mark truncation when exactly 200 files match', async () => {
    const exact = mkdtempSync(join(tmpdir(), 'nerve-glob-exact-'))
    for (let i = 0; i < 200; i++) writeFileSync(join(exact, `f${i}.txt`), 'x')
    const res: any = await tools.Glob.execute({ pattern: '*.txt', path: exact })
    expect(res.files.length).toBe(200)
    expect(res.truncated).toBeUndefined()
    rmSync(exact, { recursive: true, force: true })
  })
})

describe('Grep truncation notice', () => {
  it('caps at 100 matches and marks truncation', async () => {
    const many = mkdtempSync(join(tmpdir(), 'nerve-grep-'))
    const lines = Array.from({ length: 150 }, (_, i) => `match line ${i}`).join('\n')
    writeFileSync(join(many, 'many.txt'), lines)
    const res: any = await tools.Grep.execute({ pattern: 'match line', path: many })
    expect(res.results.length).toBe(100)
    expect(res.truncated).toBe(true)
    rmSync(many, { recursive: true, force: true })
  })

  it('does not mark truncation when exactly 100 matches exist', async () => {
    const exact = mkdtempSync(join(tmpdir(), 'nerve-grep-exact-'))
    const lines = Array.from({ length: 100 }, (_, i) => `hit ${i}`).join('\n')
    writeFileSync(join(exact, 'exact.txt'), lines)
    const res: any = await tools.Grep.execute({ pattern: 'hit', path: exact })
    expect(res.results.length).toBe(100)
    expect(res.truncated).toBeUndefined()
    rmSync(exact, { recursive: true, force: true })
  })

  it('marks long lines with ellipsis', async () => {
    const long = mkdtempSync(join(tmpdir(), 'nerve-grep-long-'))
    writeFileSync(join(long, 'long.txt'), 'hit ' + 'y'.repeat(500))
    const res: any = await tools.Grep.execute({ pattern: 'hit', path: long })
    expect(res.results[0].text.length).toBe(201)
    expect(res.results[0].text.endsWith('…')).toBe(true)
    rmSync(long, { recursive: true, force: true })
  })

  it('returns matches without truncated flag under the cap', async () => {
    const res: any = await tools.Grep.execute({ pattern: 'hello', path: dir })
    expect(res.truncated).toBeUndefined()
  })
})

describe('Edit robustness', () => {
  it('replaces a unique match and reports replacements: 1', async () => {
    writeFileSync(join(dir, 'edit1.ts'), 'const a = 1\nconst b = 2\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit1.ts'), old_string: 'const b = 2', new_string: 'const b = 3' })
    expect(res.success).toBe(true)
    expect(res.replacements).toBe(1)
  })

  it('errors on multiple matches without replace_all, listing line numbers', async () => {
    writeFileSync(join(dir, 'edit2.ts'), 'foo\nbar\nfoo\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit2.ts'), old_string: 'foo', new_string: 'baz' })
    expect(res.error).toMatch(/matches 2 locations/)
    expect(res.error).toMatch(/lines 1, 3/)
    expect(res.error).toMatch(/replace_all/)
  })

  it('replace_all: true replaces every occurrence', async () => {
    writeFileSync(join(dir, 'edit3.ts'), 'foo\nbar\nfoo\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit3.ts'), old_string: 'foo', new_string: 'baz', replace_all: true })
    expect(res.success).toBe(true)
    expect(res.replacements).toBe(2)
  })

  it('not-found error includes closest matching line and a hint', async () => {
    writeFileSync(join(dir, 'edit4.ts'), 'function greet(name) {\n  return "hi " + name\n}\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit4.ts'), old_string: 'function  greet(name) {\n  return "bye"\n}', new_string: 'x' })
    expect(res.error).toMatch(/not found/)
    expect(res.error).toMatch(/Closest matching line/)
    expect(res.error).toMatch(/L1: function greet\(name\) \{/)
    expect(res.error).toMatch(/Hint:/)
  })

  it('tolerates multi-line LF old_string against a CRLF file, preserving CRLF elsewhere', async () => {
    writeFileSync(join(dir, 'edit5.ts'), 'line one\r\nline two\r\nline three\r\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit5.ts'), old_string: 'line one\nline two', new_string: 'LINE ONE\nLINE TWO' })
    expect(res.success).toBe(true)
    const { readFileSync } = await import('fs')
    expect(readFileSync(join(dir, 'edit5.ts'), 'utf-8')).toBe('LINE ONE\r\nLINE TWO\r\nline three\r\n')
  })

  it('does not double-convert a new_string that already uses CRLF', async () => {
    writeFileSync(join(dir, 'edit7.ts'), 'a\r\nb\r\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit7.ts'), old_string: 'a\nb', new_string: 'x\r\ny' })
    expect(res.success).toBe(true)
    const { readFileSync } = await import('fs')
    expect(readFileSync(join(dir, 'edit7.ts'), 'utf-8')).toBe('x\r\ny\r\n')
  })

  it('tolerates CRLF old_string against an LF file (reverse direction)', async () => {
    writeFileSync(join(dir, 'edit8.ts'), 'a\nb\nc\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit8.ts'), old_string: 'a\r\nb', new_string: 'A\r\nB' })
    expect(res.success).toBe(true)
    const { readFileSync } = await import('fs')
    expect(readFileSync(join(dir, 'edit8.ts'), 'utf-8')).toBe('A\nB\nc\n')
  })

  it('overlap-prone matches report deduped line numbers', async () => {
    writeFileSync(join(dir, 'edit9.ts'), 'aaaa')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit9.ts'), old_string: 'aa', new_string: 'b' })
    expect(res.error).toMatch(/matches 2 locations/)
    expect(res.error).toMatch(/lines 1\)/)
  })

  it('empty old_string is rejected', async () => {
    writeFileSync(join(dir, 'edit6.ts'), 'abc')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit6.ts'), old_string: '', new_string: 'x' })
    expect(res.error).toMatch(/must not be empty/)
  })
})

describe('Edit/Write diff feedback', () => {
  it('Edit returns line diff with added/removed counts and patch', async () => {
    writeFileSync(join(dir, 'diff1.ts'), 'const a = 1\nconst b = 2\nconst c = 3\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'diff1.ts'), old_string: 'const b = 2', new_string: 'const b = 20' })
    expect(res.added).toBe(1)
    expect(res.removed).toBe(1)
    expect(res.diff).toContain('- const b = 2')
    expect(res.diff).toContain('+ const b = 20')
    expect(res.diff).toContain('const a = 1') // 上下文行
  })

  it('Write on existing file returns diff; new file reports line count instead', async () => {
    writeFileSync(join(dir, 'diff2.ts'), 'a\nb\nc\n')
    const res: any = await tools.Write.execute({ file_path: join(dir, 'diff2.ts'), content: 'a\nB\nc\nd\n' })
    expect(res.removed).toBe(1)
    expect(res.added).toBe(2)

    const fresh: any = await tools.Write.execute({ file_path: join(dir, 'diff3.ts'), content: 'x\ny\n' })
    expect(fresh.newFile).toBe(true)
    expect(fresh.lines).toBe(2)
    expect(fresh.diff).toBeUndefined()
  })

  it('identical overwrite reports zero changes without patch noise', async () => {
    writeFileSync(join(dir, 'diff4.ts'), 'same\n')
    const res: any = await tools.Write.execute({ file_path: join(dir, 'diff4.ts'), content: 'same\n' })
    expect(res.added).toBe(0)
    expect(res.removed).toBe(0)
    expect(res.diff).toBeUndefined()
  })
})
