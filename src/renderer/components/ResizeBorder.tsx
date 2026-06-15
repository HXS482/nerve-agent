import { useCallback, useRef } from 'react'

const B = 6 // border hit area px

type Edge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

const CURSOR: Record<Edge, string> = {
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
}

const MIN_W = 400
const MIN_H = 300

export function ResizeBorder() {
  const dragRef = useRef<{ edge: Edge; startX: number; startY: number; startBounds: { x: number; y: number; width: number; height: number } } | null>(null)

  const startDrag = useCallback(async (edge: Edge, e: React.MouseEvent) => {
    e.preventDefault()
    const bounds = await (window as any).claude?.windowGetBounds?.()
    if (!bounds) return
    dragRef.current = { edge, startX: e.screenX, startY: e.screenY, startBounds: bounds }

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = ev.screenX - drag.startX
      const dy = ev.screenY - drag.startY
      const b = { ...drag.startBounds }
      if (drag.edge.includes('w')) { const w = Math.max(MIN_W, b.width - dx); b.x += b.width - w; b.width = w }
      if (drag.edge.includes('e')) { b.width = Math.max(MIN_W, b.width + dx) }
      if (drag.edge.includes('n')) { const h = Math.max(MIN_H, b.height - dy); b.y += b.height - h; b.height = h }
      if (drag.edge.includes('s')) { b.height = Math.max(MIN_H, b.height + dy) }
      ;(window as any).claude?.windowSetBounds?.(b)
    }

    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const edgeProps = (edge: Edge) => ({
    onMouseDown: (e: React.MouseEvent) => startDrag(edge, e),
    onMouseEnter: () => { if (!dragRef.current) document.body.style.cursor = CURSOR[edge] },
    onMouseLeave: () => { if (!dragRef.current) document.body.style.cursor = '' },
  })

  const base = 'fixed z-[9999]'
  const style: React.CSSProperties = { pointerEvents: 'auto' }

  return (
    <div className="pointer-events-none">
      {/* Top */}
      <div className={base} style={{ ...style, top: 0, left: B, right: B, height: B }} {...edgeProps('n')} />
      {/* Bottom */}
      <div className={base} style={{ ...style, bottom: 0, left: B, right: B, height: B }} {...edgeProps('s')} />
      {/* Left */}
      <div className={base} style={{ ...style, top: B, left: 0, bottom: B, width: B }} {...edgeProps('w')} />
      {/* Right */}
      <div className={base} style={{ ...style, top: B, right: 0, bottom: B, width: B }} {...edgeProps('e')} />
      {/* Corners */}
      <div className={base} style={{ ...style, top: 0, left: 0, width: B, height: B }} {...edgeProps('nw')} />
      <div className={base} style={{ ...style, top: 0, right: 0, width: B, height: B }} {...edgeProps('ne')} />
      <div className={base} style={{ ...style, bottom: 0, left: 0, width: B, height: B }} {...edgeProps('sw')} />
      <div className={base} style={{ ...style, bottom: 0, right: 0, width: B, height: B }} {...edgeProps('se')} />
    </div>
  )
}
