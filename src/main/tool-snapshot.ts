import type { PluginToolDef } from './plugin-types'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export class PluginToolSnapshot {
  readonly version: number
  readonly toolDefs: ToolDefinition[]
  readonly toolExecutors: Map<string, (args: any) => Promise<any>>
  private refCount = 0
  private disposed = false
  private onDispose: (() => void) | null = null

  constructor(
    version: number,
    pluginTools: PluginToolDef[],
    onDispose?: () => void,
  ) {
    this.version = version
    this.onDispose = onDispose || null

    this.toolDefs = pluginTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))

    this.toolExecutors = new Map()
    for (const t of pluginTools) {
      this.toolExecutors.set(t.name, t.execute)
    }
  }

  ref(): void {
    if (this.disposed) throw new Error('Cannot ref a disposed snapshot')
    this.refCount++
  }

  unref(): void {
    this.refCount--
    if (this.refCount <= 0 && this.onDispose) {
      this.disposed = true
      this.onDispose()
      this.onDispose = null
    }
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  get refs(): number {
    return this.refCount
  }
}
