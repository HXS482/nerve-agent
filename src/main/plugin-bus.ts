import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { EventEmitter } from 'events'
import { pluginManifestSchema, VALID_PERMISSIONS } from './plugin-types'
import type { PluginManifest, LoadedPlugin, PluginToolDef } from './plugin-types'
import { createPluginContext } from './plugin-context'
import { zodToInputSchema } from './tool-schema'
import { PluginToolSnapshot } from './tool-snapshot'

export class PluginBus extends EventEmitter {
  private plugins = new Map<string, LoadedPlugin>()
  private projectDir: string
  private sourceDir: string
  private snapshotVersion = 0
  private activeSnapshot: PluginToolSnapshot | null = null
  private pendingSnapshot: PluginToolSnapshot | null = null

  constructor(sourceDir: string, projectDir: string) {
    super()
    this.sourceDir = sourceDir
    this.projectDir = projectDir
  }

  // --- Discovery ---

  discover(): { dirs: string[]; errors: string[] } {
    const dirs: string[] = []
    const errors: string[] = []

    const candidates = [
      join(this.projectDir, '.nerve', 'plugins'),
      join(this.sourceDir, '.nerve', 'plugins'),
      join(homedir(), '.nerve', 'plugins'),
    ]

    for (const dir of candidates) {
      if (!existsSync(dir)) continue
      try {
        const entries = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
        for (const entry of entries) {
          const pluginDir = join(dir, entry.name)
          const manifestPath = join(pluginDir, 'plugin.json')
          if (!existsSync(manifestPath)) continue
          dirs.push(pluginDir)
        }
      } catch (err: any) {
        errors.push(`Failed to scan ${dir}: ${err.message}`)
      }
    }

    return { dirs, errors }
  }

  // --- Loading ---

  async loadPlugin(pluginDir: string): Promise<{ plugin?: LoadedPlugin; error?: string }> {
    const manifestPath = join(pluginDir, 'plugin.json')

    let raw: string
    try {
      raw = readFileSync(manifestPath, 'utf-8')
    } catch (err: any) {
      return { error: `Cannot read manifest: ${err.message}` }
    }

    let manifestJson: unknown
    try {
      manifestJson = JSON.parse(raw)
    } catch {
      return { error: 'Invalid JSON in plugin.json' }
    }

    const result = pluginManifestSchema.safeParse(manifestJson)
    if (!result.success) {
      return { error: `Manifest validation failed: ${result.error.message}` }
    }
    const manifest = result.data

    for (const perm of manifest.permissions) {
      if (!VALID_PERMISSIONS.has(perm)) {
        return { error: `Unknown permission: ${perm}` }
      }
    }

    const trust = this.resolveTrust(pluginDir)
    if (trust === 'marketplace') {
      return { error: 'Marketplace plugins not supported in Phase 1 (requires Worker isolation)' }
    }

    const ctx = createPluginContext({
      pluginId: manifest.name,
      pluginDir,
      manifest,
      sessionId: '',
      scope: trust === 'project' ? 'project' : 'user',
      trust,
      projectDir: this.projectDir,
    })

    const tools = new Map<string, PluginToolDef>()
    for (const toolEntry of manifest.tools) {
      const modulePath = join(pluginDir, toolEntry.module)
      if (!existsSync(modulePath)) {
        return { error: `Tool module not found: ${modulePath}` }
      }

      try {
        const mod = await import(modulePath)
        if (!mod.schema || !mod.execute) {
          return { error: `Tool "${toolEntry.name}" must export { schema, execute }` }
        }

        const input_schema = zodToInputSchema(mod.schema)
        const qualifiedName = `${manifest.name}:${toolEntry.name}`

        const executor = async (args: any) => {
          try {
            const parsed = mod.schema.parse(args)
            return await mod.execute(parsed, ctx)
          } catch (err: any) {
            return { error: `[plugin:${manifest.name}] ${toolEntry.name}: ${err.message}` }
          }
        }

        tools.set(toolEntry.name, {
          name: qualifiedName,
          rawName: toolEntry.name,
          description: toolEntry.description || mod.description || '',
          input_schema,
          execute: executor,
          pluginId: manifest.name,
        })
      } catch (err: any) {
        return { error: `Failed to import tool "${toolEntry.name}": ${err.message}` }
      }
    }

    const plugin: LoadedPlugin = {
      id: manifest.name,
      dir: pluginDir,
      manifest,
      trust,
      tools,
    }

    this.plugins.set(manifest.name, plugin)
    this.invalidateSnapshot()
    this.emit('plugin:loaded', { pluginId: manifest.name })
    return { plugin }
  }

  async loadAll(): Promise<{ loaded: string[]; errors: string[] }> {
    const { dirs, errors: discoverErrors } = this.discover()
    const loaded: string[] = []
    const errors = [...discoverErrors]

    for (const dir of dirs) {
      const result = await this.loadPlugin(dir)
      if (result.error) {
        errors.push(`[${dir}]: ${result.error}`)
      } else if (result.plugin) {
        loaded.push(result.plugin.id)
      }
    }

    return { loaded, errors }
  }

  // --- Tool access ---

  getAllPluginTools(): PluginToolDef[] {
    const tools: PluginToolDef[] = []
    for (const plugin of this.plugins.values()) {
      for (const tool of plugin.tools.values()) {
        tools.push(tool)
      }
    }
    return tools
  }

  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId)
  }

  listPlugins(): Array<{ id: string; version: string; description: string; trust: string; toolCount: number }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      version: p.manifest.version,
      description: p.manifest.description || '',
      trust: p.trust,
      toolCount: p.tools.size,
    }))
  }

  // --- Snapshot management ---

  getSnapshot(): PluginToolSnapshot {
    if (!this.activeSnapshot) {
      this.activeSnapshot = new PluginToolSnapshot(
        this.snapshotVersion,
        this.getAllPluginTools(),
      )
    }
    return this.activeSnapshot
  }

  promotePending(): void {
    if (this.pendingSnapshot) {
      this.activeSnapshot = this.pendingSnapshot
      this.pendingSnapshot = null
    }
  }

  private invalidateSnapshot(): void {
    this.snapshotVersion++
    const newTools = this.getAllPluginTools()
    const newSnapshot = new PluginToolSnapshot(this.snapshotVersion, newTools)

    // If active snapshot has refs (in-flight conversations), store as pending
    if (this.activeSnapshot && this.activeSnapshot.refs > 0) {
      this.pendingSnapshot = newSnapshot
    } else {
      this.activeSnapshot = newSnapshot
    }
  }

  // --- Trust resolution ---

  private resolveTrust(pluginDir: string): 'local' | 'project' | 'marketplace' {
    if (pluginDir.includes(join(this.projectDir, '.nerve', 'plugins'))) return 'project'
    if (pluginDir.includes(join(homedir(), '.nerve', 'marketplace'))) return 'marketplace'
    return 'local'
  }
}
