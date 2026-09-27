const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i
const HTML_RE = /\.(html?)(\?|#|$)/i

export function isVideoBg(src: string): boolean {
  return src.startsWith('data:video/') || VIDEO_RE.test(src)
}

/** HTML 动态背景：data:text/html URL 或 .html/.htm 文件 URL */
export function isHtmlBg(src: string): boolean {
  return src.startsWith('data:text/html') || HTML_RE.test(src)
}

const UTF8 = new TextDecoder()

// 单格缓存：Stage 树每次流式 flush 都会重渲染（useClaude 里 useChatStore() 没传
// selector，整棵树跟着 store 一起刷新，约 25 次/秒），BgHtml 每次都调下面这个函数。
// 实测 ~300KB 的 data URL 单次解码约 4ms，不缓存等于每秒白烧 100ms 主线程。
// 同一时刻只有一个背景在用，留一格就够，不做 Map 免得把用户换过的每个壁纸都钉在内存里。
let cachedSrc: string | null = null
let cachedHtml = ''

/** data:text/html URL → HTML 文本（BgHtml / 设置面板预览用） */
export function htmlFromDataUrl(src: string): string {
  if (src === cachedSrc) return cachedHtml
  cachedSrc = src
  cachedHtml = decodeHtmlDataUrl(src)
  return cachedHtml
}

function decodeHtmlDataUrl(src: string): string {
  try {
    const comma = src.indexOf(',')
    if (!src.startsWith('data:text/html') || comma < 0) return ''
    const payload = src.slice(comma + 1)
    if (!src.includes(';base64,')) return decodeURIComponent(payload)
    // TextDecoder 取代 escape() + decodeURIComponent()：输出完全一致（含中文等多字节），
    // 单次解码快 ~1.7 倍
    const bin = atob(payload)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return UTF8.decode(bytes)
  } catch {
    return ''
  }
}

// 视频背景：填满足位容器（.stage-bg 为 absolute inset 0），
// 自动循环静音播放；样式见 globals.css .stage-bg-media
export function BgVideo({ src }: { src: string }) {
  return (
    <video
      className="stage-bg-media"
      src={src}
      autoPlay
      muted
      loop
      playsInline
      onError={(e) => {
        const v = e.target as HTMLVideoElement
        console.warn('[BgVideo] ERROR code=', v.error?.code, v.error?.message, src.slice(0, 60))
      }}
    />
  )
}

// iframe 内部是独立文档，父级的 ::-webkit-scrollbar / overflow 管不到它——内容一旦
// 溢出就会露出真实的横竖滚动条。背景和预览都是 pointer-events: none，滚动条看得见
// 卻滚不动，纯属脏东西，所以在文档内部把滚动关掉。
// 样式插在 </body> 之前而不是最前面：插到 doctype 之前会让页面掉进 quirks mode。
const NO_SCROLL_STYLE = '<style>html,body{overflow:hidden!important}</style>'

/** 供 iframe 使用：HTML 文本 + 禁止内部滚动（背景/预览用；可交互的 WebScreen viewer 不要用） */
export function htmlForIframe(src: string): string {
  const html = htmlFromDataUrl(src)
  if (!html) return ''
  const i = html.lastIndexOf('</body>')
  return i >= 0
    ? html.slice(0, i) + NO_SCROLL_STYLE + html.slice(i)
    : html + NO_SCROLL_STYLE
}

// HTML 动态背景：沙箱 iframe（allow-scripts，opaque origin，同 WebScreen 先例）。
// pointer-events 关闭——背景层不拦截壁纸上的交互；样式复用 .stage-bg-media（absolute inset 0 cover）。
export function BgHtml({ src }: { src: string }) {
  const html = htmlForIframe(src)
  if (!html) return null
  return (
    <iframe
      className="stage-bg-media stage-bg-iframe"
      srcDoc={html}
      sandbox="allow-scripts"
      tabIndex={-1}
      title="Stage background"
    />
  )
}

