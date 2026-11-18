/**
 * 后台作业注册表。
 *
 * 解决的问题：Bash 工具以前是同步等待，一条长命令会把整个 run 卡在那一轮，
 * 期间用户的任何新消息都进不来 —— 长任务直接把对话堵死。
 *
 * 现在的语义（照 DSH 的 5 秒规则）：
 * - 命令启动后先等一小段（默认 5s）
 * - 这段时间内跑完 → 正常返回输出，用户看不出区别
 * - 还没跑完 → 转成后台 job，立刻返回 { started, jobId }，run 可以继续
 * - 作业结束后结果留在注册表里，模型下次调 Bash 时能看到并读取
 *
 * 关键约束：作业的输出必须**有上限**。一个会吐几百兆的进程（比如 tail -f）
 * 不能把内存吃光——超过上限就丢掉中间部分，保留头尾。
 */

import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'

/** 单个作业最多保留的字节数。超出后丢中间、保头尾，并标记被截断。 */
const MAX_JOB_OUTPUT = 256 * 1024

export interface JobResult {
  jobId: string
  command: string
  /** 进程退出码；被信号杀掉时为 null */
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  /** 输出是否被截断过 */
  truncated: boolean
  startedAt: number
  endedAt: number
}

interface Job {
  id: string
  command: string
  child: ChildProcess
  stdout: string
  stderr: string
  truncated: boolean
  startedAt: number
  endedAt?: number
  exited: Promise<JobResult>
}

/** 保留头尾、丢中间。一开始就超限的极端情况下只留尾部。 */
function clampOutput(text: string): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= MAX_JOB_OUTPUT) {
    return { text, truncated: false }
  }
  const half = Math.floor(MAX_JOB_OUTPUT / 2)
  const head = text.slice(0, half)
  const tail = text.slice(-half)
  return {
    text: `${head}\n\n[... 输出过长，中间部分已丢弃 ...]\n\n${tail}`,
    truncated: true,
  }
}

export class JobRegistry {
  private jobs = new Map<string, Job>()
  /** 已经结束、还没被模型取走的作业。取走即删，避免无限增长。 */
  private finished = new Map<string, JobResult>()

  /** 最多同时保留多少个未取走的完成结果。 */
  constructor(private readonly maxFinished = 20) {}

