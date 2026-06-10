// src/main/mcp-bridge/types.ts

export interface McpBridgeConfig {
  enabled: boolean
  port: number
  host: string
  cwd: string
  projectDir: string
  tools: {
    include: string[]
    exclude: string[]
  }
  auth: {
    mode: 'token' | 'none'
    token: string
  }
  cloudflare: {
    enabled: boolean
  }
}

export interface NerveTool {
  description: string
  input_schema: Record<string, unknown>
  execute: (args: any) => Promise<any>
}
