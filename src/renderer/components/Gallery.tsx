import { useState, useEffect, memo } from 'react'

interface GalleryImage {
  id: string
  filename: string
  path: string
  size: number
  createdAt: number
  source?: string
}

interface GalleryProps {
  onClose: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export const Gallery = memo(function Gallery({ onClose }: GalleryProps) {
  const [images, setImages] = useState<GalleryImage[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<GalleryImage | null>(null)

  const loadImages = async () => {
    setLoading(true)
    try {
      const list = await window.claude.listImages()
      setImages(list)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadImages() }, [])

  const handleDelete = async (filename: string) => {
    await window.claude.deleteImage(filename)
    setImages((prev) => prev.filter((img) => img.filename !== filename))
    if (preview?.filename === filename) setPreview(null)
  }

  return (
    <>
      {/* Backdrop — same as Settings */}
      <div
        className="fixed inset-0 z-40 animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />

      {/* Modal — glass panel matching Settings */}
      <div
        className="fixed z-50 animate-modal-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(680px, calc(100vw - 48px))',
          height: 'min(520px, calc(100vh - 48px))',
          background: 'var(--dynamic-island-bg)',
          backdropFilter: 'var(--dynamic-island-blur)',
          WebkitBackdropFilter: 'var(--dynamic-island-blur)',
          border: '1px solid var(--dynamic-island-border)',
          borderRadius: 20,
          boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-on-surface)' }}>Gallery</span>
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-outline-variant)', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}>
              {images.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer transition-colors"
            style={{
              padding: 5,
              borderRadius: 8,
              color: 'var(--text-outline)',
              background: 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.color = 'var(--text-on-surface)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-outline)'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ padding: 20 }}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-xs" style={{ color: 'var(--text-outline)' }}>Loading...</span>
            </div>
          ) : images.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-outline-variant)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <span className="text-[11px]" style={{ color: 'var(--text-outline)' }}>No images yet</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
                  style={{
                    aspectRatio: '1',
                    background: 'var(--bg-surface-container-high)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  onClick={() => setPreview(img)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(173, 198, 255, 0.25)'
                    e.currentTarget.style.transform = 'scale(1.02)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)'
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                >
                  <img
                    src={`file:///${img.path.replace(/\\/g, '/')}`}
                    alt={img.source || img.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {/* Hover overlay */}
                  <div
                    className="absolute inset-0 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ background: 'linear-gradient(transparent 40%, rgba(0,0,0,0.7))' }}
                  >
                    <div className="px-2.5 pb-2.5 flex items-end justify-between">
                      <span className="text-[10px] truncate flex-1" style={{ color: 'rgba(255,255,255,0.8)' }}>
                        {img.source?.slice(0, 40) || img.filename}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(img.filename) }}
                        className="shrink-0 p-1 rounded transition-colors cursor-pointer"
                        style={{ color: 'rgba(255,255,255,0.5)', background: 'transparent', border: 'none' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#ff5f56'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview overlay */}
      {preview && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center animate-fade-in"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)' }}
          onClick={() => setPreview(null)}
        >
          <img
            src={`file:///${preview.path.replace(/\\/g, '/')}`}
            alt={preview.source || preview.filename}
            className="max-w-[90vw] max-h-[85vh] rounded-xl object-contain"
            style={{ border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-xl"
            style={{
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>{preview.source?.slice(0, 60) || preview.filename}</span>
            <span className="text-[10px] tabular-nums" style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}>{formatSize(preview.size)}</span>
            <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{timeAgo(preview.createdAt)}</span>
          </div>
        </div>
      )}
    </>
  )
})
