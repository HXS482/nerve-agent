import { describe, it, expect } from 'vitest'
import { resolveMcpToolNames } from '../mcp-pool'

describe('resolveMcpToolNames', () => {
  it('keeps bare names when there is no conflict', () => {
    const out = resolveMcpToolNames([
      { serverName: 'fs', toolName: 'read_file' },
      { serverName: 'web', toolName: 'fetch' },
    ], new Set(['Read', 'Edit']))
    expect(out.map((r) => r.finalName)).toEqual(['read_file', 'fetch'])
  })

  it('prefixes on conflict with reserved (builtin) names', () => {
    const warnings: string[] = []
    const out = resolveMcpToolNames(
      [{ serverName: 'fs', toolName: 'Read' }],
      new Set(['Read']),
      (m) => warnings.push(m),
    )
    expect(out[0].finalName).toBe('fs__Read')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('fs__Read')
  })

  it('prefixes the later tool on cross-server conflict', () => {
    const out = resolveMcpToolNames([
      { serverName: 'a', toolName: 'search' },
      { serverName: 'b', toolName: 'search' },
    ])
    expect(out.map((r) => r.finalName)).toEqual(['search', 'b__search'])
  })

  it('appends a numeric suffix when the prefixed name is also taken', () => {
    const out = resolveMcpToolNames([
      { serverName: 'a', toolName: 'x' },
      { serverName: 'b', toolName: 'a__x' },
      { serverName: 'a', toolName: 'x' },
    ])
    // second entry takes a__x (no conflict yet); third entry conflicts on x and a__x → a__x__2
    expect(out.map((r) => r.finalName)).toEqual(['x', 'a__x', 'a__x__2'])
  })

  it('preserves entry payloads', () => {
    const out = resolveMcpToolNames([
      { serverName: 'fs', toolName: 'Read', tool: { description: 'd' } },
    ], new Set(['Read']))
    expect(out[0].tool).toEqual({ description: 'd' })
    expect(out[0].serverName).toBe('fs')
  })
})