  /**
   * 同步等一小段；没跑完就把**同一个进程**转成后台作业。
   *
   * 为什么必须共用同一个进程：如果超时后重新起一条命令，命令会被执行两次。
   * `npm install` / `git push` / 任何有副作用的命令都受不了这个。
   * 所以这里先 spawn，再 race：赢了返回结果，输了把这同一个 child 登记为 job。
   *
   * 代价：前 N 秒的输出仍然缓冲在 job 里，不会丢 —— 因为我们从一开始就在收集。
   */
  async waitOrAdopt(
    command: string,
    opts: {
      shell: string
      args: string[]
      cwd: string
      env?: NodeJS.ProcessEnv
      inlineWaitMs: number
    },
  ): Promise<{ kind: 'done'; result: JobResult } | { kind: 'background'; jobId: string }> {
    const spawned = this.spawnJob(command, opts)
    const raced = await Promise.race([
      spawned.exited.then((result) => ({ kind: 'done' as const, result })),
      new Promise<{ kind: 'background' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'background' }), opts.inlineWaitMs),
      ),
    ])

    if (raced.kind === 'done') return raced

    // 同一个 child 直接转为对外可见的 job。它一直在跑，输出一直在攒。
    return { kind: 'background', jobId: spawned.id }
  }

  /** 启动一个后台作业。立刻返回 jobId，不等它跑完。 */
  start(command: string, opts: { shell?: string; args?: string[]; cwd: string; env?: NodeJS.ProcessEnv }): string {
    const shell = opts.shell ?? process.env.ComSpec ?? 'cmd.exe'
    const args = opts.args ?? ['/c', command]
    return this.spawnJob(command, { shell, args, cwd: opts.cwd, env: opts.env }).id
  }

  /** 真正的 spawn + 输出收集。start 和 waitOrAdopt 共用，保证只有一份实现。 */
  private spawnJob(
    command: string,
    opts: { shell: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv },
  ): { id: string; exited: Promise<JobResult> } {
    const id = randomUUID()
    const shell = opts.shell
    const args = opts.args

    const child = spawn(shell, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
    })

    const job: Job = {
      id,
      command,
      child,
      stdout: '',
      stderr: '',
      truncated: false,
      startedAt: Date.now(),
      exited: undefined as unknown as Promise<JobResult>,
    }

    job.exited = new Promise<JobResult>((resolve) => {
      const append = (which: 'stdout' | 'stderr', chunk: Buffer) => {
        const merged = job[which] + chunk.toString('utf8')
        const { text, truncated } = clampOutput(merged)
        job[which] = text
        if (truncated) job.truncated = true
      }

      child.stdout?.on('data', (c: Buffer) => append('stdout', c))
      child.stderr?.on('data', (c: Buffer) => append('stderr', c))

      child.on('error', (err) => {
        // spawn 失败（shell 不存在等）也当作作业结束，否则 id 永远挂在那儿
        job.stderr = `${job.stderr}\n${err.message}`.trim()
        job.endedAt = Date.now()
        this.finish(job, null, null)
        resolve(this.buildResult(job, null, null))
      })

      child.on('close', (code, signal) => {
        job.endedAt = Date.now()
        this.finish(job, code, signal)
        resolve(this.buildResult(job, code, signal))
      })
    })

    this.jobs.set(id, job)
    return { id, exited: job.exited }
  }

  private finish(job: Job, code: number | null, signal: string | null): void {
    this.jobs.delete(job.id)
    const result = this.buildResult(job, code, signal)
    this.finished.set(job.id, result)

    // 超出上限就丢最老的：模型可能已经不再关心它们了
    while (this.finished.size > this.maxFinished) {
      const oldest = this.finished.keys().next().value
      if (oldest === undefined) break
      this.finished.delete(oldest)
    }
  }

  private buildResult(job: Job, code: number | null, signal: string | null): JobResult {
    return {
      jobId: job.id,
      command: job.command,
      exitCode: code,
      signal,
      stdout: job.stdout,
      stderr: job.stderr,
      truncated: job.truncated,
      startedAt: job.startedAt,
      endedAt: job.endedAt ?? Date.now(),
    }
  }

  /** 还在跑的作业 id。 */
  runningIds(): string[] {
    return [...this.jobs.keys()]
  }

  hasRunning(): boolean {
    return this.jobs.size > 0
  }

  /**
   * 取走一个已完成作业的结果。取走即删——这是"结果只读一次"的语义，
   * 避免模型每轮都重复看到同一段输出。
   */
  takeFinished(jobId?: string): JobResult | undefined {
    if (jobId) {
      const r = this.finished.get(jobId)
      if (r) this.finished.delete(jobId)
      return r
    }
    // 没指定 id：取最早的一个
    const first = this.finished.keys().next().value
    if (first === undefined) return undefined
    const r = this.finished.get(first)
    this.finished.delete(first)
    return r
  }

  /**
   * 等一个作业结束并取走结果。
   *
   * 为什么需要它：`visit_jobs` 原来只会「取已完成的」，作业还在跑时返回「找不到」。
   * 模型拿到「找不到」就会以为读错了 id，然后……开始 echo 空转。真实语义应该是
   * 「读这个作业」= 等它跑完再给结果，最多等 timeoutMs。
   *
   * 超时不杀进程，返回当前已收集的输出 + running 标记 —— 模型可以再读一次，
   * 而不是把 30 秒的渲染当成"没有输出"。
   */
  async waitFor(jobId: string, timeoutMs: number): Promise<{ result?: JobResult; stillRunning: boolean }> {
    const done = this.finished.get(jobId)
    if (done) {
      this.finished.delete(jobId)
      return { result: done, stillRunning: false }
    }

    const job = this.jobs.get(jobId)
    if (!job) return { stillRunning: false }

    const timedOut = await Promise.race([
      job.exited.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
    ])

    if (timedOut) {
      // 没结束：把「到目前为止」的输出交出去，作业继续跑
      return {
        stillRunning: true,
        result: {
          jobId: job.id,
          command: job.command,
          exitCode: null,
          signal: null,
          stdout: job.stdout,
          stderr: job.stderr,
          truncated: job.truncated,
          startedAt: job.startedAt,
          endedAt: Date.now(),
        },
      }
    }

    const finished = this.finished.get(jobId)
    if (finished) {
      this.finished.delete(jobId)
      return { result: finished, stillRunning: false }
    }
    return { stillRunning: false }
  }

  /**
   * 把**所有**已完成但还没被取走的作业结果一次交出来，不清空注册表之外的任何东西。
   *
   * 这是「不用轮询」的关键：作业在后面跑完，模型下一步就能看到结果，
   * 不必自己想起来去 visit_jobs（实测它想不起来，会宁可 echo 空转）。
   */
  drainFinished(): JobResult[] {
    const out = [...this.finished.values()]
    this.finished.clear()
    return out
  }

  /** 只看不取（给 UI / 排查用）。 */
  peekFinished(): JobResult[] {
    return [...this.finished.values()]
  }

  get pendingCount(): number {
    return this.finished.size
  }

  /**
   * 杀掉一个作业。用于用户取消或收尾。
   *
   * ⚠️ Windows 上 child.kill() 只会杀掉直接子进程（bash.exe），
   * 它启动的实际命令（sleep、npm…）会变成孤儿继续跑。必须用 taskkill /T 杀整棵树。
   * 这是实测出来的：单用 child.kill() 时 `bash -c "sleep 10"` 在测试里杀不掉。
   */
  kill(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false

    const pid = job.child.pid
    if (pid === undefined) return false

    if (process.platform === 'win32') {
      // 用绝对路径：这个环境的 PATH 被裁剪过，直接写 'taskkill' 会 ENOENT。
      const taskkill = 'C:/Windows/System32/taskkill.exe'
      try {
        const tk = spawn(taskkill, ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        // spawn 失败会以 error 事件抛出，不监听会变成未捕获异常，把主进程带崩
        tk.on('error', () => { try { job.child.kill() } catch { /* 兜底 */ } })
      } catch {
        try { job.child.kill() } catch { /* 兜底 */ }
      }
    } else {
      try { job.child.kill('SIGKILL') } catch { /* 已经死了 */ }
    }
    return true
  }

  /** 杀掉全部——进程退出时用，避免留下孤儿进程。 */
  killAll(): void {
    for (const id of [...this.jobs.keys()]) this.kill(id)
  }
}
