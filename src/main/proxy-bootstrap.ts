/**
 * 代理引导模块
 * 在进程启动时读取代理配置，用 global-tunnel-ng 全局隧道代理 HTTP/HTTPS
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'

function bootstrapProxy() {
  try {
    const settingsPath = join(homedir(), '.nerve', 'settings.json')
    if (!existsSync(settingsPath)) return
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const proxy = data.proxy
    if (!proxy || !proxy.enabled || !proxy.host || !proxy.port) return

    const url = `${proxy.protocol}://${proxy.host}:${proxy.port}`
    const globalTunnel = require('global-tunnel-ng')
    globalTunnel.initialize({
      host: proxy.host,
      port: parseInt(proxy.port),
      protocol: proxy.protocol,
    })
    console.log(`[ProxyBootstrap] Global tunnel enabled: ${url}`)
  } catch (err) {
    console.warn('[ProxyBootstrap] Failed to bootstrap proxy:', err)
  }
}

bootstrapProxy()
