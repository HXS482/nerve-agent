import { readFile, readdir, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolve, sep } from 'path'
import type { PluginContext, PluginManifest, PluginFs, PluginShell, PluginNet } from './plugin-types'

const execFileAsync = promisify(execFile)

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'USER', 'SHELL', 'TERM', 'TEMP', 'TMP', 'SystemRoot', 'windir']

function buildSafeEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!
  }
  if (extra) Object.assign(env, extra)
  return env
}

function isPathWithin(base: string, target: string): boolean {
  const resolvedBase = resolve(base)
  const resolvedTarget = resolve(target)
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep)
}

const METACHARACTERS = /[;|&`$()]/

export function createPluginContext(opts: {
  pluginId: string
  pluginDir: string
  manifest: PluginManifest
  sessionId: string
  scope: 'user' | 'project'
  trust: 'local' | 'project' | 'marketplace'
  projectDir?: string
}): PluginContext {
  const { pluginId, pluginDir, manifest, sessionId, scope, trust, projectDir } = opts
  const permissions = new Set(manifest.permissions)

  const ctx: any = {
    pluginId,
    pluginDir,
    sessionId,
    scope,
    trust,
    projectDir,
  }

  // --- fs ---
  if (permissions.has('fs:read') || permissions.has('fs:write')) {
    const allowedRoots = [pluginDir]
    if (projectDir) allowedRoots.push(projectDir)

    const checkPath = (p: string) => {
      const resolvedPath = resolve(p)
      if (!allowedRoots.some(root => isPathWithin(root, resolvedPath))) {
        throw new Error(`[plugin:${pluginId}] Access denied: ${p} is outside allowed directories`)
      }
    }

    ctx.fs = {
      async readFile(path: string) {
        checkPath(path)
        return readFile(path, 'utf-8')
      },
      async readDir(path: string) {
        checkPath(path)
        return readdir(path)
      },
      async exists(path: string) {
        checkPath(path)
        return existsSync(path)
      },
      async writeFile(path: string, content: string) {
        if (!permissions.has('fs:write')) throw new Error(`[plugin:${pluginId}] fs:write permission required`)
        checkPath(path)
        await writeFile(path, content, 'utf-8')
      },
      async mkdir(path: string) {
        if (!permissions.has('fs:write')) throw new Error(`[plugin:${pluginId}] fs:write permission required`)
        checkPath(path)
        await mkdir(path, { recursive: true })
      },
    } as PluginFs
  }

  // --- shell ---
  if (permissions.has('shell:execute')) {
    const allowedCommands = manifest.shell?.allowedCommands || []

    const isCommandAllowed = (command: string, args: string[]): boolean => {
      if (allowedCommands.length === 0) return false
      return allowedCommands.some(allowed => {
        if (allowed.command !== command) return false
        if (allowed.args && allowed.args.length > 0) {
          return allowed.args.every((a, i) => args[i] === a)
        }
        return true
      })
    }

    ctx.shell = {
      async exec(command: string, opts?: { cwd?: string; timeout?: number; env?: Record<string, string> }) {
        const parts = command.split(/\s+/)
        const cmd = parts[0]
        const args = parts.slice(1)

        if (!isCommandAllowed(cmd, args)) {
          throw new Error(`[plugin:${pluginId}] Command not allowed: ${command}`)
        }

        for (const arg of args) {
          if (METACHARACTERS.test(arg)) {
            throw new Error(`[plugin:${pluginId}] Unsafe characters in argument: ${arg}`)
          }
        }

        const timeout = opts?.timeout || 30_000
        const env = buildSafeEnv(opts?.env)
        const cwd = opts?.cwd || pluginDir

        try {
          const result = await execFileAsync(cmd, args, { timeout, env, cwd, maxBuffer: 10 * 1024 * 1024 })
          return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
        } catch (err: any) {
          return { stdout: err.stdout || '', stderr: err.stderr || err.message, exitCode: err.code || 1 }
        }
      },
    } as PluginShell
  }

  // --- net ---
  if (permissions.has('net:http')) {
    ctx.net = {
      async fetch(url: string, opts?: RequestInit) {
        return globalThis.fetch(url, opts)
      },
    } as PluginNet
  }

  return Object.freeze(ctx) as PluginContext
}
