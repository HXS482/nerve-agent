/**
 * MCP 的 OAuth 授权（OAuth 2.1 + PKCE，SEP-991 URL 型 client_id）。
 *
 * 为什么不用动态客户端注册：marked.dev 背后的 Clerk 实例把
 * `POST /oauth/register` 关了（422 feature_requires_dynamic_oauth_client_registration）。
 * 但它声明了 `client_id_metadata_document_supported: true`，也就是说 client_id
 * 本身可以是一个 HTTPS URL，服务端去那个地址取客户端元数据文档。
 *
 * 所以这里的做法是：
 *   1. 仓库里放一份 oauth/client-metadata.json，通过 jsDelivr 提供一个
 *      `application/json` 的稳定 URL，那个 URL 就是 client_id；
 *   2. 授权码回调走固定端口的 loopback http 服务（127.0.0.1:39751）；
 *   3. token / client 信息 / PKCE verifier / discovery 状态都落在
 *      ~/.nerve/mcp-auth/<server>.json，重启后不用重新授权。
 *
 * 但「一个 client 打通所有平台」是做不到的 —— 实测下来 MCP 的授权分三种形态：
 *
 *   a. 支持动态注册（Linear / Sentry / Figma）：SDK 自己 POST /register 拿
 *      client_id，URL 型 client_id 那条路用不上。此时要**屏蔽 clientMetadataUrl**，
 *      否则 SDK 只要看到服务端声明 client_id_metadata_document_supported 就会
 *      优先用 URL 型 id，而有些平台两者都声明、只认注册出来的那个。
 *   b. 不支持动态注册（GitHub / Slack / Asana / Stripe）：必须用预注册的
 *      OAuth App，也就是用户填的 clientId / clientSecret；没有就只能粘 token。
 *   c. scope 各家不同。写死 marked.dev 那套会被别家直接拒掉。
 *
 * 所以 scope / clientId / resourceMetadataUrl 全部改成「按 server 从配置里取」，
 * 缺省时才回落到 marked.dev 那套（保持老配置照旧能授权）。
 */

import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { shell } from 'electron'
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

/** 回调固定端口 —— 必须和 oauth/client-metadata.json 里的 redirect_uris 一致 */
const CALLBACK_PORT = 39751
const CALLBACK_PATH = '/callback'
const CALLBACK_URL = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`

/**
 * client_id 必须是一个「能取到 JSON」的 HTTPS URL，且路径不能是根。
 * 用 jsDelivr 而不是 raw.githubusercontent.com：后者对 .json 返回
 * text/plain，服务端按 Content-Type 校验时会拒绝。
 */
const CLIENT_METADATA_URL =
  'https://cdn.jsdelivr.net/gh/HXS482/nerve-agent@master/oauth/client-metadata.json'

/**
 * marked.dev 那套 scope。只在 server 没配 oauthScope 时兜底 ——
 * 它是历史上唯一接过的平台，保持默认值能让老配置一字不改继续用。
 */
const DEFAULT_SCOPE = 'refs:read saves:write offline_access'

const AUTH_DIR = join(homedir(), '.nerve', 'mcp-auth')
const AUTH_TIMEOUT = 5 * 60 * 1000

interface StoredAuth {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
}

/** 授权流程的 state：随机串，防 CSRF，也用来把回调对回等待者 */
function randomState(): string {
  return randomBytes(16).toString('base64url')
}

function authFile(serverName: string) {
  return join(AUTH_DIR, `${serverName.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
}

function readStored(serverName: string): StoredAuth {
  const file = authFile(serverName)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as StoredAuth
  } catch {
    return {}
  }
}

function writeStored(serverName: string, data: StoredAuth) {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true })
  writeFileSync(authFile(serverName), JSON.stringify(data, null, 2), 'utf-8')
}

/** 单个 server 的授权参数。全部可选，缺省时用 marked.dev 那套。 */
export interface OAuthProviderOptions {
  /** 请求的 scope，空格分隔 */
  scope?: string
  /** 预注册 OAuth App 的 client_id */
  clientId?: string
  /** 预注册 OAuth App 的 client_secret（Slack 这类必须） */
  clientSecret?: string
  /**
   * 是否允许 SEP-991 的 URL 型 client_id。默认允许。
   * 平台明确不认 URL 型 id、又不给动态注册时置 false —— 那样授权会直接
   * 报「需要预注册的 client」，比让服务端返回一个模糊的 400 清楚。
   */
  useUrlClientId?: boolean
  /** 资源元数据地址（主动 auth() 时没有 401 响应可读，只能显式给） */
  resourceMetadataUrl?: string
}

/** 每个 server 一份 provider，状态落在 ~/.nerve/mcp-auth/<server>.json */
class FileOAuthProvider implements OAuthClientProvider {
  /** 授权 URL 生成后由外部接管（打开浏览器 / 透传给 UI） */
  onAuthorizationUrl: (url: URL) => void = (url) => { void shell.openExternal(url.toString()) }

