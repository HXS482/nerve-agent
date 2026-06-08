import { z } from 'zod'

// --- Manifest Schema (Zod) ---

const shellCommandSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
})

const toolEntrySchema = z.object({
  name: z.string(),
  module: z.string(),
  description: z.string().optional(),
})

export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  description: z.string().optional().default(''),
  permissions: z.array(z.string()).optional().default([]),
  tools: z.array(toolEntrySchema).optional().default([]),
  hooks: z.record(z.string()).optional(),
  lifecycle: z.object({
    onLoad: z.string().optional(),
    onUnload: z.string().optional(),
    onReload: z.string().optional(),
  }).optional(),
  shell: z.object({
    allowedCommands: z.array(shellCommandSchema).optional().default([]),
  }).optional(),
  dependencies: z.record(z.string()).optional().default({}),
  conflicts: z.record(z.string()).optional().default({}),
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>

// --- Loaded Plugin ---

export interface LoadedPlugin {
  id: string
  dir: string
  manifest: PluginManifest
  trust: 'local' | 'project' | 'marketplace'
  tools: Map<string, PluginToolDef>
}

// --- Plugin Tool Definition ---

export interface PluginToolDef {
  name: string           // namespaced: "pluginId:toolName"
  rawName: string        // original name from manifest
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<any>
  pluginId: string
}

// --- Plugin Context (capability injection surface) ---

export interface PluginContext {
  readonly pluginId: string
  readonly pluginDir: string
  readonly sessionId: string
  readonly scope: 'user' | 'project'
  readonly trust: 'local' | 'project' | 'marketplace'
  readonly projectDir?: string

  readonly fs?: PluginFs
  readonly shell?: PluginShell
  readonly net?: PluginNet
  readonly nerve?: PluginNerve
}

export interface PluginFs {
  readFile(path: string): Promise<string>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
}

export interface PluginShell {
  exec(command: string, opts?: {
    cwd?: string
    timeout?: number
    env?: Record<string, string>
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

export interface PluginNet {
  fetch(url: string, opts?: RequestInit): Promise<Response>
}

export interface PluginNerve {
  callTool(name: string, args: unknown): Promise<string>
  getSession(): Promise<{ sessionId: string }>
  sendMessage(text: string): Promise<void>
}

// --- Valid Permissions ---

export const VALID_PERMISSIONS = new Set([
  'fs:read',
  'fs:write',
  'shell:execute',
  'net:http',
  'nerve:mcp',
  'nerve:session',
  'nerve:memory',
  'nerve:channel',
])
