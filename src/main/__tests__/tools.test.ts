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
