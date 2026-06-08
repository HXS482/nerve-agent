import type { HookEvent, HookFn, HookContext, HookResult, HookData, PrioritizedHook } from './plugin-types'
import { HOOK_PRIORITY_FLOORS } from './plugin-types'

const HOOK_TIMEOUT_MS = 5_000

export class HookRegistry {
  private hooks = new Map<HookEvent, PrioritizedHook[]>()

  register(pluginId: string, trust: string, event: HookEvent, fn: HookFn, requestedPriority?: number): void {
    const floor = HOOK_PRIORITY_FLOORS[trust] ?? 200
    const priority = Math.max(requestedPriority ?? floor, floor)

    const list = this.hooks.get(event) || []
    list.push({ pluginId, event, fn, priority })
    list.sort((a, b) => a.priority - b.priority)
    this.hooks.set(event, list)
  }

  async execute(event: HookEvent, data: HookData, sessionId: string): Promise<HookResult> {
    const hooks = this.hooks.get(event)
    if (!hooks || hooks.length === 0) return { handled: false }

    let currentData = { ...data }

    for (const hook of hooks) {
      const ctx: HookContext = {
        sessionId,
        pluginId: hook.pluginId,
        data: Object.freeze({ ...currentData }),
        metadata: new Map(),
      }

      try {
        const result = await Promise.race([
          hook.fn(ctx),
          new Promise<HookResult>((_, reject) =>
            setTimeout(() => reject(new Error('hook timeout')), HOOK_TIMEOUT_MS)
          ),
        ])

        if (result.handled) {
          return { handled: true, modified: result.modified }
        }

        if (result.modified) {
          currentData = { ...currentData, ...result.modified }
        }
      } catch (err) {
        console.error(`[HookRegistry] ${hook.pluginId}:${event} error:`, err)
      }
    }

    return {
      handled: false,
      modified: currentData !== data ? currentData : undefined,
    }
  }

  unregister(pluginId: string): void {
    for (const [event, list] of this.hooks) {
      this.hooks.set(event, list.filter(h => h.pluginId !== pluginId))
    }
  }

  hasHooks(event: HookEvent): boolean {
    const hooks = this.hooks.get(event)
    return !!hooks && hooks.length > 0
  }
}
