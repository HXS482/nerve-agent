const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i

export function isVideoBg(src: string): boolean {
  return src.startsWith('data:video/') || VIDEO_RE.test(src)
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
