import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useBrainStore } from '../stores/brainStore'
import { useChatStore } from '../stores/chatStore'
import type { BrainNode } from '../../shared/types'

const TYPE_COLORS: Record<string, string> = {
  identity: '#3b82f6',
  cache: '#10b981',
  episodic: '#f59e0b',
  procedural: '#8b5cf6',
  semantic: '#ec4899',
  schema: '#6b7280',
  unknown: '#6b7280',
}

const TYPE_LABELS: Record<string, string> = {
  identity: 'Identity',
  cache: 'Cache',
  episodic: 'Episodic',
  procedural: 'Procedural',
  semantic: 'Semantic',
  schema: 'Schema',
}

interface BrainPanelProps {
  open: boolean
  onClose: () => void
}

export function BrainPanel({ open, onClose }: BrainPanelProps) {
  const theme = useChatStore(s => s.theme)
  const isDark = theme !== 'light'
  const { graphData, selectedNode, selectedFile, loading, scan, selectNode } = useBrainStore()
  const [graphLoaded, setGraphLoaded] = useState(false)
  const [hoveredNode, setHoveredNode] = useState<BrainNode | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })

  // Load graph library on demand
  useEffect(() => {
    if (!open || graphRef.current) return
    import('react-force-graph-3d').then(mod => {
      graphRef.current = mod.default || mod.ForceGraph3D || Object.values(mod)[0]
      setGraphLoaded(true)
    })
  }, [open])

  // Scan brain on open
  useEffect(() => {
    if (open) scan()
  }, [open, scan])

  // Resize observer
  useEffect(() => {
    if (!containerRef.current || !open) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [open])

  // Node click handler
  const handleNodeClick = useCallback((node: any) => {
    console.log('[Brain] node clicked:', node?.id, node?.name, !!node)
    selectNode(node as BrainNode)
  }, [selectNode])

  // Node hover handler
  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node as BrainNode | null)
  }, [])

  // 3D node label
  const nodeLabel = useCallback((node: any) => {
    return `<div style="
      background: ${isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)'};
      color: ${isDark ? '#e5e5e5' : '#333'};
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-family: Inter, sans-serif;
      border: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};
    ">
      <div style="font-weight:600">${node.name || node.id}</div>
      <div style="opacity:0.6;font-size:10px">${TYPE_LABELS[node.type] || node.type}</div>
    </div>`
  }, [isDark])

  const graphDataMemo = useMemo(() => graphData, [graphData])

  if (!open) return null

  const GraphComp = graphRef.current

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[55] animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' }}
        onClick={onClose}
      />

      {/* Centered panel */}
      <div
        className="fixed z-[60] animate-brain-in flex flex-col"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(780px, calc(100vw - 80px))',
          height: 'min(520px, calc(100vh - 80px))',
          background: isDark ? 'rgba(18,18,20,0.95)' : 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
          borderRadius: 20,
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="no-select flex items-center justify-between" style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 1024 1024" fill="var(--accent-primary)">
              <path d="M358.4 621.226667c-6.826667 0-167.253333-3.413333-187.733333-102.4-54.613333-3.413333-92.16-13.653333-116.053334-37.546667-10.24-10.24-17.066667-23.893333-20.48-30.72-10.24-6.826667-23.893333-17.066667-30.72-40.96-3.413333-17.066667-3.413333-37.546667-3.413333-44.373333 0-17.066667 6.826667-174.08 215.04-256 208.213333-78.506667 436.906667-47.786667 525.653333 34.133333 95.573333 3.413333 170.666667 95.573333 177.493334 180.906667 6.826667 75.093333-37.546667 167.253333-174.08 191.146666-47.786667 58.026667-150.186667 68.266667-242.346667 75.093334-54.613333 6.826667-109.226667 10.24-136.533333 23.893333 0 3.413333-3.413333 6.826667-6.826667 6.826667z" />
            </svg>
            <span className="text-[14px] font-semibold" style={{ color: 'var(--text-on-surface)' }}>Brain</span>
            {loading && (
              <span className="text-[11px]" style={{ color: 'var(--text-outline)' }}>scanning...</span>
            )}
            {!loading && graphData.nodes.length > 0 && (
              <span className="text-[11px]" style={{ color: 'var(--text-outline)' }}>
                {graphData.nodes.length} nodes · {graphData.links.length} links
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Close */}
            <button
              onClick={onClose}
              className="cursor-pointer transition-colors"
              style={{ padding: 6, borderRadius: 8, color: 'var(--text-outline)', background: 'transparent', border: 'none' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Graph area */}
          <div ref={containerRef} className="flex-1 relative" style={{ minHeight: 0 }}>
            {graphLoaded && GraphComp && graphData.nodes.length > 0 && (
              <GraphComp
                graphData={graphDataMemo}
                width={size.width}
                height={size.height}
                backgroundColor={isDark ? '#121214' : '#ffffff'}
                nodeLabel={nodeLabel}
                nodeColor={(n: any) => TYPE_COLORS[n.type] || TYPE_COLORS.unknown}
                nodeVal={(n: any) => 4 + (n.size ? Math.min(n.size / 1000, 8) : 0)}
                nodeRelSize={6}
                linkColor={() => isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}
                linkWidth={1}
                linkDirectionalParticles={1}
                linkDirectionalParticleSpeed={0.003}
                linkDirectionalParticleWidth={1.5}
                linkDirectionalParticleColor={() => isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)'}
                onNodeClick={handleNodeClick}
                onNodeHover={handleNodeHover}
                showNavInfo={true}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
                warmupTicks={50}
                cooldownTicks={100}
              />
            )}

            {/* Empty state */}
            {!loading && graphData.nodes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <svg width="48" height="48" viewBox="0 0 1024 1024" fill="var(--text-outline)" opacity={0.3}>
                  <path d="M358.4 621.226667c-6.826667 0-167.253333-3.413333-187.733333-102.4-54.613333-3.413333-92.16-13.653333-116.053334-37.546667-10.24-10.24-17.066667-23.893333-20.48-30.72-10.24-6.826667-23.893333-17.066667-30.72-40.96-3.413333-17.066667-3.413333-37.546667-3.413333-44.373333 0-17.066667 6.826667-174.08 215.04-256 208.213333-78.506667 436.906667-47.786667 525.653333 34.133333 95.573333 3.413333 170.666667 95.573333 177.493334 180.906667 6.826667 75.093333-37.546667 167.253333-174.08 191.146666-47.786667 58.026667-150.186667 68.266667-242.346667 75.093334-54.613333 6.826667-109.226667 10.24-136.533333 23.893333 0 3.413333-3.413333 6.826667-6.826667 6.826667z" />
                </svg>
                <span className="text-[13px]" style={{ color: 'var(--text-outline)' }}>
                  No brain files found
                </span>
                <span className="text-[11px]" style={{ color: 'var(--text-outline-variant)' }}>
                  Place .md files in ~/.nerve/_brain/
                </span>
              </div>
            )}

            {/* Hover tooltip */}
            {hoveredNode && !selectedNode && (
              <div
                className="absolute bottom-4 left-4 rounded-xl px-3 py-2"
                style={{
                  background: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)',
                  border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
                  backdropFilter: 'blur(20px)',
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[hoveredNode.type] }} />
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-on-surface)' }}>{hoveredNode.name}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-outline)' }}>{TYPE_LABELS[hoveredNode.type] || hoveredNode.type}</span>
                </div>
              </div>
            )}
          </div>

          {/* Right panel: selected file */}
          {selectedNode && (
            <div
              className="flex flex-col animate-slide-in-right"
              style={{
                width: 320,
                borderLeft: '1px solid var(--border-subtle)',
                background: isDark ? 'rgba(20,20,22,0.6)' : 'rgba(250,250,250,0.6)',
              }}
            >
              {/* File header */}
              <div className="flex items-center justify-between" style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TYPE_COLORS[selectedNode.type] }} />
                  <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-on-surface)' }}>
                    {selectedNode.name}
                  </span>
                </div>
                <button
                  onClick={() => selectNode(null)}
                  className="cursor-pointer flex-shrink-0"
                  style={{ padding: 4, borderRadius: 6, color: 'var(--text-outline)', background: 'transparent', border: 'none' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Meta */}
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{
                      background: TYPE_COLORS[selectedNode.type] + '20',
                      color: TYPE_COLORS[selectedNode.type],
                    }}
                  >
                    {TYPE_LABELS[selectedNode.type] || selectedNode.type}
                  </span>
                  {selectedNode.tags?.map(tag => (
                    <span
                      key={tag}
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{
                        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                        color: 'var(--text-outline)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto" style={{ padding: '12px 14px' }}>
                {selectedFile ? (
                  <pre className="text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-on-surface)', fontFamily: 'Inter, sans-serif' }}>
                    {selectedFile.content}
                  </pre>
                ) : (
                  <div className="text-[11px] text-center py-8" style={{ color: 'var(--text-outline)' }}>
                    Loading...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div
          className="no-select flex items-center gap-4"
          style={{ padding: '8px 20px', borderTop: '1px solid var(--border-subtle)' }}
        >
          {Object.entries(TYPE_LABELS).map(([type, label]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[type] }} />
              <span className="text-[10px]" style={{ color: 'var(--text-outline)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
