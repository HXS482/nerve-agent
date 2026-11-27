/**
 * 可一键接入的平台预设。
 *
 * 为什么需要这份表：MCP 的 OAuth 在「谁能连得上」这件事上有三种完全不同的形态，
 * 光塞一个 URL 是接不通的 ——
 *
 *   1. 支持动态注册（DCR）：客户端自己 POST /register 拿 client_id，用户点一下就行。
 *      Linear / Sentry / Figma 属于这档。
 *   2. 不支持 DCR，只认「预注册的 OAuth App」：必须在平台后台建一个应用，
 *      把 client_id / secret 填进来。GitHub / Slack / Asana / Stripe 属于这档。
 *   3. 干脆不支持 OAuth，只认 access token：粘一个 PAT 就能用。
 *      GitHub 同时属于 2 和 3 —— 所以它给两个入口，PAT 是零配置那条。
 *
 * 表里的 url / scope / resourceMetadataUrl 全部是实测抓来的（打一次 initialize
 * 看 401 的 WWW-Authenticate，再取 .well-known），不是照文档抄的 ——
 * 文档写 `mcp.notion.com` 那个域名实际根本不通。
 */

export type McpPlatformAuthMode =
  /** 支持动态客户端注册，一次点击走完授权 */
  | 'oauth-dcr'
  /** 平台只认预注册的 OAuth App，需要用户提供 client_id（可选 secret） */
  | 'oauth-static'
  /** 只能粘 access token */
  | 'token'
  /** 两种都行，优先 OAuth；平台没配 App 时可以直接用 token */
  | 'oauth-static-or-token'

export interface McpPlatformPreset {
  /** 稳定 id，用来算默认 server 名；同时作为 UI 的 key */
  id: string
  /** 显示名 */
  label: string
  /** MCP 端点 */
  url: string
  /**
   * 授权服务器的资源元数据地址。
   *
   * 必须显式给 —— 我们的「授权」按钮是主动调 auth()，没有先发一次请求被 401，
   * 也就拿不到 WWW-Authenticate 里的地址。SDK 的默认回落（在 origin 根上找
   * /.well-known/oauth-protected-resource）对 GitHub / Sentry 这类
   * 「元数据挂在 /mcp/ 子路径下」的服务是 404。
   */
  resourceMetadataUrl?: string
  /** 请求的 scope，空格分隔。留空 = 交给服务端元数据里的 scopes_supported */
  scope?: string
  /** 支持的接入方式 */
  auth: McpPlatformAuthMode
  /** 一句话说明，UI 里当副标题 */
  hint: string
  /** token 模式的输入框提示 */
  tokenHint?: string
  /** token 模式的说明：去哪儿拿 */
  tokenHelp?: string
  /**
   * 这个平台是不是「同一份配置能服务多个 Bot」。目前没用上，
   * 留着是为了将来做「按 Bot 隔离授权」时不用再改表。
   */
  shared?: boolean
}

export const MCP_PLATFORM_PRESETS: McpPlatformPreset[] = [
  {
    id: 'github',
    label: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    resourceMetadataUrl: 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/',
    scope: 'repo read:org read:user user:email',
    auth: 'oauth-static-or-token',
    hint: '仓库、PR、issue、Actions',
    tokenHint: 'ghp_… 或 github_pat_…',
    tokenHelp: 'GitHub → Settings → Developer settings → Personal access tokens',
  },
  {
    id: 'linear',
    label: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    resourceMetadataUrl: 'https://mcp.linear.app/.well-known/oauth-protected-resource',
    scope: 'read write',
    auth: 'oauth-dcr',
    hint: 'issue、项目、迭代',
  },
  {
    id: 'sentry',
    label: 'Sentry',
    url: 'https://mcp.sentry.dev/mcp',
    resourceMetadataUrl: 'https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp',
    scope: 'org:read project:write team:write event:write alerts:write',
    auth: 'oauth-dcr',
    hint: '错误、性能、告警',
  },
  {
    id: 'figma',
    label: 'Figma',
    url: 'https://mcp.figma.com/mcp',
    resourceMetadataUrl: 'https://mcp.figma.com/.well-known/oauth-protected-resource',
    scope: 'mcp:connect',
    auth: 'oauth-dcr',
    hint: '设计稿、组件、评论',
  },
  {
    id: 'slack',
    label: 'Slack',
    url: 'https://mcp.slack.com/mcp',
    resourceMetadataUrl: 'https://mcp.slack.com/.well-known/oauth-protected-resource',
    // Slack 的授权服务器只收 client_secret_post，且没有 registration_endpoint，
    // 必须在 Slack 后台建 App。scope 留空让服务端按 App 配的权限走。
    auth: 'oauth-static',
    hint: '频道、消息、搜索',
  },
  {
    id: 'asana',
    label: 'Asana',
    url: 'https://mcp.asana.com/v2/mcp',
    resourceMetadataUrl: 'https://mcp.asana.com/.well-known/oauth-protected-resource',
    scope: 'default',
    auth: 'oauth-static',
    hint: '任务、项目、里程碑',
  },
  {
    id: 'stripe',
    label: 'Stripe',
    url: 'https://mcp.stripe.com',
    resourceMetadataUrl: 'https://mcp.stripe.com/.well-known/oauth-protected-resource',
    scope: 'mcp',
    auth: 'oauth-static',
    hint: '客户、订阅、支付',
  },
]

/** id → 预设。UI 与主进程共用。 */
export const MCP_PRESETS_BY_ID: Record<string, McpPlatformPreset> = Object.fromEntries(
  MCP_PLATFORM_PRESETS.map((p) => [p.id, p]),
)

/** 平台是否支持「浏览器授权」这条路 */
export function platformSupportsOAuth(preset: McpPlatformPreset | undefined): boolean {
  if (!preset) return false
  return preset.auth === 'oauth-dcr' || preset.auth === 'oauth-static' || preset.auth === 'oauth-static-or-token'
}

/** 平台是否支持「粘 token」这条路 */
export function platformSupportsToken(preset: McpPlatformPreset | undefined): boolean {
  if (!preset) return false
  return preset.auth === 'token' || preset.auth === 'oauth-static-or-token'
}
