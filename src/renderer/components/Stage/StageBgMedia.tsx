const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i
const HTML_RE = /\.(html?)(\?|#|$)/i

export function isVideoBg(src: string): boolean {
  return src.startsWith('data:video/') || VIDEO_RE.test(src)
}

/** HTML 动态背景：data:text/html URL 或 .html/.htm 文件 URL */
export function isHtmlBg(src: string): boolean {
  return src.startsWith('data:text/html') || HTML_RE.test(src)
}

/** data:text/html URL → HTML 文本（BgHtml / 设置面板预览用） */
export function htmlFromDataUrl(src: string): string {
  try {
    const comma = src.indexOf(',')
    if (!src.startsWith('data:text/html') || comma < 0) return ''
    const payload = src.slice(comma + 1)
    return src.includes(';base64,')
      ? decodeURIComponent(escape(atob(payload)))
      : decodeURIComponent(payload)
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

// HTML 动态背景：沙箱 iframe（allow-scripts，opaque origin，同 WebScreen 先例）。
// pointer-events 关闭——背景层不拦截壁纸上的交互；样式复用 .stage-bg-media（absolute inset 0 cover）。
export function BgHtml({ src }: { src: string }) {
  const html = htmlFromDataUrl(src)
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

