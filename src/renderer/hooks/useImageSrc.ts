import { useState, useEffect } from 'react'

const cache = new Map<string, string>()

export function useImageSrc(path: string | undefined | null): string | null {
  const [src, setSrc] = useState<string | null>(() => path ? cache.get(path) ?? null : null)

  useEffect(() => {
    if (!path) { setSrc(null); return }
    const cached = cache.get(path)
    if (cached) { setSrc(cached); return }

    let cancelled = false
    ;(window as any).claude?.loadImage?.(path).then((dataUrl: string | null) => {
      if (cancelled || !dataUrl) return
      cache.set(path, dataUrl)
      setSrc(dataUrl)
    })

    return () => { cancelled = true }
  }, [path])

  return src
}
