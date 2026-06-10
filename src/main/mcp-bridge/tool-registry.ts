// src/main/mcp-bridge/tool-registry.ts

import type { NerveTool } from './types'

export function filterTools(
  allTools: Record<string, NerveTool>,
  config: { include: string[]; exclude: string[] }
): Record<string, NerveTool> {
  const result: Record<string, NerveTool> = {}
  for (const [name, tool] of Object.entries(allTools)) {
    if (config.exclude.includes(name)) continue
    if (config.include.length > 0 && !config.include.includes(name)) continue
    result[name] = tool
  }
  return result
}

export function serializeResult(result: any): string {
  if (result === null || result === undefined) return ''
  if (typeof result !== 'object') return String(result)

  if (result.success === false || (result.error && !result.output && !result.message && !result.content)) {
    return `Error: ${result.error}`
  }

  if (result.output) {
    let text = String(result.output)
    if (result.error) text += `\n[stderr] ${result.error}`
    if (result.savedImages?.length) text += `\n[images saved: ${result.savedImages.join(', ')}]`
    if (result.savedArtifacts?.length) text += `\n[artifacts saved: ${result.savedArtifacts.join(', ')}]`
    return text
  }

  if (result.content && typeof result.content === 'string') return result.content

  if (Array.isArray(result.results)) {
    return result.results.map((r: any) => `${r.file}:${r.line}: ${r.text}`).join('\n')
  }

  if (Array.isArray(result.files)) return result.files.join('\n')

  if (result.success !== undefined) {
    if (result.message) return result.message
    if (result.file_path) return `${result.warnings ? 'Edited' : 'Written'}: ${result.file_path}`
    return 'OK'
  }

  return JSON.stringify(result, null, 2)
}
