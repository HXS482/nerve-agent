import { describe, it, expect } from 'vitest'
import { filterTools, serializeResult } from '../../mcp-bridge/tool-registry'

describe('serializeResult', () => {
  it('handles null/undefined', () => {
    expect(serializeResult(null)).toBe('')
    expect(serializeResult(undefined)).toBe('')
  })

  it('handles primitive values', () => {
    expect(serializeResult('hello')).toBe('hello')
    expect(serializeResult(42)).toBe('42')
  })

  it('handles Bash success { output }', () => {
    expect(serializeResult({ output: 'file1.txt\nfile2.txt' })).toBe('file1.txt\nfile2.txt')
  })

  it('handles Bash with stderr { output, error }', () => {
    const result = serializeResult({ output: 'ok', error: 'warning: deprecated' })
    expect(result).toBe('ok\n[stderr] warning: deprecated')
  })

  it('handles Bash failure { error } only', () => {
    expect(serializeResult({ error: 'command not found' })).toBe('Error: command not found')
  })

  it('handles Read { content }', () => {
    expect(serializeResult({ content: 'file contents here' })).toBe('file contents here')
  })

  it('handles Write { success, file_path }', () => {
    expect(serializeResult({ success: true, file_path: '/tmp/test.ts' })).toBe('Written: /tmp/test.ts')
  })

  it('handles Edit { success, file_path, warnings }', () => {
    expect(serializeResult({ success: true, file_path: '/tmp/test.ts', warnings: ['warn'] })).toBe('Edited: /tmp/test.ts')
  })

  it('handles Glob { files }', () => {
    expect(serializeResult({ files: ['a.ts', 'b.ts'] })).toBe('a.ts\nb.ts')
  })

  it('handles Grep { results }', () => {
    const result = serializeResult({
      results: [
        { file: 'a.ts', line: 1, text: 'import foo' },
        { file: 'b.ts', line: 5, text: 'import bar' },
      ]
    })
    expect(result).toBe('a.ts:1: import foo\nb.ts:5: import bar')
  })

  it('handles Git { success, message }', () => {
    expect(serializeResult({ success: true, message: '3 files staged' })).toBe('3 files staged')
  })

  it('handles GitCommit { success, message, warnings, error }', () => {
    const result = serializeResult({
      success: true,
      message: '[main abc1234] commit msg',
      warnings: [],
      error: 'lint warning'
    })
    expect(result).toBe('[main abc1234] commit msg')
  })

  it('handles success=true with no message or file_path', () => {
    expect(serializeResult({ success: true })).toBe('OK')
  })

  it('handles success=false as fatal error', () => {
    expect(serializeResult({ success: false, error: 'disk full' })).toBe('Error: disk full')
  })

  it('handles unknown object shape', () => {
    const result = serializeResult({ foo: 'bar', count: 3 })
    expect(result).toContain('"foo"')
    expect(result).toContain('"count"')
  })

  it('handles Bash with savedImages', () => {
    const result = serializeResult({ output: 'done', savedImages: ['chart.png'] })
    expect(result).toContain('done')
    expect(result).toContain('[images saved: chart.png]')
  })
})

describe('filterTools', () => {
  const mockTools = {
    Read: { description: 'Read', input_schema: {}, execute: async () => ({}) },
    Write: { description: 'Write', input_schema: {}, execute: async () => ({}) },
    Bash: { description: 'Bash', input_schema: {}, execute: async () => ({}) },
    load_skill: { description: 'skill', input_schema: {}, execute: async () => ({}) },
  }

  it('includes only specified tools when include is non-empty', () => {
    const result = filterTools(mockTools, { include: ['Read', 'Write'], exclude: [] })
    expect(Object.keys(result)).toEqual(['Read', 'Write'])
  })

  it('excludes specified tools', () => {
    const result = filterTools(mockTools, { include: [], exclude: ['load_skill'] })
    expect(Object.keys(result)).toContain('Read')
    expect(Object.keys(result)).not.toContain('load_skill')
  })

  it('exclude takes precedence over include', () => {
    const result = filterTools(mockTools, { include: ['Read', 'Bash'], exclude: ['Bash'] })
    expect(Object.keys(result)).toEqual(['Read'])
  })

  it('returns all tools when include is empty and exclude is empty', () => {
    const result = filterTools(mockTools, { include: [], exclude: [] })
    expect(Object.keys(result)).toEqual(['Read', 'Write', 'Bash', 'load_skill'])
  })
})
