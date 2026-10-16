import { describe, it, expect, vi } from 'vitest'
import { McpPool, isPoolableConfig, resolveMcpToolNames } from '../mcp-pool'

const { loadMcpServerConfigs } = vi.hoisted(() => ({ loadMcpServerConfigs: vi.fn() }))

vi.mock('../settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../settings')>()
  return { ...actual, loadMcpServerConfigs }
})

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

describe('McpPool hot sync — remote (http) servers', () => {
  const REMOTE = { type: 'http', url: 'https://huggingface.co/mcp' }

  function seedRemote(pool: McpPool, name: string, config: unknown) {
    const client = { close: vi.fn().mockResolvedValue(undefined), listTools: vi.fn() }
    ;(pool as any).pool.set(name, {
      client,
      tools: {},
      lastHealthCheck: Date.now(),
      drainMode: false,
      inflightCalls: 0,
      configJson: JSON.stringify(config),
    })
    return client
  }

  it('keeps an unchanged remote server connected on hot sync', async () => {
    const pool = new McpPool()
    const client = seedRemote(pool, 'huggingface', REMOTE)
    loadMcpServerConfigs.mockResolvedValue({ huggingface: REMOTE })

    await pool.syncWithConfig()

    expect((pool as any).pool.has('huggingface')).toBe(true)
    expect(client.close).not.toHaveBeenCalled()
  })

  it('reconnects a remote server whose config changed instead of dropping it', async () => {
    const pool = new McpPool()
    const client = seedRemote(pool, 'huggingface', { type: 'http', url: 'https://old.example/mcp' })
    const connect = vi.spyOn(pool as any, 'connectWithTimeout').mockResolvedValue(undefined)
    const next = { type: 'http', url: 'https://new.example/mcp' }
    loadMcpServerConfigs.mockResolvedValue({ huggingface: next })

    await pool.syncWithConfig()

    expect(connect).toHaveBeenCalledWith('huggingface', next)
    expect(client.close).toHaveBeenCalled()
  })

  it('reconnects a dropped remote server in the background', async () => {
    const pool = new McpPool()
    const fakeClient = { listTools: vi.fn().mockResolvedValue({ tools: [] }), close: vi.fn() }
    vi.spyOn(pool as any, 'connectServer').mockResolvedValue(fakeClient)
    loadMcpServerConfigs.mockResolvedValue({ huggingface: REMOTE })

    await (pool as any).reconnect('huggingface')

    expect((pool as any).pool.has('huggingface')).toBe(true)
  })
})

// 三处（connectAll / reconnect / syncWithConfig）共用的准入判定，
// 这里单独钉住它的语义，免得再出现「改了一处漏了两处」
describe('isPoolableConfig', () => {
  it('accepts a local stdio server', () => {
    expect(isPoolableConfig({ type: 'stdio', command: 'npx' })).toBe(true)
  })

  it('accepts any config carrying a url, whatever the type string says', () => {
    for (const type of ['http', 'sse', 'streamablehttp', 'stdio']) {
      expect(isPoolableConfig({ type, url: 'https://huggingface.co/mcp' })).toBe(true)
    }
  })

  it('rejects a config that is neither stdio nor remote', () => {
    expect(isPoolableConfig({ type: 'websocket' })).toBe(false)
  })
})
