import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// setCwd 会写 ~/.nerve/settings.json。测试里把 NERVE_DIR 换成临时目录，
// 否则跑一次测试就改掉开发者真实的「最近项目」列表。
const { nerveDir } = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  return { nerveDir: path.join(os.tmpdir(), `nerve-setcwd-home-${process.pid}-${Date.now()}`) }
})

vi.mock('../../settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../settings')>()
  return { ...actual, NERVE_DIR: nerveDir }
})

import { AgentCore } from '../../core/agent-core'
import { FileSessionStore } from '../../session-store'

// 换项目的语义：`cwd`（工具跑在哪个目录、插件看哪个项目）可以变，
// 但**会话存储根目录不能跟着变**。原来的 setCwd 会把 sessionStore 重新
// create 到 `<cwd>/.nerve/sessions`，于是切到项目 B 之后项目 A 的所有会话
// 在列表里凭空消失（文件还在，只是指向的目录换了），切回来才又能看见。
//
// 这条测试钉的就是「A 的会话在切到 B 之后依然读得到」——直接调 setCwd，
// 不靠常量断言。
describe('setCwd — 换项目不换会话存储根目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'nerve-set-cwd-'))
  const sourceDir = join(root, 'app-source')
  const projectA = join(root, 'project-a')
  const projectB = join(root, 'project-b')

  beforeAll(() => mkdirSync(nerveDir, { recursive: true }))

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(nerveDir, { recursive: true, force: true })
  })

  const makeCore = (projectDir: string) =>
    new AgentCore({
      projectDir,
      sourceDir,
      settings: { cwd: projectDir, modelAliases: {} } as any,
    })

  /** 直接往 store 根目录写一个会话（和 AgentCore 用的是同一个 baseDir）。 */
  const seedSession = async () => {
    const store = await FileSessionStore.create(join(sourceDir, '.nerve', 'sessions'))
    await store.append({ sessionId: 's-a' }, [
      { type: 'user', message: { content: '项目 A 的第一条消息' }, timestamp: new Date().toISOString() },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: '收到' }] },
        timestamp: new Date().toISOString(),
        usage: { inputTokens: 10, outputTokens: 2, contextTokens: 12 },
      },
    ])
  }

  it('切到另一个项目后，原项目的会话仍然可读、列表里还在', async () => {
    await seedSession()
    const core = makeCore(projectA)

    // 切换前：会话可见
    expect((await core.getSessionMessages('s-a')).length).toBe(2)

    const storeBefore = (core as any).sessionStore
    expect(storeBefore).not.toBeNull()

    await core.setCwd(projectB)

    // 切换后：还是同一个 store 实例，历史一条不少
    expect((core as any).sessionStore).toBe(storeBefore)
    expect((await core.getSessionMessages('s-a')).length).toBe(2)
    expect((await core.listSessions()).map((s) => s.sessionId)).toContain('s-a')

    // 反过来钉：切换不能把 store 建到新 cwd 下面去
    expect(existsSync(join(projectB, '.nerve', 'sessions'))).toBe(false)

    // cwd 本身是要变的（工具跑哪个目录、插件读哪个项目）
    expect(core.getConfig().cwd).toBe(projectB)
  })

  it('setCwd 依然写 settings.json：cwd 更新 + 最近项目置顶去重', async () => {
    const core = makeCore(projectA)

    await core.setCwd(projectB)
    await core.setCwd(projectA)
    await core.setCwd(projectB)

    const written = JSON.parse(readFileSync(join(nerveDir, 'settings.json'), 'utf-8'))
    expect(written.cwd).toBe(projectB)
    expect(written.recentProjects).toEqual([projectB, projectA])
  })

  // 懒初始化的边界：store 还没被创建过就调用 setCwd，不能顺手把它建到新 cwd 下。
  // 下一次真正用到 store 时必须从 sourceDir 创建。
  it('store 尚未初始化时调用 setCwd，之后仍从 sourceDir 创建', async () => {
    await seedSession()
    const core = makeCore(projectA)

    expect((core as any).sessionStore).toBeNull()

    await core.setCwd(projectB)

    // setCwd 不负责创建 store
    expect((core as any).sessionStore).toBeNull()
    expect(existsSync(join(projectB, '.nerve', 'sessions'))).toBe(false)

    // 第一次真正使用 → 从 sourceDir 创建，而不是新 cwd
    const sessions = await core.listSessions()
    expect(sessions.map((s) => s.sessionId)).toContain('s-a')
    expect((core as any).sessionStore).not.toBeNull()
    expect(existsSync(join(projectB, '.nerve', 'sessions'))).toBe(false)
    expect(existsSync(join(sourceDir, '.nerve', 'sessions'))).toBe(true)
  })
})
