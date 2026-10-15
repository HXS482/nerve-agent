/**
 * 代理引导模块
 * 读取代理配置，设置环境变量供各适配器使用
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'

/** 默认直连白名单：内网/本机不该走代理，否则公司内网 LLM 接口会被代理打断（实测 502） */
const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1,.local'

function loadProxyConfig() {
  try {
    const settingsPath = join(homedir(), '.nerve', 'settings.json')
    if (!existsSync(settingsPath)) return
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const proxy = data.proxy
    if (!proxy || !proxy.enabled || !proxy.host || !proxy.port) return

    const url = `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`
    process.env.HTTP_PROXY = url
    process.env.HTTPS_PROXY = url
    process.env.http_proxy = url
    process.env.https_proxy = url

    // Node 18+ 的全局 fetch（undici）**不会**自动读 HTTP(S)_PROXY，必须显式打开开关。
    // 不开的话，走 fetch 的能力（插件工具、WebFetch 等）会绕过代理直连而失败。
    process.env.NODE_USE_ENV_PROXY = '1'

    // 直连白名单：公司内网的 LLM 网关走代理会 502，必须绕过。
    if (!process.env.NO_PROXY && !process.env.no_proxy) {
      process.env.NO_PROXY = DEFAULT_NO_PROXY
      process.env.no_proxy = DEFAULT_NO_PROXY
    }

    console.log(`[ProxyBootstrap] Proxy configured: ${url} (NO_PROXY=${process.env.NO_PROXY})`)
  } catch (err) {
    console.warn('[ProxyBootstrap] Failed to load proxy config:', err)
  }
}

loadProxyConfig()
