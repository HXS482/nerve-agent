/**
 * 代理引导模块
 * 读取代理配置，设置环境变量供各适配器使用
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'

function loadProxyConfig() {
  try {
    const settingsPath = join(homedir(), '.nerve', 'settings.json')
    if (!existsSync(settingsPath)) return
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const proxy = data.proxy
    if (!proxy || !proxy.enabled || !proxy.host || !proxy.port) return

    const url = `${proxy.protocol}://${proxy.host}:${proxy.port}`
    process.env.HTTP_PROXY = url
    process.env.HTTPS_PROXY = url
    console.log(`[ProxyBootstrap] Proxy configured: ${url}`)
  } catch (err) {
    console.warn('[ProxyBootstrap] Failed to load proxy config:', err)
  }
}

loadProxyConfig()