  /**
   * OAuth state。
   *
   * 之前漏了这个方法 —— SDK 里是 `provider.state ? await provider.state() : undefined`，
   * 不实现就**不会往授权 URL 里塞 state**，回调回来时 `?code=...` 旁边什么都没有，
   * 于是「按 state 找回等待者」这一步必然落空，浏览器显示「回调已失效」。
   *
   * 现在用一个可变的 holder：authorize() 在发请求前塞一个随机值进来，
   * provider.state() 读它；回调回来时两边就一致了。
   */
  stateValue: string = randomState()

  /**
   * 这个 server 的授权参数。全部可选，缺省时回落到 marked.dev 那一套：
   *   scope         —— 请求的权限范围，各家不同
   *   clientId      —— 预注册 OAuth App 的 id（平台不支持动态注册时必填）
   *   clientSecret  —— 同上，配合 token_endpoint_auth_method 用
   *   useUrlClientId—— 是否允许用 SEP-991 的 URL 型 client_id
   */
  readonly opts: OAuthProviderOptions

  constructor(private serverName: string, opts: OAuthProviderOptions = {}) {
    this.opts = opts
  }

  state() {
    return this.stateValue
  }

  get redirectUrl() {
    return CALLBACK_URL
  }

  /**
   * URL 型 client_id 的元数据地址。
   *
   * 只有「既没有预注册 clientId、平台又没被标记为不支持 URL 型 id」时才给。
   * 返回 undefined 会让 SDK 走动态注册那条路 —— Linear / Sentry / Figma 它们
   * 有 registration_endpoint，正是需要这条路。
   */
  get clientMetadataUrl() {
    if (this.opts.clientId) return undefined
    if (this.opts.useUrlClientId === false) return undefined
    return CLIENT_METADATA_URL
  }

  get clientMetadata(): OAuthClientMetadata {
    const secret = !!this.opts.clientSecret
    return {
      client_name: 'Nerve',
      client_uri: 'https://github.com/HXS482/nerve-agent',
      redirect_uris: [CALLBACK_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // Slack 只收 client_secret_post；其余平台用 none（公共客户端 + PKCE）即可
      token_endpoint_auth_method: secret ? 'client_secret_post' : 'none',
      scope: this.opts.scope || DEFAULT_SCOPE,
    }
  }

  /** 预注册的 App：client 信息是已知的，直接给 SDK，省掉一次注册请求 */
  get presetClientInformation(): OAuthClientInformationMixed | undefined {
    if (!this.opts.clientId) return undefined
    return this.opts.clientSecret
      ? { client_id: this.opts.clientId, client_secret: this.opts.clientSecret }
      : { client_id: this.opts.clientId }
  }

  clientInformation() {
    // 预注册 App 优先：平台后台配的那份永远比本地缓存的更可信
    // （本地缓存可能是上一次用别的 client 授权留下的）
    return this.presetClientInformation ?? readStored(this.serverName).clientInformation
  }

  saveClientInformation(info: OAuthClientInformationMixed) {
    writeStored(this.serverName, { ...readStored(this.serverName), clientInformation: info })
  }

  tokens() {
    return readStored(this.serverName).tokens
  }

  saveTokens(tokens: OAuthTokens) {
    writeStored(this.serverName, { ...readStored(this.serverName), tokens })
  }

  saveCodeVerifier(verifier: string) {
    writeStored(this.serverName, { ...readStored(this.serverName), codeVerifier: verifier })
  }

  codeVerifier() {
    const v = readStored(this.serverName).codeVerifier
    if (!v) throw new Error('缺少 PKCE code verifier，授权流程需要从头开始')
    return v
  }

  discoveryState() {
    return readStored(this.serverName).discoveryState
  }

  saveDiscoveryState(state: OAuthDiscoveryState) {
    writeStored(this.serverName, { ...readStored(this.serverName), discoveryState: state })
  }

  redirectToAuthorization(url: URL) {
    this.onAuthorizationUrl(url)
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') {
      rmSync(authFile(this.serverName), { force: true })
      return
    }
    const next = { ...readStored(this.serverName) }
    if (scope === 'client') delete next.clientInformation
    if (scope === 'tokens') delete next.tokens
    if (scope === 'verifier') delete next.codeVerifier
    if (scope === 'discovery') delete next.discoveryState
    writeStored(this.serverName, next)
  }
}

interface Waiter {
  resolve: (code: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 授权管理器：一份 loopback 回调服务 + 每个 server 一个 provider。
 * 回调按 state 分发给对应的等待者，所以多个 server 同时授权也不会串。
 */
export class McpOAuthManager {
  private loopback: Server | null = null
  private waiters = new Map<string, Waiter>()

  private ensureLoopback(): Promise<void> {
    if (this.loopback) return Promise.resolve()

    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://127.0.0.1:${CALLBACK_PORT}`)
        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404).end('not found')
          return
        }
        const state = url.searchParams.get('state') || ''
        const code = url.searchParams.get('code') || ''
        const error = url.searchParams.get('error') || ''

        const waiter = this.waiters.get(state)
        if (!waiter) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('这个授权回调已经失效了，回到 Nerve 重新点一次授权。')
          return
        }
        this.waiters.delete(state)
        clearTimeout(waiter.timer)

