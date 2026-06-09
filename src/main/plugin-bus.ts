import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
import { EventEmitter } from 'events'
import chokidar from 'chokidar'
import { Mutex } from 'async-mutex'
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
  private watcher: chokidar.FSWatcher | null = null
  private debounceTimers = new Map<string, NodeJS.Timeout>()
  private reloadMutex = new Mutex()

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
        const fileUrl = pathToFileURL(modulePath).href + `?v=${Date.now()}`
        const mod = await import(fileUrl)
        if (!mod.schema || !mod.execute) {
          return { error: `Tool "${toolEntry.name}" must export { schema, execute }` }
        }

        const isZodSchema = mod.schema && typeof mod.schema.parse === 'function' && mod.schema._def
        const input_schema = isZodSchema ? zodToInputSchema(mod.schema) : mod.schema
        const qualifiedName = `${manifest.name}:${toolEntry.name}`

        const executor = async (args: any) => {
          try {
            const parsed = isZodSchema ? mod.schema.parse(args) : args
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

  async loadAll(disabledIds: string[] = []): Promise<{ loaded: string[]; errors: string[] }> {
    const { dirs, errors: discoverErrors } = this.discover()
    const disabled = new Set(disabledIds)
    const loaded: string[] = []
    const errors = [...discoverErrors]

    for (const dir of dirs) {
      // Pre-read manifest to check disabled status
      const manifestPath = join(dir, 'plugin.json')
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        if (disabled.has(manifest.name)) {
          console.log(`[PluginBus] Skipping disabled plugin: ${manifest.name}`)
          continue
        }
      } catch { /* let loadPlugin handle the error */ }

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

  listPlugins(disabled?: Set<string>): Array<{ id: string; version: string; description: string; trust: string; toolCount: number; enabled: boolean }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      version: p.manifest.version,
      description: p.manifest.description || '',
      trust: p.trust,
      toolCount: p.tools.size,
      enabled: disabled ? !disabled.has(p.id) : true,
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

  // --- FileWatcher ---

  startWatching(): void {
    const pluginDirs = [
      join(this.projectDir, '.nerve', 'plugins'),
      join(this.sourceDir, '.nerve', 'plugins'),
      join(homedir(), '.nerve', 'plugins'),
    ].filter(d => existsSync(d))

    if (pluginDirs.length === 0) return

    this.watcher = chokidar.watch(pluginDirs, {
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**'],
      depth: 3,
    })

    this.watcher.on('all', (event: string, filePath: string) => {
      const pluginId = this.resolvePluginId(filePath)
      if (!pluginId) return

      clearTimeout(this.debounceTimers.get(pluginId))
      this.debounceTimers.set(pluginId, setTimeout(async () => {
        this.debounceTimers.delete(pluginId)
        await this.reloadMutex.runExclusive(async () => {
          await this.reloadPlugin(pluginId)
        })
      }, 300))
    })

    console.log('[PluginBus] FileWatcher started for', pluginDirs)
  }

  private resolvePluginId(filePath: string): string | null {
    for (const [id, plugin] of this.plugins) {
      if (filePath.startsWith(plugin.dir)) return id
    }
    return null
  }

  async reloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return

    console.log(`[PluginBus] Reloading plugin: ${pluginId}`)
    const result = await this.loadPlugin(plugin.dir)
    if (result.error) {
      console.error(`[PluginBus] Reload failed for ${pluginId}:`, result.error)
      return
    }
    this.invalidateSnapshot()
    console.log(`[PluginBus] Reloaded plugin: ${pluginId}`)
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }

  // --- Trust resolution ---

  private resolveTrust(pluginDir: string): 'local' | 'project' | 'marketplace' {
    if (pluginDir.includes(join(this.projectDir, '.nerve', 'plugins'))) return 'project'
    if (pluginDir.includes(join(homedir(), '.nerve', 'marketplace'))) return 'marketplace'
    return 'local'
  }
}
