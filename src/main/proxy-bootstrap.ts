/**
 * 代理引导模块
 * 必须在所有其他模块之前加载，用于全局代理 HTTP/HTTPS 请求
 *
 * 使用方式：在 index.ts 第一行 import './proxy-bootstrap'
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'

try {
  const settingsPath = join(homedir(), '.nerve', 'settings.json')
  if (existsSync(settingsPath)) {
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const proxy = data.proxy
    if (proxy && proxy.enabled && proxy.host && proxy.port) {
      const url = `${proxy.protocol}://${proxy.host}:${proxy.port}`
      process.env.GLOBAL_AGENT_HTTP_PROXY = url
      process.env.GLOBAL_AGENT_NO_PROXY = '<-loopback>'
      require('global-agent/bootstrap')
      console.log(`[ProxyBootstrap] Global proxy enabled: ${url}`)
    }
  }
} catch (err) {
  console.warn('[ProxyBootstrap] Failed to bootstrap proxy:', err)
}
