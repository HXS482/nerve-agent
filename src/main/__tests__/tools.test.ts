import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
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

describe('Edit tool', () => {
  it('edits a unique match and returns a diff receipt', async () => {
    writeFileSync(join(dir, 'edit1.txt'), 'alpha\nbeta\ngamma')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit1.txt'), old_string: 'beta', new_string: 'BETA' })
    expect(res.success).toBe(true)
    expect(res.replacements).toBe(1)
    expect(res.firstChangedLine).toBe(2)
    expect(res.diff).toContain('- beta')
    expect(res.diff).toContain('+ BETA')
    expect(readFileSync(join(dir, 'edit1.txt'), 'utf-8')).toBe('alpha\nBETA\ngamma')
  })

  it('rejects multiple occurrences without replace_all', async () => {
    writeFileSync(join(dir, 'edit2.txt'), 'x\ny\nx')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit2.txt'), old_string: 'x', new_string: 'z' })
    expect(res.error).toMatch(/2 times/)
    expect(readFileSync(join(dir, 'edit2.txt'), 'utf-8')).toBe('x\ny\nx')
  })

  it('replace_all replaces every occurrence', async () => {
    writeFileSync(join(dir, 'edit3.txt'), 'x\ny\nx')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit3.txt'), old_string: 'x', new_string: 'z', replace_all: true })
    expect(res.replacements).toBe(2)
    expect(readFileSync(join(dir, 'edit3.txt'), 'utf-8')).toBe('z\ny\nz')
  })

  it('edits CRLF files with LF old_string and preserves CRLF', async () => {
    writeFileSync(join(dir, 'edit4.txt'), 'alpha\r\nbeta\r\ngamma\r\n')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit4.txt'), old_string: 'beta', new_string: 'BETA' })
    expect(res.success).toBe(true)
    expect(readFileSync(join(dir, 'edit4.txt'), 'utf-8')).toBe('alpha\r\nBETA\r\ngamma\r\n')
  })

  it('supports deletion with empty new_string', async () => {
    writeFileSync(join(dir, 'edit5.txt'), 'a\nb\nc')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit5.txt'), old_string: 'b\n', new_string: '' })
    expect(res.success).toBe(true)
    expect(readFileSync(join(dir, 'edit5.txt'), 'utf-8')).toBe('a\nc')
  })

  it('not-found error carries a hint and the file path', async () => {
    writeFileSync(join(dir, 'edit6.txt'), 'const a = 1')
    const res: any = await tools.Edit.execute({ file_path: join(dir, 'edit6.txt'), old_string: 'const  a  = 1', new_string: 'x' })
    expect(res.error).toMatch(/line 1/)
    expect(res.error).toContain('edit6.txt')
  })
})
