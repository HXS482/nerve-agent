/**
 * 退出前的排空闸门。
 *
 * `before-quit` 里的异步监听器**不会**真的拦住 Electron 的退出：事件回来之后进程照退，
 * 于是「先把队列排空」根本来不及跑。要挡住只有一条路——同步 `preventDefault()`，
 * 自己在收尾结束后再调 `app.quit()`。
 *
 * 三条硬要求：
 * 1. 只跑一次收尾（`app.quit()` 会再次触发 `before-quit`，不设标志就会递归/重复收尾）。
 * 2. 收尾抛错不能让 app 永久挂住 —— 记日志，照样退。
 * 3. 收尾卡住也一样：到点就放弃等待，照样退。
 *
 * 这里不 import electron：纯逻辑，方便单测。
 */

export type QuitEvent = { preventDefault(): void }

export interface QuitDrainDeps {
  /** 收尾完成（或超时/失败）之后调它，真正退出。生产里是 `app.quit()`。 */
  quit: () => void
  /** 收尾动作本身：排空 gateway、停 mcp bridge、关 agent core…… */
  teardown: () => Promise<void>
  /** 等待上限，默认 15s。 */
  timeoutMs?: number
  warn?: (message: string, err?: unknown) => void
}

export const DEFAULT_QUIT_DRAIN_TIMEOUT_MS = 15_000

export interface QuitDrain {
  /** 直接挂到 `app.on('before-quit', handler)`。 */
  handler: (event: QuitEvent) => void
  /** 收尾那一轮的 promise（测试用；生产不需要 await）。 */
  whenSettled: () => Promise<void> | null
  /** 收尾是否已经跑完并放行。 */
  isFinished: () => boolean
}

export function createQuitDrain(deps: QuitDrainDeps): QuitDrain {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_QUIT_DRAIN_TIMEOUT_MS
  const warn = deps.warn ?? ((message: string, err?: unknown) => console.warn(message, err ?? ''))

  let draining = false
  let finished = false
  let settled: Promise<void> | null = null

  const runTeardown = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    // 计时器不 unref：这是退出路径，宁可多活 15s 也不能让一个永不 resolve 的收尾
    // 把 app 卡在退出中。事件循环里没别的东西也无所谓，Electron 自己的循环还在。
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
    try {
      const outcome = await Promise.race([
        (async () => { await deps.teardown(); return 'done' as const })(),
        timeout,
      ])
      if (outcome === 'timeout') {
        warn(`[quit] teardown did not finish within ${timeoutMs}ms; quitting anyway`)
      }
    } catch (err) {
      // 收尾失败/抛错都必须放行退出，否则用户关不掉这个 app。
      warn('[quit] teardown failed; quitting anyway', err)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const handler = (event: QuitEvent): void => {
    // 收尾跑完后再进来的这一次（来自我们自己调的 quit()）直接放行。
    if (finished) return

    // 同步拦住这一次退出：异步收尾本身拦不住。
    event.preventDefault()

    // 收尾中又被要求退出：忽略，等第一轮跑完。
    if (draining) return
    draining = true

    settled = runTeardown().then(() => {
      finished = true
      deps.quit()
    })
  }

  return {
    handler,
    whenSettled: () => settled,
    isFinished: () => finished,
  }
}
