/**
 * 代理引导模块
 * 在进程启动时读取代理配置，如有则设置环境变量并 bootstrap global-agent
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
    process.env.GLOBAL_AGENT_HTTP_PROXY = url
    process.env.GLOBAL_AGENT_HTTPS_PROXY = url
    process.env.GLOBAL_AGENT_NO_LOOPBACK = '1'

    // global-agent 是 external dep，用 require 加载
    const ga = require('global-agent')
    ga.bootstrap()
    console.log(`[ProxyBootstrap] Global proxy enabled: ${url}`)
  } catch (err) {
    console.warn('[ProxyBootstrap] Failed to bootstrap proxy:', err)
  }
}

bootstrapProxy()
