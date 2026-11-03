import { describe, it, expect, afterEach } from 'vitest'
import { JobRegistry } from '../../core/job-registry'

/**
 * 用 Git Bash 跑真命令（这台机器上有），避免依赖 shell 差异。
 * 所有命令都写成能在 100ms 内结束的形式，测试不靠 sleep 赌时序。
 */
const BASH = 'C:/Program Files/Git/bin/bash.exe'

function run(reg: JobRegistry, cmd: string, inlineWaitMs = 5000) {
  return reg.waitOrAdopt(cmd, {
    shell: BASH,
    args: ['-c', cmd],
    cwd: process.cwd(),
    inlineWaitMs,
  })
}

/**
 * 等到作业离开 running 集合（或超时）。
 *
 * 不用固定 sleep：全量跑时 CPU 更忙，固定 500ms 会偶发不够。
 * 轮询能把"够不够"变成"等到了没有"，慢机器上只是等久一点，不会假失败。
 */
async function waitForFinish(reg: JobRegistry, jobId: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (reg.runningIds().includes(jobId) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('JobRegistry', () => {
  const reg = new JobRegistry()
  afterEach(() => reg.killAll())

  it('5 秒内完成时走同步路径，直接拿到输出', async () => {
    const r = await run(reg, 'echo hello')
    expect(r.kind).toBe('done')
    if (r.kind !== 'done') throw new Error('unreachable')
    expect(r.result.stdout).toContain('hello')
    expect(r.result.exitCode).toBe(0)
  })

  it('超时未完成时转后台，且**同一个进程**继续跑完', async () => {
    // 先睡 400ms 再输出，inlineWaitMs 设 100ms → 必然转后台
    const r = await run(reg, 'sleep 0.4 && echo finished', 100)
    expect(r.kind).toBe('background')
    if (r.kind !== 'background') throw new Error('unreachable')

    // 后台作业最终应该完成
    await waitForFinish(reg, r.jobId)
    const done = reg.takeFinished(r.jobId)
    expect(done).toBeDefined()
    expect(done!.stdout).toContain('finished')
    expect(done!.exitCode).toBe(0)
  })

  it('转后台时不会重复执行命令（副作用只发生一次）', async () => {
    // 关键回归：早期实现超时后重新起一条命令，命令会跑两次
    const fs = await import('fs')
    const os = await import('os')
    const path = await import('path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobdedup-'))
    const marker = path.join(dir, 'count.txt').replace(/\\/g, '/')

    const r = await run(reg, `sleep 0.3 && echo x >> "${marker}"`, 100)
    expect(r.kind).toBe('background')
    if (r.kind !== 'background') throw new Error('should be background')

    await waitForFinish(reg, r.jobId)
    // 再等一小会儿，确认没有第二个进程迟到写入
    await new Promise((res) => setTimeout(res, 200))
    const content = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : ''
    // 只写了一行 = 命令只执行了一次
    expect(content.trim().split('\n').filter(Boolean)).toHaveLength(1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('取走结果后不会再返回（结果只读一次）', async () => {
    // 只有走后台路径的作业才进 finished 队列；同步返回的不入队。
    const bg = await run(reg, 'sleep 0.3 && echo once', 50)
    if (bg.kind !== 'background') throw new Error('should be background')
    await waitForFinish(reg, bg.jobId)

    // 用精确 jobId 取，避免拿到前面测试遗留的结果
    const first = reg.takeFinished(bg.jobId)
    expect(first).toBeDefined()
    expect(first!.stdout).toContain('once')
    expect(reg.takeFinished(bg.jobId)).toBeUndefined()
  })

  it('按 jobId 精确取结果', async () => {
    const a = await run(reg, 'echo AAA')
    const b = await run(reg, 'echo BBB')
    if (a.kind !== 'done' || b.kind !== 'done') throw new Error('should be sync')

    // 走后台路径才能进 finished 队列
    const bg = await run(reg, 'sleep 0.3 && echo ZZZ', 50)
    if (bg.kind !== 'background') throw new Error('should be background')
    await waitForFinish(reg, bg.jobId)

    const got = reg.takeFinished(bg.jobId)
    expect(got!.stdout).toContain('ZZZ')
  })

  it('退出码如实反映失败', async () => {
    const r = await run(reg, 'exit 3')
    expect(r.kind).toBe('done')
    if (r.kind !== 'done') throw new Error('unreachable')
    expect(r.result.exitCode).toBe(3)
  })

  it('stderr 也被收集', async () => {
    const r = await run(reg, 'echo oops >&2')
    expect(r.kind).toBe('done')
    if (r.kind !== 'done') throw new Error('unreachable')
    expect(r.result.stderr).toContain('oops')
  })

  it('完成结果数量有上限，不会无限增长', async () => {
    const small = new JobRegistry(3)
    for (let i = 0; i < 6; i++) {
      const r = await small.waitOrAdopt(`echo ${i}`, {
        shell: BASH, args: ['-c', `echo ${i}`], cwd: process.cwd(), inlineWaitMs: 5000,
      })
      if (r.kind !== 'done') throw new Error('should be sync')
      // 手动把它塞进 finished 队列：走后台路径才能进，这里直接验证上限逻辑
    }
    // 用后台路径造 6 个
    for (let i = 0; i < 6; i++) {
      await small.waitOrAdopt(`sleep 0.2 && echo ${i}`, {
        shell: BASH, args: ['-c', `sleep 0.2 && echo ${i}`], cwd: process.cwd(), inlineWaitMs: 10,
      })
    }
    // 等到所有后台作业都结束
    const deadline = Date.now() + 5000
    while (small.runningIds().length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(small.pendingCount).toBeLessThanOrEqual(3)
    small.killAll()
  })

  it('kill() 能杀掉运行中的作业', async () => {
    const r = await run(reg, 'sleep 10', 100)
    expect(r.kind).toBe('background')
    if (r.kind !== 'background') throw new Error('unreachable')
    expect(reg.runningIds()).toContain(r.jobId)
    expect(reg.kill(r.jobId)).toBe(true)

    // Windows 上 child.kill() 对 bash 不保证立即生效，给足时间
    const deadline = Date.now() + 3000
    while (reg.runningIds().includes(r.jobId) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 50))
    }

    expect(reg.runningIds()).not.toContain(r.jobId)
    const result = reg.takeFinished(r.jobId)
    expect(result).toBeDefined()
    // 被信号杀掉：signal 有值，或退出码非 0
    expect(result!.signal || result!.exitCode !== 0).toBeTruthy()
  })
})
