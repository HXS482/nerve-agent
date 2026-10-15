import { describe, it, expect, afterEach, vi } from 'vitest'
import { getBuiltinTools } from '../tools'

// GenerateImage 的降级链：优先 SiliconFlow（Kolors 质量更好），
// 但只要 key 缺失 / 余额不足(402) / 接口挂了 / 下载失败，都必须自动落到
// Pollinations（免 key）。以前余额为 0 就直接整个工具报错，这里锁死行为。
describe('GenerateImage 降级链', () => {
  const realFetch = globalThis.fetch
  const realKey = process.env.SILICONFLOW_API_KEY

  afterEach(() => {
    globalThis.fetch = realFetch
    if (realKey === undefined) delete process.env.SILICONFLOW_API_KEY
    else process.env.SILICONFLOW_API_KEY = realKey
    vi.restoreAllMocks()
  })

  const tinyJpeg = () => {
    // 大于 1000 字节的假 JPEG（magic ffd8ff），满足「非空响应体」校验
    const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    return Buffer.concat([head, Buffer.alloc(2048, 0x20)])
  }

  const makeTools = () => getBuiltinTools(process.cwd())

  it('key 缺失时直接走 Pollinations，不碰 SiliconFlow', async () => {
    delete process.env.SILICONFLOW_API_KEY
    const calls: string[] = []
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url))
      return { ok: true, status: 200, arrayBuffer: async () => tinyJpeg() } as any
    }) as any

    const res: any = await makeTools().GenerateImage.execute({ prompt: 'a cat' })

    expect(calls.some((u) => u.includes('siliconflow'))).toBe(false)
    expect(calls.some((u) => u.includes('pollinations'))).toBe(true)
    expect(res.provider).toBe('pollinations')
    expect(res.error).toBeUndefined()
  })

  it('SiliconFlow 余额不足(402) 时自动降级到 Pollinations', async () => {
    process.env.SILICONFLOW_API_KEY = 'sk-test'
    const calls: string[] = []
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url))
      if (String(url).includes('siliconflow')) {
        return { ok: false, status: 402, text: async () => '{"code":30001,"message":"insufficient"}' } as any
      }
      return { ok: true, status: 200, arrayBuffer: async () => tinyJpeg() } as any
    }) as any

    const res: any = await makeTools().GenerateImage.execute({ prompt: 'a cat' })

    expect(calls.filter((u) => u.includes('siliconflow')).length).toBe(1)
    expect(res.provider).toBe('pollinations')
    expect(res.error).toBeUndefined()
  })

  it('SiliconFlow 正常时用它，不再请求 Pollinations', async () => {
    process.env.SILICONFLOW_API_KEY = 'sk-test'
    const calls: string[] = []
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url))
      if (String(url).includes('siliconflow') && !String(url).includes('cdn')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ url: 'https://cdn.example/x.png' }] }) } as any
      }
      return { ok: true, status: 200, arrayBuffer: async () => tinyJpeg() } as any
    }) as any

    const res: any = await makeTools().GenerateImage.execute({ prompt: 'a cat' })

    expect(res.provider).toBe('siliconflow')
    expect(calls.some((u) => u.includes('pollinations'))).toBe(false)
  })

  it('SiliconFlow 抛网络异常时降级，不把错误抛给调用方', async () => {
    process.env.SILICONFLOW_API_KEY = 'sk-test'
    globalThis.fetch = (async (url: any) => {
      if (String(url).includes('siliconflow')) throw new Error('ECONNRESET')
      return { ok: true, status: 200, arrayBuffer: async () => tinyJpeg() } as any
    }) as any

    const res: any = await makeTools().GenerateImage.execute({ prompt: 'a cat' })

    expect(res.provider).toBe('pollinations')
    expect(res.error).toBeUndefined()
  })

  it('两条路都失败时返回可读的 error', async () => {
    process.env.SILICONFLOW_API_KEY = 'sk-test'
    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => 'down' } as any)) as any

    const res: any = await makeTools().GenerateImage.execute({ prompt: 'a cat' })

    expect(res.error).toBeTruthy()
    expect(res.path).toBeUndefined()
  })
})
