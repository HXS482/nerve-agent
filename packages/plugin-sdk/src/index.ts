export { z } from 'zod'
export type { ZodType } from 'zod'

export interface PluginToolContext {
  readonly pluginId: string
  readonly pluginDir: string
  readonly sessionId: string
  readonly scope: 'user' | 'project'
  readonly trust: 'local' | 'project' | 'marketplace'
  readonly projectDir?: string
  readonly fs?: {
    readFile(path: string): Promise<string>
    readDir(path: string): Promise<string[]>
    exists(path: string): Promise<boolean>
    writeFile(path: string, content: string): Promise<void>
    mkdir(path: string): Promise<void>
  }
  readonly shell?: {
    exec(command: string, opts?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>
  }
  readonly net?: {
    fetch(url: string, opts?: RequestInit): Promise<Response>
  }
}

export type PluginToolExecute<T extends Record<string, any>> = (
  args: T,
  ctx: PluginToolContext,
) => Promise<{ output: string } | { error: string } | Record<string, unknown>>

export interface PluginToolDefinition<T extends Record<string, any>> {
  description: string
  schema: import('zod').ZodObject<any>
  execute: PluginToolExecute<T>
}