        if (error || !code) {
          waiter.reject(new Error(error || '没有拿到授权码'))
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(`授权失败：${error || 'missing code'}\n可以关闭这个页面。`)
          return
        }

        waiter.resolve(code)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<!doctype html><meta charset="utf-8"><title>Nerve</title>' +
          '<body style="font:15px system-ui;padding:48px;text-align:center">' +
          '<h2 style="font-weight:600">授权完成</h2>' +
          '<p style="color:#666">可以关闭这个页面，回到 Nerve 了。</p></body>',
        )
      })

      server.once('error', reject)
      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        this.loopback = server
        resolve()
      })
    })
  }

  /** 本地是否已有 access token（UI 判断「已授权」用） */
  hasTokens(serverName: string): boolean {
    return !!readStored(serverName).tokens?.access_token
  }

  clear(serverName: string) {
    rmSync(authFile(serverName), { force: true })
  }

  /**
   * 触发一次完整授权：discovery → 打开浏览器 → 等回调 → 换 token。
   * SDK 的 auth() 在需要用户操作时会走 redirectToAuthorization 并返回 'REDIRECT'，
   * 拿到授权码后再调一次同一个函数完成交换。
   */
  async authorize(
    serverName: string,
    serverUrl: string,
    opts: OAuthProviderOptions = {},
  ): Promise<{ ok: true } | { ok: false; error: string; authUrl?: string }> {
    await this.ensureLoopback()

    const provider = new FileOAuthProvider(serverName, opts)
    // 必须先生成 state 再跑 discovery，否则授权 URL 里没有 state，回调对不上等待者
    provider.stateValue = randomState()
    let authUrl: string | undefined
    provider.onAuthorizationUrl = (url) => {
      authUrl = url.toString()
      void shell.openExternal(authUrl)
    }

    // 第一段：discovery + 拼授权 URL
    try {
      /*
       * scope 与 resourceMetadataUrl 都按 server 传：
       *
       *   - scope：各家权限名完全不同（GitHub 是 repo / read:org，Linear 是
       *     read / write）。不传的话 SDK 会退回服务端元数据里的 scopes_supported，
       *     那样 offline_access 会丢，于是没有 refresh_token，token 一过期就得
       *     重新授权。
       *   - resourceMetadataUrl：主动调 auth() 没有先发请求，也就拿不到 401 里
       *     的 WWW-Authenticate。SDK 的默认回落是在 origin 根上找
       *     /.well-known/oauth-protected-resource，对 GitHub（挂在 /mcp/ 下）
       *     和 Sentry 这类都是 404。
       */
      const result = await auth(provider, {
        serverUrl,
        scope: opts.scope || DEFAULT_SCOPE,
        ...(opts.resourceMetadataUrl
          ? { resourceMetadataUrl: new URL(opts.resourceMetadataUrl) }
          : {}),
      })
      if (result === 'AUTHORIZED') return { ok: true }
    } catch (err) {
      // 没有生成授权 URL 就说明是真失败；否则只是「等用户去浏览器」
      if (!authUrl) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    if (!authUrl) return { ok: false, error: '没能生成授权链接' }

    const state = new URL(authUrl).searchParams.get('state') || ''
    if (!state) return { ok: false, error: '授权链接里没有 state', authUrl }

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(state)
        reject(new Error('授权超时（5 分钟）'))
      }, AUTH_TIMEOUT)
      this.waiters.set(state, { resolve, reject, timer })
    }).catch((err: Error) => err as Error)

    if (code instanceof Error) return { ok: false, error: code.message, authUrl }

    // 第二段：用授权码换 token。scope 不必再传（用的是已存 discovery 状态），
    // 但 resourceMetadataUrl 要带 —— 换 token 前 SDK 会校验授权服务器是否与
    // 资源元数据里声明的一致
    try {
      const result = await auth(provider, {
        serverUrl,
        authorizationCode: code,
        ...(opts.resourceMetadataUrl
          ? { resourceMetadataUrl: new URL(opts.resourceMetadataUrl) }
          : {}),
      })
      if (result !== 'AUTHORIZED') return { ok: false, error: '换取 token 失败', authUrl }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), authUrl }
    }
  }

  /** 给 McpPool 用：连接时挂上，已授权就直接走 token，未授权则弹浏览器 */
  createProvider(
    serverName: string,
    opts: OAuthProviderOptions = {},
    onAuthUrl?: (url: string) => void,
  ): OAuthClientProvider {
    const provider = new FileOAuthProvider(serverName, opts)
    /*
     * 池里用到的 provider 只负责「带着已有 token 连」和「token 过期时刷新」。
     * 万一没 token，SDK 会走 redirectToAuthorization —— 这里默认什么都不做，
     * 不主动弹浏览器（后台轮询时弹窗很吓人），只让连接失败、由 UI 提示去点授权。
     */
    provider.onAuthorizationUrl = onAuthUrl
      ? (url) => onAuthUrl(url.toString())
      : () => {}
    return provider
  }

  dispose() {
    for (const [, w] of this.waiters) clearTimeout(w.timer)
    this.waiters.clear()
    this.loopback?.close()
    this.loopback = null
  }
}
